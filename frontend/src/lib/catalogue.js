// ─── Admin catalogue + provider settings ─────────────────────────────────────
// The catalogue is the set of titles an admin has explicitly added to
// ComicVerse by picking a provider and a title (Admin → Add title).
// It lives in localStorage in v1 (same local-first model as accounts) and is
// what powers the "Curated picks" shelf on the homepage. Each entry keeps
// its provider + provider id, so series/chapter pages always resolve
// through the provider it came from.

import { SOURCE_IDS, DEFAULT_SOURCE } from './api';
import { storeEvents } from './store';

const CATALOGUE_KEY = 'comicverse:catalogue';
const HIDDEN_KEY = 'comicverse:hidden';
const FEATURED_KEY = 'comicverse:featured';
const ENABLED_SOURCES_KEY = 'comicverse:enabledSources';
const VISIBLE_GENRES_KEY = 'comicverse:visibleGenres';

function readJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  storeEvents.emit();
}

export function catalogueKey(source, sourceId) {
  return `${source}:${sourceId}`;
}

// ─── Catalogue ───────────────────────────────────────────────────────────────
export function getCatalogue() {
  return readJson(CATALOGUE_KEY, []);
}
export function isInCatalogue(source, sourceId) {
  return getCatalogue().some((c) => c.key === catalogueKey(source, sourceId));
}
export function addToCatalogue(series, adminName) {
  const key = catalogueKey(series.source, series.id);
  const list = getCatalogue();
  if (list.some((c) => c.key === key)) return { added: false, key };
  list.unshift({
    key, source: series.source, sourceId: String(series.id),
    title: series.title, cover: series.cover || '', type: series.type,
    status: series.status, genres: series.genres || [],
    description: series.description || '', authors: series.authors || [],
    year: series.year ?? null, ratingValue: series.ratingValue ?? null,
    ratingLabel: series.ratingLabel ?? null,
    addedAt: new Date().toISOString(), addedBy: adminName || 'admin',
    featured: false,
  });
  writeJson(CATALOGUE_KEY, list);
  return { added: true, key };
}
export function removeFromCatalogue(key) {
  writeJson(CATALOGUE_KEY, getCatalogue().filter((c) => c.key !== key));
  const featured = getFeaturedKeys().filter((k) => k !== key);
  writeJson(FEATURED_KEY, featured);
}

// ─── Featured / hidden ───────────────────────────────────────────────────────
export function getFeaturedKeys() {
  return readJson(FEATURED_KEY, []);
}
export function isFeatured(key) {
  return getFeaturedKeys().includes(key);
}
export function setFeatured(key, featured) {
  const keys = getFeaturedKeys();
  writeJson(FEATURED_KEY, featured ? [...new Set([...keys, key])] : keys.filter((k) => k !== key));
}
export function getHiddenKeys() {
  return readJson(HIDDEN_KEY, []);
}
export function isHidden(key) {
  return getHiddenKeys().includes(key);
}
export function setHidden(key, hidden) {
  const keys = getHiddenKeys();
  writeJson(HIDDEN_KEY, hidden ? [...new Set([...keys, key])] : keys.filter((k) => k !== key));
}
export function isSeriesHidden(source, sourceId) {
  return isHidden(catalogueKey(source, sourceId));
}

// ─── Enabled providers ───────────────────────────────────────────────────────
// Admins choose which providers the app uses. MangaDex stays available as
// the fallback source even if disabled elsewhere, because the homepage lists
// depend on it — disabling it only removes it from the provider picker.
export function getEnabledSources() {
  const saved = readJson(ENABLED_SOURCES_KEY, null);
  if (!saved || !Array.isArray(saved) || !saved.length) return [...SOURCE_IDS];
  return SOURCE_IDS.filter((id) => saved.includes(id));
}
export function setEnabledSources(ids) {
  const clean = SOURCE_IDS.filter((id) => ids.includes(id));
  writeJson(ENABLED_SOURCES_KEY, clean.length ? clean : [DEFAULT_SOURCE]);
}

// ─── Visible genres (browse chips) ───────────────────────────────────────────
// null = show every genre the API returns. Admins can narrow the chip list.
export function getVisibleGenres() {
  return readJson(VISIBLE_GENRES_KEY, null);
}
export function setVisibleGenres(ids) {
  writeJson(VISIBLE_GENRES_KEY, ids && ids.length ? ids : null);
}
