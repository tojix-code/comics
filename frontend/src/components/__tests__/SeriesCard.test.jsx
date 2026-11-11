import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SeriesCard } from '../../components/ui';

const base = {
  id: 'abc', source: 'mangadex', title: 'Solo Leveling', cover: 'https://covers/x.jpg',
  type: 'manhwa', status: 'ongoing', genres: ['Action', 'Fantasy'], year: 2018,
};

describe('SeriesCard', () => {
  it('links to the series page and shows type, status and genres', () => {
    render(<MemoryRouter><SeriesCard series={base} /></MemoryRouter>);
    expect(screen.getByText('Solo Leveling').closest('a').getAttribute('href')).toBe('/series/mangadex/abc');
    expect(screen.getByText('Manhwa')).toBeTruthy();
    expect(screen.getByText('Ongoing')).toBeTruthy();
    expect(screen.getByText('Action · Fantasy')).toBeTruthy();
    expect(screen.getByText('MangaDex')).toBeTruthy();
  });

  it('shows a real rating when one exists and nothing when it does not', () => {
    const { rerender } = render(<MemoryRouter><SeriesCard series={{ ...base, ratingValue: 9.32, ratingLabel: 'MangaDex rating' }} /></MemoryRouter>);
    expect(screen.getByText(/9.32/)).toBeTruthy();
    rerender(<MemoryRouter><SeriesCard series={{ ...base, ratingValue: null }} /></MemoryRouter>);
    expect(screen.queryByText(/★/)).toBeNull();
  });
});
