// =============================================================================
// Manna — auth (v0.1.3)
// =============================================================================
// Server-side helpers for reading the current user from cookies. Used by:
//   - app/page.js — gate the devotional behind a session
//   - app/login/page.js — redirect already-logged-in users to /
//   - app/api/auth/* routes — set/clear session cookies
//
// Two cookies are involved:
//   - manna_session : signed JSON payload { userId, role, exp }. HTTP-only.
//   - manna_email   : remembered email for passcode-only re-login on this
//                     device. HTTP-only. NOT a security token — just UX.
//
// Sessions last 30 days. The email cookie lasts 1 year. Logout clears the
// session cookie only; the email cookie persists so a returning user can
// log in with passcode alone. To switch accounts on a device, the login
// page accepts ?fresh=1 which shows both fields.
// =============================================================================

import { cookies } from 'next/headers';
import { getServiceClient } from '@/lib/supabase';
import { verifySession } from '@/lib/crypto';

export const SESSION_COOKIE = 'manna_session';
export const EMAIL_COOKIE = 'manna_email';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const EMAIL_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

// True if the server is configured for auth (SESSION_SECRET present).
// The page can use this to render a calm setup message if missing.
export function isAuthConfigured() {
  return Boolean(process.env.SESSION_SECRET);
}

// Get the current authenticated user from the session cookie, or null.
// Returns { id, email, display_name, role } on success.
export async function getCurrentUser() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE);
  if (!sessionCookie?.value) return null;

  const payload = verifySession(sessionCookie.value, secret);
  if (!payload?.userId) return null;

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from('app_users')
      .select('id, email, display_name, role')
      .eq('id', payload.userId)
      .maybeSingle();
    if (error || !data) return null;
    // Sanity: the role in the cookie must match the role in the database.
    // If you rotated someone's role, their old cookies still work — but we
    // trust the database as the source of truth.
    return data;
  } catch {
    return null;
  }
}

// Get the remembered email cookie, or null. Used by the login page to
// decide whether to render passcode-only or email + passcode.
export async function getRememberedEmail() {
  const cookieStore = await cookies();
  const value = cookieStore.get(EMAIL_COOKIE)?.value;
  if (!value) return null;
  return String(value).trim().toLowerCase() || null;
}
