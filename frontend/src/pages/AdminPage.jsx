import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SOURCES, backendHealth, getTags, searchSeries } from '../lib/api';
import {
  addToCatalogue, getCatalogue, getEnabledSources, getFeaturedKeys, getHiddenKeys,
  getVisibleGenres, isInCatalogue, removeFromCatalogue, setEnabledSources,
  setFeatured, setHidden, setVisibleGenres,
} from '../lib/catalogue';
import {
  deleteUser, getReports, getUsers, setReportStatus, setUserRole,
} from '../lib/store';
import { useCurrentUser, useDataVersion } from '../lib/useAuth';
import { CoverImage, EmptyState, ErrorState, SourceBadge } from '../components/ui';
import { typeLabel } from '../lib/format';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'add', label: 'Add title' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'users', label: 'Users' },
  { id: 'reports', label: 'Reports' },
  { id: 'sources', label: 'Sources' },
  { id: 'genres', label: 'Genres' },
];

function AddTitle({ user }) {
  const [source, setSource] = useState('mangadex');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [version, setVersion] = useState(0);
  void version;

  async function runSearch(e) {
    e?.preventDefault();
    if (!q.trim()) { setError(new Error('Type a title to search.')); return; }
    setLoading(true); setError(null); setSearched(true);
    try {
      const res = await searchSeries({ q: q.trim(), source, type: type || null, page: 1, limit: 12 });
      setResults(res.results);
    } catch (err) {
      setError(err); setResults([]);
    } finally { setLoading(false); }
  }

  return (
    <div>
      <p className="lede">
        Pick a provider, then search it. The title is added to the ComicVerse catalogue with its
        provider attached, so its series and chapter pages always resolve through that provider.
        MangaDex and ComicK are public APIs; WeebCentral and AsuraScans are scraped by the backend
        and only work when the source site lets the request through.
      </p>
      <div className="provider-picker" role="group" aria-label="Provider">
        {SOURCES.map((s) => (
          <button key={s.id} type="button" className={`chip ${source === s.id ? 'chip-active' : ''}`} onClick={() => setSource(s.id)} title={`${s.kind}. ${s.blurb}`}>
            {s.name}
          </button>
        ))}
      </div>
      <form onSubmit={runSearch} style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Content type" className="btn">
          <option value="">Manga + Manhwa + Manhua</option>
          <option value="manga">Manga</option>
          <option value="manhwa">Manhwa</option>
          <option value="manhua">Manhua</option>
        </select>
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${SOURCES.find((s) => s.id === source)?.name}…`}
          aria-label="Search provider" style={{ flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-soft)' }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>

      {error && <div style={{ marginTop: 16 }}><ErrorState error={error} /></div>}
      {loading && <p style={{ marginTop: 16 }}>Searching {SOURCES.find((s) => s.id === source)?.name}…</p>}
      {!loading && searched && !error && results.length === 0 && (
        <div style={{ marginTop: 16 }}><EmptyState title={`No results on ${SOURCES.find((s) => s.id === source)?.name}`} body="Try a different spelling, or another provider — catalogues differ." /></div>
      )}
      <div style={{ marginTop: 16 }}>
        {results.map((s) => {
          const added = isInCatalogue(s.source, s.id);
          return (
            <div className="search-result" key={`${s.source}:${s.id}`}>
              <CoverImage src={s.cover} alt={`${s.title} cover`} />
              <div className="sr-info">
                <strong>{s.title}</strong>
                <span>{typeLabel(s.type)} · {s.status}{s.year ? ` · ${s.year}` : ''}{s.genres?.length ? ` · ${s.genres.slice(0, 3).join(', ')}` : ''}</span>
                <span style={{ display: 'block', marginTop: 4 }}><SourceBadge source={s.source} /></span>
              </div>
              {added ? (
                <Link to={`/series/${s.source}/${encodeURIComponent(s.id)}`} className="btn btn-sm">Added ✓ — view</Link>
              ) : (
                <button
                  type="button" className="btn btn-primary btn-sm"
                  onClick={() => { addToCatalogue(s, user.name); setVersion((v) => v + 1); }}
                >
                  Add to ComicVerse
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const user = useCurrentUser();
  const version = useDataVersion();
  const [tab, setTab] = useState('overview');
  const [health, setHealth] = useState({ ok: null, sources: null });
  const [tags, setTags] = useState([]);
  const [tagsError, setTagsError] = useState(null);
  const [adminError, setAdminError] = useState('');
  void version;

  useEffect(() => {
    let cancelled = false;
    backendHealth().then((h) => { if (!cancelled) setHealth({ ok: h.ok, sources: h.sources }); });
    getTags().then(setTags).catch((err) => setTagsError(err));
    return () => { cancelled = true; };
  }, []);

  const users = getUsers();
  const catalogue = getCatalogue();
  const reports = getReports();
  const openReports = reports.filter((r) => r.status === 'open');
  const enabled = getEnabledSources();
  const visibleGenres = getVisibleGenres();
  const featuredKeys = getFeaturedKeys();
  const hiddenKeys = getHiddenKeys();

  function runAdmin(fn) {
    setAdminError('');
    try { fn(); } catch (err) { setAdminError(err.message); }
  }

  return (
    <main className="page">
      <h1>Admin</h1>
      <p className="lede">Signed in as {user?.name} (admin). These settings are stored in this browser in v1.</p>
      {adminError ? <p className="form-error" role="alert">{adminError}</p> : null}

      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`chip ${tab === t.id ? 'chip-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'reports' && openReports.length > 0 ? ` (${openReports.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="admin-grid">
          <div className="admin-card">
            <h3>Backend API</h3>
            <p>
              <span className={`dot ${health.ok == null ? 'dot-unknown' : health.ok ? 'dot-ok' : 'dot-bad'}`} />
              {health.ok == null ? 'Checking…' : health.ok ? 'Reachable' : 'Unreachable — the app falls back to MangaDex direct where possible'}
            </p>
            <p>Sources reported by backend: {health.sources ? health.sources.join(', ') : '—'}</p>
            <Link to="/browse" className="btn btn-sm">Open Browse →</Link>
          </div>
          <div className="admin-card">
            <h3>Catalogue</h3>
            <p>{catalogue.length} titles added · {featuredKeys.length} featured · {hiddenKeys.length} hidden</p>
            <button type="button" className="btn btn-sm" onClick={() => setTab('add')}>Add a title →</button>
          </div>
          <div className="admin-card">
            <h3>Users</h3>
            <p>{users.length} accounts on this device · {users.filter((u) => u.role === 'admin').length} admins</p>
            <button type="button" className="btn btn-sm" onClick={() => setTab('users')}>Manage users →</button>
          </div>
          <div className="admin-card">
            <h3>Reader reports</h3>
            <p>{openReports.length} open · {reports.length} total</p>
            <button type="button" className="btn btn-sm" onClick={() => setTab('reports')}>Review reports →</button>
          </div>
        </div>
      )}

      {tab === 'add' && <AddTitle user={user} />}

      {tab === 'catalogue' && (
        catalogue.length === 0 ? (
          <EmptyState title="Catalogue is empty" body="Add your first title from the Add title tab — pick a provider, search, and add." action={<button type="button" className="btn btn-primary" onClick={() => setTab('add')}>Add a title</button>} />
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Title</th><th>Provider</th><th>Type</th><th>Added by</th><th>Actions</th></tr></thead>
              <tbody>
                {catalogue.map((c) => (
                  <tr key={c.key}>
                    <td><Link to={`/series/${c.source}/${encodeURIComponent(c.sourceId)}`}>{c.title}</Link></td>
                    <td><SourceBadge source={c.source} /></td>
                    <td>{typeLabel(c.type)}</td>
                    <td>{c.addedBy}<br /><span style={{ color: 'var(--text-faint)' }}>{new Date(c.addedAt).toLocaleDateString()}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-sm" onClick={() => setFeatured(c.key, !featuredKeys.includes(c.key))}>
                        {featuredKeys.includes(c.key) ? '★ Featured' : 'Feature'}
                      </button>{' '}
                      <button type="button" className="btn btn-sm" onClick={() => setHidden(c.key, !hiddenKeys.includes(c.key))}>
                        {hiddenKeys.includes(c.key) ? 'Unhide' : 'Hide'}
                      </button>{' '}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => { if (window.confirm(`Remove "${c.title}" from the catalogue?`)) removeFromCatalogue(c.key); }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'users' && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Sign-in</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.provider === 'google' ? 'Google' : u.email === 'demo@comicverse.app' ? 'Demo' : 'Email'}</td>
                  <td>
                    <select value={u.role} onChange={(e) => runAdmin(() => setUserRole(user, u.email, e.target.value))} aria-label={`Role for ${u.email}`}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    {u.email !== user.email && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => runAdmin(() => { if (window.confirm(`Delete ${u.email} and their library?`)) deleteUser(user, u.email); })}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reports' && (
        reports.length === 0 ? (
          <EmptyState title="No reports yet" body="When readers report a broken chapter, it shows up here." />
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Title</th><th>Chapter</th><th>Reason</th><th>Reporter</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/series/${r.source}/${encodeURIComponent(r.seriesId)}`}>{r.title || r.seriesId}</Link></td>
                    <td>{r.chapterNumber || '—'}</td>
                    <td>{r.reason}{r.detail ? <><br /><span style={{ color: 'var(--text-dim)' }}>{r.detail}</span></> : null}</td>
                    <td>{r.reporter}</td>
                    <td>{r.status}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'open' && (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => runAdmin(() => setReportStatus(user, r.id, 'resolved'))}>Resolve</button>{' '}
                          <button type="button" className="btn btn-sm" onClick={() => runAdmin(() => setReportStatus(user, r.id, 'dismissed'))}>Dismiss</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'sources' && (
        <div>
          <p className="lede">Choose which providers ComicVerse uses. Disabled providers disappear from Browse and Add title. MangaDex is the fallback source for the homepage lists.</p>
          {SOURCES.map((s) => {
            const on = enabled.includes(s.id);
            return (
              <div className="source-row" key={s.id}>
                <input
                  type="checkbox" checked={on} aria-label={`Enable ${s.name}`}
                  onChange={(e) => {
                    const next = e.target.checked ? [...enabled, s.id] : enabled.filter((id) => id !== s.id);
                    if (next.length === 0) { setAdminError('At least one provider must stay enabled.'); return; }
                    setEnabledSources(next);
                  }}
                />
                <div className="source-info">
                  <strong>{s.name} <span className="badge">{s.kind}</span></strong>
                  <span>{s.blurb}</span>
                  <span style={{ display: 'block' }}>
                    {s.id === 'mangadex' && 'Lists: trending, popular, recent updates, recently added. Full filters. Works without the backend.'}
                    {s.id === 'comick' && 'Lists: trending only. Search + type filter. Backend required.'}
                    {(s.id === 'weebcentral' || s.id === 'asura') && 'Search-only. No browse list. Backend required; often blocked by Cloudflare.'}
                  </span>
                </div>
                <span className={`dot ${health.ok == null ? 'dot-unknown' : health.ok ? 'dot-ok' : 'dot-bad'}`} title={health.ok ? 'Backend reachable' : 'Backend unreachable'} />
              </div>
            );
          })}
          <p className="filter-note" style={{ marginTop: 14 }}>
            Scraped providers (WeebCentral, AsuraScans) depend on the source site allowing the backend's requests.
            If they keep failing, set PROXY_URL or FLARESOLVERR_URL on the backend — see the repo README.
          </p>
        </div>
      )}

      {tab === 'genres' && (
        <div>
          <p className="lede">Genres come live from MangaDex&apos;s tag list. Untick genres to hide them from the Browse filter chips.</p>
          {tagsError ? <ErrorState error={tagsError} /> : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setVisibleGenres(null)} style={{ marginBottom: 12 }}>Show all genres</button>
              <div className="filter-chips">
                {tags.filter((t) => t.group === 'genre').map((t) => {
                  const shown = !visibleGenres || visibleGenres.includes(t.id);
                  return (
                    <button key={t.id} type="button" className={`chip ${shown ? 'chip-active' : ''}`} aria-pressed={shown}
                      onClick={() => {
                        const current = visibleGenres || tags.filter((x) => x.group === 'genre').map((x) => x.id);
                        const next = shown ? current.filter((id) => id !== t.id) : [...current, t.id];
                        setVisibleGenres(next.length === tags.filter((x) => x.group === 'genre').length ? null : next);
                      }}>
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
