// ComicVerse Telegram bot — search + read
// AsuraScans first (via your ComicVerse API), MangaDex fallback.
// Run:  BOT_TOKEN=... node bot.js   (see README.md)
// Telegram callback_data is capped at 64 bytes, so buttons never carry
// full IDs or slugs. Everything is stored in a per-chat session and
// buttons only carry a short index (v:0, r:3, n: …).
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const api = require('./api');
const dl = require('./download');

const TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Missing BOT_TOKEN. Create a bot with @BotFather, then run:\n  BOT_TOKEN=123456:ABC-DEF... node bot.js\nOr put BOT_TOKEN=... in a .env file (see .env.example).');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const PAGE_BATCH = 10; // Telegram allows max 10 photos per media group
const CHAPTERS_PER_PAGE = 10;
// Mini App reader — the ComicVerse web reader, opened inside Telegram.
// It already has strip/paged reading, a chapter dropdown and Prev/Next
// chapter buttons. Reading happens in the phone's browser (Telegram WebView),
// so page images load directly from the CDN — the bot running on a laptop
// no longer has to download every page itself (that download is what was
// failing with "fetch failed" for Asura CDN images on Windows).
const MINI_READER_BASE = (process.env.MINI_READER_URL || 'https://comicverse-flame.vercel.app/read').replace(/\/$/, '');
function readerUrl(source, seriesId, chapterId) {
  return `${MINI_READER_BASE}/${encodeURIComponent(source)}/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterId)}?mini=1`;
}

