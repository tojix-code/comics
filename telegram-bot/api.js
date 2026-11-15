// ─── ComicVerse API layer ────────────────────────────────────────────────────
// Talks to your live ComicVerse backend first, exactly like the frontend does:
//   GET /api/manga/search?source=asura&q=...
//   GET /api/manga/:id?source=asura
//   GET /api/manga/:id/chapters?source=asura
//   GET /api/manga/:id/chapters/:chapterId/pages?chapterSource=asura
//
// Asura is search-only and is Cloudflare-blocked on Vercel IPs right now
// (live test 2026-11-15: search returned {"error":"Internal server error"}).
// So every call tries Asura first, then falls back to MangaDex through the
// backend, then to the public MangaDex API directly. The bot always tells
// the user which source actually answered, and never invents data.

const API_BASE = (process.env.COMICVERSE_API_URL || 'https://comicverse-api.vercel.app').replace(/\/$/, '');
const MD_API = 'https://api.mangadex.org';

async function fetchJson(url, ms = 20000) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ComicVerse-Telegram-Bot/1.0' },
    signal: AbortSignal.timeout(ms),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(body?.error || body?.message || `HTTP ${res.status} from ${url}`);
  return body;
}

async function fetchBuffer(url, ms = 25000) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'image/*,*/*;q=0.8',
      Referer: 'https://comicverse-flame.vercel.app/',
    },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/') && buf.length < 1000) throw new Error('Not an image');
  return buf;
}

