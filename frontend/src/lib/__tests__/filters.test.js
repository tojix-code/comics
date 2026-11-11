import { describe, expect, it } from 'vitest';
import {
  byChapterCount, byMinRating, filterChapters, nextChapter, prevChapter,
  progressPercent, sortChapters,
} from '../filters';

const chapters = [
  { id: 'c3', number: '3', title: 'Three', group: 'A' },
  { id: 'c1', number: '1', title: 'One', group: 'A' },
  { id: 'c10', number: '10', title: 'Ten', group: 'B' },
  { id: 'cX', number: '', title: 'Special', group: 'B' },
  { id: 'c2', number: '2.5', title: 'Two point five', group: 'A' },
];

describe('sortChapters', () => {
  it('sorts numerically, not lexicographically (2.5 before 3 before 10)', () => {
    expect(sortChapters(chapters, 'asc').map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c10', 'cX']);
  });
  it('reverses for descending, un-numbered first', () => {
    expect(sortChapters(chapters, 'desc').map((c) => c.id)).toEqual(['cX', 'c10', 'c3', 'c2', 'c1']);
  });
});

describe('filterChapters', () => {
  it('matches number, title or group, case-insensitive', () => {
    expect(filterChapters(chapters, 'ten')).toHaveLength(1);
    expect(filterChapters(chapters, '2.5')).toHaveLength(1);
    expect(filterChapters(chapters, 'b')).toHaveLength(2);
    expect(filterChapters(chapters, '')).toHaveLength(5);
  });
});

describe('byMinRating', () => {
  it('keeps only titles with a real rating at or above the threshold', () => {
    const list = [
      { id: 'a', ratingValue: 9.3 }, { id: 'b', ratingValue: 7.1 },
      { id: 'c', ratingValue: null }, { id: 'd' },
    ];
    expect(byMinRating(list, 8).map((s) => s.id)).toEqual(['a']);
    expect(byMinRating(list, 0)).toHaveLength(4);
  });
});

describe('byChapterCount', () => {
  it('filters on known totals and excludes unknown totals (never guesses)', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const totals = { a: 150, b: 12, c: null };
    expect(byChapterCount(list, totals, 10, 100).map((s) => s.id)).toEqual(['b']);
    expect(byChapterCount(list, totals, null, null)).toHaveLength(3);
  });
});

describe('progressPercent', () => {
  it('is 0-based inclusive and clamped', () => {
    expect(progressPercent(0, 10)).toBe(10);
    expect(progressPercent(9, 10)).toBe(100);
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(99, 10)).toBe(100);
  });
});

describe('nextChapter / prevChapter', () => {
  it('finds neighbours by number across unsorted input', () => {
    expect(nextChapter(chapters, '3')?.id).toBe('c10');
    expect(prevChapter(chapters, '3')?.id).toBe('c2');
    expect(nextChapter(chapters, '10')).toBeNull();
    expect(prevChapter(chapters, '1')).toBeNull();
  });
});
