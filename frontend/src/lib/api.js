// ─── ComicVerse data layer ────────────────────────────────────────────────────
// Talks to the manga-novel-api backend in this repo first
// (GET /api/manga/… — it aggregates MangaDex + ComicK and scrapes
// WeebCentral / AsuraScans server-side, and proxies hotlink-protected
// images). When the backend is unreachable, MangaDex calls fall back to
// the public MangaDex API (https://api.mangadex.org, no key, CORS-enabled)
// so the app keeps working. ComicK / WeebCentral / AsuraScans have no
// browser-usable public API, so they are backend-only and report a clear
// error when the backend — or the source site — blocks the request.
//
// Ratings are NEVER invented: MangaDex numbers come from the real
// /statistics/manga endpoint (bayesian rating); Asura shows the rating
// string the source site itself displays; ComicK shows follows instead.

export const MD_API = 'https://api.mangadex.org';
export const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/$/, '');

export const SOURCES = [
  { id: 'mangadex', name: 'MangaDex', kind: 'Public API', blurb: 'Official public API. Fast, reliable, works without the backend.' },
  { id: 'comick', name: 'ComicK', kind: 'Public API', blurb: 'Large catalogue. Served through the backend (Cloudflare-protected upstream).' },
  { id: 'weebcentral', name: 'WeebCentral', kind: 'Scraped', blurb: 'HTML scrape via the backend. Works only when the source site allows the request.' },
  { id: 'asura', name: 'AsuraScans', kind: 'Scraped', blurb: 'HTML scrape via the backend. Works only when the source site allows the request.' },
];
export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const DEFAULT_SOURCE = import.meta.env.VITE_DEFAULT_SOURCE || 'mangadex';

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id) || SOURCES[0];
}

export class ApiError extends Error {
  constructor(message, { status = 0, source = null, code = 'api_error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.source = source;
    this.code = code;
  }
}

/**
 * Timeout-aware fetch. The signal is best-effort: in some embedded/test
 * runtimes (e.g. jsdom under Vitest) the fetch implementation rejects a
 * cross-realm AbortSignal, so a signal TypeError retries once without one
 * instead of failing every request. Real browsers use the signal normally.
 */
async function fetchWithTimeout(url, opts, ms) {
  let controller = null;
  try { controller = new AbortController(); } catch { controller = null; }
  if (!controller) return fetch(url, opts);
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err instanceof TypeError && /signal/i.test(err.message)) {
      return fetch(url, opts);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { ms = 20000, headers = {} } = {}) {
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { Accept: 'application/json', ...headers } }, ms);
  } catch (e) {
    throw new ApiError(`Could not reach ${new URL(url).host}. Check your connection and that the backend is running.`, { code: 'network' });
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    throw new ApiError(body?.error || body?.message || `Request failed (${res.status})`, { status: res.status, code: 'http' });
  }
  return body;
}

// ─── Backend health (cached 60s) ─────────────────────────────────────────────
let backendCache = { at: 0, ok: false, sources: null };
export async function backendHealth() {
  const now = Date.now();
  if (now - backendCache.at < 60000 && backendCache.ok) return backendCache;
  try {
    const data = await fetchJson(`${API_BASE}/api/health`, { ms: 5000 });
    backendCache = { at: now, ok: data?.status === 'ok', sources: data?.sources || null };
  } catch {
    backendCache = { at: now, ok: false, sources: null };
  }
  return backendCache;
}

export async function backendSources() {
  const health = await backendHealth();
  if (!health.ok) return [];
  try {
    const data = await fetchJson(`${API_BASE}/api/manga/sources`, { ms: 8000 });
    return (data?.sources || []).map((s) => s.id);
  } catch {
    return health.sources || [];
  }
}

/** Image URL through the backend proxy (fixes hotlink protection). */
export function proxiedImageUrl(rawUrl) {
  if (!rawUrl) return '';
  return `${API_BASE}/api/proxy/image?url=${encodeURIComponent(rawUrl)}`;
}