// chatId -> { results:[], series, chapters:[], chapterPage:0, reading:{pages,pos,chapter,series} }
const sessions = new Map();
function session(ctx) {
  const id = ctx.chat.id;
  if (!sessions.has(id)) sessions.set(id, {});
  return sessions.get(id);
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function trunc(s, n = 600) {
  s = String(s || '').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function sourceLabel(s) { return s === 'asura' ? 'AsuraScans' : s === 'mangadex' ? 'MangaDex' : s; }

function seriesCaption(s, extra = '') {
  const lines = [
    `<b>${esc(s.title)}</b>`,
    `${sourceLabel(s.source)} • ${esc(s.type || 'unknown')} • ${esc(s.status || 'unknown')}${s.year ? ` • ${s.year}` : ''}`,
    s.ratingValue ? `★ ${s.ratingValue} (Asura rating)` : '',
    s.genres?.length ? `Genres: ${esc(s.genres.slice(0, 6).join(', '))}` : '',
    s.authors?.length ? `By ${esc(s.authors.join(', '))}` : '',
    '',
    trunc(s.description, 500),
    extra ? `\n${extra}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendCover(ctx, s, caption, buttons) {
  // 1. Download the cover ourselves and upload it (most reliable for pages).
  let buf = null;
  try {
    if (s.cover) {
      buf = await api.fetchBuffer(s.cover);
      await ctx.replyWithPhoto({ source: buf }, { caption, parse_mode: 'HTML', ...buttons });
      return;
    }
  } catch (e) { console.warn('[bot] cover photo failed, trying direct URL:', e.message); }
  // 2. Let Telegram's own servers fetch the URL — sometimes they succeed
  // where our download gets a MangaDex bot-check page (uploads host 403/302).
  try {
    if (s.cover) {
      await ctx.replyWithPhoto(s.cover, { caption, parse_mode: 'HTML', ...buttons });
      return;
    }
  } catch (e) { console.warn('[bot] cover direct URL failed, trying document:', e.message); }
  // 2b. Asura covers are .webp — if Telegram rejects them as a photo,
  // send as a document (still shows inline in the chat).
  try {
    if (buf) {
      await ctx.replyWithDocument({ source: buf, filename: 'cover.webp' }, { caption, parse_mode: 'HTML', ...buttons });
      return;
    }
  } catch (e) { console.warn('[bot] cover document failed, sending text instead:', e.message); }
  // 3. Text only — the series info still works, just without a cover photo.
  await ctx.reply(caption, { parse_mode: 'HTML', ...buttons });
}

// ─── Search ──────────────────────────────────────────────────────────────────
async function doSearch(ctx, query) {
  const q = String(query || '').trim();
  if (!q) { await ctx.reply('Send me a title to search. Example:\n/search solo leveling\n\nOr just type the name — plain text also searches.'); return; }
  const wait = await ctx.reply(`🔍 Searching for “${esc(q)}”…\nTrying AsuraScans first, MangaDex as fallback.`, { parse_mode: 'HTML' });
  try {
    const { source, results, fallback, fallbackReason } = await api.searchSeries(q);
    const s = session(ctx);
    s.results = results; s.query = q;
    if (!results.length) {
      await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined, `No results for “${esc(q)}”.\nTry a different spelling, or a shorter title.`, { parse_mode: 'HTML' });
      return;
    }
    const lines = results.map((r, i) => `${i + 1}. <b>${esc(r.title)}</b> — ${sourceLabel(r.source)} • ${esc(r.type)} • ${esc(r.status)}${r.lastChapter ? ` • Ch. ${esc(r.lastChapter)}` : ''}`).join('\n');
    const note = fallback ? `\n\n⚠️ ${esc(fallbackReason || 'Asura is blocked right now, showing MangaDex results.')}` : `\n\n✅ Source: AsuraScans`;
    const buttons = results.map((r, i) => [Markup.button.callback(`${i + 1}. ${r.title.slice(0, 30)}`, `v:${i}`)]);
    await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined,
      `Results for “${esc(q)}”:\n\n${lines}${note}\n\nTap a title to see its chapters:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined,
      `Search failed: ${esc(e.message)}\n\nAsura and MangaDex both failed to answer. Try again in a bit.`,
      { parse_mode: 'HTML' });
  }
}

// ─── Series view + chapters ──────────────────────────────────────────────────
function chapterButtons(s, page = 0) {
  const start = page * CHAPTERS_PER_PAGE;
  const slice = s.chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const rows = slice.map((c, i) => [Markup.button.callback(`Ch. ${c.number}${c.title ? ` — ${c.title.slice(0, 25)}` : ''}`, `r:${start + i}`)]);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Prev', `cp:${page - 1}`));
  if (start + CHAPTERS_PER_PAGE < s.chapters.length) nav.push(Markup.button.callback('Next ➡️', `cp:${page + 1}`));
  if (nav.length) rows.push(nav);
  // Quick read-latest button on first page
  if (page === 0 && s.chapters.length) rows.unshift([Markup.button.callback(`📖 Read latest (Ch. ${s.chapters[s.chapters.length - 1].number})`, `r:${s.chapters.length - 1}`)]);
  rows.push([Markup.button.callback('⬇️ Download chapters (PDF)', 'dl:')]);
  return Markup.inlineKeyboard(rows);
}

// Same chapter list, but tapping a chapter downloads it as a PDF.
function downloadChapterButtons(s, page = 0) {
  const start = page * CHAPTERS_PER_PAGE;
  const slice = s.chapters.slice(start, start + CHAPTERS_PER_PAGE);
  const rows = slice.map((c, i) => [Markup.button.callback(`⬇️ Ch. ${c.number}${c.title ? ` — ${c.title.slice(0, 25)}` : ''}`, `d:${start + i}`)]);
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('⬅️ Prev', `dp:${page - 1}`));
  if (start + CHAPTERS_PER_PAGE < s.chapters.length) nav.push(Markup.button.callback('Next ➡️', `dp:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('📚 Back to chapters', 'backch')]);
  return Markup.inlineKeyboard(rows);
}

async function showSeries(ctx, idx) {
  const s = session(ctx);
  const hit = s.results?.[idx];
  if (!hit) { await ctx.answerCbQuery('That result expired — search again.'); return; }
  await ctx.answerCbQuery();
  const wait = await ctx.reply(`Loading <b>${esc(hit.title)}</b>…`, { parse_mode: 'HTML' });
  try {
    const full = await api.getSeries(hit.source, hit.id);
    const { chapters, allComick } = await api.getChapters(hit.source, hit.id, full.title);
    // Oldest first in the list, newest last — matches the reader order
    s.series = full; s.chapters = chapters; s.chapterPage = 0; s.allComick = !!allComick;
    const warn = allComick ? `\n⚠️ Chapters here are ComicK-only and ComicK returns no page images, and MangaDex has no free version of this title (licensed). Reading will likely fail until Asura is unblocked.` : '';
    const caption = seriesCaption(full, chapters.length ? `\n📚 ${chapters.length} chapters loaded (${sourceLabel(chapters[0]?.source || full.source)})${warn}` : '\n📚 No chapters found.');
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    if (!chapters.length) {
      await sendCover(ctx, full, caption + '\n\nNo readable chapters right now.', Markup.inlineKeyboard([[Markup.button.callback('🔍 New search', 'newsearch')]]));
      return;
    }
    await sendCover(ctx, full, caption, chapterButtons(s, 0));
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined, `Could not load that series: ${esc(e.message)}`, { parse_mode: 'HTML' });
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────
async function sendPageBatch(ctx) {
  const s = session(ctx);
  const r = s.reading;
  if (!r) return;
  const batch = r.pages.slice(r.pos, r.pos + PAGE_BATCH);
  if (!batch.length) {
    await ctx.reply(`✅ End of Chapter ${esc(r.chapter.number)} — ${esc(r.series.title)}.\n\nTap Chapters to pick another one.`,
      Markup.inlineKeyboard([[Markup.button.callback('📚 Chapters', 'backch')]]));
    return;
  }
  // Download first, then send as one album — Telegram can't reliably fetch
  // MangaDex / Asura CDN URLs directly (hotlink protection).
  const buffers = [];
  for (const url of batch) {
    try {
      const buf = await api.fetchBuffer(url);
      buffers.push({ url, buf });
    } catch (e) { console.warn('[bot] page failed:', url, e.message); }
  }
  if (!buffers.length) {
    await ctx.reply('Those pages failed to load (the image host blocked the download). Try another chapter — MangaDex chapters usually work.');
    return;
  }
  const from = r.pos + 1, to = r.pos + buffers.length;
  const photos = buffers.map(({ buf }) => ({ type: 'photo', media: { source: buf } }));
  try {
    await ctx.replyWithMediaGroup(photos);
  } catch (e) {
    // Asura pages are .webp — if Telegram rejects the album as photos,
    // send them one by one as documents (still shows inline in the chat).
    console.warn('[bot] media group failed, sending pages as documents:', e.message);
    for (const { url, buf } of buffers) {
      try {
        const name = url.split('/').pop()?.split('?')[0] || 'page.webp';
        await ctx.replyWithDocument({ source: buf, filename: name });
      } catch (e2) { console.warn('[bot] document page failed:', url, e2.message); }
    }
  }
  r.pos += buffers.length;
  const left = r.pages.length - r.pos;
  const rows = [];
  if (left > 0) rows.push([Markup.button.callback(`Next ${Math.min(PAGE_BATCH, left)} pages (${from + photos.length}–${Math.min(r.pages.length, to + PAGE_BATCH)} of ${r.pages.length}) ➡️`, 'n:')]);
  else rows.push([Markup.button.callback('✅ End of chapter — back to chapters', 'backch')]);
  rows.push([Markup.button.callback('📚 Chapters', 'backch')]);
  await ctx.reply(`Ch. ${esc(r.chapter.number)} — pages ${from}–${to} of ${r.pages.length} (${sourceLabel(r.pagesSource)})`, Markup.inlineKeyboard(rows));
}

async function startReading(ctx, chapterIdx) {
  // Mini App first: tapping a chapter opens the ComicVerse reader inside
  // Telegram, with the chapter's pages and Prev/Next chapter buttons.
  // The old in-chat photo flow is still available via "Send pages in chat"
  // (r2:), but it downloads every page on the machine running the bot —
  // and on Gagan's Windows laptop that download fails for Asura CDN images
  // ("fetch failed"), so the Mini App is the reliable way to read.
  const s = session(ctx);
  const chapter = s.chapters?.[chapterIdx];
  if (!chapter || !s.series) { await ctx.answerCbQuery('Chapter expired — open the series again.'); return; }
  await ctx.answerCbQuery();
  const url = readerUrl(s.series.source, s.series.id, chapter.id);
  await ctx.reply(
    `<b>${esc(s.series.title)}</b> — Chapter ${esc(chapter.number)}${chapter.title ? ` — ${esc(chapter.title)}` : ''}\n${sourceLabel(s.series.source)} • tap below to read.`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('📖 Open Reader', url)],
        [Markup.button.callback('📥 Send pages in chat instead', `r2:${chapterIdx}`)],
        [Markup.button.callback('⬇️ Download this chapter (PDF)', `d:${chapterIdx}`)],
        [Markup.button.callback('📚 Chapters', 'backch')],
      ]),
    }
  );
}

// ─── Downloads ───────────────────────────────────────────────────────────────
// One chapter → one PDF, sent part by part: build, send, forget, next.

async function downloadOneChapter(ctx, chapterIdx) {
  const s = session(ctx);
  const chapter = s.chapters?.[chapterIdx];
  if (!chapter || !s.series) { await ctx.answerCbQuery('Chapter expired — open the series again.'); return; }
  await ctx.answerCbQuery(`Downloading Ch. ${chapter.number}…`);
  const status = await ctx.reply(`⬇️ Downloading <b>${esc(s.series.title)}</b> — Ch. ${esc(chapter.number)}…`, { parse_mode: 'HTML' });
  try {
    let lastEdit = 0;
    const { buffer, pages, total, name } = await dl.chapterPdf(s.series, chapter, (done, all) => {
      const now = Date.now();
      if (now - lastEdit < 4000 && done < all) return;
      lastEdit = now;
      ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
        `⬇️ Downloading <b>${esc(s.series.title)}</b> — Ch. ${esc(chapter.number)}…\n${done}/${all} pages`, { parse_mode: 'HTML' }).catch(() => {});
    });
    await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
      `📄 Sending <b>${esc(name)}</b> (${pages}/${total} pages, ${(buffer.length / 1024 / 1024).toFixed(1)} MB)…`, { parse_mode: 'HTML' }).catch(() => {});
    await ctx.replyWithDocument({ source: buffer, filename: name }, { caption: `<b>${esc(s.series.title)}</b> — Chapter ${esc(chapter.number)}`, parse_mode: 'HTML' });
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
      `Download failed for Ch. ${esc(chapter.number)}: ${esc(e.message)}`, { parse_mode: 'HTML' }).catch(() => {});
  }
}

async function downloadChapters(ctx, chapters) {
  const s = session(ctx);
  if (!chapters.length) { await ctx.reply('No chapters in that range.'); return; }
  const status = await ctx.reply(`⬇️ Downloading <b>${esc(s.series.title)}</b> — ${chapters.length} chapter(s), one PDF at a time…`, { parse_mode: 'HTML' });
  let sent = 0;
  let failed = 0;
  try {
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
        `⬇️ Downloading <b>${esc(s.series.title)}</b> — ${i + 1}/${chapters.length} (Ch. ${esc(ch.number)})…\n${sent} sent${failed ? `, ${failed} skipped` : ''}`, { parse_mode: 'HTML' }).catch(() => {});
      try {
        const pdf = await dl.chapterPdf(s.series, ch);
        await ctx.replyWithDocument({ source: pdf.buffer, filename: pdf.name },
          { caption: `<b>${esc(s.series.title)}</b> — Chapter ${esc(ch.number)} (${pdf.pages}/${pdf.total} pages)`, parse_mode: 'HTML' });
        sent++;
      } catch (e) {
        failed++;
        console.warn('[bot] chapter download failed:', ch.number, e.message);
        await ctx.reply(`⚠️ Skipped Ch. ${esc(ch.number)}: ${esc(e.message)}`, { parse_mode: 'HTML' });
      }
    }
    await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined,
      `✅ Done — <b>${esc(s.series.title)}</b>: ${sent} chapter(s) sent${failed ? `, ${failed} skipped` : ''}.`, { parse_mode: 'HTML' }).catch(() => {});
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, `Download stopped: ${esc(e.message)}`, { parse_mode: 'HTML' }).catch(() => {});
  }
}

// Load the full chapter list (the series view only loads the first 96).
async function fullChapterList(ctx) {
  const s = session(ctx);
  const { chapters } = await api.getChapters(s.series.source, s.series.id, s.series.title, 500);
  if (chapters.length) { s.chapters = chapters; }
  return s.chapters;
}

async function showDownloadMenu(ctx) {
  const s = session(ctx);
  if (!s.series || !s.chapters) { await ctx.answerCbQuery('Open a series first.'); return; }
  await ctx.answerCbQuery();
  await ctx.reply(
    `⬇️ <b>Download ${esc(s.series.title)}</b>\n${s.chapters.length} chapters loaded.\n\nEach chapter is sent as its own PDF, one after another — no big ZIP to wait for, and if one chapter fails the rest still arrive.`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📄 Single chapter (PDF)', 'dl1:')],
        [Markup.button.callback('📄 A range of chapters (PDF each)', 'dlr:')],
        [Markup.button.callback('📄 All chapters (PDF each)', 'dla:')],
        [Markup.button.callback('📚 Back to chapters', 'backch')],
      ]),
    }
  );
}

async function startReadingInChat(ctx, chapterIdx) {
  const s = session(ctx);
  const chapter = s.chapters?.[chapterIdx];
  if (!chapter || !s.series) { await ctx.answerCbQuery('Chapter expired — open the series again.'); return; }
  await ctx.answerCbQuery(`Loading Ch. ${chapter.number}…`);
  const wait = await ctx.reply(`📖 Loading Chapter ${esc(chapter.number)}…`, { parse_mode: 'HTML' });
  try {
    const { pages, source } = await api.getPages(s.series.source, s.series.id, chapter);
    s.reading = { pages, pos: 0, chapter, series: s.series, pagesSource: source };
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`<b>${esc(s.series.title)}</b> — Chapter ${esc(chapter.number)}${chapter.title ? ` — ${esc(chapter.title)}` : ''}\n${pages.length} pages • ${sourceLabel(source)}`, { parse_mode: 'HTML' });
    await sendPageBatch(ctx);
  } catch (e) {
    await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined, `Could not read Chapter ${esc(chapter.number)}: ${esc(e.message)}`, { parse_mode: 'HTML' });
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────
bot.start((ctx) => ctx.reply(
  `👋 Hi, I'm the ComicVerse bot.\n\n` +
  `Search AsuraScans first, MangaDex as fallback, and read chapters in the Mini App reader right inside Telegram.\n\n` +
  `• /search <title> — e.g. /search solo leveling\n` +
  `• Or just type a title — plain text also searches\n` +
  `• Tap a result → tap a chapter → 📖 Open Reader opens the Mini App, with Prev / Next chapter buttons at the bottom\n` +
  `• Tap ⬇️ Download chapters on a series to save chapters as PDFs, one per chapter, sent one after another\n\n` +
  `Note: AsuraScans works now (fixed 2026-11-15) — searches try Asura first, MangaDex as fallback. MangaDex reading works — tested with Berserk Ch. 0.01, 94 pages.`
));
bot.help((ctx) => ctx.reply(
  `Commands:\n/search <title> — search AsuraScans, fallback MangaDex\n/start — about this bot\n\nJust typing a title also searches. Tap a result, then a chapter, then 📖 Open Reader — the Mini App has Prev / Next chapter buttons. Use ⬇️ Download chapters on a series page to save PDFs.`
));
bot.command('search', (ctx) => doSearch(ctx, ctx.message.text.replace(/^\/search\s*/i, '')));

// Plain text = search, unless the bot is waiting for a download range.
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const s = session(ctx);
  if (s.awaitingRange) {
    s.awaitingRange = false;
    const m = ctx.message.text.trim().match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    if (!m) { await ctx.reply('That doesn\'t look like a range. Send it like 1-10 (chapter numbers, with a dash).'); return; }
    const from = parseFloat(m[1]);
    const to = parseFloat(m[2]);
    if (!(to >= from)) { await ctx.reply('The second number should be bigger than the first. Send a range like 1-10.'); return; }
    try {
      const chapters = await fullChapterList(ctx);
      const picked = chapters.filter((c) => {
        const n = parseFloat(c.number);
        return Number.isFinite(n) && n >= from && n <= to;
      });
      if (!picked.length) { await ctx.reply(`No chapters between ${from} and ${to} in this series.`); return; }
      if (picked.length > 50) {
        await ctx.reply(`That's ${picked.length} chapters — too many for one go. I'll do the first 50 (Ch. ${picked[0].number}–${picked[49].number}); send another range for the rest.`);
        await downloadChapters(ctx, picked.slice(0, 50));
        return;
      }
      await downloadChapters(ctx, picked);
    } catch (e) {
      await ctx.reply(`Could not load the chapter list: ${esc(e.message)}`, { parse_mode: 'HTML' });
    }
    return;
  }
  return doSearch(ctx, ctx.message.text);
});

