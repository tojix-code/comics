import { fetchJSON } from "../utils/httpClient";

const BASES = [
  "https://api.comick.dev",
  "https://api.comick.io",
  "https://comick-api-proxy.notaspider.dev/api",
];

export type ContentType = "manga" | "manhwa" | "manhua" | "unknown";

export interface ComicSearchResult {
  hid: string; slug: string; title: string;
  contentType: ContentType; coverUrl: string;
  rating: string; genres: string[];
  status: number; lastChapter: number | null; followCount: number;
}

export interface ComicInfo extends ComicSearchResult {
  description: string; authors: string[];
  artists: string[]; year: number | null;
  totalChapters: number;
}

export interface ComicChapter {
  hid: string; chap: string; title: string | null;
  lang: string; publishedAt: string; groupName: string[];
}

export interface ChapterPage {
  url: string; width: number; height: number;
}

function countryToType(country?: string): ContentType {
  switch ((country ?? "").toLowerCase()) {
    case "jp": case "ja": return "manga";
    case "kr": case "ko": return "manhwa";
    case "cn": case "zh": case "zh-hk": case "zh-cn": case "tw": case "hk": return "manhua";
    default: return "unknown";
  }
}

function mapHit(hit: any): ComicSearchResult {
  const md = hit.md_covers?.[0];
  const cover = md?.b2key
    ? `https://meo.comick.pictures/${md.b2key}`
    : hit.cover_url ?? "";
  return {
    hid:         hit.hid ?? hit.id ?? "",
    slug:        hit.slug ?? "",
    title:       hit.title ?? hit.slug ?? "",
    contentType: countryToType(hit.country),
    coverUrl:    cover,
    rating:      hit.content_rating ?? "safe",
    genres:      (hit.md_comic_md_genres ?? []).map((g: any) => g.md_genres?.name ?? g.name ?? "").filter(Boolean),
    status:      hit.status ?? 1,
    lastChapter: hit.last_chapter ?? null,
    followCount: hit.follow_count ?? 0,
  };
}

async function fetchComickJSON<T>(pathAndQuery: string): Promise<T> {
  let lastError: unknown;
  for (const base of BASES) {
    const referer = base.includes("comick.io") ? "https://comick.io/" : "https://comick.dev/";
    try {
      return await fetchJSON<T>(`${base}${pathAndQuery}`, referer, true);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Failed to fetch ComicK route: ${pathAndQuery}`);
}

export class ComickScraper {

  async search(
    query: string,
    opts: { type?: ContentType; limit?: number; page?: number } = {}
  ): Promise<ComicSearchResult[]> {
    const params = new URLSearchParams({
      q:     query,
      limit: String(opts.limit ?? 20),
      page:  String(opts.page  ?? 1),
    });

    const countryMap: Record<string, string> = {
      manga: "jp", manhwa: "kr", manhua: "cn",
    };
    if (opts.type && opts.type !== "unknown") {
      params.set("country", countryMap[opts.type] ?? "");
    }

    const data = await fetchComickJSON<any[]>(`/v1.0/search?${params}`);
    return (Array.isArray(data) ? data : []).map(mapHit);
  }

  async trending(type?: ContentType, page = 1): Promise<ComicSearchResult[]> {
    const params = new URLSearchParams({
      page:  String(page),
      order: "follow",
    });
    const countryMap: Record<string, string> = {
      manga: "jp", manhwa: "kr", manhua: "cn",
    };
    if (type && type !== "unknown") {
      params.set("country", countryMap[type] ?? "");
    }
    const data = await fetchComickJSON<any[]>(`/v1.0/search?${params}`);
    return (Array.isArray(data) ? data : []).map(mapHit);
  }

  async fetchComicInfo(slug: string): Promise<ComicInfo> {
    const data = await fetchComickJSON<any>(`/comic/${encodeURIComponent(slug)}`);
    const comic = data?.comic ?? data;
    const base  = mapHit(comic);
    return {
      ...base,
      description:   comic.desc ?? comic.description ?? "",
      authors:       (comic.author ?? comic.authors ?? []).map((a: any) => a.name ?? a),
      artists:       (comic.artist ?? comic.artists ?? []).map((a: any) => a.name ?? a),
      year:          comic.year ?? null,
      totalChapters: comic.chapter_count ?? 0,
    };
  }

  async fetchChapters(
    hid: string,
    opts: { page?: number; lang?: string; limit?: number } = {}
  ): Promise<{ chapters: ComicChapter[]; total: number }> {
    const params = new URLSearchParams({
      page:  String(opts.page  ?? 1),
      limit: String(Math.min(opts.limit ?? 20, 100)),
      lang:  opts.lang ?? "en",
    });
    const data = await fetchComickJSON<any>(`/comic/${encodeURIComponent(hid)}/chapters?${params}`);
    const rawList = Array.isArray(data) ? data : (data?.chapters ?? []);
    const chapters: ComicChapter[] = rawList.map((c: any) => ({
      hid:         c.hid,
      chap:        c.chap ?? "0",
      title:       c.title ?? null,
      lang:        c.lang  ?? "en",
      publishedAt: c.created_at ?? "",
      groupName:   c.group_name ?? (c.md_chapters_groups ?? []).map((g: any) => g.md_groups?.title).filter(Boolean),
    }));
    return { chapters, total: data?.total ?? chapters.length };
  }

  async fetchChapterPages(chapterHid: string): Promise<ChapterPage[]> {
    const data = await fetchComickJSON<any>(`/chapter/${encodeURIComponent(chapterHid)}?tachiyomi=true`);
    const images = data?.chapter?.md_images ?? data?.md_images ?? data?.images ?? [];
    return images
      .filter((img: any) => typeof img === "string" || img?.b2key || img?.url)
      .map((img: any) => {
        if (typeof img === "string") {
          return {
            url: img.startsWith("http") ? img : `https://meo.comick.pictures/${img}`,
            width: 0,
            height: 0,
          };
        }
        return {
          url:    img.url ?? `https://meo.comick.pictures/${img.b2key}`,
          width:  img.w ?? 0,
          height: img.h ?? 0,
        };
      });
  }
}
