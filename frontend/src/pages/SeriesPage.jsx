import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getChapters, getSeries, sourceById } from '../lib/api';
import { isInCatalogue } from '../lib/catalogue';
import { filterChapters, sortChapters } from '../lib/filters';
import { formatDate, plainText, statusLabel, timeAgo, typeLabel } from '../lib/format';
import {
  addReport, getLibrary, getProgress, isBookmarked, recordHistory, toggleBookmark,
} from '../lib/store';
import { useCurrentUser, useDataVersion } from '../lib/useAuth';
import { CoverImage, EmptyState, ErrorState, RatingBadge, SourceBadge } from '../components/ui';

const REPORT_REASONS = ['Pages do not load', 'Wrong chapter order', 'Missing pages', 'Wrong language', 'Other'];

export default function SeriesPage() {
  const { source, id } = useParams();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const version = useDataVersion();
  const [series, setSeries] = useState(null);
  const [seriesError, setSeriesError] = useState(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [chapters, setChapters] = useState([]);
  const [chaptersTotal, setChaptersTotal] = useState(0);
  const [chaptersError, setChaptersError] = useState(null);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [chapterSources, setChapterSources] = useState([]);
  const [sortDir, setSortDir] = useState('desc');
  const [chapterQuery, setChapterQuery] = useState('');
  const [reportFor, setReportFor] = useState(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState('');
  const [reportDone, setReportDone] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSeriesLoading(true); setSeriesError(null);
    getSeries(source, id)
      .then((s) => { if (!cancelled) { setSeries(s); setSeriesLoading(false); } })
      .catch((err) => { if (!cancelled) { setSeriesError(err); setSeriesLoading(false); } });
    return () => { cancelled = true; };
  }, [source, id, retryTick]);

  useEffect(() => {
    if (!series) return;
    let cancelled = false;
    setChaptersLoading(true); setChaptersError(null);
    getChapters(source, id, { title: series.title })
      .then((res) => {
        if (cancelled) return;
        setChapters(res.chapters); setChaptersTotal(res.total);
        setChapterSources(res.sources || []); setChaptersLoading(false);
      })
      .catch((err) => { if (!cancelled) { setChaptersError(err); setChaptersLoading(false); } });
    return () => { cancelled = true; };
  }, [source, id, series]);

  const progress = user && series ? getProgress(user.email, String(series.id)) : null;
  const readChapterIds = useMemo(() => {
    if (!user || !series) return new Set();
    return new Set(getLibrary(user.email).history.filter((h) => h.seriesId === String(series.id)).map((h) => h.chapterId));
  }, [user, series, version]);

  const visibleChapters = useMemo(
    () => filterChapters(sortChapters(chapters, sortDir), chapterQuery),
    [chapters, sortDir, chapterQuery],
  );
  const bookmarked = user && series ? isBookmarked(user.email, String(series.id), source) : false;
  const inCatalogue = isInCatalogue(source, id);

  function openChapter(chapter) {
    if (user && series) recordHistory(user.email, series, chapter);
    navigate(`/read/${source}/${encodeURIComponent(id)}/${encodeURIComponent(chapter.id)}`);
  }
  function submitReport(e) {
    e.preventDefault();
    if (!series || !reportFor) return;
    addReport({ series, chapter: reportFor, reason: reportReason, detail: reportDetail, reporter: user?.email || 'guest' });
    setReportDone(true);
    setTimeout(() => { setReportFor(null); setReportDone(false); setReportDetail(''); }, 1800);
  }

  if (seriesLoading) {
    return (
      <main className="page">
        <div className="series-hero">
          <div className="skeleton" style={{ width: 220, aspectRatio: '2 / 3', borderRadius: 14 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-line" style={{ width: '60%', height: 28, margin: 0 }} />
            <div className="skeleton skeleton-line" style={{ width: '90%', marginLeft: 0 }} />
            <div className="skeleton skeleton-line" style={{ width: '75%', marginLeft: 0 }} />
          </div>
        </div>
      </main>
    );
  }
  if (seriesError || !series) {
    return (
      <main className="page">
        <ErrorState error={seriesError || new Error('Series not found.')} onRetry={() => setRetryTick((t) => t + 1)} />
        <p style={{ marginTop: 16 }}><Link to="/browse" className="btn">← Back to Browse</Link></p>
      </main>
    );
  }

  const firstChapter = sortChapters(chapters, 'asc')[0];
  const continueChapter = progress ? chapters.find((c) => c.id === progress.chapterId) : null;

  return (
    <main className="page">
      <div className="series-hero">
        <CoverImage src={series.cover} alt={`${series.title} cover`} className="series-cover" />
        <div className="series-info">
          <h1>{series.title}</h1>
          <div className="series-meta">
            <SourceBadge source={series.source} />
            <span>{typeLabel(series.type)}</span>
            <span className={`status status-${series.status}`}>{statusLabel(series.status)}</span>
            {series.year ? <span>{series.year}</span> : null}
            <span>{series.contentRating}</span>
            <RatingBadge series={series} />
            {series.followCount ? <span>{series.followCount.toLocaleString()} follows</span> : null}
          </div>
          {(series.authors?.length > 0 || series.artists?.length > 0) && (
            <p className="series-meta">
              {series.authors?.length > 0 && <span>Author: {series.authors.join(', ')}</span>}
              {series.artists?.length > 0 && <span>Artist: {series.artists.join(', ')}</span>}
            </p>
          )}
          {series.genres?.length > 0 && (
            <div className="genre-list">
              {series.genres.map((g) => <span key={g} className="badge">{g}</span>)}
              {series.themes?.map((t) => <span key={t} className="badge">{t}</span>)}
            </div>
          )}
          {inCatalogue && <p className="notice">Added to the ComicVerse catalogue by an admin.</p>}
          {series.description ? (
            <p className="series-desc">{plainText(series.description).slice(0, 1400)}{plainText(series.description).length > 1400 ? '…' : ''}</p>
          ) : (
            <p className="series-desc" style={{ color: 'var(--text-faint)' }}>No description provided by {sourceById(source).name}.</p>
          )}
          <div className="series-actions">
            {user ? (
              <button type="button" className="btn btn-primary" onClick={() => toggleBookmark(user.email, series)}>
                {bookmarked ? '★ Bookmarked — remove' : '☆ Bookmark'}
              </button>
            ) : (
              <Link to="/login" className="btn btn-primary">Sign in to bookmark</Link>
            )}
            {continueChapter && progress ? (
              <button type="button" className="btn" onClick={() => openChapter(continueChapter)}>
                Continue Ch. {progress.chapterNumber} ({progress.pageCount ? `${Math.round(((progress.pageIndex + 1) / progress.pageCount) * 100)}%` : 'started'})
              </button>
            ) : firstChapter ? (
              <button type="button" className="btn" onClick={() => openChapter(firstChapter)}>Start reading — Ch. {firstChapter.number}</button>
            ) : null}
          </div>
          {progress && (
            <div>
              <div className="progress-track" aria-label="Reading progress">
                <div className="progress-fill" style={{ width: `${progress.pageCount ? Math.round(((progress.pageIndex + 1) / progress.pageCount) * 100) : 0}%` }} />
              </div>
              <p className="filter-note">Last read: Chapter {progress.chapterNumber} · {timeAgo(progress.updatedAt)}</p>
            </div>
          )}
        </div>
      </div>

      <section className="section" aria-label="Chapters">
        <div className="section-head">
          <div>
            <h2>Chapters {chaptersTotal ? `(${chaptersTotal})` : ''}</h2>
            <p className="section-sub">
              {chapterSources.length > 0 ? `Sources: ${chapterSources.join(' + ')}` : 'English chapters'}
              {source === 'mangadex' ? ' · external / licensed chapters are skipped (no readable pages)' : ''}
            </p>
          </div>
          <div className="chapter-tools">
            <input type="search" value={chapterQuery} onChange={(e) => setChapterQuery(e.target.value)} placeholder="Filter chapters…" aria-label="Filter chapters" />
            <button type="button" className="btn btn-sm" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
              {sortDir === 'asc' ? 'Oldest first ↑' : 'Newest first ↓'}
            </button>
          </div>
        </div>

        {chaptersLoading ? (
          <div className="empty" role="status"><p className="empty-title">Loading chapters…</p></div>
        ) : chaptersError ? (
          <ErrorState error={chaptersError} onRetry={() => setRetryTick((t) => t + 1)} />
        ) : chapters.length === 0 ? (
          <EmptyState title="No chapters found" body="This title has no English chapters on this provider right now. Try another provider from Browse." />
        ) : visibleChapters.length === 0 ? (
          <EmptyState title="No chapters match that filter" body="Clear the chapter filter to see them all." />
        ) : (
          <ul className="chapter-list">
            {visibleChapters.map((c) => (
              <li key={`${c.source}:${c.id}`}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button type="button" className="chapter-row" onClick={() => openChapter(c)}>
                    <span className="chapter-num">Ch. {c.number || '—'}</span>
                    <span className="chapter-title">{c.title || 'Untitled chapter'}</span>
                    {readChapterIds.has(c.id) ? <span className="chapter-read">✓ Read</span> : null}
                    <span className="chapter-date">{c.publishedAt ? formatDate(c.publishedAt) : (c.group || '')}</span>
                  </button>
                  <button type="button" className="btn btn-sm" style={{ marginRight: 12 }} onClick={() => { setReportFor(c); setReportDone(false); }} aria-label={`Report chapter ${c.number}`}>
                    Report
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {reportFor && (
          <form className="form-card" style={{ marginTop: 20 }} onSubmit={submitReport}>
            <h3>Report Chapter {reportFor.number}</h3>
            {reportDone ? (
              <p className="notice">Thanks — your report was saved for the admin to review.</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="report-reason">What&apos;s wrong?</label>
                  <select id="report-reason" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
                    {REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="report-detail">Details (optional)</label>
                  <textarea id="report-detail" rows="3" value={reportDetail} onChange={(e) => setReportDetail(e.target.value)} placeholder="What did you see?" />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="submit" className="btn btn-primary">Send report</button>
                  <button type="button" className="btn" onClick={() => setReportFor(null)}>Cancel</button>
                </div>
              </>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