/** Direct cover URL for a series (used first; <CoverImage> falls back to the proxy). */
export function coverUrl(series) {
  return series?.cover || '';
}

// ─── Normalisation → one shape for every provider ────────────────────────────
// Series: { id, source, title, cover, type, status, contentRating, genres,
//   themes, description, year, authors, artists, totalChapters, lastChapter,
//   followCount, ratingValue, ratingLabel }
// Chapter: { id, number, title, lang, publishedAt, group, pages, source, external }

const TYPE_VALUES = ['manga', 'manhwa', 'manhua'];
export function normaliseType(v) {
  const t = String(v || '').toLowerCase();
  return TYPE_VALUES.includes(t) ? t : 'unknown';
}

export function normaliseStatus(v) {
  if (typeof v === 'number') return v === 1 ? 'ongoing' : v === 2 ? 'completed' : 'unknown';
  const s = String(v || '').toLowerCase();
  if (['ongoing', 'completed', 'hiatus', 'cancelled'].includes(s)) return s;
  return 'unknown';
}

export function parseChapterNumber(text) {
  if (text == null) return '';
  const m = String(text).match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

function parseSourceRating(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= 10 ? Math.round(n * 100) / 100 : null;
}

export function normaliseSeries(raw, source) {
  if (!raw) return null;
  if (source === 'comick') {
    return {
      id: raw.hid || raw.slug || '', source: 'comick', slug: raw.slug || '',
      title: raw.title || raw.slug || 'Untitled',
      cover: raw.coverUrl || '', type: normaliseType(raw.contentType),
      status: normaliseStatus(raw.status), contentRating: raw.rating || 'safe',
      genres: raw.genres || [], themes: [],
      description: raw.description || '', year: raw.year ?? null,
      authors: raw.authors || [], artists: raw.artists || [],
      totalChapters: raw.totalChapters ?? raw.lastChapter ?? null,
      lastChapter: raw.lastChapter ?? null, followCount: raw.followCount ?? null,
      ratingValue: null, ratingLabel: null,
    };
  }
  if (source === 'weebcentral') {
    return {
      id: raw.id || '', source: 'weebcentral', title: raw.title || 'Untitled',
      cover: raw.coverUrl || '', type: normaliseType(raw.contentType),
      status: normaliseStatus(raw.status), contentRating: 'safe',
      genres: raw.genres || [], themes: [], description: raw.description || '',
      year: raw.year ?? null, authors: raw.authors || [], artists: [],
      totalChapters: null, lastChapter: parseChapterNumber(raw.latestChapter) || null,
      followCount: null, ratingValue: null, ratingLabel: null,
    };
  }
  if (source === 'asura') {
    const ratingValue = parseSourceRating(raw.rating);
    return {
      id: raw.slug || '', source: 'asura', title: raw.title || 'Untitled',
      cover: raw.coverUrl || '', type: normaliseType(raw.contentType),
      status: normaliseStatus(raw.status), contentRating: 'safe',
      genres: raw.genres || [], themes: [], description: raw.description || '',
      year: raw.year ?? null, authors: raw.authors || [], artists: [],
      totalChapters: null, lastChapter: parseChapterNumber(raw.latestChapter) || null,
      followCount: null,
      ratingValue,
      ratingLabel: ratingValue != null ? 'Asura rating' : null,
    };
  }
  // mangadex (backend shape and direct shape share these fields)
  return {
    id: raw.id || '', source: 'mangadex', title: raw.title || 'Untitled',
    cover: raw.coverUrl || '', type: normaliseType(raw.contentType),
    status: normaliseStatus(raw.status), contentRating: raw.rating || 'safe',
    genres: raw.genres || [], themes: raw.themes || [],
    description: raw.description || '', year: raw.year ?? null,
    authors: raw.authors || [], artists: raw.artists || [],
    totalChapters: raw.totalChapters ?? null, lastChapter: raw.lastChapter ?? null,
    followCount: raw.followCount ?? null,
    ratingValue: raw.ratingValue ?? null, ratingLabel: raw.ratingLabel ?? null,
  };
}

export function normaliseChapter(raw, source) {
  if (!raw) return null;
  if (source === 'comick') {
    return {
      id: raw.hid || '', number: String(raw.chap ?? ''), title: raw.title || null,
      lang: raw.lang || 'en', publishedAt: raw.publishedAt || '',
      group: Array.isArray(raw.groupName) ? raw.groupName.join(', ') : (raw.groupName || 'Unknown'),
      pages: 0, source: 'comick', external: false,
    };
  }
  if (source === 'weebcentral') {
    return {
      id: raw.id || '', number: parseChapterNumber(raw.title), title: raw.title || null,
      lang: 'en', publishedAt: raw.date || '',
      group: 'WeebCentral', pages: 0, source: 'weebcentral', external: false,
    };
  }
  if (source === 'asura') {
    return {
      id: raw.slug || '', number: String(raw.number ?? parseChapterNumber(raw.title)),
      title: raw.title || null, lang: 'en', publishedAt: raw.date || '',
      group: 'AsuraScans', pages: 0, source: 'asura', external: false,
    };
  }
  // mangadex — backend aggregated shape {id, number, title, source, ...}
  // and direct feed shape {id, chapter, title, lang, ...}
  return {
    id: raw.id || '', number: String(raw.number ?? raw.chapter ?? ''),
    title: raw.title || null, lang: raw.lang || 'en',
    publishedAt: raw.publishedAt || raw.publishAt || '',
    group: raw.group || raw.scanlationGroup || 'Unknown',
    pages: raw.pages ?? 0, source: raw.source || 'mangadex',
    external: Boolean(raw.isExternal),
  };
}

export function normalisePages(raw, source) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((p) => {
      if (typeof p === 'string') return { url: p };
      if (p && typeof p.url === 'string') return { url: p.url, width: p.width || 0, height: p.height || 0 };
      return null;
    })
    .filter(Boolean);
}

