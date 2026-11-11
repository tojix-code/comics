import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChapterPages, getChapters, listSeries, searchSeries } from '../api';

const MD_ITEM = {
  id: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
  type: 'manga',
  attributes: {
    title: { en: 'Solo Leveling' },
    originalLanguage: 'ko',
    status: 'completed',
    contentRating: 'safe',
    year: 2018,
    description: { en: 'Ten years ago…' },
    tags: [{ attributes: { group: 'genre', name: { en: 'Action' } } }],
  },
  relationships: [{ type: 'cover_art', attributes: { fileName: 'cover-1' } }],
};

function mdListJson() {
  return { result: 'ok', data: [MD_ITEM], total: 1, limit: 20, offset: 0 };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    // Backend is down in these tests.
    if (u.includes('localhost:3001')) throw new Error('backend down');
    if (u.includes('api.mangadex.org/manga?')) {
      return { ok: true, json: async () => mdListJson() };
    }
    if (u.includes('api.mangadex.org/manga/') && u.includes('/feed?')) {
      return { ok: true, json: async () => ({ result: 'ok', data: [], total: 0 }) };
    }
    if (u.includes('api.mangadex.org/at-home/server/')) {
      return { ok: true, json: async () => ({ baseUrl: 'https://uploads.mangadex.org', chapter: { hash: 'h1', data: ['p1.jpg', 'p2.jpg'] } }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('backend-down fallback to the public MangaDex API', () => {
  it('searchSeries falls back to direct MangaDex when the backend is unreachable', async () => {
    const res = await searchSeries({ q: 'solo leveling', source: 'mangadex', page: 1, limit: 20 });
    expect(res.fallback).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ title: 'Solo Leveling', type: 'manhwa', status: 'completed' });
  });

  it('chapter pages fall back to the at-home server directly', async () => {
    const res = await getChapterPages('mangadex', MD_ITEM.id, { id: 'chapter-1', source: 'mangadex' });
    expect(res.fallback).toBe(true);
    expect(res.pages).toEqual([
      { url: 'https://uploads.mangadex.org/data/h1/p1.jpg' },
      { url: 'https://uploads.mangadex.org/data/h1/p2.jpg' },
    ]);
  });
});

describe('search-only providers', () => {
  it('listSeries refuses a browse list for WeebCentral/Asura without touching the network', async () => {
    await expect(listSeries('trending', { source: 'asura' })).rejects.toThrow(/no browse list/);
    await expect(listSeries('trending', { source: 'weebcentral' })).rejects.toThrow(/no browse list/);
  });
});

describe('empty backend responses', () => {
  it('getChapters treats an empty backend success as a failure and falls back to the direct feed', async () => {
    const feedChapter = {
      id: 'ch-9',
      attributes: { chapter: '9', title: 'The Exit is Open', translatedLanguage: 'en', publishAt: '2023-09-05T17:13:01+00:00', pages: 30 },
      relationships: [{ type: 'scanlation_group', attributes: { name: 'Group' } }],
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      // Backend answers 200 but with zero chapters (its aggregator swallows upstream failures).
      if (u.includes('localhost:3001')) {
        return { ok: true, json: async () => ({ source: 'aggregated', sources: [], chapters: [], total: 0, page: 1 }) };
      }
      if (u.includes('/feed?')) {
        return { ok: true, json: async () => ({ result: 'ok', data: [feedChapter], total: 1 }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    }));
    try {
      const res = await getChapters('mangadex', 'some-id', {});
      expect(res.fallback).toBe(true);
      expect(res.chapters).toHaveLength(1);
      expect(res.chapters[0]).toMatchObject({ id: 'ch-9', number: '9' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
