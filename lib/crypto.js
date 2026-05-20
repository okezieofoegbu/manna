// =============================================================================
// Manna — crypto (v0.1.3)
// =============================================================================
// Zero-dependency hashing and signing using Node's built-in crypto module.
//
// - Passcode storage: scrypt with random per-row salt. Format string is
//   "scrypt:N:r:p:salt_hex:hash_hex" so the parameters are versioned with
//   the hash itself — we can change them in the future without breaking
//   existing rows.
//
// - Session signing: HMAC-SHA256 over a base64url-encoded JSON payload.
//   Format is "<body>.<mac>". The session secret comes from the
//   SESSION_SECRET env var; rotate it to invalidate all sessions.
//
// All comparisons are constant-time (timingSafeEqual).
// =============================================================================

import {
  scrypt,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt parameters. N=16384 is the OWASP-recommended starting point; r=8 and
// p=1 are standard. keyLen=32 gives a 256-bit derived key.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

// Hash a plaintext passcode for storage. Returns a self-describing string.
export async function hashPasscode(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('hashPasscode: plaintext must be a non-empty string');
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join(':');
}

// Verify a plaintext passcode against a stored hash. Returns boolean.
// Returns false (rather than throwing) on any malformed input — the caller
// should treat a false return as "not authenticated".
export async function verifyPasscode(plaintext, stored) {
  try {
    if (typeof plaintext !== 'string' || typeof stored !== 'string') {
      return false;
    }
    const parts = stored.split(':');
    if (parts.length !== 6) return false;
    const [scheme, nStr, rStr, pStr, saltHex, hashHex] = parts;
    if (scheme !== 'scrypt') return false;

    const N = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scryptAsync(plaintext, salt, expected.length, {
      N,
      r,
      p,
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// Sign a session payload. Returns "<body>.<mac>". Both parts are base64url.
// Payload should be a small JSON-serializable object, e.g.
//   { userId: '...', role: 'owner', exp: <unix-ms> }
export function signSession(payload, secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('signSession: secret is required');
  }
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

// Verify and decode a session token. Returns the payload object, or null if
// the signature is invalid, the token is malformed, or the exp claim is past.
export function verifySession(token, secret) {
  try {
    if (typeof token !== 'string' || typeof secret !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot < 1 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);

    const expectedMac = createHmac('sha256', secret).update(body).digest('base64url');
    const macBuf = Buffer.from(mac);
    const expectedBuf = Buffer.from(expectedMac);
    if (macBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(macBuf, expectedBuf)) return null;

    const json = Buffer.from(body, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    if (
      typeof payload === 'object' &&
      payload !== null &&
      typeof payload.exp === 'number' &&
      Date.now() > payload.exp
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