// ─── Direct MangaDex client (public API, no key) ─────────────────────────────
function mdTitle(a) {
  const t = a?.title ?? {};
  return t.en ?? t['ja-ro'] ?? t.ja ?? t['ko-ro'] ?? t.ko ?? Object.values(t)[0] ?? 'Unknown';
}
function mdCover(id, rels) {
  const c = (rels ?? []).find((r) => r.type === 'cover_art');
  const f = c?.attributes?.fileName;
  return f ? `https://uploads.mangadex.org/covers/${id}/${f}.512.jpg` : '';
}
function mdTags(a, group) {
  return (a?.tags ?? []).filter((t) => t.attributes?.group === group)
    .map((t) => t.attributes?.name?.en ?? '').filter(Boolean);
}
function mdLangToType(lang) {
  if (!lang) return 'unknown';
  if (lang.startsWith('ja')) return 'manga';
  if (lang.startsWith('ko')) return 'manhwa';
  if (lang.startsWith('zh')) return 'manhua';
  return 'unknown';
}
function mdPerson(rels, type) {
  return (rels ?? []).filter((r) => r.type === type).map((r) => r.attributes?.name).filter(Boolean);
}
function mdToSeries(item) {
  const a = item.attributes ?? {};
  return normaliseSeries({
    id: item.id, title: mdTitle(a), contentType: mdLangToType(a.originalLanguage),
    coverUrl: mdCover(item.id, item.relationships ?? []),
    status: a.status ?? 'unknown', rating: a.contentRating ?? 'safe',
    genres: mdTags(a, 'genre'), themes: mdTags(a, 'theme'),
    description: a.description?.en ?? '', year: a.year ?? null,
    authors: mdPerson(item.relationships, 'author'),
    artists: mdPerson(item.relationships, 'artist'),
  }, 'mangadex');
}

const MD_RATINGS = ['safe', 'suggestive'];

