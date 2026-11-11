import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, loginDemo, register, upsertGoogleUser } from '../lib/store';
import { GOOGLE_CLIENT_ID, renderGoogleButton } from '../lib/googleAuth';
import { useCurrentUser } from '../lib/useAuth';

function GoogleButton({ onDone, onError }) {
  const ref = useRef(null);
  const [googleError, setGoogleError] = useState('');
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !ref.current) return;
    let alive = true;
    renderGoogleButton(ref.current, {
      onSuccess: (profile) => { if (alive) onDone(upsertGoogleUser(profile)); },
      onError: (err) => { if (alive) { setGoogleError(err.message); onError?.(err); } },
    }).catch((err) => { if (alive) setGoogleError(err.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="notice" style={{ marginBottom: 0 }}>
        Google sign-in isn&apos;t configured on this deployment yet. The site owner can enable it
        in 5 minutes — set <code>VITE_GOOGLE_CLIENT_ID</code> (see DEPLOY.md). Email sign-in below works meanwhile.
      </div>
    );
  }
  return (
    <div>
      <div ref={ref} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      {googleError ? <p className="form-error" style={{ marginTop: 10 }}>{googleError}</p> : null}
    </div>
  );
}

export default function AuthPage({ notice }) {
  const navigate = useNavigate();
  const current = useCurrentUser();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (current) navigate('/library', { replace: true }); }, [current, navigate]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'register') await register({ name, email, password });
      else await login({ email, password });
      navigate('/library');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="page">
      <div className="form-card">
        <h1 style={{ fontSize: 24 }}>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="lede">Bookmarks, history and reading progress are saved to your account on this device.</p>
        {notice ? <p className="notice">{notice}</p> : null}

        <GoogleButton onDone={() => navigate('/library')} onError={() => {}} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0', color: 'var(--text-faint)', fontSize: 13 }}>
          <span style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
          or with email
          <span style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
        </div>

        <div className="tabs" role="tablist" aria-label="Sign in or register">
          <button type="button" className={`chip ${mode === 'login' ? 'chip-active' : ''}`} onClick={() => setMode('login')}>Sign in</button>
          <button type="button" className={`chip ${mode === 'register' ? 'chip-active' : ''}`} onClick={() => setMode('register')}>Create account</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="auth-name">Name</label>
              <input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" required />
            <small>Passwords are hashed on this device and never sent to a server in v1.</small>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-block"
            onClick={() => { loginDemo(); navigate('/library'); }}
          >
            Try the demo account — no sign-up
          </button>
          <p className="filter-note" style={{ marginTop: 10 }}>
            The first account created on a device becomes its admin (that's how the admin area is unlocked — no default password is shipped).
          </p>
        </div>
      </div>
    </main>
  );
}
