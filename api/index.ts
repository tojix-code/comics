// Vercel serverless entry point for the ComicVerse API.
// Vercel routes every /api/* request here (see vercel.json); the Express app
// in src/app.ts does the actual routing, so the API behaves exactly like
// `npm run start` does locally.
//
// Limits to know about (see DEPLOY.md):
// - Hobby plan functions time out after 10s — MangaDex is fast, but
//   WeebCentral / AsuraScans scrapes can take longer and may time out.
// - Vercel runs on datacenter IPs, so Cloudflare-protected upstreams
//   (ComicK, WeebCentral, AsuraScans) often need PROXY_URL / FLARESOLVERR_URL.
// - For a long-running backend with no timeout, deploy the same code on
//   Render/Railway instead (see render.yaml).
import app from "../src/app";

export default app;
