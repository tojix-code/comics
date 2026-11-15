# ComicVerse Telegram Bot — search + read

Search AsuraScans first, MangaDex as fallback, read chapters in Telegram.

**Flow:** Telegram → this bot → your live ComicVerse API (`https://comicverse-api.vercel.app`) → AsuraScans / MangaDex. The bot does no scraping itself.

## What it does

- `/search solo leveling` — or just type a title, plain text also searches
- Tap a result → series page with cover, status, genres, rating
- Tap a chapter → pages arrive as photos, 10 at a time, with a **Next** button
- `📖 Read latest` shortcut on the series page

## 1. Create the bot (2 minutes)

1. In Telegram, open **@BotFather**
2. Send `/newbot`, give it a name and a username ending in `bot`
3. Copy the token BotFather gives you — that's `BOT_TOKEN`. Don't share it.

## 2. Run it locally (to test)

```bash
cd comicverse-telegram-bot
npm install
cp .env.example .env
# edit .env and paste your real BOT_TOKEN
node bot.js
```

Then in Telegram, message your bot: `/search solo leveling`

Test the API layer without Telegram (no token needed):

```bash
npm run test:api
```

## 3. Keep it online 24/7

This bot uses long-polling: it keeps asking Telegram "any new messages?"
So it needs one process running all the time. If you close your laptop, it stops.

**Option A — Render (easiest to try, free to start)**
1. Push this folder to GitHub (or add it to `tojix-code/comics` as `telegram-bot/`)
2. Render → New → Web Service → pick the repo (or New → Blueprint, it reads `render.yaml`)
3. Build command: `npm install`, Start command: `node bot.js`
4. Environment variable: `BOT_TOKEN` = your BotFather token (never commit it)
5. Deploy. Open the Render URL once — it should say "ComicVerse Telegram bot is running".

Honest catch: Render free sleeps after ~15 min with no inbound traffic, and polling creates no inbound traffic. So the first message after a sleep takes 30–60s to wake it up. It works, it's just slow to wake. A paid Background Worker on Render (~$7/mo) or Railway stays awake properly.

**Option B — Vercel webhook (free, no sleeping, but needs a code change)**
Vercel is free on your Hobby plan and never sleeps like Render, but it can't run a polling bot — it only runs short web requests. For Vercel the bot has to switch to webhook mode: Telegram pushes each message to `https://your-bot.vercel.app/api/webhook`. That version isn't built yet — say the word and I'll convert it.

**Option C — your own laptop (for testing only)**
Just leave `node bot.js` running. Works perfectly while it's on, stops when you close the lid.

Vercel won't work for the current polling version — it's for short web requests, not a long-running bot.

## Current status — read this before you demo it

Tested live 2026-11-15:

- **Asura search: currently failing.** Live API returns `{"error":"Internal server error"}` — the same Cloudflare block on Vercel IPs from 11–12 Nov. The bot handles this automatically: it falls back to MangaDex and tells the user so (`⚠️ Asura is blocked right now…`).
- **MangaDex search / chapters / pages: working.** Verified: Solo Leveling search, chapters, and page download as a real JPEG. Berserk Ch. 0.01 returns 94 pages.
- **ComicK chapters: no readable pages.** The backend aggregator sometimes returns ComicK chapters for MangaDex titles; their API returns no images. The bot detects this (all-ComicK or empty list) and falls back to the direct MangaDex feed instead.
- **Asura will start working automatically** once the backend's Cloudflare bypass is set up (`PROXY_URL` or `FLARESOLVERR_URL` in `httpClient.ts` on the backend). No bot code change needed.

## Files

- `bot.js` — Telegram bot (Telegraf), commands + buttons + reading
- `api.js` — ComicVerse API client with Asura-first / MangaDex fallback, including direct MangaDex feed + at-home fallbacks
- `test-api.js` — live API test, no token needed
- `.env.example` — copy to `.env` with your token

## Reading — Mini App (2026-11-15)

Tapping a chapter opens the ComicVerse reader as a Telegram Mini App
(`📖 Open Reader` button, web_app URL `https://comicverse-flame.vercel.app/read/<source>/<seriesId>/<chapterId>?mini=1`).
The reader runs in Telegram's WebView, so page images load directly from the
CDN in the browser — the bot no longer has to download every page itself
(that download was failing with `fetch failed` for Asura CDN images when the
bot runs on Windows). The reader has a chapter dropdown and Prev / Next
chapter buttons at the bottom.

`📥 Send pages in chat instead` still tries the old photo flow (10 pages at
a time as a media group, `.webp` pages fall back to documents).
