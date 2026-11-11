import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listSeries, withRatings, sourceById } from '../lib/api';
import { getCatalogue, getFeaturedKeys } from '../lib/catalogue';
import { getLibrary } from '../lib/store';
import { useCurrentUser, useDataVersion } from '../lib/useAuth';
import { CoverImage, EmptyState, ErrorState, SectionHeader, SeriesGrid } from '../components/ui';
import { typeLabel } from '../lib/format';

function useList(kind, limit = 12) {
  const [state, setState] = useState({ items: [], loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { results } = await listSeries(kind, { source: 'mangadex', limit });
        const rated = await withRatings(results);
        if (!cancelled) setState({ items: rated, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ items: [], loading: false, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, [kind, limit]);
  return state;
}

export default function HomePage() {
  const user = useCurrentUser();
  const version = useDataVersion();
  const trending = useList('trending', 12);
  const recent = useList('recent-updates', 12);
  const popular = useList('popular', 12);
  const added = useList('recently-added', 12);

  const catalogue = getCatalogue();
  const featuredKeys = getFeaturedKeys();
  const curated = [...catalogue].sort((a, b) => {
    const fa = featuredKeys.includes(a.key) ? 0 : 1;
    const fb = featuredKeys.includes(b.key) ? 0 : 1;
    return fa - fb || new Date(b.addedAt) - new Date(a.addedAt);
  });
  const hero = curated.find((c) => featuredKeys.includes(c.key)) || trending.items[0] || curated[0];

  const continueReading = user ? getLibrary(user.email).history.slice(0, 6) : [];
  void version; // re-render when library/catalogue data changes

  return (
    <main className="page">
      <section className="hero" aria-label="Featured">
        <div className="hero-text">
          <h1>Read manga, manhwa &amp; manhua — all in one place.</h1>
          <p>
            ComicVerse pulls from {sourceById('mangadex').name}, {sourceById('comick').name},{' '}
            {sourceById('weebcentral').name} and {sourceById('asura').name} through one search.
            Bookmark series, track chapters, and pick up exactly where you left off.
          </p>
          <div className="hero-actions">
            <Link to="/browse" className="btn btn-primary">Browse the library</Link>
            {user ? (
              <Link to="/library" className="btn">Continue reading</Link>
            ) : (
              <Link to="/login" className="btn">Sign in to save progress</Link>
            )}
          </div>
        </div>
        {hero ? (
          <Link to={`/series/${hero.source}/${encodeURIComponent(hero.id || hero.sourceId)}`} className="hero-featured">
            <CoverImage src={hero.cover} alt={`${hero.title} cover`} />
            <div>
              <span className="badge">Featured</span>
              <h3>{hero.title}</h3>
              <p>{typeLabel(hero.type)}{hero.year ? ` · ${hero.year}` : ''}</p>
              <span className="btn btn-sm btn-primary">Read now →</span>
            </div>
          </Link>
        ) : null}
      </section>

      {continueReading.length > 0 && (
        <section className="section" aria-label="Continue reading">
          <SectionHeader title="Continue reading" subtitle="Where you left off" action={<Link to="/library" className="btn btn-sm">My Library →</Link>} />
          <div className="grid">
            {continueReading.map((h) => (
              <article className="card" key={`${h.source}:${h.seriesId}:${h.chapterId}`}>
                <Link to={`/read/${h.source}/${encodeURIComponent(h.seriesId)}/${encodeURIComponent(h.chapterId)}`} className="card-cover-link" aria-label={`${h.title} chapter ${h.chapterNumber}`}>
                  <CoverImage src={h.cover} alt={`${h.title} cover`} className="card-cover" />
                </Link>
                <div className="card-body">
                  <h3 className="card-title">
                    <Link to={`/read/${h.source}/${encodeURIComponent(h.seriesId)}/${encodeURIComponent(h.chapterId)}`}>{h.title}</Link>
                  </h3>
                  <p className="card-genres">Chapter {h.chapterNumber || '—'}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {curated.length > 0 && (
        <section className="section" aria-label="Curated picks">
          <SectionHeader title="Curated picks" subtitle="Titles added by the ComicVerse admin, from every provider" />
          <SeriesGrid items={curated.map((c) => ({ id: c.sourceId, source: c.source, title: c.title, cover: c.cover, type: c.type, status: c.status, genres: c.genres, year: c.year, ratingValue: c.ratingValue, ratingLabel: c.ratingLabel }))} />
        </section>
      )}

      <section className="section" aria-label="Trending">
        <SectionHeader title="Trending now" subtitle="Most followed on MangaDex" action={<Link to="/browse?sort=trending" className="btn btn-sm">See all →</Link>} />
        {trending.error ? <ErrorState error={trending.error} /> : <SeriesGrid items={trending.items} loading={trending.loading} />}
      </section>

      <section className="section" aria-label="Recent chapter updates">
        <SectionHeader title="Recent chapter updates" subtitle="Series with the newest English chapters" action={<Link to="/browse?sort=recent-updates" className="btn btn-sm">See all →</Link>} />
        {recent.error ? <ErrorState error={recent.error} /> : <SeriesGrid items={recent.items} loading={recent.loading} />}
      </section>

      <section className="section" aria-label="Popular series">
        <SectionHeader title="Popular series" subtitle="Highest rated on MangaDex" action={<Link to="/browse?sort=popular" className="btn btn-sm">See all →</Link>} />
        {popular.error ? <ErrorState error={popular.error} /> : <SeriesGrid items={popular.items} loading={popular.loading} />}
      </section>

      <section className="section" aria-label="Recently added">
        <SectionHeader title="Recently added" subtitle="Newest titles on MangaDex" action={<Link to="/browse?sort=recently-added" className="btn btn-sm">See all →</Link>} />
        {added.error ? <ErrorState error={added.error} /> : <SeriesGrid items={added.items} loading={added.loading} />}
        {(!added.loading && !added.error && added.items.length === 0) && (
          <EmptyState title="Nothing here yet" body="The provider returned no titles. Try again in a moment." />
        )}
      </section>
    </main>
  );
}
