import { describe, expect, it } from 'vitest';
import {
  normaliseChapter, normalisePages, normaliseSeries, parseChapterNumber,
} from '../api';

describe('normaliseSeries', () => {
  it('normalises a MangaDex result', () => {
    const s = normaliseSeries({
      id: 'abc', title: 'Solo Leveling', contentType: 'manhwa',
      coverUrl: 'https://covers/x.jpg', status: 'completed', rating: 'safe',
      genres: ['Action'], themes: [], description: 'd', year: 2018,
    }, 'mangadex');
    expect(s).toMatchObject({ id: 'abc', source: 'mangadex', title: 'Solo Leveling', type: 'manhwa', status: 'completed', year: 2018 });
    expect(s.ratingValue).toBeNull(); // never invented — filled later from /statistics
  });

  it('normalises a ComicK hit (numeric status, follows)', () => {
    const s = normaliseSeries({
      hid: 'h1', slug: 'solo-leveling', title: 'Solo Leveling', contentType: 'manhwa',
      coverUrl: 'https://meo/x.jpg', rating: 'safe', genres: ['Action'],
      status: 1, lastChapter: 179, followCount: 12000,
    }, 'comick');
    expect(s).toMatchObject({ id: 'h1', source: 'comick', status: 'ongoing', lastChapter: 179, followCount: 12000 });
    expect(s.ratingValue).toBeNull();
  });

  it('normalises an AsuraScans result and keeps the source-displayed rating', () => {
    const s = normaliseSeries({
      slug: 'series/x', title: 'X', contentType: 'manhwa', coverUrl: '',
      status: 'Ongoing', latestChapter: 'Chapter 42', rating: '9.4',
    }, 'asura');
    expect(s).toMatchObject({ id: 'series/x', source: 'asura', status: 'ongoing', lastChapter: '42' });
    expect(s.ratingValue).toBe(9.4);
    expect(s.ratingLabel).toBe('Asura rating');
  });

  it('normalises a WeebCentral result', () => {
    const s = normaliseSeries({
      id: 'series/y', title: 'Y', contentType: 'manga', coverUrl: '',
      status: 'Ongoing', latestChapter: 'Chapter 12',
    }, 'weebcentral');
    expect(s).toMatchObject({ id: 'series/y', source: 'weebcentral', lastChapter: '12', ratingValue: null });
  });

  it('treats unknown types/statuses as unknown, never crashes', () => {
    const s = normaliseSeries({ title: '?' }, 'mangadex');
    expect(s.type).toBe('unknown');
    expect(s.status).toBe('unknown');
  });
});

describe('normaliseChapter', () => {
  it('normalises ComicK chapters (hid/chap/groupName)', () => {
    const c = normaliseChapter({ hid: 'ch1', chap: '12', title: 'T', lang: 'en', publishedAt: '2024-01-01', groupName: ['A', 'B'] }, 'comick');
    expect(c).toMatchObject({ id: 'ch1', number: '12', source: 'comick', group: 'A, B' });
  });

  it('parses WeebCentral chapter numbers out of titles', () => {
    const c = normaliseChapter({ id: 'series/x/chapters/1', title: 'Chapter 103: The End', date: '2024-01-01' }, 'weebcentral');
    expect(c.number).toBe('103');
  });

  it('normalises Asura chapters by slug', () => {
    const c = normaliseChapter({ slug: 'series/x/chapter/5', number: '5', title: 'Chapter 5', date: '' }, 'asura');
    expect(c).toMatchObject({ id: 'series/x/chapter/5', number: '5', source: 'asura' });
  });

  it('normalises aggregated MangaDex chapters', () => {
    const c = normaliseChapter({ id: 'c1', number: '7', title: null, source: 'mangadex', lang: 'en', publishedAt: '', group: 'G', pages: 20, isExternal: false }, 'mangadex');
    expect(c).toMatchObject({ id: 'c1', number: '7', pages: 20, external: false });
  });
});

describe('normalisePages', () => {
  it('accepts string URLs and {url} objects, drops junk', () => {
    expect(normalisePages(['https://a/1.jpg', { url: 'https://a/2.jpg', width: 800 }, null, 42], 'mangadex'))
      .toEqual([{ url: 'https://a/1.jpg' }, { url: 'https://a/2.jpg', width: 800, height: 0 }]);
  });
  it('returns [] for non-arrays', () => {
    expect(normalisePages(null, 'mangadex')).toEqual([]);
  });
});

describe('parseChapterNumber', () => {
  it('finds the first number in a string', () => {
    expect(parseChapterNumber('Chapter 12.5')).toBe('12.5');
    expect(parseChapterNumber('Ch. 3')).toBe('3');
    expect(parseChapterNumber('Prologue')).toBe('');
    expect(parseChapterNumber(null)).toBe('');
  });
});
