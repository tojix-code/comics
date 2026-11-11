import { useState } from 'react';
import { Link } from 'react-router-dom';
import { proxiedImageUrl, SOURCES, sourceById } from '../lib/api';
import { getEnabledSources } from '../lib/catalogue';
import { statusLabel, typeLabel } from '../lib/format';

const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='600'%3E%3Crect width='400' height='600' fill='%23161d27'/%3E%3Ctext x='200' y='300' font-size='22' font-family='Arial,sans-serif' fill='%235b6b7f' text-anchor='middle'%3ENo cover%3C/text%3E%3C/svg%3E";

/** Cover with a fallback chain: direct URL → backend image proxy → placeholder. */
export function CoverImage({ src, alt, className = '' }) {
  const [step, setStep] = useState(0);
  const current = step === 0 ? src || PLACEHOLDER : step === 1 ? proxiedImageUrl(src) : PLACEHOLDER;
  return (
    <img
      src={current}
      alt={alt || 'Cover'}
      loading="lazy"
      className={className}
      onError={() => setStep((s) => (s < 2 ? s + 1 : s))}
    />
  );
}

export function SourceBadge({ source }) {
  const s = sourceById(source);
  return (
    <span className="badge badge-source" title={`${s.name} — ${s.kind}`}>
      {s.name}
    </span>
  );
}

export function RatingBadge({ series }) {
  if (series?.ratingValue == null) return null;
  return (
    <span className="rating" title={series.ratingLabel ? `${series.ratingLabel}: ${series.ratingValue} / 10` : `Rated ${series.ratingValue} / 10`}>
      ★ {series.ratingValue.toFixed(2)}
    </span>
  );
}

export function SeriesCard({ series, action }) {
  return (
    <article className="card">
      <Link to={`/series/${series.source}/${encodeURIComponent(series.id)}`} className="card-cover-link" aria-label={series.title}>
        <CoverImage src={series.cover} alt={`${series.title} cover`} className="card-cover" />
        <span className="card-type">{typeLabel(series.type)}</span>
      </Link>
      <div className="card-body">
        <h3 className="card-title">
          <Link to={`/series/${series.source}/${encodeURIComponent(series.id)}`}>{series.title}</Link>
        </h3>
        <div className="card-meta">
          <span className={`status status-${series.status}`}>{statusLabel(series.status)}</span>
          <RatingBadge series={series} />
        </div>
        {series.genres?.length > 0 && (
          <p className="card-genres">{series.genres.slice(0, 3).join(' · ')}</p>
        )}
        <div className="card-foot">
          <SourceBadge source={series.source} />
          {series.year ? <span className="card-year">{series.year}</span> : null}
          {action}
        </div>
      </div>
    </article>
  );
}

export function SeriesGrid({ items, loading, actionFor }) {
  if (loading) {
    return (
      <div className="grid" aria-label="Loading series">
        {Array.from({ length: 12 }).map((_, i) => (
          <div className="card skeleton-card" key={i}>
            <div className="skeleton skeleton-cover" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        ))}
      </div>
    );
  }
  if (!items?.length) return null;
  return (
    <div className="grid">
      {items.map((s) => (
        <SeriesCard key={`${s.source}:${s.id}`} series={s} action={actionFor ? actionFor(s) : null} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="empty" role="status">
      <p className="empty-title">{title}</p>
      {body ? <p className="empty-body">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="error-box" role="alert">
      <p className="empty-title">Something went wrong</p>
      <p className="empty-body">{error?.message || 'An unexpected error happened.'}</p>
      {onRetry ? <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Pagination({ page, total, limit, onPage }) {
  const pages = total > 0 ? Math.ceil(total / limit) : 0;
  if (pages <= 1 && page <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="page-info">Page {page}{pages ? ` of ${pages}` : ''}</span>
      <button type="button" className="btn" disabled={pages ? page >= pages : false} onClick={() => onPage(page + 1)}>Next →</button>
    </nav>
  );
}

export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="section-sub">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Provider picker used in Browse and in Admin → Add title. */
export function ProviderPicker({ value, onChange, enabledOnly = false, includeAll = false }) {
  const enabled = getEnabledSources();
  const list = SOURCES.filter((s) => !enabledOnly || enabled.includes(s.id));
  return (
    <div className="provider-picker" role="group" aria-label="Content provider">
      {includeAll && (
        <button type="button" className={`chip ${value === 'all' ? 'chip-active' : ''}`} onClick={() => onChange('all')}>
          All providers
        </button>
      )}
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`chip ${value === s.id ? 'chip-active' : ''}`}
          onClick={() => onChange(s.id)}
          title={`${s.name} — ${s.kind}. ${s.blurb}`}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