function mdListParams({ title, type, page = 1, limit = 20, order = 'order[followedCount]=desc', tags = [], status = [], year = null, contentRating = MD_RATINGS, authorId = null }) {
  const p = new URLSearchParams();
  if (title) p.set('title', title);
  p.set('limit', String(Math.min(limit, 100)));
  p.set('offset', String((page - 1) * limit));
  const [k, v] = order.split('=');
  p.set(k, v);
  contentRating.forEach((r) => p.append('contentRating[]', r));
  p.append('includes[]', 'cover_art');
  p.append('includes[]', 'author');
  p.append('includes[]', 'artist');
  const langMap = { manga: ['ja', 'ja-ro'], manhwa: ['ko', 'ko-ro'], manhua: ['zh', 'zh-hk'] };
  (type && langMap[type] ? langMap[type] : []).forEach((l) => p.append('originalLanguage[]', l));
  tags.forEach((t) => p.append('includedTags[]', t));
  if (tags.length > 1) p.set('includedTagsMode', 'AND');
  status.forEach((s) => p.append('status[]', s));
  if (year) p.set('year', String(year));
  if (authorId) p.append('authors[]', authorId);
  return p;
}

async function mdList(opts) {
  const data = await fetchJson(`${MD_API}/manga?${mdListParams(opts)}`, { ms: 15000 });
  return {
    results: (data?.data ?? []).map(mdToSeries),
    total: data?.total ?? 0,
    limit: data?.limit ?? opts.limit ?? 20,
    offset: data?.offset ?? 0,
  };
}

/** Real MangaDex statistics: bayesian rating + follows. Never invented.
 *  Goes through the backend first (browsers on datacenter IPs get 403
 *  calling api.mangadex.org directly); direct call is only a fallback. */
let statsCache = new Map();
export async function getStatistics(ids) {
  const fresh = ids.filter((id) => !statsCache.has(id));
  if (fresh.length) {
    try {
      const q = fresh.map((id) => `manga[]=${encodeURIComponent(id)}`).join('&');
      let data;
      try {
        data = await backendGet(`/api/manga/statistics?ids=${fresh.map((id) => encodeURIComponent(id)).join(',')}`, { ms: 15000 });
      } catch {
        data = await fetchJson(`${MD_API}/statistics/manga?${q}`, { ms: 15000 });
      }
      Object.entries(data?.statistics ?? {}).forEach(([id, s]) => {
        statsCache.set(id, {
          bayesian: s?.rating?.bayesian ?? null,
          average: s?.rating?.average ?? null,
          follows: s?.follows ?? null,
        });
      });
      fresh.forEach((id) => { if (!statsCache.has(id)) statsCache.set(id, { bayesian: null, average: null, follows: null }); });
    } catch {
      fresh.forEach((id) => statsCache.set(id, { bayesian: null, average: null, follows: null }));
    }
  }
  const out = {};
  ids.forEach((id) => { out[id] = statsCache.get(id) || { bayesian: null, average: null, follows: null }; });
  return out;
}

/** Attach real bayesian ratings to a list of MangaDex series (best effort). */
export async function withRatings(seriesList) {
  const md = seriesList.filter((s) => s.source === 'mangadex');
  if (!md.length) return seriesList;
  const stats = await getStatistics(md.map((s) => s.id));
  return seriesList.map((s) => {
    if (s.source !== 'mangadex') return s;
    const st = stats[s.id];
    if (st?.bayesian != null) {
      return { ...s, ratingValue: Math.round(st.bayesian * 100) / 100, ratingLabel: 'MangaDex rating', followCount: st.follows ?? s.followCount };
    }
    return s;
  });
}

let tagsCache = null;
export async function getTags() {
  if (tagsCache) return tagsCache;
  let data;
  try {
    data = await backendGet('/api/manga/tags', { ms: 15000 });
  } catch {
    data = await fetchJson(`${MD_API}/manga/tag`, { ms: 15000 });
  }
  tagsCache = (data?.data ?? []).map((t) => ({
    id: t.id, name: t.attributes?.name?.en ?? '', group: t.attributes?.group ?? '',
  })).filter((t) => t.name);
  return tagsCache;
}