// ─── Buttons ─────────────────────────────────────────────────────────────────
bot.action(/^v:(\d+)$/, (ctx) => showSeries(ctx, Number(ctx.match[1])));
bot.action(/^cp:(\d+)$/, async (ctx) => {
  const s = session(ctx);
  if (!s.series || !s.chapters) { await ctx.answerCbQuery('Open a series first.'); return; }
  await ctx.answerCbQuery();
  s.chapterPage = Number(ctx.match[1]);
  await ctx.editMessageCaption(seriesCaption(s.series, `\n📚 ${s.chapters.length} chapters`), { parse_mode: 'HTML', ...chapterButtons(s, s.chapterPage) }).catch(async () => {
    await ctx.reply(seriesCaption(s.series), { parse_mode: 'HTML', ...chapterButtons(s, s.chapterPage) });
  });
});
bot.action(/^r:(\d+)$/, (ctx) => startReading(ctx, Number(ctx.match[1])));
bot.action(/^r2:(\d+)$/, (ctx) => startReadingInChat(ctx, Number(ctx.match[1])));
bot.action('dl:', (ctx) => showDownloadMenu(ctx));
bot.action('dl1:', async (ctx) => {
  const s = session(ctx);
  await ctx.answerCbQuery();
  if (!s.series || !s.chapters) { await ctx.reply('Open a series first.'); return; }
  s.chapterPage = 0;
  await ctx.reply(`⬇️ Pick a chapter to download as a PDF — <b>${esc(s.series.title)}</b>:`, { parse_mode: 'HTML', ...downloadChapterButtons(s, 0) });
});
bot.action(/^dp:(\d+)$/, async (ctx) => {
  const s = session(ctx);
  if (!s.series || !s.chapters) { await ctx.answerCbQuery('Open a series first.'); return; }
  await ctx.answerCbQuery();
  s.chapterPage = Number(ctx.match[1]);
  await ctx.reply(`⬇️ Pick a chapter to download as a PDF — <b>${esc(s.series.title)}</b>:`, { parse_mode: 'HTML', ...downloadChapterButtons(s, s.chapterPage) });
});
bot.action(/^d:(\d+)$/, (ctx) => downloadOneChapter(ctx, Number(ctx.match[1])));
bot.action('dlr:', async (ctx) => {
  const s = session(ctx);
  await ctx.answerCbQuery();
  if (!s.series || !s.chapters) { await ctx.reply('Open a series first.'); return; }
  s.awaitingRange = true;
  await ctx.reply(`📦 Which chapters? Reply with a range like <b>1-10</b> (chapter numbers, with a dash).\nEach chapter arrives as its own PDF, one after another.`, { parse_mode: 'HTML' });
});
bot.action('dla:', async (ctx) => {
  const s = session(ctx);
  await ctx.answerCbQuery('Loading the full chapter list…');
  if (!s.series) { await ctx.reply('Open a series first.'); return; }
  try {
    const chapters = await fullChapterList(ctx);
    if (!chapters.length) { await ctx.reply('No chapters found for this series.'); return; }
    if (chapters.length > 100) {
      await ctx.reply(`That's ${chapters.length} chapters — I'll do the first 100 (Ch. ${chapters[0].number}–${chapters[99].number}). Send a range like 101-200 for the rest.`);
      await downloadChapters(ctx, chapters.slice(0, 100));
      return;
    }
    await downloadChapters(ctx, chapters);
  } catch (e) {
    await ctx.reply(`Could not load the chapter list: ${esc(e.message)}`, { parse_mode: 'HTML' });
  }
});
bot.action('n:', async (ctx) => { await ctx.answerCbQuery(); await sendPageBatch(ctx); });
bot.action('backch', async (ctx) => {
  const s = session(ctx);
  await ctx.answerCbQuery();
  if (!s.series || !s.chapters) { await ctx.reply('Search for a series first: /search <title>'); return; }
  await ctx.reply(seriesCaption(s.series, `\n📚 ${s.chapters.length} chapters`), { parse_mode: 'HTML', ...chapterButtons(s, 0) });
});
bot.action('newsearch', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('What do you want to read? Type a title, or /search <title>'); });

bot.catch((err) => console.error('[bot] error:', err));

// ─── Health server for Render (Web Service) ──────────────────────────────────
// Render free Web Services must bind to $PORT or the deploy fails.
// This bot uses long-polling (it asks Telegram for updates, Telegram never
// calls us), so this server does nothing except say "I'm alive".
// NOTE: free Render sleeps after ~15 min without inbound traffic, so the
// bot will be slow to wake on first message. For true 24/7, use a paid
// Background Worker ($7/mo on Render), Railway, or a Vercel webhook version.
if (process.env.PORT) {
  const http = require('http');
  http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ComicVerse Telegram bot is running\n');
  }).listen(process.env.PORT, () => console.log('Health server on port', process.env.PORT));
}

bot.launch().then(() => {
  console.log('ComicVerse Telegram bot is running.');
  console.log('API:', api.API_BASE, '| Asura first, MangaDex fallback.');
  console.log('Try in Telegram: /search solo leveling');
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
