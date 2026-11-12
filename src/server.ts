import "dotenv/config";

import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { mangaRouter } from "./routes/manga";
import { novelRouter } from "./routes/novels";
import { proxyRouter } from "./proxy/imageProxy";

const app = express();

app.disable("x-powered-by");

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin ?? "";
  const allowed =
    !origin ||
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https:\/\/[^.]+\.lovable\.app$/.test(origin) ||
    /^https:\/\/[^.]+\.lovableproject\.com$/.test(origin) ||
    /^https:\/\/lovable\.dev$/.test(origin) ||
    /^https:\/\/arcaneread\.lovable\.app$/.test(origin) ||
    (process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).includes(origin);

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX ?? 300),
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), sources: ["comick", "mangadex", "weebcentral", "asura", "novelfull"] });
});

// ── Mount Routers (supports ?source=comick, mangadex, weebcentral, asura) ────
app.use("/api/manga", mangaRouter);
app.use("/api/novels", novelRouter);
app.use("/api/proxy", proxyRouter);

// ── 404 & error ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = Number((err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status ?? 500);
  const safeStatus = statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
  const message = err instanceof Error ? err.message : "Unexpected server error";
  console.error(`[API error] ${message}`);
  res.status(safeStatus).json({ error: safeStatus === 500 ? "Internal server error" : message });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

export default app;
