// ComicVerse Telegram bot — search + read
// AsuraScans first (via your ComicVerse API), MangaDex fallback.
// Run:  BOT_TOKEN=... node bot.js   (see README.md)
// Telegram callback_data is capped at 64 bytes, so buttons never carry
// full IDs or slugs. Everything is stored in a per-chat session and
// buttons only carry a short index (v:0, r:3, n: …).
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const api = require('./api');

const TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Missing BOT_TOKEN. Create a bot with @BotFather, then run:\n  BOT_TOKEN=123456:ABC-DEF... node bot.js\nOr put BOT_TOKEN=... in a .env file (see .env.example).');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
const PAGE_BATCH = 10; // Telegram allows max 10 photos per media group
const CHAPTERS_PER_PAGE = 10;

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
  try {
    if (s.cover) {
      const buf = await api.fetchBuffer(s.cover);
      await ctx.replyWithPhoto({ source: buf }, { caption, parse_mode: 'HTML', ...buttons });
      return;
    }
  } catch (e) { console.warn('[bot] cover download failed, trying Telegram direct URL:', e.message); }
  // 2. Let Telegram's own servers fetch the URL — sometimes they succeed
  // where our download gets a MangaDex bot-check page (uploads host 403/302).
  try {
    if (s.cover) {
      await ctx.replyWithPhoto(s.cover, { caption, parse_mode: 'HTML', ...buttons });
      return;
    }
  } catch (e) { console.warn('[bot] cover direct URL failed, sending text instead:', e.message); }
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
      `Search failed: ${esc(e.message)}\n\nAsura is Cloudflare-blocked on the server right now and MangaDex did not answer either. Try again in a bit.`,
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
  const photos = [];
  for (const url of batch) {
    try {
      const buf = await api.fetchBuffer(url);
      photos.push({ type: 'photo', media: { source: buf } });
    } catch (e) { console.warn('[bot] page failed:', url, e.message); }
  }
  if (!photos.length) {
    await ctx.reply('Those pages failed to load (the image host blocked the download). Try another chapter — MangaDex chapters usually work.');
    return;
  }
  const from = r.pos + 1, to = r.pos + photos.length;
  await ctx.replyWithMediaGroup(photos);
  r.pos += photos.length;
  const left = r.pages.length - r.pos;
  const rows = [];
  if (left > 0) rows.push([Markup.button.callback(`Next ${Math.min(PAGE_BATCH, left)} pages (${from + photos.length}–${Math.min(r.pages.length, to + PAGE_BATCH)} of ${r.pages.length}) ➡️`, 'n:')]);
  else rows.push([Markup.button.callback('✅ End of chapter — back to chapters', 'backch')]);
  rows.push([Markup.button.callback('📚 Chapters', 'backch')]);
  await ctx.reply(`Ch. ${esc(r.chapter.number)} — pages ${from}–${to} of ${r.pages.length} (${sourceLabel(r.pagesSource)})`, Markup.inlineKeyboard(rows));
}

async function startReading(ctx, chapterIdx) {
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
  `Search AsuraScans first, MangaDex as fallback, and read chapters right here in Telegram.\n\n` +
  `• /search <title> — e.g. /search solo leveling\n` +
  `• Or just type a title — plain text also searches\n` +
  `• Tap a result → tap a chapter → pages arrive as photos, 10 at a time\n\n` +
  `Note: AsuraScans is Cloudflare-blocked on the server right now, so most searches will show MangaDex results until that's fixed (PROXY_URL / FlareSolverr on the backend). MangaDex reading works — tested with Berserk Ch. 0.01, 94 pages.`
));
bot.help((ctx) => ctx.reply(
  `Commands:\n/search <title> — search AsuraScans, fallback MangaDex\n/start — about this bot\n\nJust typing a title also searches. Tap a result, then a chapter, then Next to keep reading.`
));
bot.command('search', (ctx) => doSearch(ctx, ctx.message.text.replace(/^\/search\s*/i, '')));

// Plain text = search (ignore other commands)
bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
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
