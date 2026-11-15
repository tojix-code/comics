import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getChapterPages, getChapters, getSeries, proxiedImageUrl } from '../lib/api';
import { nextChapter, prevChapter, progressPercent } from '../lib/filters';
import { getProgress, recordHistory, saveProgress, addReport } from '../lib/store';
import { useCurrentUser } from '../lib/useAuth';
import { ErrorState } from '../components/ui';
import ReaderSettingsPanel, { DEFAULT_SETTINGS, loadSettings, pageFilter, saveSettings } from '../components/ReaderSettings';

/** One reader page image: direct URL first, backend proxy on error, then an error card. */
function PageImage({ page, alt, index, onVisible, eager, filter }) {
  const [step, setStep] = useState(0); // 0 direct, 1 proxy, 2 failed
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onVisible) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => { onVisible(index, en.isIntersecting); });
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
      loading={eager ? 'eager' : 'lazy'}
      style={filter && filter !== 'none' ? { filter } : undefined}
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
  // Reader settings (direction, margins, auto-scroll, progress bar, …).
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  useEffect(() => { saveSettings(settings); }, [settings]);
  // Reading direction drives the mode: top-to-bottom = strip, left/right = paged.
  const direction = settings.direction;
  useEffect(() => {
    setMode(direction === 'top-bottom' ? 'strip' : 'paged');
  }, [direction]);
  function setDirectionMode(m) {
    setMode(m);
    if (m === 'strip') setSettings((s) => ({ ...s, direction: 'top-bottom' }));
    else setSettings((s) => ({ ...s, direction: s.direction === 'rtl' ? 'rtl' : 'ltr' }));
  }
  // Hide the top bar while scrolling down to read, bring it back on scroll up.
  // Delta is accumulated across scroll events: a single event's jump can be
  // tiny (smooth scrolling fires many small events), so judging one event
  // alone left the bar stuck hidden until the very top of the page.
  const [barHidden, setBarHidden] = useState(false);
  const lastScrollY = useRef(0);
  const scrollAccum = useRef(0);
  useEffect(() => {
    function onScroll() {
      const y = window.scrollY || 0;
      const delta = y - lastScrollY.current;
      lastScrollY.current = y;
      if (delta === 0) return;
      // A change of direction resets the accumulated run.
      if (Math.sign(delta) !== Math.sign(scrollAccum.current)) scrollAccum.current = 0;
      scrollAccum.current += delta;
      if (scrollAccum.current > 60 && y > 120) { setBarHidden(true); scrollAccum.current = 0; }
      else if (scrollAccum.current < -60 || y <= 120) { setBarHidden(false); scrollAccum.current = 0; }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const stripRef = useRef(null);

  const chapter = chapters.find((c) => c.id === chapterId) || null;
  const chapterNumber = chapter?.number || '';

  // Load series + chapter list (for prev/next + dropdown).
  useEffect(() => {
    let cancelled = false;
    getSeries(source, seriesId).then((s) => { if (!cancelled) setSeries(s); }).catch(() => {});
    // Load the full chapter list (limit 500) so Prev/Next chapter works even
    // for long series like Solo Leveling (201 chapters) — the default 96
    // would cut the list off and hide Next chapter past Ch. 96.
    getChapters(source, seriesId, { limit: 500 })
      .then((res) => { if (!cancelled) setChapters(res.chapters); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [source, seriesId]);

  // Load the chapter's pages.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setPages([]); setPageIndex(0); setMaxSeen(0);
    setCurrentPage(0); visiblePages.current.clear();
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

  // Strip mode: track the topmost page currently on screen. That is the
  // reading position shown in the progress bar — the furthest page ever seen
  // (maxSeen) is kept separately for saving resume progress, because using
  // it for the bar stuck the bar at 100% after scrolling down and back up.
  const visiblePages = useRef(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const handleVisible = useCallback((idx, isVisible) => {
    if (isVisible) {
      visiblePages.current.add(idx);
      setMaxSeen((m) => Math.max(m, idx));
    } else {
      visiblePages.current.delete(idx);
    }
    const visible = [...visiblePages.current];
    if (visible.length) setCurrentPage(Math.min(...visible));
  }, []);

  // Keyboard: strip mode scrolls by the configured step (Arrow / Space / W / S),
  // paged mode flips pages (arrows reversed for right-to-left).
  useEffect(() => {
    function onKey(e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const stepPx = Math.round(window.innerHeight * (settings.keyboardStep / 100));
      const behavior = settings.keyboardScroll === 'smooth' ? 'smooth' : 'auto';
      if (mode === 'strip') {
        if (['ArrowDown', ' ', 's', 'S'].includes(e.key)) { e.preventDefault(); window.scrollBy({ top: stepPx, behavior }); }
        else if (['ArrowUp', 'w', 'W'].includes(e.key)) { e.preventDefault(); window.scrollBy({ top: -stepPx, behavior }); }
        return;
      }
      const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === forward || e.key === ' ' || e.key === 'ArrowDown') setPageIndex((i) => Math.min(pages.length - 1, i + 1));
      else if (e.key === back || e.key === 'ArrowUp') setPageIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, pages.length, settings.keyboardStep, settings.keyboardScroll, direction]);

  // Auto-scroll (play / pause button in the reader bar).
  useEffect(() => {
    if (!autoScrolling || !pages.length) return;
    if (mode === 'paged') {
      // Advance one page per interval; interval from speed so faster = sooner.
      const interval = Math.min(10000, Math.max(1200, Math.round((window.innerHeight / settings.autoScrollSpeed) * 1000)));
      const id = window.setInterval(() => {
        setPageIndex((i) => {
          if (i >= pages.length - 1) { setAutoScrolling(false); return i; }
          return i + 1;
        });
      }, interval);
      return () => window.clearInterval(id);
    }
    if (settings.autoScrollMode === 'step') {
      const stepPx = Math.round(window.innerHeight * (settings.keyboardStep / 100));
      const interval = Math.min(10000, Math.max(1200, Math.round((stepPx / settings.autoScrollSpeed) * 1000)));
      const id = window.setInterval(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (window.scrollY >= max - 2) { setAutoScrolling(false); return; }
        window.scrollBy({ top: stepPx, behavior: 'auto' });
      }, interval);
      return () => window.clearInterval(id);
    }
    // Continuous: smooth scroll at autoScrollSpeed px/s.
    let raf = 0;
    let last = performance.now();
    function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= max - 2) { setAutoScrolling(false); return; }
      window.scrollBy(0, settings.autoScrollSpeed * dt);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoScrolling, mode, pages.length, settings.autoScrollMode, settings.autoScrollSpeed, settings.keyboardStep]);

  // Stop auto-scroll when the chapter changes.
  useEffect(() => { setAutoScrolling(false); }, [chapterId]);

  useEffect(() => { setMaxSeen((m) => Math.max(m, pageIndex)); }, [pageIndex]);

  const prev = chapter ? prevChapter(chapters, chapterNumber) : null;
  const next = chapter ? nextChapter(chapters, chapterNumber) : null;
  function goToChapter(ch) {
    if (ch) navigate(`/read/${source}/${encodeURIComponent(seriesId)}/${encodeURIComponent(ch.id)}`);
  }
  // Paged mode tracks the current page; strip mode tracks the topmost page
  // currently on screen. Using furthest-seen for the bar stuck it at 100%
  // after switching over from strip (where every page was already observed).
  const pct = pages.length ? progressPercent(mode === 'paged' ? pageIndex : Math.max(pageIndex, currentPage), pages.length) : 0;
  const filter = pageFilter(settings);
  const eager = settings.preload === 'all';
  const progressClass =
    settings.progressBar === 'hidden' ? 'reader-progress reader-progress-hidden' :
    settings.progressBar === 'bottom' ? 'reader-progress reader-progress-bottom' :
    settings.progressBar === 'left' ? 'reader-progress reader-progress-left' :
    settings.progressBar === 'right' ? 'reader-progress reader-progress-right' :
    'reader-progress reader-progress-top';
  // In right-to-left paged mode the page buttons flip direction.
  const pageForwardLabel = direction === 'rtl' ? '← Next page' : 'Next page →';
  const pageBackLabel = direction === 'rtl' ? 'Prev page →' : '← Prev page';

  return (
    <main className="reader">
      <div className={`reader-bar${barHidden ? ' reader-bar-hidden' : ''}`}>
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
          <button type="button" className={`btn btn-sm ${mode === 'strip' ? 'btn-primary' : ''}`} onClick={() => setDirectionMode('strip')}>Strip</button>
          {' '}
          <button type="button" className={`btn btn-sm ${mode === 'paged' ? 'btn-primary' : ''}`} onClick={() => setDirectionMode('paged')}>Paged</button>
        </div>
        <button
          type="button" className={`btn btn-sm ${autoScrolling ? 'btn-primary' : ''}`}
          aria-label={autoScrolling ? 'Pause auto-scroll' : 'Play auto-scroll'}
          title={autoScrolling ? 'Pause auto-scroll' : 'Auto-scroll'}
          onClick={() => setAutoScrolling((v) => !v)}
        >
          {autoScrolling ? '⏸' : '▶'}
        </button>
        <button type="button" className="btn btn-sm" aria-label="Reader settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙️</button>
      </div>
      <div className={progressClass} aria-label={`Reading progress ${pct}%`}><div style={{ width: `${pct}%`, height: `${pct}%` }} /></div>

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
        <div className="reader-pages strip" ref={stripRef} style={{ '--strip-gap': `${settings.stripMargin}px` }}>
          {pages.map((p, i) => (
            <PageImage key={`${p.url}-${i}`} page={p} alt={`Page ${i + 1}`} index={i} onVisible={handleVisible} eager={eager} filter={filter} />
          ))}
          <p className="reader-hint">Scroll to read · progress saves automatically{user ? '' : ' (sign in to keep it across devices on this browser)'}</p>
        </div>
      )}

      {!loading && !error && pages.length > 0 && mode === 'paged' && (
        <div className="reader-pages paged">
          <div className="page-frame">
            <PageImage key={pages[pageIndex].url} page={pages[pageIndex]} alt={`Page ${pageIndex + 1} of ${pages.length}`} index={pageIndex} onVisible={null} eager={eager} filter={filter} />
          </div>
          <p className="reader-hint">Page {pageIndex + 1} of {pages.length} · use ← → keys or the buttons below</p>
          <div className="reader-nav" style={{ padding: '0 0 20px' }}>
            <button type="button" className="btn" disabled={pageIndex <= 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))}>{pageBackLabel}</button>
            <button type="button" className="btn" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}>{pageForwardLabel}</button>
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
      {settingsOpen && (
        <ReaderSettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