export async function resolveAuthorId(name) {
  if (!name?.trim()) return null;
  let data;
  try {
    data = await backendGet(`/api/manga/authors?name=${encodeURIComponent(name.trim())}`, { ms: 15000 });
  } catch {
    data = await fetchJson(`${MD_API}/author?name=${encodeURIComponent(name.trim())}&limit=5`, { ms: 15000 });
  }
  const list = data?.data ?? [];
  const exact = list.find((a) => (a.attributes?.name || '').toLowerCase() === name.trim().toLowerCase());
  return (exact || list[0])?.id || null;
}

// ─── Backend client (all four providers) ─────────────────────────────────────
async function backendGet(path, { ms = 20000 } = {}) {
  return fetchJson(`${API_BASE}${path}`, { ms });
}

function backendSearchError(source, err) {
  const name = sourceById(source).name;
  if (source === 'mangadex' || source === 'comick') {
    return new ApiError(`${name} did not answer (${err.message}). The app will retry directly where possible.`, { source, code: 'provider_down' });
  }
  return new ApiError(
    `${name} is unreachable right now — the source site is blocking the request (Cloudflare) or the backend has no proxy configured. ` +
    `Set PROXY_URL or FLARESOLVERR_URL on the backend, or try MangaDex / ComicK instead. (${err.message})`,
    { source, code: 'provider_blocked' },
  );
}

export async function searchSeries({ q, source = 'mangadex', type = null, page = 1, limit = 20 }) {
  const query = String(q || '').trim();
  if (!query) throw new ApiError('Enter a search term first.', { code: 'validation' });
  const params = new URLSearchParams({ q: query, source, page: String(page), limit: String(limit) });
  if (type) params.set('type', type);
  try {
    const data = await backendGet(`/api/manga/search?${params}`);
    const results = (data?.results ?? []).map((r) => normaliseSeries(r, source));
    return { results, total: results.length, source, page };
  } catch (err) {
    if (source === 'mangadex') {
      // Fall back to the public MangaDex API directly.
      const md = await mdList({ title: query, type, page, limit, order: 'order[relevance]=desc' });
      return { results: md.results, total: md.total, source: 'mangadex', page, fallback: true };
    }
    throw backendSearchError(source, err);
  }
}

/** Homepage lists. MangaDex lists go through the backend first (the backend
 *  proxies MangaDex with plain fetch) — browsers calling api.mangadex.org
 *  directly get a 403 on datacenter IPs, so direct is only a fallback.
 *  ComicK trending goes through the backend. WeebCentral / AsuraScans have
 *  no list endpoint — they are search-only. */
const LIST_ORDERS = {
  trending: 'order[followedCount]=desc',
  popular: 'order[rating]=desc',
  'recent-updates': 'order[latestUploadedChapter]=desc',
  'recently-added': 'order[createdAt]=desc',
};
const LIST_BACKEND_ORDERS = {
  trending: 'followedCount',
  popular: 'rating',
  'recent-updates': 'latestUploadedChapter',
  'recently-added': 'createdAt',
};
export async function listSeries(kind, { source = 'mangadex', type = null, page = 1, limit = 18 } = {}) {
  if (!LIST_ORDERS[kind]) throw new ApiError(`Unknown list: ${kind}`, { code: 'validation' });
  if (source === 'comick') {
    if (kind !== 'trending') throw new ApiError('ComicK only supports a trending list — use search for everything else.', { source, code: 'unsupported' });
    try {
      const params = new URLSearchParams({ source: 'comick', page: String(page), limit: String(limit) });
      if (type) params.set('type', type);
      const data = await backendGet(`/api/manga/trending?${params}`);
      return { results: (data?.results ?? []).map((r) => normaliseSeries(r, 'comick')), total: 0, source, page };
    } catch (err) {
      throw backendSearchError('comick', err);
    }
  }
  if (source === 'weebcentral' || source === 'asura') {
    throw new ApiError(`${sourceById(source).name} has no browse list — search for a title instead, or add titles from it in Admin → Add title.`, { source, code: 'unsupported' });
  }
  try {
    const params = new URLSearchParams({ source: 'mangadex', order: LIST_BACKEND_ORDERS[kind], page: String(page), limit: String(limit) });
    if (type) params.set('type', type);
    const data = await backendGet(`/api/manga/trending?${params}`);
    const results = (data?.results ?? []).map((r) => normaliseSeries(r, 'mangadex'));
    return { results, total: results.length, source: 'mangadex', page };
  } catch {
    // Direct public API as a fallback (works from most home connections).
    const md = await mdList({ type, page, limit, order: LIST_ORDERS[kind] });
    return { results: md.results, total: md.total, source: 'mangadex', page, fallback: true };
  }
}

