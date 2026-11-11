import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToCatalogue, getCatalogue, getEnabledSources, getFeaturedKeys, getHiddenKeys,
  isFeatured, isHidden, isInCatalogue, removeFromCatalogue, setEnabledSources,
  setFeatured, setHidden,
} from '../catalogue';

beforeEach(() => {
  localStorage.clear();
});

const solo = {
  id: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0', source: 'mangadex', title: 'Solo Leveling',
  cover: 'c.jpg', type: 'manhwa', status: 'ongoing', genres: ['Action'],
  description: 'd', authors: ['Chugong'], year: 2018,
};
const asuraTitle = {
  id: 'series/solo-max', source: 'asura', title: 'Solo Max-Level Newbie',
  cover: '', type: 'manhwa', status: 'ongoing', genres: [],
};

describe('admin catalogue (add title by provider)', () => {
  it('adds a MangaDex title and an Asura title, keeping provider + id', () => {
    expect(addToCatalogue(solo, 'Ada')).toEqual({ added: true, key: 'mangadex:32d76d19-8a05-4db0-9fc2-e0b0648fe9d0' });
    expect(addToCatalogue(asuraTitle, 'Ada').added).toBe(true);
    expect(getCatalogue()).toHaveLength(2);
    expect(getCatalogue().find((c) => c.source === 'asura')).toMatchObject({ source: 'asura', sourceId: 'series/solo-max' });
    expect(getCatalogue().find((c) => c.source === 'mangadex')).toMatchObject({ source: 'mangadex', sourceId: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0' });
    expect(isInCatalogue('asura', 'series/solo-max')).toBe(true);
  });

  it('does not add the same provider title twice', () => {
    addToCatalogue(solo, 'Ada');
    expect(addToCatalogue(solo, 'Ada')).toEqual({ added: false, key: 'mangadex:32d76d19-8a05-4db0-9fc2-e0b0648fe9d0' });
    expect(getCatalogue()).toHaveLength(1);
  });

  it('features, hides and removes titles', () => {
    const { key } = addToCatalogue(solo, 'Ada');
    setFeatured(key, true);
    expect(isFeatured(key)).toBe(true);
    expect(getFeaturedKeys()).toEqual([key]);
    setHidden(key, true);
    expect(isHidden(key)).toBe(true);
    expect(getHiddenKeys()).toEqual([key]);
    removeFromCatalogue(key);
    expect(getCatalogue()).toHaveLength(0);
    expect(isFeatured(key)).toBe(false); // removal clears featured too
  });
});

describe('enabled sources', () => {
  it('defaults to all four providers and never allows zero', () => {
    expect(getEnabledSources()).toEqual(['mangadex', 'comick', 'weebcentral', 'asura']);
    setEnabledSources(['asura']);
    expect(getEnabledSources()).toEqual(['asura']);
    setEnabledSources([]);
    expect(getEnabledSources()).toEqual(['mangadex']); // falls back to the default source
  });
});
