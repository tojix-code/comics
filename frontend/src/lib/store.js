// ─── ComicVerse local accounts + library ─────────────────────────────────────
// Local-first by design: accounts, bookmarks, history and reading progress
// live in this browser's localStorage. There is no server user database in
// v1, so accounts work on this device only — the UI says so wherever it
// matters. Passwords are never stored in plain text: SHA-256(salt + password)
// via WebCrypto (with a non-cryptographic fallback only when WebCrypto is
// unavailable, e.g. plain http on old browsers).
// The FIRST account registered on a device becomes the admin — that is how
// the admin area is unlocked without shipping a known admin password.

const USERS_KEY = 'comicverse:users';
const SESSION_KEY = 'comicverse:session';
const REPORTS_KEY = 'comicverse:reports';

export function createSimpleStore() {
  const listeners = new Set();
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { listeners.forEach((fn) => fn()); },
  };
}
export const storeEvents = createSimpleStore();

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
  storeEvents.emit();
}

export function libraryKey(username) {
  return `comicverse:library:${username}`;
}
function emptyLibrary() {
  return { bookmarks: [], history: [], progress: {} };
}

// ─── Password hashing ────────────────────────────────────────────────────────
function randomSalt() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i = i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fnvHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv:${(h >>> 0).toString(16)}`;
}
export async function hashPassword(password, salt) {
  try {
    if (crypto?.subtle) {
      const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`));
      return `sha256:${Array.from(new Uint8Array(data)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
  } catch { /* fall through */ }
  return fnvHash(`${salt}:${password}`);
}

// ─── Users ───────────────────────────────────────────────────────────────────
export function getUsers() {
  return readJson(USERS_KEY, []);
}
export function getSessionUser() {
  const session = readJson(SESSION_KEY, null);
  if (!session?.email) return null;
  return getUsers().find((u) => u.email === session.email) || null;
}
export function isAdmin(user) {
  return Boolean(user && user.role === 'admin');
}

export async function register({ name, email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
  const users = getUsers();
  if (users.some((u) => u.email === cleanEmail)) throw new Error('An account with that email already exists on this device.');
  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const user = {
    id: `u_${Date.now().toString(36)}`, name: cleanName, email: cleanEmail,
    passwordHash, salt, role: users.length === 0 ? 'admin' : 'user', // first account = admin
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeJson(USERS_KEY, users);
  writeJson(SESSION_KEY, { email: cleanEmail });
  return publicUser(user);
}

export async function login({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = getUsers().find((u) => u.email === cleanEmail);
  if (!user) throw new Error('No account with that email on this device. Register first, or use the demo account.');
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) throw new Error('Wrong password.');
  writeJson(SESSION_KEY, { email: cleanEmail });
  return publicUser(user);
}

export function loginDemo() {
  const users = getUsers();
  let demo = users.find((u) => u.email === 'demo@comicverse.app');
  if (!demo) {
    demo = { id: 'u_demo', name: 'Demo Reader', email: 'demo@comicverse.app', passwordHash: '', salt: '', role: 'user', createdAt: new Date().toISOString() };
    users.push(demo);
    writeJson(USERS_KEY, users);
  }
  writeJson(SESSION_KEY, { email: demo.email });
  return publicUser(demo);
}

/** Create or link a Google account. Same email = same local account; a Google
 *  sign-in never overwrites an existing password — it links to that account. */
export function upsertGoogleUser({ sub, name, email, picture }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Google did not share an email address.');
  const users = getUsers();
  let user = users.find((u) => u.email === cleanEmail);
  if (user) {
    user.googleSub = sub || user.googleSub;
    user.picture = picture || user.picture;
    user.name = user.name || name;
  } else {
    user = {
      id: `u_${Date.now().toString(36)}`, name: name || cleanEmail.split('@')[0],
      email: cleanEmail, passwordHash: '', salt: '',
      role: users.length === 0 ? 'admin' : 'user', // first account = admin
      provider: 'google', googleSub: sub || '', picture: picture || '',
      createdAt: new Date().toISOString(),
    };
    users.push(user);
  }
  writeJson(USERS_KEY, users);
  writeJson(SESSION_KEY, { email: cleanEmail });
  return publicUser(user);
}

export function logout() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  storeEvents.emit();
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...rest } = user;
  return rest;
}

/** Admin: change a user's role. Guards: never demote yourself, never remove the last admin. */
export function setUserRole(adminUser, targetEmail, role) {
  if (!isAdmin(adminUser)) throw new Error('Only admins can change roles.');
  if (targetEmail === adminUser.email && role !== 'admin') throw new Error('You cannot demote yourself.');
  const users = getUsers();
  const target = users.find((u) => u.email === targetEmail);
  if (!target) throw new Error('User not found.');
  if (target.role === 'admin' && role !== 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
    throw new Error('There must always be at least one admin.');
  }
  target.role = role;
  writeJson(USERS_KEY, users);
  return publicUser(target);
}

/** Admin: delete a user (and their local library). Never yourself. */
export function deleteUser(adminUser, targetEmail) {
  if (!isAdmin(adminUser)) throw new Error('Only admins can delete users.');
  if (targetEmail === adminUser.email) throw new Error('You cannot delete your own account.');
  writeJson(USERS_KEY, getUsers().filter((u) => u.email !== targetEmail));
  try { localStorage.removeItem(libraryKey(targetEmail)); } catch { /* ignore */ }
}

// ─── Library (per user) ──────────────────────────────────────────────────────
export function getLibrary(username) {
  if (!username) return emptyLibrary();
  const lib = readJson(libraryKey(username), emptyLibrary());
  return { bookmarks: lib.bookmarks || [], history: lib.history || [], progress: lib.progress || {} };
}
function saveLibrary(username, lib) {
  if (username) writeJson(libraryKey(username), lib);
}

export function isBookmarked(username, seriesId, source) {
  if (!username) return false;
  return getLibrary(username).bookmarks.some((b) => b.seriesId === String(seriesId) && b.source === source);
}
export function toggleBookmark(username, series) {
  const lib = getLibrary(username);
  const key = (b) => b.seriesId === String(series.id) && b.source === series.source;
  if (lib.bookmarks.some(key)) {
    lib.bookmarks = lib.bookmarks.filter((b) => !key(b));
  } else {
    lib.bookmarks.unshift({
      seriesId: String(series.id), source: series.source, title: series.title,
      cover: series.cover || '', type: series.type, status: series.status,
      addedAt: new Date().toISOString(),
    });
  }
  saveLibrary(username, lib);
  return lib.bookmarks.some(key);
}

export function recordHistory(username, series, chapter) {
  if (!username || !series || !chapter) return;
  const lib = getLibrary(username);
  lib.history = lib.history.filter((h) => !(h.seriesId === String(series.id) && h.chapterId === String(chapter.id)));
  lib.history.unshift({
    seriesId: String(series.id), source: series.source, title: series.title,
    cover: series.cover || '', chapterId: String(chapter.id),
    chapterNumber: chapter.number || '', updatedAt: new Date().toISOString(),
  });
  lib.history = lib.history.slice(0, 50);
  saveLibrary(username, lib);
}

export function saveProgress(username, series, chapter, { pageIndex = 0, pageCount = 0, mode = 'strip', scrollPct = 0 } = {}) {
  if (!username || !series || !chapter) return;
  const lib = getLibrary(username);
  lib.progress[String(series.id)] = {
    chapterId: String(chapter.id), chapterNumber: chapter.number || '',
    pageIndex, pageCount, mode, scrollPct,
    updatedAt: new Date().toISOString(),
  };
  saveLibrary(username, lib);
}
export function getProgress(username, seriesId) {
  if (!username) return null;
  return getLibrary(username).progress[String(seriesId)] || null;
}
export function clearHistory(username) {
  const lib = getLibrary(username);
  lib.history = [];
  saveLibrary(username, lib);
}

// ─── Reader reports ──────────────────────────────────────────────────────────
export function getReports() {
  return readJson(REPORTS_KEY, []);
}
export function addReport({ series, chapter, reason, detail, reporter }) {
  const reports = getReports();
  const report = {
    id: `r_${Date.now().toString(36)}`,
    seriesId: String(series?.id || ''), source: series?.source || '',
    title: series?.title || '', chapterId: chapter ? String(chapter.id) : '',
    chapterNumber: chapter?.number || '', reason, detail: String(detail || '').slice(0, 500),
    reporter: reporter || 'anonymous', status: 'open',
    createdAt: new Date().toISOString(),
  };
  reports.unshift(report);
  writeJson(REPORTS_KEY, reports);
  return report;
}
export function setReportStatus(adminUser, reportId, status) {
  if (!isAdmin(adminUser)) throw new Error('Only admins can manage reports.');
  if (!['open', 'resolved', 'dismissed'].includes(status)) throw new Error('Invalid status.');
  const reports = getReports().map((r) => (r.id === reportId ? { ...r, status } : r));
  writeJson(REPORTS_KEY, reports);
}
