import { describe, expect, it } from 'vitest';
import { decodeGoogleIdToken } from '../googleAuth';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function fakeToken(payload) {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.signature`;
}

describe('decodeGoogleIdToken', () => {
  it('decodes a valid token into a profile', () => {
    const profile = decodeGoogleIdToken(fakeToken({
      sub: '123', name: 'Gina', email: 'Gina@Example.com', picture: 'https://pic/x.jpg',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    expect(profile).toMatchObject({ sub: '123', name: 'Gina', email: 'gina@example.com', picture: 'https://pic/x.jpg' });
  });

  it('rejects expired tokens', () => {
    const token = fakeToken({ sub: '1', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(() => decodeGoogleIdToken(token)).toThrow(/expired/);
  });

  it('rejects malformed tokens and tokens without an email', () => {
    expect(() => decodeGoogleIdToken('not-a-token')).toThrow();
    expect(() => decodeGoogleIdToken('')).toThrow();
    expect(() => decodeGoogleIdToken(fakeToken({ sub: '1', exp: 9999999999 }))).toThrow(/email/);
  });
});
