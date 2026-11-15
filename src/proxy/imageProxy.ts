import { Router, Request, Response } from "express";
import { asyncWrapper } from "../utils/asyncWrapper";

// Plain Node fetch for images, mirroring fetchJSONPlain in utils/httpClient.ts:
// got-scraping's patched TLS fingerprint gets challenged by Cloudflare on
// Vercel IPs (the same reason it was removed from the MangaDex JSON path on
// 2026-11-11), while plain fetch with an honest User-Agent works for the
// MangaDex API host. This is unproven for the uploads host until live-checked.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const proxyRouter = Router();

const ALLOWED_IMAGE_DOMAINS = [
  "meo.comick.pictures", "meo2.comick.pictures",
  "uploads.mangadex.org", "mangadex.network",
  "cdn.weebcentral.com",
  "gg.asuracomic.net", "asuracomic.net",
  // Asura's image CDN — needed by the Telegram Mini App reader: direct CDN
  // loads get Cloudflare-challenged on datacenter IPs, so the reader falls
  // back to this proxy. Without this entry the proxy answers 403 and every
  // Asura page shows "This page failed to load."
  "cdn.asurascans.com",
  "novelfull.com", "img.novelfull.com",
];

const REFERER_MAP: Record<string, string> = {
  "meo.comick.pictures":  "https://comick.io/",
  "meo2.comick.pictures": "https://comick.io/",
  "uploads.mangadex.org": "https://mangadex.org/",
  "mangadex.network":    "https://mangadex.org/",
  "cdn.weebcentral.com":  "https://weebcentral.com/",
  "gg.asuracomic.net":    "https://asuracomic.net/",
  "cdn.asurascans.com":   "https://asurascans.com/",
};

proxyRouter.get("/image", asyncWrapper(async (req: Request, res: Response) => {
  const rawUrl = String(req.query.url ?? "").trim();
  if (!rawUrl) return res.status(400).json({ error: "'url' query param required." });

  let parsed: URL;
  try { parsed = new URL(rawUrl); }
  catch { return res.status(400).json({ error: "Invalid URL." }); }

  if (parsed.protocol !== "https:") {
    return res.status(400).json({ error: "Only HTTPS image URLs are allowed." });
  }
  if (parsed.username || parsed.password || parsed.port) {
    return res.status(400).json({ error: "Image URL credentials and custom ports are not allowed." });
  }

  const domainAllowed = ALLOWED_IMAGE_DOMAINS.some(
    d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
  );
  if (!domainAllowed) {
    return res.status(403).json({ error: `Domain '${parsed.hostname}' not in allow-list.` });
  }

  // Exact match, or a suffix match so *.mangadex.network subdomains (the
  // at-home reader CDN) get the mangadex.org referer too.
  const refererEntry = Object.entries(REFERER_MAP).find(
    ([domain]) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
  );
  const referer = refererEntry?.[1] ?? `${parsed.protocol}//${parsed.hostname}/`;

  const upstream = await fetch(rawUrl, {
    headers: {
      "User-Agent": "ComicVerse/1.0 (+https://github.com/tojix-code/comics)",
      Referer: referer,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!upstream.ok) {
    return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
  }

  const contentType = String(upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    return res.status(502).json({ error: "Upstream did not return an image." });
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) {
    return res.status(502).json({ error: "Upstream image exceeds 15 MB." });
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  res.end(body);
}));
