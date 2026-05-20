// =============================================================================
// Manna — POST /api/auth/logout (v0.1.3)
// =============================================================================
// Clears the session cookie and redirects to /login. The remembered-email
// cookie is intentionally preserved so the user can log back in with just
// the passcode. To switch accounts on a device, visit /login?fresh=1.
// =============================================================================

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

export async function POST(req) {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  const url = new URL('/login', req.url);
  return Response.redirect(url, 303);
}
