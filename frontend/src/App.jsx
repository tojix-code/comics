import { useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useCurrentUser } from './lib/useAuth';
import { isAdmin, logout } from './lib/store';
import HomePage from './pages/HomePage';
import BrowsePage from './pages/BrowsePage';
import SeriesPage from './pages/SeriesPage';
import ReaderPage from './pages/ReaderPage';
import LibraryPage from './pages/LibraryPage';
import AuthPage from './pages/AuthPage';
import AdminPage from './pages/AdminPage';
import NotFoundPage from './pages/NotFoundPage';

function Navbar() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <header className="navbar">
      <Link to="/" className="logo" aria-label="ComicVerse home">
        <span className="logo-mark">C</span> ComicVerse
      </Link>
      <nav className="nav-links" aria-label="Main navigation">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/browse">Browse</NavLink>
        <NavLink to="/library">My Library</NavLink>
        {user && isAdmin(user) ? <NavLink to="/admin">Admin</NavLink> : null}
      </nav>
      <form
        className="nav-search"
        role="search"
        onSubmit={(e) => { e.preventDefault(); navigate(`/browse?q=${encodeURIComponent(q.trim())}`); }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search manga, manhwa…"
          aria-label="Search series"
        />
        <button type="submit" className="btn btn-primary btn-sm">Search</button>
      </form>
      <div className="nav-user">
        {user ? (
          <>
            <span className="nav-hello" title={user.email}>Hi, {user.name}</span>
            <button type="button" className="btn btn-sm" onClick={() => { logout(); navigate('/'); }}>Log out</button>
          </>
        ) : (
          <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
        )}
      </div>
    </header>
  );
}

function RequireAuth({ children }) {
  const user = useCurrentUser();
  if (!user) return <AuthPage notice="Sign in to use your library — bookmarks, history and reading progress are saved to your account on this device." />;
  return children;
}

function RequireAdmin({ children }) {
  const user = useCurrentUser();
  if (!user) return <AuthPage notice="Sign in first. The first account registered on this device becomes the admin." />;
  if (!isAdmin(user)) {
    return (
      <main className="page">
        <h1>Admin area</h1>
        <p>This area is for administrators only. You are signed in as {user.name} ({user.email}), which is not an admin account.</p>
        <p>Admins can promote your account in Admin → Users.</p>
      </main>
    );
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/series/:source/:id" element={<SeriesPage />} />
        <Route path="/read/:source/:seriesId/:chapterId" element={<ReaderPage />} />
        <Route path="/library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="footer">
        <p>
          ComicVerse reads from MangaDex, ComicK, WeebCentral and AsuraScans through the
          manga-novel-api backend. Titles belong to their creators and publishers — read
          the official release where one exists, and respect each source's terms.
        </p>
        <p className="footer-dim">Accounts, bookmarks and progress are stored locally in your browser in v1.</p>
      </footer>
    </BrowserRouter>
  );
}
