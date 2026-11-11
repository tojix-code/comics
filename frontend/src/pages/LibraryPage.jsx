import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clearHistory, getLibrary, getProgress } from '../lib/store';
import { useCurrentUser, useDataVersion } from '../lib/useAuth';
import { CoverImage, EmptyState } from '../components/ui';
import { progressPercent } from '../lib/filters';
import { timeAgo } from '../lib/format';

export default function LibraryPage() {
  const user = useCurrentUser();
  const version = useDataVersion();
  const [tab, setTab] = useState('continue');
  const lib = user ? getLibrary(user.email) : { bookmarks: [], history: [], progress: {} };
  void version;

  const continueItems = Object.entries(lib.progress)
    .map(([seriesId, p]) => ({ seriesId, ...p }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const historyBySeries = lib.history.filter((h) => h.seriesId);

  function seriesTitle(seriesId) {
    const fromHistory = lib.history.find((h) => h.seriesId === seriesId);
    const fromBookmark = lib.bookmarks.find((b) => b.seriesId === seriesId);
    return fromHistory?.title || fromBookmark?.title || 'Unknown title';
  }
  function seriesCover(seriesId) {
    return lib.history.find((h) => h.seriesId === seriesId)?.cover
      || lib.bookmarks.find((b) => b.seriesId === seriesId)?.cover || '';
  }
  function seriesSource(seriesId) {
    return lib.history.find((h) => h.seriesId === seriesId)?.source
      || lib.bookmarks.find((b) => b.seriesId === seriesId)?.source || 'mangadex';
  }

  return (
    <main className="page">
      <h1>My Library</h1>
      <p className="lede">Signed in as {user?.name} ({user?.email}). Everything here is stored in this browser.</p>

      <div className="tabs" role="tablist" aria-label="Library sections">
        <button type="button" className={`chip ${tab === 'continue' ? 'chip-active' : ''}`} onClick={() => setTab('continue')}>Continue reading</button>
        <button type="button" className={`chip ${tab === 'bookmarks' ? 'chip-active' : ''}`} onClick={() => setTab('bookmarks')}>Bookmarks ({lib.bookmarks.length})</button>
        <button type="button" className={`chip ${tab === 'history' ? 'chip-active' : ''}`} onClick={() => setTab('history')}>History ({lib.history.length})</button>
      </div>

      {tab === 'continue' && (
        continueItems.length === 0 ? (
          <EmptyState title="Nothing to continue yet" body="Open a chapter from any series page and your place will be saved here." action={<Link to="/browse" className="btn btn-primary">Find something to read</Link>} />
        ) : (
          <div className="grid">
            {continueItems.map((p) => {
              const pct = progressPercent(p.pageIndex, p.pageCount);
              return (
                <article className="card" key={p.seriesId}>
                  <Link to={`/read/${seriesSource(p.seriesId)}/${encodeURIComponent(p.seriesId)}/${encodeURIComponent(p.chapterId)}`} className="card-cover-link">
                    <CoverImage src={seriesCover(p.seriesId)} alt={`${seriesTitle(p.seriesId)} cover`} className="card-cover" />
                  </Link>
                  <div className="card-body">
                    <h3 className="card-title">
                      <Link to={`/read/${seriesSource(p.seriesId)}/${encodeURIComponent(p.seriesId)}/${encodeURIComponent(p.chapterId)}`}>{seriesTitle(p.seriesId)}</Link>
                    </h3>
                    <p className="card-genres">Chapter {p.chapterNumber || '—'} · {pct}% · {timeAgo(p.updatedAt)}</p>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                    <p className="card-genres">{getProgress(user.email, p.seriesId) ? '' : ''}<Link to={`/series/${seriesSource(p.seriesId)}/${encodeURIComponent(p.seriesId)}`}>Series page →</Link></p>
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}

      {tab === 'bookmarks' && (
        lib.bookmarks.length === 0 ? (
          <EmptyState title="No bookmarks yet" body="Tap ☆ Bookmark on any series page to keep it here." action={<Link to="/browse" className="btn btn-primary">Browse series</Link>} />
        ) : (
          <div className="grid">
            {lib.bookmarks.map((b) => (
              <article className="card" key={`${b.source}:${b.seriesId}`}>
                <Link to={`/series/${b.source}/${encodeURIComponent(b.seriesId)}`} className="card-cover-link">
                  <CoverImage src={b.cover} alt={`${b.title} cover`} className="card-cover" />
                </Link>
                <div className="card-body">
                  <h3 className="card-title"><Link to={`/series/${b.source}/${encodeURIComponent(b.seriesId)}`}>{b.title}</Link></h3>
                  <p className="card-genres">{b.type} · {b.status} · saved {timeAgo(b.addedAt)}</p>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {tab === 'history' && (
        <>
          {historyBySeries.length === 0 ? (
            <EmptyState title="No reading history yet" body="Chapters you open will show up here." />
          ) : (
            <>
              <button type="button" className="btn btn-danger" style={{ marginBottom: 16 }} onClick={() => { if (window.confirm('Clear all reading history?')) clearHistory(user.email); }}>
                Clear history
              </button>
              <ul className="chapter-list">
                {historyBySeries.map((h) => (
                  <li key={`${h.seriesId}:${h.chapterId}`}>
                    <Link to={`/read/${h.source}/${encodeURIComponent(h.seriesId)}/${encodeURIComponent(h.chapterId)}`} className="chapter-row">
                      <span className="chapter-num">Ch. {h.chapterNumber || '—'}</span>
                      <span className="chapter-title">{h.title}</span>
                      <span className="chapter-date">{timeAgo(h.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