/** Full browse/search against MangaDex with server-side filters.
 *  Goes through the backend first; direct public API is only a fallback. */
export async function browseMangaDex({ q = '', type = null, page = 1, limit = 20, tags = [], status = [], year = null, contentRating = MD_RATINGS, authorName = '', order = 'order[followedCount]=desc' } = {}) {
  let authorId = null;
  if (authorName?.trim()) {
    try { authorId = await resolveAuthorId(authorName); } catch { authorId = null; }
    if (!authorId) return { results: [], total: 0, page, authorNotFound: true };
  }
  try {
    const params = new URLSearchParams({ source: 'mangadex', page: String(page), limit: String(limit), order });
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (tags.length) params.set('tags', tags.join(','));
    if (status.length) params.set('status', status.join(','));
    if (year) params.set('year', String(year));
    if (contentRating?.length) params.set('contentRating', contentRating.join(','));
    if (authorId) params.set('authorId', authorId);
    const data = await backendGet(`/api/manga/search?${params}`);
    const results = (data?.results ?? []).map((r) => normaliseSeries(r, 'mangadex'));
    return { results, total: data?.total ?? results.length, page };
  } catch {
    return mdList({ title: q || undefined, type, page, limit, order, tags, status, year, contentRating, authorId });
  }
}

export async function getSeries(source, id) {
  const cleanId = String(id || '').trim();
  if (!cleanId) throw new ApiError('Missing series id.', { code: 'validation' });
  try {
    const data = await backendGet(`/api/manga/${encodeURIComponent(cleanId)}?source=${source}`);
    const series = normaliseSeries(data, source);
    if (!series) throw new Error('Empty response');
    series.id = cleanId;
    if (source === 'mangadex' && series) {
      const stats = await getStatistics([cleanId]);
      const st = stats[cleanId];
      if (st?.bayesian != null) { series.ratingValue = Math.round(st.bayesian * 100) / 100; series.ratingLabel = 'MangaDex rating'; series.followCount = st.follows ?? series.followCount; }
    }
    return series;
  } catch (err) {
    if (source === 'mangadex') {
      const data = await fetchJson(`${MD_API}/manga/${encodeURIComponent(cleanId)}?includes[]=cover_art&includes[]=author&includes[]=artist`, { ms: 15000 });
      const series = mdToSeries(data.data);
      const stats = await getStatistics([cleanId]);
      const st = stats[cleanId];
      if (st?.bayesian != null) { series.ratingValue = Math.round(st.bayesian * 100) / 100; series.ratingLabel = 'MangaDex rating'; series.followCount = st.follows ?? series.followCount; }
      return series;
    }
    throw backendSearchError(source, err);
  }
}

/** Direct MangaDex chapter feed (used as the fallback when the backend
 *  can't return chapters). External / licensed chapters are skipped — they
 *  have no readable pages. */
async function mdChaptersDirect(cleanId, lang) {
  const chapters = [];
  let offset = 0; let total = Infinity;
  while (offset < total && chapters.length < 500) {
    const data = await fetchJson(`${MD_API}/manga/${encodeURIComponent(cleanId)}/feed?limit=100&offset=${offset}&order[chapter]=asc&translatedLanguage[]=${lang}&includes[]=scanlation_group`, { ms: 15000 });
    total = data?.total ?? 0;
    const batch = (data?.data ?? []).map((c) => {
      const a = c.attributes ?? {};
      const group = (c.relationships ?? []).find((r) => r.type === 'scanlation_group');
      return normaliseChapter({ id: c.id, chapter: a.chapter, title: a.title, lang: a.translatedLanguage, publishedAt: a.publishAt, scanlationGroup: group?.attributes?.name ?? 'Unknown', pages: a.pages ?? 0, isExternal: Boolean(a.externalUrl) }, 'mangadex');
    }).filter((c) => !c.external);
    chapters.push(...batch);
    offset += 100;
    if (!batch.length) break;
  }
  return chapters;
}

