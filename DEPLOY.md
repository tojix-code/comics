# Deploying ComicVerse

## Live deployment

- **Frontend:** https://comicverse-flame.vercel.app (Vercel project `comicverse`)
- **API:** https://comicverse-api.vercel.app (Vercel project `comicverse-api`)

Both projects are linked to `tojix-code/comics` on GitHub — every push to `main`
redeploys them automatically. Environment variables set on Vercel:
`VITE_API_URL=https://comicverse-api.vercel.app` on the frontend,
`ALLOWED_ORIGINS=https://comicverse-flame.vercel.app` on the API.

ComicVerse is two parts that deploy separately:

| Part | What it is | Where it runs |
|---|---|---|
| **Frontend** | React + Vite app in `frontend/` | Vercel (static) |
| **API** | The Express proxy in `src/` + `api/` | Vercel (serverless) **or** Render (long-running server) |

The frontend works without the API (it falls back to the public MangaDex API),
but ComicK / WeebCentral / AsuraScans, chapter aggregation and the image proxy
need the API running.

---

## Option A — everything on Vercel (fastest)

### 1. Deploy the API (one project)

1. Go to [vercel.com/new](https://vercel.com/new) → **Import** `tojix-code/comics`.
2. **Root Directory:** leave as the repo root (`.`).
3. Framework preset: **Other**. Build command: `npm run build`. Output: leave empty.
4. Environment variables:
   - `ALLOWED_ORIGINS` = `https://YOUR-FRONTEND-URL.vercel.app` (add it after step 2; you can edit it later)
   - Optional, only if a provider keeps getting blocked: `PROXY_URL` or `FLARESOLVERR_URL` (see README).
5. Deploy. Note the URL, e.g. `https://comics-api.vercel.app`.
6. Check it: open `https://comics-api.vercel.app/api/health` — you should see `{"status":"ok",...}`.

> Vercel Hobby functions time out after 10 seconds. MangaDex is fast, but
> WeebCentral / AsuraScans scrapes can take longer and may time out on Hobby.
> If that bites you, use Option B for the API instead.

### 2. Deploy the frontend (a second project)

1. Again [vercel.com/new](https://vercel.com/new) → **Import** `tojix-code/comics`.
2. **Root Directory:** `frontend`.
3. Framework preset: **Vite**. (Build `npm run build`, output `dist` — Vercel fills these in.)
4. Environment variables:
   - `VITE_API_URL` = your API URL from step 1, e.g. `https://comics-api.vercel.app`
   - `VITE_GOOGLE_CLIENT_ID` = your Google OAuth client id (optional — see below)
   - `VITE_DEFAULT_SOURCE` = `mangadex` (optional)
5. Deploy. Open the URL and use the app.

That is it. Every push to `main` redeploys both projects automatically.

## Option B — API on Render (no timeout, better for scraped providers)

1. Push the repo to GitHub, then open [dashboard.render.com](https://dashboard.render.com) →
   **New +** → **Web Service** → pick `tojix-code/comics`.
   (Or use the `render.yaml` in this repo: **New +** → **Blueprint** → pick the repo.)
2. Build command `npm ci && npm run build`, start command `npm start` — Render reads these from `render.yaml`.
3. Set `ALLOWED_ORIGINS` to your frontend URL (e.g. `https://comicverse.vercel.app`).
4. Deploy, copy the `https://comicverse-api.onrender.com` URL, and use it as
   `VITE_API_URL` in the frontend project (Option A, step 2).

> Render's free tier spins down after inactivity, so the first API call after
> a while can take ~30–60s. The frontend shows a loading state meanwhile and
> falls back to MangaDex direct where it can.

## Local development

```bash
# Terminal 1 — API on http://localhost:3001
cp .env.example .env   # optional; defaults already work locally
npm install
npm run dev

# Terminal 2 — frontend on http://localhost:5173
cd frontend
npm install
cp .env.example .env   # optional
npm run dev
```

The Vite dev server proxies `/api` to `localhost:3001`, so no env config is
needed locally. `npm test` in `frontend/` runs the test suite;
`npm run build` in `frontend/` produces the static site.

---

## Google Sign-In setup (optional, ~5 minutes)

Email + password and the demo account work with no setup. Google sign-in is an
extra option on the login page, powered by Google Identity Services.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create/select a project.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → application type **Web application**.
3. Under **Authorized JavaScript origins**, add every origin the app runs on:
   - `http://localhost:5173` (local dev)
   - `https://YOUR-FRONTEND-URL.vercel.app` (production)
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
5. Set it as an environment variable wherever the frontend runs:
   - Vercel: project **Settings → Environment Variables** → `VITE_GOOGLE_CLIENT_ID` → redeploy.
   - Local: put it in `frontend/.env` (never commit `.env`).
6. Reload the login page — the "Continue with Google" button appears.

Notes:
- The Client ID is **not a secret** (it is public in the page source by design);
  never put a client *secret* in the frontend.
- In v1 the Google ID token is decoded and checked client-side (`aud`, `exp`)
  and the account lives in the browser, like email accounts. If you later add a
  real server, verify the ID token server-side with Google before trusting it.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Frontend shows data but ComicK/WeebCentral/Asura fail | The API is down or the source blocks it. Check `/api/health` on your API URL; check Admin → Sources. |
| `CORS` errors in the browser console | `ALLOWED_ORIGINS` on the API doesn't include your frontend origin. Add it and redeploy the API. |
| Everything is slow the first time on Render free tier | Cold start (~30–60s). It wakes on the first request; MangaDex direct fallback covers browsing meanwhile. |
| Vercel API returns 504 on Asura/WeebCentral | 10s Hobby timeout. Use Render for the API, or set `PROXY_URL`/`FLARESOLVERR_URL`. |
| Google button doesn't appear | `VITE_GOOGLE_CLIENT_ID` isn't set on that deployment, or the origin isn't in the OAuth client's authorized origins. |
| Images don't load | The image proxy needs the API. Covers fall back direct → proxy → placeholder automatically; check the API is up. |
