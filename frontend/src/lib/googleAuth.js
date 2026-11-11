// ─── Google Sign-In (Google Identity Services) ───────────────────────────────
// Real Google auth: the button is rendered by Google's own library and the
// user signs in with their Google account. The ID token Google returns is
// decoded here (checking `aud` and `exp`); the profile (name/email/picture)
// becomes the local ComicVerse account.
//
// Setup (free, 5 minutes — see DEPLOY.md):
//   1. Google Cloud Console → create an OAuth 2.0 Client ID (Web application)
//   2. Add your site origin (e.g. http://localhost:5173, https://your-app.vercel.app)
//      to "Authorized JavaScript origins"
//   3. Set VITE_GOOGLE_CLIENT_ID=<the client id> and rebuild/redeploy.
//
// Until that is set, the Google button is shown disabled with instructions —
// email + password and the demo account keep working.
// NOTE (honest limitation): in v1 the token is verified client-side only.
// Accounts are local to this browser, so there is no server session to forge;
// if you later add a real server, verify the ID token there with Google's
// tokeninfo endpoint / a JWT library before trusting it.

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

let gisPromise = null;
export function loadGis() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Sign-In needs a browser.'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google library failed to load.')));
    script.onerror = () => reject(new Error('Could not load Google Sign-In (check your connection).'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decode + sanity-check a Google ID token. Returns the profile or throws. */
export function decodeGoogleIdToken(token) {
  if (!token || typeof token !== 'string') throw new Error('Empty Google token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Google token is malformed.');
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    throw new Error('Google token could not be read.');
  }
  if (GOOGLE_CLIENT_ID && payload.aud && payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Google token was issued for a different app.');
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('Google sign-in expired — try again.');
  if (!payload.email) throw new Error('Google did not share an email address.');
  return {
    sub: payload.sub, name: payload.name || payload.email.split('@')[0],
    email: String(payload.email).toLowerCase(), picture: payload.picture || '',
  };
}

/** Render Google's own sign-in button into `element`. Resolves with the profile. */
export async function renderGoogleButton(element, { onSuccess, onError }) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Google sign-in is not configured yet — set VITE_GOOGLE_CLIENT_ID (see DEPLOY.md).');
  }
  const google = await loadGis();
  return new Promise((resolve) => {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        try {
          const profile = decodeGoogleIdToken(response?.credential);
          onSuccess?.(profile);
          resolve(profile);
        } catch (err) {
          onError?.(err);
          resolve(null);
        }
      },
    });
    google.accounts.id.renderButton(element, {
      theme: 'filled_black', size: 'large', width: 320,
      text: 'continue_with', shape: 'rectangular',
    });
  });
}
