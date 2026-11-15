import * as cheerio from "cheerio";
import { fetchHTMLPlain, fetchHTML, fetchJSONPlain } from "../utils/httpClient";

// ─── AsuraScans — new site (rewritten 2026-11-15) ────────────────────────────
// The old site (asuracomic.net, /series?name=…, old selectors) is dead:
// asuracomic.net 301-redirects to asurascans.com, and /series?name=… is a 404.
// The new site is an Astro site at https://asurascans.com, with a real public
// JSON API at https://api.asurascans.com — found in the umesh-m666/comicveser
// repo (apps/api/src/sources/asurascans.provider.ts), which uses it instead
// of scraping for search/details:
//   search:  GET /api/series?search=<q>&limit=5&offset=0
//            → { data: [{ slug, title, type, status, rating, chapter_count,
//                 cover, public_url: "/comics/<slug>-<8hex>", genres: […] }], meta: { total } }
//   details: same API, search by bare slug, match public_url last segment.
//   chapters: HTML scrape GET /comics/<slug> (same as that repo)
//   pages:    HTML scrape GET /comics/<slug>/chapter/<num>
//            → <img src="https://cdn.asurascans.com/asura-images/chapters/<slug>/<num>/001.webp…">
// Slugs look like "infinite-mage-f212c582" — keep the full "comics/…" path as
// the id, so the backend route /api/manga/:id (encodeURIComponent) still works.
// Plain fetch works from a normal network (200, real HTML/JSON, no challenge);
// got-scraping is only a fallback if plain fetch is challenged.

const BASE = "https://asurascans.com";
const API = "https://api.asurascans.com";

interface ApiSeriesRow {
  slug?: string; title?: string; type?: string; status?: string;
  rating?: number; chapter_count?: number; cover?: string;
  public_url?: string; description?: string; author?: string; artist?: string;
  genres?: { id?: number; name?: string; slug?: string }[];
}

function bareSlug(input: string): string {
  return String(input || "").trim().replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "")
    .replace(/^comics\//, "").replace(/^series\//, "").replace(/\/$/, "");
}

function fullSlugFromRow(row: ApiSeriesRow): string {
  const last = String(row.public_url ?? "").split("/").filter(Boolean).pop();
  return last ? `comics/${last}` : `comics/${row.slug ?? ""}`;
}

function rating1(n?: number): string {
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "";
}

function rowToResult(row: ApiSeriesRow): AsuraResult {
  return {
    slug: fullSlugFromRow(row),
    title: row.title ?? "",
    contentType: parseType(row.type ?? ""),
    coverUrl: row.cover ?? "",
    status: row.status ?? "",
    latestChapter: row.chapter_count != null ? String(row.chapter_count) : "",
    rating: rating1(row.rating),
  };
}

async function apiSeriesSearch(search: string, limit = 5): Promise<ApiSeriesRow[]> {
  const body = await fetchJSONPlain<{ data?: ApiSeriesRow[] }>(
    `${API}/api/series?search=${encodeURIComponent(search)}&limit=${limit}&offset=0`,
    BASE + "/"
  );
  return Array.isArray(body?.data) ? body.data : [];
}

export interface AsuraResult {
  slug: string; title: string;
  contentType: "manga" | "manhwa" | "manhua" | "unknown";
  coverUrl: string; status: string; latestChapter: string; rating: string;
}
export interface AsuraChapter { slug: string; number: string; title: string; date: string; }

function parseType(raw: string): AsuraResult["contentType"] {
  const t = raw.toLowerCase();
  if (t.includes("manhwa")) return "manhwa";
  if (t.includes("manhua")) return "manhua";
  if (t.includes("manga"))  return "manga";
  return "unknown";
}

function normSlug(input: string): string {
  let s = String(input || "").trim().replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "");
  // Old ids were "series/…"; new ids are "comics/…". Accept a bare slug too.
  if (s.startsWith("series/")) s = s.replace(/^series\//, "comics/");
  if (!s.startsWith("comics/")) s = `comics/${s}`;
  return s.replace(/\/$/, "");
}

function fullCover(url: string): string {
  // Browse cards use -400.webp thumbnails; the full cover drops that suffix.
  return (url || "").replace(/-400\.webp(\?|$)/, ".webp$1");
}

async function fetchAsuraHTML(url: string): Promise<string> {
  try {
    return await fetchHTMLPlain(url, BASE + "/");
  } catch (e: any) {
    console.warn(`[AsuraScraper] plain fetch failed for ${url}: ${e.message} — trying got-scraping`);
    return fetchHTML(url, BASE + "/", true);
  }
}

