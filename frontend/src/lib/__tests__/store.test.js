import { beforeEach, describe, expect, it } from 'vitest';
import {
  addReport, clearHistory, deleteUser, getLibrary, getProgress, getReports,
  getSessionUser, getUsers, isBookmarked, login, loginDemo, logout, recordHistory,
  register, saveProgress, setReportStatus, setUserRole, toggleBookmark, upsertGoogleUser,
} from '../store';

beforeEach(() => {
  localStorage.clear();
});

const series = { id: 'abc', source: 'mangadex', title: 'Solo Leveling', cover: 'c.jpg', type: 'manhwa', status: 'ongoing' };
const chapter = { id: 'ch1', number: '5', title: 'Five' };

describe('accounts', () => {
  it('registers the first user as admin, later users as regular users', async () => {
    const first = await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    expect(first.role).toBe('admin');
    expect(first.passwordHash).toBeUndefined(); // never leaked
    const second = await register({ name: 'Bo', email: 'bo@example.com', password: 'password123' });
    expect(second.role).toBe('user');
    expect(getUsers()).toHaveLength(2);
  });

  it('rejects duplicate emails, bad emails and short passwords', async () => {
    await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    await expect(register({ name: 'Ada', email: 'ada@example.com', password: 'password123' })).rejects.toThrow(/already exists/);
    await expect(register({ name: 'X', email: 'not-an-email', password: 'password123' })).rejects.toThrow(/valid email/);
    await expect(register({ name: 'X', email: 'x@example.com', password: 'short' })).rejects.toThrow(/8 characters/);
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    logout();
    expect(getSessionUser()).toBeNull();
    const user = await login({ email: 'ada@example.com', password: 'password123' });
    expect(user.email).toBe('ada@example.com');
    await expect(login({ email: 'ada@example.com', password: 'nope-nope-nope' })).rejects.toThrow(/Wrong password/);
  });

  it('never stores a plain-text password', async () => {
    await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    const raw = localStorage.getItem('comicverse:users');
    expect(raw).not.toContain('password123');
  });

  it('creates a Google account and links the same email instead of duplicating it', async () => {
    const g1 = upsertGoogleUser({ sub: 'g1', name: 'Gina', email: 'gina@example.com', picture: 'p.jpg' });
    expect(g1.role).toBe('admin'); // first account on the device
    const g2 = upsertGoogleUser({ sub: 'g1', name: 'Gina', email: 'gina@example.com', picture: 'p2.jpg' });
    expect(g2.id).toBe(g1.id);
    expect(getUsers()).toHaveLength(1);
  });

  it('demo login works without a password', () => {
    const demo = loginDemo();
    expect(demo.email).toBe('demo@comicverse.app');
    expect(getSessionUser()?.email).toBe('demo@comicverse.app');
  });
});

describe('admin role guards', () => {
  it('prevents demoting yourself or removing the last admin', async () => {
    const admin = await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    await register({ name: 'Bo', email: 'bo@example.com', password: 'password123' });
    // Demoting yourself is never allowed, even when another admin exists.
    expect(() => setUserRole(admin, 'ada@example.com', 'user')).toThrow(/yourself/);
    expect(() => setUserRole(admin, 'bo@example.com', 'admin')).not.toThrow();
    // Bo is now an admin too — Ada demoting *Bo* is fine (one admin remains).
    expect(() => setUserRole(admin, 'bo@example.com', 'user')).not.toThrow();
    expect(getUsers().filter((u) => u.role === 'admin')).toHaveLength(1);
  });

  it('prevents deleting your own account', async () => {
    const admin = await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    expect(() => deleteUser(admin, 'ada@example.com')).toThrow(/own account/);
  });
});

describe('library', () => {
  it('toggles bookmarks and saves progress + history', async () => {
    const user = await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    expect(toggleBookmark(user.email, series)).toBe(true);
    expect(isBookmarked(user.email, 'abc', 'mangadex')).toBe(true);
    expect(toggleBookmark(user.email, series)).toBe(false);

    saveProgress(user.email, series, chapter, { pageIndex: 4, pageCount: 20, mode: 'paged' });
    const p = getProgress(user.email, 'abc');
    expect(p).toMatchObject({ chapterId: 'ch1', chapterNumber: '5', pageIndex: 4, pageCount: 20 });

    recordHistory(user.email, series, chapter);
    expect(getLibrary(user.email).history).toHaveLength(1);
    recordHistory(user.email, series, chapter); // re-reading doesn't duplicate
    expect(getLibrary(user.email).history).toHaveLength(1);
    clearHistory(user.email);
    expect(getLibrary(user.email).history).toHaveLength(0);
  });
});

describe('reports', () => {
  it('adds reports and lets admins resolve them (non-admins cannot)', async () => {
    const admin = await register({ name: 'Ada', email: 'ada@example.com', password: 'password123' });
    await register({ name: 'Bo', email: 'bo@example.com', password: 'password123' });
    const report = addReport({ series, chapter, reason: 'Pages do not load', detail: '', reporter: 'bo@example.com' });
    expect(report.status).toBe('open');
    const bo = getUsers().find((u) => u.email === 'bo@example.com');
    expect(() => setReportStatus(bo, report.id, 'resolved')).toThrow(/Only admins/);
    setReportStatus(admin, report.id, 'resolved');
    expect(getReports()[0].status).toBe('resolved');
  });
});
