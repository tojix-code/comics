// ─── Chapter download: PDF per chapter, ZIP of PDFs ────────────────────────
// The bot fetches pages live from the providers (nothing is stored anywhere)
// and builds the files on the fly, then sends them to Telegram and forgets
// them. Two hard limits shape this module:
//
// 1. Telegram bots can only SEND files up to 50 MB. A chapter PDF is usually
//    3–10 MB, so one chapter is fine, but a ZIP of many chapters is not —
//    chapters are packed into ZIPs of at most ~40 MB, and a long series
//    arrives as several ZIPs.
// 2. PDFs cannot hold .webp images (Asura pages are .webp), so every page is
//    converted to JPEG with sharp first. MangaDex pages are already JPEG.
//
// Page images are fetched through the ComicVerse image proxy first — the
// proxy is proven to work from datacenter IPs (direct CDN fetches get
// Cloudflare-challenged there, which is also why the laptop photo flow
// failed). Direct download is the fallback.

const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const sharp = require('sharp');
const api = require('./api');

const MAX_FILE_BYTES = 40 * 1024 * 1024; // stay safely under Telegram's 50 MB cap
const JPEG_QUALITY = 80;
const MAX_WIDTH = 1600;

function safeName(s) {
  return String(s ?? 'untitled').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

function chapterPdfName(series, chapter) {
  return `${safeName(series.title)} - Ch. ${chapter.number}.pdf`;
}

function zipName(series, from, to) {
  return `${safeName(series.title)} - Ch. ${from}-${to}.zip`;
}

// Download one page image: proxy first (reliable), direct as fallback.
// One retry each way — a page occasionally comes back truncated.
async function fetchPageImage(url) {
  const proxied = `${api.API_BASE}/api/proxy/image?url=${encodeURIComponent(url)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await api.fetchBuffer(proxied);
    } catch (e) {
      console.warn('[download] proxy fetch failed, trying direct:', e.message);
      try {
        return await api.fetchBuffer(url);
      } catch (e2) {
        console.warn('[download] direct fetch failed:', e2.message);
        if (attempt === 1) throw e2;
      }
    }
  }
  throw new Error('Could not download image');
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

// Build a PDF Buffer from page image buffers (webp/jpg/png → JPEG pages).
async function buildPdf(imageBuffers) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  for (const buf of imageBuffers) {
    if (!buf) continue;
    const jpg = await sharp(buf).jpeg({ quality: JPEG_QUALITY }).toBuffer();
    const meta = await sharp(jpg).metadata();
    const width = Math.min(meta.width || 800, MAX_WIDTH);
    const height = Math.round((meta.height || 1200) * (width / (meta.width || 800)));
    doc.addPage({ size: [width, height], margins: 0 });
    doc.image(jpg, 0, 0, { width, height });
  }
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

// One chapter → one PDF Buffer. Returns { buffer, pages, name }.
async function chapterPdf(series, chapter, onProgress) {
  const { pages } = await api.getPages(series.source, series.id, chapter);
  if (!pages.length) throw new Error(`Chapter ${chapter.number} has no readable pages.`);
  const images = await downloadAll(pages, onProgress);
  const usable = images.filter(Boolean);
  if (!usable.length) throw new Error(`Chapter ${chapter.number}: every page failed to download.`);
  const buffer = await buildPdf(usable);
  return { buffer, pages: usable.length, total: pages.length, name: chapterPdfName(series, chapter) };
}

// A ZIP Buffer holding the given [{ name, buffer }] files.
// (archiver v8 exports classes, not a callable factory.)
function buildZip(files) {
  return new Promise((resolve, reject) => {
    const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const f of files) archive.append(f.buffer, { name: f.name });
    archive.finalize();
  });
}

// Split chapter PDFs into ZIPs of at most MAX_FILE_BYTES each. A single
// chapter bigger than the cap goes out alone as its own PDF, not in a ZIP.
function chunkIntoZips(series, pdfs) {
  const zips = [];
  let current = [];
  let currentBytes = 0;
  let rangeStart = null;
  let rangeEnd = null;
  const flush = () => {
    if (!current.length) return;
    zips.push({ files: current, from: rangeStart, to: rangeEnd });
    current = [];
    currentBytes = 0;
    rangeStart = null;
    rangeEnd = null;
  };
  for (const pdf of pdfs) {
    if (pdf.buffer.length > MAX_FILE_BYTES) {
      flush();
      zips.push({ single: pdf });
      continue;
    }
    if (current.length && currentBytes + pdf.buffer.length > MAX_FILE_BYTES) flush();
    if (!current.length) rangeStart = pdf.number;
    rangeEnd = pdf.number;
    current.push(pdf);
    currentBytes += pdf.buffer.length;
  }
  flush();
  return zips.map((z) => {
    if (z.single) return { kind: 'pdf', pdf: z.single };
    return { kind: 'zip', name: zipName(series, z.from, z.to), files: z.files };
  });
}

module.exports = { chapterPdf, buildZip, chunkIntoZips, safeName, MAX_FILE_BYTES };
