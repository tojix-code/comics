// End-to-end smoke test (live network, real MangaDex API).
// NOT part of `npm test` — run with: npm run test:e2e
// (vitest.e2e.config.js). It walks the real user flow: home → series → reader.
// Note: some popular titles (e.g. Solo Leveling) are licensed on MangaDex,
// so all their English chapters are external links with no readable pages.
// The test therefore tries trending titles in order until it finds one with
// readable chapters — exactly what a user would do.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

async function waitForCards() {
  await waitFor(() => {
    expect(document.querySelectorAll('.card-title').length).toBeGreaterThan(0);
  }, { timeout: 60000 });
}

describe('ComicVerse end-to-end smoke (live MangaDex)', () => {
  it('home renders real series, a readable series lists chapters, the reader loads pages', async () => {
    render(<App />);
    await screen.findByText('Trending now', {}, { timeout: 60000 });
    await waitForCards();

    // Try trending titles in order until one has readable chapters.
    let seriesTitle = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      const links = [...document.querySelectorAll('.card-title a')];
      const link = links[attempt];
      if (!link) throw new Error('ran out of series cards on the homepage');
      fireEvent.click(link);
      const outcome = await waitFor(() => {
        if (document.querySelectorAll('.chapter-list li').length > 0) return 'chapters';
        if (document.body.textContent.includes('No chapters found')) return 'empty';
        throw new Error('waiting for chapters');
      }, { timeout: 60000 });
      if (outcome === 'chapters') {
        seriesTitle = document.querySelector('.series-info h1')?.textContent || '';
        break;
      }
      // Licensed title with no readable chapters — back home, try the next one.
      fireEvent.click(screen.getByText('Home', { selector: 'a' }));
      await waitForCards();
    }
    expect(seriesTitle.length).toBeGreaterThan(1);

    // Open the newest chapter in the reader.
    fireEvent.click(document.querySelector('.chapter-list .chapter-row'));
    await waitFor(() => {
      expect(document.querySelectorAll('.reader-pages img').length).toBeGreaterThan(0);
    }, { timeout: 90000 });
    const img = document.querySelector('.reader-pages img');
    // MangaDex serves pages from its CDN (baseUrl varies, e.g.
    // uploads.mangadex.org or *.mangadex.network) — accept any of them.
    expect(img.getAttribute('src')).toMatch(/^https:\/\/[^/]*mangadex[^/]*\/data\//);
    expect(document.querySelector('.reader-bar h1')?.textContent).toContain(seriesTitle);
  }, 300000);
});
