import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getChapterPages, getChapters, getSeries, proxiedImageUrl } from '../lib/api';
import { nextChapter, prevChapter, progressPercent } from '../lib/filters';
import { getProgress, recordHistory, saveProgress, addReport } from '../lib/store';
import { useCurrentUser } from '../lib/useAuth';
import { ErrorState } from '../components/ui';

/** One reader page image: direct URL first, backend proxy on error, then an error card. */
function PageImage({ page, alt, index, onVisible }) {
  const [step, setStep] = useState(0); // 0 direct, 1 proxy, 2 failed
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onVisible) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) onVisible(index); });
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisible, index]);
  const src = step === 0 ? page.url : step === 1 ? proxiedImageUrl(page.url) : '';
  if (step === 2) {
    return (
      <div className="page-error" ref={ref}>
        <p>This page failed to load.</p>
        <button type="button" className="btn btn-sm" onClick={() => setStep(0)}>Retry page</button>
      </div>
    );
  }
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setStep((s) => (s < 2 ? s + 1 : s))}
    />
  );
}

export default function ReaderPage() {
  const { source, seriesId, chapterId } = useParams();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [series, setSeries] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('strip'); // strip | paged
  const [pageIndex, setPageIndex] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const [reportSent, setReportSent] = useState(false);
  const stripRef = useRef(null);

  const chapter = chapters.find((c) => c.id === chapterId) || null;
  const chapterNumber = chapter?.number || '';

  // Load series + chapter list (for prev/next + dropdown).
  useEffect(() => {
    let cancelled = false;
    getSeries(source, seriesId).then((s) => { if (!cancelled) setSeries(s); }).catch(() => {});
    getChapters(source, seriesId, {})
      .then((res) => { if (!cancelled) setChapters(res.chapters); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [source, seriesId]);

  // Load the chapter's pages.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setPages([]); setPageIndex(0); setMaxSeen(0);
    const ch = chapters.find((c) => c.id === chapterId);
    const target = ch || { id: chapterId, source };
    getChapterPages(source, seriesId, target)
      .then((res) => {
        if (cancelled) return;
        setPages(res.pages);
        setLoading(false);
        if (user && series) recordHistory(user.email, series, target);
        // Restore saved position for this chapter.
        if (user && series) {
          const saved = getProgress(user.email, String(series.id));
          if (saved?.chapterId === chapterId && saved.pageIndex > 0 && saved.pageIndex < res.pages.length) {
            setPageIndex(saved.pageIndex);
            setMaxSeen(saved.pageIndex);
          }
        }
      })
      .catch((err) => { if (!cancelled) { setError(err); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, seriesId, chapterId, chapters.length, retryTick]);

  // Persist progress (paged: current page; strip: furthest page seen).
  const persist = useCallback((idx) => {
    if (!user || !series || !chapter || !pages.length) return;
    saveProgress(user.email, series, chapter, { pageIndex: idx, pageCount: pages.length, mode });
  }, [user, series, chapter, pages.length, mode]);

  useEffect(() => { persist(maxSeen); }, [maxSeen, persist]);

  // Strip mode: track furthest visible page via IntersectionObserver callbacks.
  const handleVisible = useCallback((idx) => {
    setMaxSeen((m) => Math.max(m, idx));
  }, []);

  // Keyboard navigation in paged mode.
  useEffect(() => {
    if (mode !== 'paged') return;
    function onKey(e) {
      if (e.key === 'ArrowRight') setPageIndex((i) => Math.min(pages.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setPageIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, pages.length]);

  useEffect(() => { setMaxSeen((m) => Math.max(m, pageIndex)); }, [pageIndex]);

  const prev = chapter ? prevChapter(chapters, chapterNumber) : null;
  const next = chapter ? nextChapter(chapters, chapterNumber) : null;
  function goToChapter(ch) {
    if (ch) navigate(`/read/${source}/${encodeURIComponent(seriesId)}/${encodeURIComponent(ch.id)}`);
  }
  const pct = pages.length ? progressPercent(Math.max(pageIndex, maxSeen), pages.length) : 0;

  return (
    <main className="reader">
      <div className="reader-bar">
        <Link to={`/series/${source}/${encodeURIComponent(seriesId)}`} className="btn btn-sm">← Series</Link>
        <h1>{series ? series.title : 'Loading…'} {chapterNumber ? `— Ch. ${chapterNumber}` : ''}</h1>
        {chapters.length > 0 && (
          <select value={chapterId} onChange={(e) => goToChapter(chapters.find((c) => c.id === e.target.value))} aria-label="Choose chapter">
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>Ch. {c.number || '—'}{c.title ? ` — ${c.title.slice(0, 40)}` : ''}</option>
            ))}
          </select>
        )}
        <div role="group" aria-label="Reading mode">
          <button type="button" className={`btn btn-sm ${mode === 'strip' ? 'btn-primary' : ''}`} onClick={() => setMode('strip')}>Strip</button>
          {' '}
          <button type="button" className={`btn btn-sm ${mode === 'paged' ? 'btn-primary' : ''}`} onClick={() => setMode('paged')}>Paged</button>
        </div>
      </div>
      <div className="reader-progress" aria-label={`Reading progress ${pct}%`}><div style={{ width: `${pct}%` }} /></div>

      {loading && (
        <div className="reader-pages">
          <div className="page-frame"><p className="page-loading">Loading pages…</p></div>
          <div className="skeleton" style={{ height: 420, margin: '0 8px', borderRadius: 8 }} />
        </div>
      )}

      {error && (
        <div className="reader-pages">
          <ErrorState error={error} onRetry={() => setRetryTick((t) => t + 1)} />
          <p className="reader-hint">
            {reportSent ? 'Report sent — thanks, an admin can review it in Admin → Reports.' : (
              <>Still broken? <button type="button" className="btn btn-sm" onClick={() => { if (series) addReport({ series, chapter: chapter || { id: chapterId, number: chapterNumber }, reason: 'Pages do not load', detail: 'Reader reported pages failing to load.', reporter: user?.email || 'guest' }); setReportSent(true); }}>Report this chapter</button></>
            )}
          </p>
        </div>
      )}

      {!loading && !error && pages.length === 0 && (
        <div className="reader-pages">
          <div className="empty"><p className="empty-title">No pages in this chapter</p><p className="empty-body">The provider returned an empty chapter. It may be an external / licensed chapter with no readable images.</p></div>
        </div>
      )}

      {!loading && !error && pages.length > 0 && mode === 'strip' && (
        <div className="reader-pages strip" ref={stripRef}>
          {pages.map((p, i) => (
            <PageImage key={`${p.url}-${i}`} page={p} alt={`Page ${i + 1}`} index={i} onVisible={handleVisible} />
          ))}
          <p className="reader-hint">Scroll to read · progress saves automatically{user ? '' : ' (sign in to keep it across devices on this browser)'}</p>
        </div>
      )}

      {!loading && !error && pages.length > 0 && mode === 'paged' && (
        <div className="reader-pages paged">
          <div className="page-frame">
            <PageImage key={pages[pageIndex].url} page={pages[pageIndex]} alt={`Page ${pageIndex + 1} of ${pages.length}`} index={pageIndex} onVisible={null} />
          </div>
          <p className="reader-hint">Page {pageIndex + 1} of {pages.length} · use ← → keys or the buttons below</p>
          <div className="reader-nav" style={{ padding: '0 0 20px' }}>
            <button type="button" className="btn" disabled={pageIndex <= 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>← Prev page</button>
            <button type="button" className="btn" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}>Next page →</button>
          </div>
        </div>
      )}

      {!loading && !error && pages.length > 0 && (
        <div className="reader-nav">
          <button type="button" className="btn" disabled={!prev} onClick={() => goToChapter(prev)}>← Prev chapter</button>
          <Link to={`/series/${source}/${encodeURIComponent(seriesId)}`} className="btn">All chapters</Link>
          <button type="button" className="btn btn-primary" disabled={!next} onClick={() => goToChapter(next)}>{next ? `Next chapter (Ch. ${next.number}) →` : 'Last chapter'}</button>
        </div>
      )}
    </main>
  );
}
