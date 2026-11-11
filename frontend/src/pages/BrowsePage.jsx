import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  browseMangaDex, chapterFeedTotal, getTags, listSeries, searchSeries, withRatings,
} from '../lib/api';
import { getCatalogue, getVisibleGenres } from '../lib/catalogue';
import { byChapterCount, byMinRating } from '../lib/filters';
import { EmptyState, ErrorState, Pagination, ProviderPicker, SeriesGrid } from '../components/ui';

const SORTS = [
  { id: 'trending', label: 'Trending', order: 'order[followedCount]=desc' },
  { id: 'popular', label: 'Highest rated', order: 'order[rating]=desc' },
  { id: 'recent-updates', label: 'Recently updated', order: 'order[latestUploadedChapter]=desc' },
  { id: 'recently-added', label: 'Recently added', order: 'order[createdAt]=desc' },
  { id: 'relevance', label: 'Most relevant', order: 'order[relevance]=desc' },
];
const STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled'];
const TYPES = [
  { id: '', label: 'All types' },
  { id: 'manga', label: 'Manga' },
  { id: 'manhwa', label: 'Manhwa' },
  { id: 'manhua', label: 'Manhua' },
];
const CONTENT_RATINGS = ['safe', 'suggestive'];

function useDebounced(value, ms = 450) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const source = params.get('source') || 'mangadex';
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  const sort = params.get('sort') || 'trending';
  const statusParam = params.get('status') || '';
  const yearParam = params.get('year') || '';
  const author = params.get('author') || '';
  const minRating = Number(params.get('minRating') || 0);
  const minChapters = params.get('minChapters') ? Number(params.get('minChapters')) : null;
  const maxChapters = params.get('maxChapters') ? Number(params.get('maxChapters')) : null;
  const genreParam = params.get('genres') || '';
  const page = Math.max(1, Number(params.get('page') || 1));

  const [queryInput, setQueryInput] = useState(q);
  const debouncedQ = useDebounced(queryInput);
  const [tags, setTags] = useState([]);
  const [tagsError, setTagsError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null, authorNotFound: false, countsLoading: false });

  useEffect(() => { setQueryInput(q); }, [q]);

  useEffect(() => {
    let cancelled = false;
    getTags()
      .then((t) => { if (!cancelled) setTags(t.filter((tag) => tag.group === 'genre')); })
      .catch((err) => { if (!cancelled) setTagsError(err); });
    return () => { cancelled = true; };
  }, []);

  // Keep the URL in sync with the debounced search box.
  useEffect(() => {
    if (debouncedQ !== q) {
      const next = new URLSearchParams(params);
      if (debouncedQ) next.set('q', debouncedQ); else next.delete('q');
      next.set('page', '1');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const selectedGenres = useMemo(() => genreParam.split(',').filter(Boolean), [genreParam]);
  const selectedStatus = useMemo(() => statusParam.split(',').filter(Boolean), [statusParam]);
  const visibleGenres = getVisibleGenres();
  const shownTags = visibleGenres ? tags.filter((t) => visibleGenres.includes(t.id)) : tags;

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null, authorNotFound: false }));
    (async () => {
      try {
        let items = []; let total = 0; let authorNotFound = false;
        if (source === 'mangadex') {
          const sortDef = SORTS.find((s) => s.id === sort) || SORTS[0];
          const hasFilters = q || selectedGenres.length || selectedStatus.length || yearParam || author || type;
          if (hasFilters) {
            const res = await browseMangaDex({
              q, type: type || null, page, limit: 20,
              tags: selectedGenres, status: selectedStatus,
              year: yearParam ? Number(yearParam) : null,
              contentRating: CONTENT_RATINGS, authorName: author,
              order: sortDef.order,
            });
            items = res.results; total = res.total; authorNotFound = Boolean(res.authorNotFound);
          } else {
            const res = await listSeries(sortDef.id === 'relevance' ? 'trending' : sortDef.id, { source: 'mangadex', page, limit: 20 });
            items = res.results; total = res.total;
          }
        } else if (q) {
          const res = await searchSeries({ q, source, type: type || null, page, limit: 20 });
          items = res.results; total = res.total;
        } else if (source === 'comick') {
          const res = await listSeries('trending', { source: 'comick', type: type || null, page, limit: 20 });
          items = res.results; total = res.total;
        } else {
          items = []; total = 0; // weebcentral / asura are search-only
        }

        if (minRating) items = byMinRating(await withRatings(items), minRating);
        else if (source === 'mangadex') items = await withRatings(items);

        if ((minChapters != null || maxChapters != null) && items.length) {
          if (!cancelled) setState((s) => ({ ...s, countsLoading: true }));
          const totals = {};
          await Promise.all(items.map(async (s) => { totals[s.id] = await chapterFeedTotal(s.source, s.id, s); }));
          if (cancelled) return;
          items = byChapterCount(items, totals, minChapters, maxChapters);
          total = items.length;
        }
        if (!cancelled) setState({ items, total, loading: false, error: null, authorNotFound, countsLoading: false });
      } catch (err) {
        if (!cancelled) setState({ items: [], total: 0, loading: false, error: err, authorNotFound: false, countsLoading: false });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, q, type, sort, statusParam, yearParam, author, minRating, minChapters, maxChapters, genreParam, page, retryTick]);

  function updateParam(key, value) {
    const next = new URLSearchParams(params);
    if (value === '' || value == null) next.delete(key); else next.set(key, String(value));
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  }
  function toggleListParam(key, value, current) {
    const set = new Set(current);
    if (set.has(value)) set.delete(value); else set.add(value);
    updateParam(key, [...set].join(','));
  }

  const catalogueMatches = q
    ? getCatalogue().filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
    : [];
  const isSearchOnly = (source === 'weebcentral' || source === 'asura') && !q;

  return (
    <main className="page">
      <h1>Browse</h1>
      <p className="lede">
        Search and filter across providers. MangaDex supports every filter below;
        ComicK supports search + type + trending; WeebCentral and AsuraScans are search-only
        (those sites have no browse list endpoint).
      </p>

      <div className="filter-bar">
        <ProviderPicker value={source} onChange={(s) => updateParam('source', s)} enabledOnly />
        <div className="filter-row">
          <div className="field">
            <label htmlFor="browse-q">Search</label>
            <input id="browse-q" type="search" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="Title, e.g. Solo Leveling" />
          </div>
          <div className="field">
            <label htmlFor="browse-type">Type</label>
            <select id="browse-type" value={type} onChange={(e) => updateParam('type', e.target.value)}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="browse-sort">Sort by</label>
            <select id="browse-sort" value={sort} onChange={(e) => updateParam('sort', e.target.value)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {source === 'mangadex' && (
          <>
            <div>
              <p className="filter-note" style={{ marginBottom: 8 }}>Genres</p>
              {tagsError ? <p className="filter-note">Couldn&apos;t load genres ({tagsError.message}). Genre filtering is unavailable right now.</p> : (
                <div className="filter-chips">
                  {shownTags.map((t) => (
                    <button key={t.id} type="button" className={`chip ${selectedGenres.includes(t.id) ? 'chip-active' : ''}`} onClick={() => toggleListParam('genres', t.id, selectedGenres)} aria-pressed={selectedGenres.includes(t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="filter-row">
              <div className="field">
                <label>Status</label>
                <div className="filter-chips">
                  {STATUSES.map((s) => (
                    <button key={s} type="button" className={`chip ${selectedStatus.includes(s) ? 'chip-active' : ''}`} onClick={() => toggleListParam('status', s, selectedStatus)} aria-pressed={selectedStatus.includes(s)}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="filter-row">
              <div className="field">
                <label htmlFor="browse-year">Year</label>
                <input id="browse-year" type="number" min="1900" max="2100" value={yearParam} placeholder="e.g. 2023" onChange={(e) => updateParam('year', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="browse-author">Creator / author</label>
                <input id="browse-author" type="text" value={author} placeholder="Author name" onChange={(e) => updateParam('author', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="browse-rating">Minimum rating</label>
                <select id="browse-rating" value={minRating} onChange={(e) => updateParam('minRating', Number(e.target.value) || '')}>
                  <option value="">Any rating</option>
                  <option value="7">7.0+</option>
                  <option value="8">8.0+</option>
                  <option value="8.5">8.5+</option>
                  <option value="9">9.0+</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="browse-minch">Min. chapters</label>
                <input id="browse-minch" type="number" min="0" value={minChapters ?? ''} placeholder="e.g. 10" onChange={(e) => updateParam('minChapters', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="browse-maxch">Max. chapters</label>
                <input id="browse-maxch" type="number" min="0" value={maxChapters ?? ''} placeholder="e.g. 100" onChange={(e) => updateParam('maxChapters', e.target.value)} />
              </div>
            </div>
            <p className="filter-note">Ratings are real MangaDex bayesian ratings. Chapter counts come from each title&apos;s English chapter feed; titles with an unknown count are left out when a chapter filter is set.</p>
          </>
        )}
      </div>

      {state.authorNotFound && (
        <EmptyState title={`No creator found for “${author}”`} body="Check the spelling, or clear the creator filter to see everything." />
      )}

      {isSearchOnly ? (
        <EmptyState
          title={`${source === 'asura' ? 'AsuraScans' : 'WeebCentral'} is search-only`}
          body="This provider has no browse list, so type a title above to search it — or add its titles from Admin → Add title."
        />
      ) : state.error ? (
        <ErrorState error={state.error} onRetry={() => setRetryTick((t) => t + 1)} />
      ) : (
        <>
          {state.countsLoading && <p className="filter-note">Checking chapter counts…</p>}
          <SeriesGrid items={state.items} loading={state.loading} />
          {!state.loading && state.items.length === 0 && !state.authorNotFound && (
            <EmptyState
              title={q ? `No results for “${q}”` : 'No titles match these filters'}
              body="Try a different spelling, clear a filter, or switch provider — catalogues differ between providers."
              action={<button type="button" className="btn" onClick={() => setParams(new URLSearchParams({ source }))}>Clear filters</button>}
            />
          )}
          <Pagination page={page} total={state.total} limit={20} onPage={(p) => updateParam('page', p)} />
        </>
      )}

      {catalogueMatches.length > 0 && (
        <section className="section">
          <h2>From the ComicVerse catalogue</h2>
          <p className="section-sub">Titles your admin added from {catalogueMatches.map((c) => c.source).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.</p>
          <SeriesGrid items={catalogueMatches.map((c) => ({ id: c.sourceId, source: c.source, title: c.title, cover: c.cover, type: c.type, status: c.status, genres: c.genres, year: c.year, ratingValue: c.ratingValue, ratingLabel: c.ratingLabel }))} />
        </section>
      )}

      <p className="filter-note" style={{ marginTop: 24 }}>
        Results come from the live provider APIs — nothing here is invented or seeded.
        If a provider is blocked (Cloudflare / offline backend), its error is shown instead of empty results.
      </p>
      <Link to="/" className="btn" style={{ marginTop: 12 }}>← Back home</Link>
    </main>
  );
}
