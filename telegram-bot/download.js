// ─── Chapter download: one PDF per chapter, sent part by part ───────────────
// The bot fetches pages live from the providers (nothing is stored anywhere)
// and builds each chapter's PDF on the fly, sends it to Telegram, forgets
// it, and moves on to the next chapter. Sending part by part (instead of
// one big ZIP) keeps memory low — the bot never holds more than one chapter
// at a time — and if one chapter fails, the rest still arrive.
//
// Two hard limits shape this module:
//
// 1. Telegram bots can only SEND files up to 50 MB. A chapter PDF is usually
//    3–10 MB; a very long chapter is rebuilt smaller if it comes out over
//    45 MB, and skipped with a message if it still won't fit.
// 2. PDFs cannot hold .webp images (Asura pages are .webp), so every page is
//    converted to JPEG with sharp first. MangaDex pages are already JPEG.
//
// Page images are fetched through the ComicVerse image proxy first — the
// proxy is proven to work from datacenter IPs (direct CDN fetches get
// Cloudflare-challenged there, which is also why the laptop photo flow
// failed). Direct download is the fallback.

const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const api = require('./api');

const MAX_FILE_BYTES = 45 * 1024 * 1024; // stay safely under Telegram's 50 MB cap
const JPEG_QUALITY = 80;
const MAX_WIDTH = 1600;

function safeName(s) {
  return String(s ?? 'untitled').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

function chapterPdfName(series, chapter) {
  return `${safeName(series.title)} - Ch. ${chapter.number}.pdf`;
}// Download one page image: proxy first (reliable), direct as fallback.
// No retry loop — a genuinely broken page (e.g. a 388-byte placeholder on
// the CDN) never succeeds, and retrying it used to burn ~100s per page
// before the chapter could move on. One quick try each way, then skip it.
async function fetchPageImage(url) {
  const proxied = `${api.API_BASE}/api/proxy/image?url=${encodeURIComponent(url)}`;
  try {
    return await api.fetchBuffer(proxied, 15000);
  } catch (e) {
    console.warn('[download] proxy fetch failed, trying direct:', e.message);
    return await api.fetchBuffer(url, 15000);
  }
}

// Download pages a few at a time (faster than one-by-one, kinder than all at once).
async function downloadAll(urls, onProgress) {
  const out = new Array(urls.length).fill(null);
  const CONCURRENCY = 4;
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      try {
        out[i] = await fetchPageImage(urls[i]);
      } catch (e) {
        console.warn('[download] page failed:', urls[i], e.message);
        out[i] = null;
      }
      done++;
      if (onProgress) onProgress(done, urls.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return out;
}

// Prepare one page for the PDF: { data (JPEG buffer), width, height }.
// Speed matters here — on Render free (0.1 CPU) image conversion is the
// slowest part of a download, and the old code ran sharp TWICE per page
// (once to convert, once to measure). Now it runs at most once:
// - JPEG pages (MangaDex) are already JPEG: measure only, embed as-is.
// - WebP pages (Asura) are converted once, and the size comes back with
//   the conversion (resolveWithObject) instead of a second sharp call.
async function preparePage(buf, quality = JPEG_QUALITY, maxWidth = MAX_WIDTH) {
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  if (isJpeg) {
    const meta = await sharp(buf).metadata();
    // Small enough already: embed as-is, no conversion at all.
    if ((meta.width || 800) <= maxWidth) {
      return { data: buf, width: meta.width || 800, height: meta.height || 1200 };
    }
    // Oversized JPEG (wide MangaDex pages): shrink it — this is also what
    // makes the oversized-chapter fallback work for JPEG chapters.
    const { data, info } = await sharp(buf).resize({ width: maxWidth }).jpeg({ quality }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }
  const { data, info } = await sharp(buf).jpeg({ quality }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Build a PDF Buffer from page image buffers (webp/jpg/png → JPEG pages).
async function buildPdf(imageBuffers, quality = JPEG_QUALITY, maxWidth = MAX_WIDTH) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  for (const buf of imageBuffers) {
    if (!buf) continue;
    const page = await preparePage(buf, quality, maxWidth);
    const width = Math.min(page.width, maxWidth);
    const height = Math.round(page.height * (width / page.width));
    doc.addPage({ size: [width, height], margins: 0 });
    doc.image(page.data, 0, 0, { width, height });
  }
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

// One chapter → one PDF Buffer. Returns { buffer, pages, name }.
// A very long chapter (100+ pages) can push the PDF near Telegram's 50 MB
// send limit — if that happens, rebuild it smaller instead of failing.
async function chapterPdf(series, chapter, onProgress) {
  const { pages } = await api.getPages(series.source, series.id, chapter);
  if (!pages.length) throw new Error(`Chapter ${chapter.number} has no readable pages.`);
  const images = await downloadAll(pages, onProgress);
  const usable = images.filter(Boolean);
  if (!usable.length) throw new Error(`Chapter ${chapter.number}: every page failed to download.`);
  let buffer = await buildPdf(usable);
  if (buffer.length > MAX_FILE_BYTES) {
    console.warn(`[download] Ch. ${chapter.number} PDF is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — rebuilding smaller`);
    buffer = await buildPdf(usable, 60, 1200);
  }
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`Chapter ${chapter.number} is too big to send even compressed (${(buffer.length / 1024 / 1024).toFixed(1)} MB).`);
  return { buffer, pages: usable.length, total: pages.length, name: chapterPdfName(series, chapter) };
}

module.exports = { chapterPdf, safeName, MAX_FILE_BYTES };