export class AsuraScraper {
  async search(query: string): Promise<AsuraResult[]> {
    // 1. Real API — full status/type/rating/chapter count in one call.
    try {
      const rows = await apiSeriesSearch(query, 5);
      const results = rows.map(rowToResult).filter((r) => r.slug && r.title);
      if (results.length) return results;
    } catch (e: any) {
      console.warn(`[AsuraScraper] API search failed: ${e.message} — falling back to HTML browse`);
    }
    // 2. HTML fallback: /browse?search=… cards.
    const html = await fetchAsuraHTML(`${BASE}/browse?search=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const results: AsuraResult[] = [];
    $('a[href^="/comics/"]').each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || href.includes("/chapter/")) return;
      const slug = href.replace(/^\//, "");
      if (seen.has(slug)) return;
      seen.add(slug);
      const img = $(el).find("img").first();
      const title = (img.attr("alt") || "").trim() || $(el).text().trim().split("\n")[0].trim();
      const cover = fullCover(img.attr("src") ?? "");
      // Card text starts with the rating, e.g. "9.0"
      const rating = ($(el).text().trim().match(/(\d\.\d)/)?.[1] ?? "");
      if (slug && title) {
        results.push({ slug, title, contentType: "unknown", coverUrl: cover, status: "", latestChapter: "", rating });
      }
    });
    return results;
  }

  async fetchSeriesInfo(slug: string): Promise<{
    title: string; contentType: AsuraResult["contentType"];
    coverUrl: string; status: string; genres: string[];
    description: string; authors: string[]; rating: string;
  }> {
    // 1. Real API — search by bare slug (without the -<8hex> suffix), match
    // the row whose public_url ends with the full slug we were given.
    try {
      const full = bareSlug(slug);
      const bare = full.replace(/-[a-z0-9]{8}$/i, "");
      const rows = await apiSeriesSearch(bare, 20);
      const row = rows.find((r) => String(r.public_url ?? "").split("/").filter(Boolean).pop() === full)
        ?? rows.find((r) => r.slug === bare);
      if (row?.title) {
        return {
          title: row.title,
          contentType: parseType(row.type ?? ""),
          coverUrl: row.cover ?? "",
          status: row.status ?? "",
          genres: (row.genres ?? []).map((g) => g.name ?? "").filter(Boolean),
          // API descriptions can contain HTML (<p>…</p>) — strip tags.
          description: (row.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          authors: [row.author ?? ""].filter(Boolean),
          rating: rating1(row.rating),
        };
      }
    } catch (e: any) {
      console.warn(`[AsuraScraper] API details failed: ${e.message} — falling back to HTML series page`);
    }
    // 2. HTML fallback: /comics/<slug> page.
    const path = normSlug(slug);
    const html = await fetchAsuraHTML(`${BASE}/${path}`);
    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim();
    const cover = fullCover($('img[src*="/covers/"]').first().attr("src") ?? "");
    const description = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const genres: string[] = [];
    $('a[href*="genres="]').each((_i, el) => { const g = $(el).text().trim(); if (g) genres.push(g); });
    const authors: string[] = [];
    $('a[href*="author="]').each((_i, el) => { const a = $(el).text().trim(); if (a) authors.push(a); });
    // The series page embeds Astro props as &quot;-encoded JSON:
    // "status":[0,"ongoing"],"type":[0,"manhwa"],"author":[0,"Kimchi Woo"],
    // "rating":[0,9.035…] — parse those with regex on the raw HTML.
    const decoded = html.replace(/&quot;/g, '"');
    const pick = (key: string): string => {
      const m = decoded.match(new RegExp(`"${key}":\\[0,"([^"]+)"\\]`));
      return m ? m[1] : "";
    };
    const ratingNum = decoded.match(/"rating":\[0,([\d.]+)\]/)?.[1] ?? "";
    const rating = ratingNum ? String(Math.round(parseFloat(ratingNum) * 10) / 10) : "";
    return {
      title,
      contentType: parseType(pick("type")),
      coverUrl: cover,
      status: pick("status"),
      genres: [...new Set(genres)],
      description,
      authors: [...new Set(authors)],
      rating,
    };
  }

  async fetchChapters(slug: string): Promise<AsuraChapter[]> {
    const path = normSlug(slug);
    const html = await fetchAsuraHTML(`${BASE}/${path}`);
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const chapters: AsuraChapter[] = [];
    $('a[href*="/chapter/"]').each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href) return;
      const chSlug = href.replace(/^\//, "");
      if (seen.has(chSlug)) return;
      seen.add(chSlug);
      const num = href.split("/chapter/")[1]?.split("/")[0]?.split("?")[0] ?? "";
      const text = $(el).text().replace(/\s+/g, " ").trim();
      // Link text concatenates number + date with no space, e.g.
      // "Chapter 1913 weeks ago" — strip the "Chapter <num>" prefix first,
      // the remainder ("3 weeks ago" / "Dec 30, 2022") is the date.
      const rest = text.replace(new RegExp(`^Chapter\\s*${num}\\s*`, "i"), "").replace(/^First Chapter$/i, "");
      const date = rest.match(/(\d+\s+(?:day|week|month|hour|minute)s?\s+ago)/i)?.[1] ?? "";
      if (chSlug && num) chapters.push({ slug: chSlug, number: num, title: `Chapter ${num}`, date });
    });
    // Oldest first (chapter 1 at the top of the reader order)
    chapters.sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
    return chapters;
  }

  async fetchChapterPages(chapterSlug: string): Promise<string[]> {
    const path = String(chapterSlug || "").trim().replace(/^\//, "");
    const html = await fetchAsuraHTML(`${BASE}/${path}`);
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const pages: string[] = [];
    $('img[src*="asura-images/chapters/"]').each((_i, el) => {
      const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
      if (src && !seen.has(src)) { seen.add(src); pages.push(src); }
    });
    return pages;
  }
}
