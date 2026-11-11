// Pure, testable helpers: chapter numbers, sorting, client-side filters,
// reading progress. No network, no storage — see store.js / catalogue.js.
export function chapterNum(chapter) {
  const n = parseFloat(String(chapter?.number ?? ''));
  return Number.isFinite(n) ? n : -1;
}

/** Sort chapters by number (un-numbered go last), ascending or descending. */
export function sortChapters(chapters, direction = 'asc') {
  const sorted = [...(chapters || [])].sort((a, b) => {
    const na = chapterNum(a); const nb = chapterNum(b);
    if (na === -1 && nb === -1) return String(a?.title || '').localeCompare(String(b?.title || ''));
    if (na === -1) return 1;
    if (nb === -1) return -1;
    return na - nb;
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export function filterChapters(chapters, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return chapters || [];
  return (chapters || []).filter((c) =>
    String(c.number ?? '').toLowerCase().includes(q) ||
    String(c.title || '').toLowerCase().includes(q) ||
    String(c.group || '').toLowerCase().includes(q),
  );
}

/** Client-side rating filter (bayesian / source rating, 0–10). */
export function byMinRating(seriesList, minRating) {
  if (!minRating) return seriesList;
  return seriesList.filter((s) => s.ratingValue != null && s.ratingValue >= minRating);
}

/** Client-side chapter-count filter. `totals` maps series id → chapter total (or null). */
export function byChapterCount(seriesList, totals, min, max) {
  if (min == null && max == null) return seriesList;
  return seriesList.filter((s) => {
    const total = totals[s.id];
    if (total == null) return false; // unknown count can't satisfy the filter — honest, not guessed
    if (min != null && total < min) return false;
    if (max != null && total > max) return false;
    return true;
  });
}

/** Reading progress as a 0–100 percentage. */
export function progressPercent(pageIndex, pageCount) {
  if (!pageCount || pageCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((pageIndex + 1) / pageCount) * 100)));
}

/** Next unread chapter after `currentNumber`, or null. Un-numbered chapters are skipped. */
export function nextChapter(chapters, currentNumber) {
  const sorted = sortChapters(chapters, 'asc');
  const cur = parseFloat(String(currentNumber ?? ''));
  if (!Number.isFinite(cur)) return sorted.find((c) => chapterNum(c) !== -1) || null;
  return sorted.find((c) => chapterNum(c) > cur) || null;
}

export function prevChapter(chapters, currentNumber) {
  const sorted = sortChapters(chapters, 'asc');
  const cur = parseFloat(String(currentNumber ?? ''));
  if (!Number.isFinite(cur)) return null;
  const earlier = sorted.filter((c) => { const n = chapterNum(c); return n !== -1 && n < cur; });
  return earlier[earlier.length - 1] || null;
}