export async function getChapters(source, seriesId, { lang = 'en', page = 1, limit = 96, title = '' } = {}) {
  const cleanId = String(seriesId || '').trim();
  try {
    const params = new URLSearchParams({ source, lang, page: String(page), limit: String(limit) });
    if (title) params.set('title', title);
    const data = await backendGet(`/api/manga/${encodeURIComponent(cleanId)}/chapters?${params}`);
    const chapters = (data?.chapters ?? []).map((c) => normaliseChapter(c, c.source || source)).filter(Boolean);
    if (source === 'mangadex' && chapters.length === 0) {
      // The backend aggregator swallows upstream failures and answers with an
      // empty list — an empty success is not proof there are no chapters.
      // Fall through to the direct feed before showing an empty state.
      const direct = await mdChaptersDirect(cleanId, lang);
      return { chapters: direct, total: direct.length, sources: ['mangadex'], aggregated: false, fallback: true };
    }
    return { chapters, total: data?.total ?? chapters.length, sources: data?.sources || [source], aggregated: data?.source === 'aggregated' };
  } catch (err) {
    if (source === 'mangadex') {
      // Direct feed fallback, paginated until the total is reached (cap 500).
      const chapters = await mdChaptersDirect(cleanId, lang);
      return { chapters, total: chapters.length, sources: ['mangadex'], aggregated: false, fallback: true };
    }
    throw backendSearchError(source, err);
  }
}

/** English chapter total for one MangaDex title (used by the chapter-count filter). */
const feedTotalCache = new Map();
export async function chapterFeedTotal(source, seriesId, series) {
  const key = `${source}:${seriesId}`;
  if (feedTotalCache.has(key)) return feedTotalCache.get(key);
  let total = null;
  try {
    if (source === 'mangadex') {
      const data = await fetchJson(`${MD_API}/manga/${encodeURIComponent(seriesId)}/feed?limit=1&offset=0&translatedLanguage[]=en`, { ms: 12000 });
      total = typeof data?.total === 'number' ? data.total : null;
    } else if (source === 'comick') {
      total = series?.totalChapters ?? (series?.lastChapter != null ? Number(series.lastChapter) : null);
      if (!Number.isFinite(total)) total = null;
    } else {
      total = series?.lastChapter != null ? Number(series.lastChapter) : null;
      if (!Number.isFinite(total)) total = null;
    }
  } catch { total = null; }
  feedTotalCache.set(key, total);
  return total;
}

export async function getChapterPages(source, seriesId, chapter) {
  const chapterId = chapter?.id;
  const chapterSource = chapter?.source || source;
  if (!chapterId) throw new ApiError('Missing chapter id.', { code: 'validation' });
  try {
    const data = await backendGet(`/api/manga/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages?chapterSource=${chapterSource}`);
    const pages = normalisePages(data?.pages, chapterSource);
    if (!pages.length) throw new Error('No pages returned');
    return { pages, source: chapterSource };
  } catch (err) {
    if (chapterSource === 'mangadex') {
      const data = await fetchJson(`${MD_API}/at-home/server/${encodeURIComponent(chapterId)}`, { ms: 15000 });
      const base = data?.baseUrl ?? 'https://uploads.mangadex.org';
      const hash = data?.chapter?.hash ?? '';
      const pages = (data?.chapter?.data ?? []).map((f) => ({ url: `${base}/data/${hash}/${f}` }));
      if (!pages.length) throw new ApiError('This chapter has no readable pages (it may be an external / licensed chapter).', { code: 'no_pages' });
      return { pages, source: 'mangadex', fallback: true };
    }
    throw backendSearchError(chapterSource, err);
  }
}