function enc(v) { return encodeURIComponent(String(v)); }
function chapterNum(raw) {
  const m = String(raw?.number ?? raw?.chapter ?? raw?.title ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

// ─── Normalise to one shape ──────────────────────────────────────────────────
function normSeries(raw, source) {
  if (!raw) return null;
  const rating = raw.ratingValue ?? (() => {
    const n = parseFloat(String(raw.rating || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 && n <= 10 ? n : null;
  })();
  return {
    id: raw.id || raw.slug || '',
    source,
    title: raw.title || 'Untitled',
    cover: raw.coverUrl || raw.cover || '',
    type: String(raw.contentType || raw.type || 'unknown').toLowerCase(),
    status: String(raw.status || 'unknown').toLowerCase(),
    genres: raw.genres || [],
    description: raw.description || '',
    authors: raw.authors || [],
    year: raw.year ?? null,
    lastChapter: raw.lastChapter ?? null,
    ratingValue: rating,
    totalChapters: raw.totalChapters ?? null,
  };
}

function normChapter(raw, fallbackSource) {
  if (!raw) return null;
  const source = raw.source || fallbackSource;
  return {
    id: raw.id || raw.slug || '',
    number: String(raw.number ?? raw.chapter ?? chapterNum(raw)),
    title: raw.title || null,
    lang: raw.lang || 'en',
    publishedAt: raw.publishedAt || raw.publishAt || raw.date || '',
    group: raw.group || raw.scanlationGroup || 'Unknown',
    source,
    isExternal: Boolean(raw.isExternal || raw.externalUrl),
  };
}

// ─── Direct MangaDex (public API, no key) — fallback only ────────────────────
function mdTitle(a) {
  const t = a?.title ?? {};
  return t.en ?? t['ja-ro'] ?? t.ja ?? t['ko-ro'] ?? t.ko ?? Object.values(t)[0] ?? 'Unknown';
}
function mdCover(id, rels) {
  const c = (rels ?? []).find((r) => r.type === 'cover_art');
  const f = c?.attributes?.fileName;
  return f ? `https://uploads.mangadex.org/covers/${id}/${f}.512.jpg` : '';
}
function mdToSeries(item) {
  const a = item.attributes ?? {};
  return {
    id: item.id, source: 'mangadex', title: mdTitle(a),
    cover: mdCover(item.id, item.relationships ?? []),
    type: (a.originalLanguage || '').startsWith('ja') ? 'manga' : (a.originalLanguage || '').startsWith('ko') ? 'manhwa' : (a.originalLanguage || '').startsWith('zh') ? 'manhua' : 'unknown',
    status: String(a.status || 'unknown').toLowerCase(),
    genres: (a.tags ?? []).filter((t) => t.attributes?.group === 'genre').map((t) => t.attributes?.name?.en).filter(Boolean),
    description: a.description?.en ?? '', authors: [],
    year: a.year ?? null, lastChapter: null, ratingValue: null, totalChapters: null,
  };
}
async function mdSearchDirect(query, limit = 5) {
  const p = new URLSearchParams({ title: query, limit: String(limit), offset: '0', 'order[relevance]': 'desc', 'contentRating[]': 'safe', 'contentRating[]': 'suggestive', 'includes[]': 'cover_art' });
  const data = await fetchJson(`${MD_API}/manga?${p}`, 15000);
  return (data?.data ?? []).map(mdToSeries);
}
async function mdChaptersDirect(seriesId, limit = 500) {
  const out = [];
  let offset = 0, total = Infinity;
  while (offset < total && out.length < limit) {
    const data = await fetchJson(`${MD_API}/manga/${enc(seriesId)}/feed?limit=100&offset=${offset}&order[chapter]=asc&translatedLanguage[]=en&includes[]=scanlation_group`, 15000);
    total = data?.total ?? 0;
    const batch = (data?.data ?? []).map((c) => {
      const a = c.attributes ?? {};
      const g = (c.relationships ?? []).find((r) => r.type === 'scanlation_group');
      return normChapter({ id: c.id, chapter: a.chapter, title: a.title, lang: a.translatedLanguage, publishedAt: a.publishAt, scanlationGroup: g?.attributes?.name ?? 'Unknown', pages: a.pages ?? 0, isExternal: Boolean(a.externalUrl), source: 'mangadex' }, 'mangadex');
    }).filter((c) => !c.isExternal && c.number !== '');
    out.push(...batch);
    offset += 100;
    if (!batch.length && !(data?.data ?? []).length) break;
    if (!(data?.data ?? []).length) break;
  }
  // De-dupe by chapter number, keep first (earliest group)
  const seen = new Set();
  return out.filter((c) => { if (seen.has(c.number)) return false; seen.add(c.number); return true; });
}
async function mdPagesDirect(chapterId) {
  const data = await fetchJson(`${MD_API}/at-home/server/${enc(chapterId)}`, 15000);
  const base = data?.baseUrl ?? 'https://uploads.mangadex.org';
  const hash = data?.chapter?.hash ?? '';
  const files = data?.chapter?.data ?? [];
  if (!hash || !files.length) throw new Error('No pages from MangaDex at-home server');
  return files.map((f) => `${base}/data/${hash}/${f}`);
}

// ─── Backend (ComicVerse API) ────────────────────────────────────────────────
async function backendSearch(source, query, limit = 5) {
  const data = await fetchJson(`${API_BASE}/api/manga/search?source=${source}&q=${enc(query)}&limit=${limit}`);
  return (data?.results ?? []).map((r) => normSeries(r, source));
}

async function searchSeries(query) {
  // 1. Asura first — this is the point of the bot
  try {
    const asura = await backendSearch('asura', query, 5);
    if (asura.length) return { source: 'asura', results: asura, fallback: false };
  } catch (e) {
    console.warn('[bot] Asura search failed, falling back:', e.message);
  }
  // 2. MangaDex through your backend (plain-fetch path, works on Vercel)
  try {
    const md = await backendSearch('mangadex', query, 5);
    if (md.length) return { source: 'mangadex', results: md, fallback: true, fallbackReason: 'Asura is blocked right now (Cloudflare), so these are MangaDex results.' };
  } catch (e) {
    console.warn('[bot] Backend MangaDex search failed:', e.message);
  }
  // 3. Public MangaDex API directly
  const direct = await mdSearchDirect(query, 5);
  return { source: 'mangadex', results: direct, fallback: true, fallbackReason: 'Asura is blocked right now (Cloudflare), so these are MangaDex results.' };
}

async function getSeries(source, id) {
  try {
    const data = await fetchJson(`${API_BASE}/api/manga/${enc(id)}?source=${source}`);
    const s = normSeries(data, source);
    if (s && s.title && s.title !== 'Untitled') { s.id = id; return s; }
    throw new Error('Empty series from backend');
  } catch (e) {
    if (source !== 'mangadex') throw e;
    const data = await fetchJson(`${MD_API}/manga/${enc(id)}?includes[]=cover_art&includes[]=author&includes[]=artist`, 15000);
    return mdToSeries(data.data);
  }
}

async function getChapters(source, seriesId, title = '') {
  // Backend first
  try {
    const params = new URLSearchParams({ source, lang: 'en', page: '1', limit: '96' });
    if (title) params.set('title', title);
    const data = await fetchJson(`${API_BASE}/api/manga/${enc(seriesId)}/chapters?${params}`);
    let chapters = (data?.chapters ?? []).map((c) => normChapter(c, c.source || source)).filter((c) => c.id && c.number !== '');
    const allComick = chapters.length > 0 && chapters.every((c) => c.source === 'comick');
    // ComicK chapters have no readable pages (its API returns md_images: []),
    // and an empty aggregated list is not proof there are no chapters.
    // In both cases, prefer the direct MangaDex feed for MangaDex titles.
    if (source === 'mangadex' && (chapters.length === 0 || allComick)) {
      const direct = await mdChaptersDirect(seriesId);
      if (direct.length) return { chapters: direct, source: 'mangadex', fallback: true, allComick: false };
      // Direct MangaDex has no free chapters (e.g. Solo Leveling is all
      // licensed/external there). Keep the ComicK list so the user can see
      // chapters exist, but flag it — reading will likely fail.
      if (chapters.length) return { chapters, source: 'mangadex', fallback: false, allComick: true };
    }
    if (chapters.length) return { chapters, source: data?.source === 'aggregated' ? 'mangadex' : source, fallback: false, allComick };
  } catch (e) {
    console.warn('[bot] Backend chapters failed:', e.message);
  }
  if (source === 'mangadex') {
    const direct = await mdChaptersDirect(seriesId);
    return { chapters: direct, source: 'mangadex', fallback: true, allComick: false };
  }
  throw new Error('Could not load chapters for this source right now.');
}

async function getPages(source, seriesId, chapter) {
  const chapterSource = chapter.source || source;
  // Backend first — for MangaDex this already returns real at-home URLs
  try {
    const data = await fetchJson(`${API_BASE}/api/manga/${enc(seriesId)}/chapters/${enc(chapter.id)}/pages?chapterSource=${chapterSource}`);
    const pages = (data?.pages ?? []).filter((p) => typeof p === 'string' && p.startsWith('http'));
    if (pages.length) return { pages, source: chapterSource };
    throw new Error('No pages from backend');
  } catch (e) {
    console.warn('[bot] Backend pages failed:', e.message);
  }
  // MangaDex direct at-home
  if (chapterSource === 'mangadex') {
    const pages = await mdPagesDirect(chapter.id);
    return { pages, source: 'mangadex', fallback: true };
  }
  // ComicK chapter with no pages? Try the same chapter number on MangaDex.
  if (chapterSource === 'comick' && chapter.number) {
    const mdChapters = await mdChaptersDirect(seriesId);
    const match = mdChapters.find((c) => c.number === chapter.number);
    if (match) {
      const pages = await mdPagesDirect(match.id);
      return { pages, source: 'mangadex', fallback: true };
    }
  }
  throw new Error('This chapter has no readable pages. Its ComicK version returns no images, and MangaDex has no free (non-licensed) version of this chapter — Asura would be the readable source here, but it is Cloudflare-blocked right now.');
}

module.exports = { API_BASE, searchSeries, getSeries, getChapters, getPages, fetchBuffer };
