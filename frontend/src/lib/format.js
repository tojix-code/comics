// Small pure helpers: dates, text cleanup, status labels.
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(value) {
  if (!value) return '';
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
  return formatDate(value);
}

/** MangaDex descriptions are Markdown — strip links/images/formatting to plain text. */
export function plainText(md) {
  if (!md) return '';
  return String(md)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const STATUS_LABELS = {
  ongoing: 'Ongoing',
  completed: 'Completed',
  hiatus: 'Hiatus',
  cancelled: 'Cancelled',
  unknown: 'Unknown status',
};

export function statusLabel(s) {
  return STATUS_LABELS[String(s || '').toLowerCase()] || 'Unknown status';
}

export const TYPE_LABELS = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua', unknown: 'Comic' };
export function typeLabel(t) {
  return TYPE_LABELS[String(t || '').toLowerCase()] || 'Comic';
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
