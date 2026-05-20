// =============================================================================
// Manna — POST /api/auth/login (v0.1.3)
// =============================================================================
// Validates an email + passcode against app_users. On success: sets the
// session cookie (signed, HTTP-only, 30d) and the remembered-email cookie
// (HTTP-only, 1y), then returns { ok: true }.
//
// If the request body has no email, the route falls back to the remembered
// email cookie — that's how passcode-only re-login works on a known device.
//
// In-memory rate limit: 5 failed attempts from one IP within 5 minutes
// locks that IP for 5 minutes. Per-instance; resets on cold start.
// =============================================================================

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServiceClient } from '@/lib/supabase';
import { verifyPasscode, signSession } from '@/lib/crypto';
import {
  SESSION_COOKIE,
  EMAIL_COOKIE,
  SESSION_TTL_SECONDS,
  EMAIL_TTL_SECONDS,
} from '@/lib/auth';

// --- Rate limiter -----------------------------------------------------------

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 5;

// Map<ip, { count, firstAttemptAt }>
const attempts = new Map();

function getClientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function isLockedOut(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt > RATE_WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= RATE_MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() - entry.firstAttemptAt > RATE_WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttemptAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailures(ip) {
  attempts.delete(ip);
}

// --- Handler ----------------------------------------------------------------

export async function POST(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'Server is not configured for auth.' },
      { status: 500 }
    );
  }

  const ip = getClientIp(req);
  if (isLockedOut(ip)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Too many failed attempts. Try again in a few minutes.',
      },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  let email = (body?.email || '').trim().toLowerCase();
  const passcode = (body?.passcode || '').trim();

  // Fall back to remembered email if the form didn't include one.
  if (!email) {
    email =
      (cookieStore.get(EMAIL_COOKIE)?.value || '')
        .trim()
        .toLowerCase();
  }

  if (!email || !passcode) {
    return NextResponse.json(
      { ok: false, error: 'Email and passcode are both required.' },
      { status: 400 }
    );
  }

  // Look up the user.
  let user = null;
  try {
    const client = getServiceClient();
    const { data } = await client
      .from('app_users')
      .select('id, email, passcode_hash, role')
      .eq('email', email)
      .maybeSingle();
    user = data;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Server error. Try again.' },
      { status: 500 }
    );
  }

  // Generic failure message — never reveal whether the email exists.
  const genericInvalid = NextResponse.json(
    { ok: false, error: 'Invalid email or passcode.' },
    { status: 401 }
  );

  if (!user) {
    recordFailure(ip);
    return genericInvalid;
  }

  const valid = await verifyPasscode(passcode, user.passcode_hash);
  if (!valid) {
    recordFailure(ip);
    return genericInvalid;
  }

  // Success. Clear rate-limit state, update last_login_at, set cookies.
  clearFailures(ip);

  try {
    const client = getServiceClient();
    await client
      .from('app_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);
  } catch {
    // Non-fatal — the login still succeeds.
  }

  const expiresAtMs = Date.now() + SESSION_TTL_SECONDS * 1000;
  const sessionToken = signSession(
    { userId: user.id, role: user.role, exp: expiresAtMs },
    secret
  );

  const isProd = process.env.NODE_ENV === 'production';
  const baseCookie = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };

  cookieStore.set(SESSION_COOKIE, sessionToken, {
    ...baseCookie,
    maxAge: SESSION_TTL_SECONDS,
  });
  cookieStore.set(EMAIL_COOKIE, email, {
    ...baseCookie,
    maxAge: EMAIL_TTL_SECONDS,
  });

  return NextResponse.json({ ok: true, role: user.role });
}
