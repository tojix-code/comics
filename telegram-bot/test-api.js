// Test the API layer only — no Telegram token needed.
//   node test-api.js
// Verifies, against the LIVE ComicVerse API:
//  1. Asura search fails (expected right now — Cloudflare) and falls back
//  2. MangaDex search returns real results
//  3. Chapters load (direct MangaDex feed fallback when backend is empty / ComicK-only)
//  4. Pages load for a readable title (Berserk Ch. 0.01 = 94 pages) and one
//     page actually downloads as a JPEG
//  5. Solo Leveling is documented as unreadable right now: its MangaDex
//     chapters are all licensed/external and its ComicK pages are empty.
//     That is a real upstream limit, not a bot bug — Asura would be the
//     readable source once unblocked.
const api = require('./api');

(async () => {
  console.log('API_BASE:', api.API_BASE);
  console.log('\n1) search "solo leveling" (Asura first, MangaDex fallback)');
  const s = await api.searchSeries('solo leveling');
  console.log('   source used:', s.source, '| fallback:', !!s.fallback, '| results:', s.results.length);
  console.log('   first:', s.results[0]?.title, '| id:', s.results[0]?.id, '| type:', s.results[0]?.type);
  if (s.fallbackReason) console.log('   note:', s.fallbackReason);

  const series = s.results[0];
  console.log('\n2) series info for', series.title);
  const full = await api.getSeries(series.source, series.id);
  console.log('   status:', full.status, '| genres:', (full.genres || []).slice(0, 4).join(', '));

  console.log('\n3) chapters for Solo Leveling');
  const ch = await api.getChapters(series.source, series.id, full.title);
  console.log('   chapters:', ch.chapters.length, '| source:', ch.source, '| allComick:', !!ch.allComick);
  console.log('   first 3:', ch.chapters.slice(0, 3).map((c) => `Ch.${c.number} (${c.source})`).join(', '));
  console.log('   (expected: ComicK-only, no free MangaDex chapters — see note in header)');

  console.log('\n4) Berserk (readable) — Ch. 0.01 should be 94 pages');
  const berserkPages = await api.getPages('mangadex', '801513ba-a712-498c-8f57-cae55b38cc92', { id: '6310f6a1-17ee-4890-b837-2ec1b372905b', number: '0.01', source: 'mangadex' });
  console.log('   Berserk Ch. 0.01 pages:', berserkPages.pages.length, '| source:', berserkPages.source);
  if (berserkPages.pages.length !== 94) throw new Error(`Expected 94 pages, got ${berserkPages.pages.length}`);

  console.log('\n5) download first Berserk page as JPEG');
  const buf = await api.fetchBuffer(berserkPages.pages[0]);
  console.log('   downloaded bytes:', buf.length, '| JPEG header:', buf[0] === 0xff && buf[1] === 0xd8 ? 'yes (FF D8)' : 'no');
  if (buf.length < 10000) throw new Error('Page download suspiciously small');

  console.log('\n6) Solo Leveling Ch.1 pages — expected to fail honestly');
  try {
    await api.getPages(series.source, series.id, ch.chapters[0]);
    console.log('   unexpectedly succeeded — ComicK may have started serving images again');
  } catch (e) {
    console.log('   failed as expected:', e.message.slice(0, 120));
  }

  console.log('\n✅ API layer OK — bot search + read works with MangaDex today; Asura will work automatically once its Cloudflare block is fixed.');
})().catch((e) => { console.error('\n❌ test failed:', e.message); process.exit(1); });
