// app/api/brief/route.js
//
// Server-side endpoint for the Transworld brief. Owner-only.
//
//   GET   /api/brief  → triggers lazy generation if no brief exists
//                       for today, returns today's brief items.
//   POST  /api/brief  → forces regeneration (for v0.1.4 this also
//                       does lazy-generate; same as GET, exposed for
//                       a possible future "refresh" button).
//
// The page.js server component calls into lib/brief-reads.js directly
// rather than going through HTTP, but this route exists for a
// possible future client-side refresh trigger and for diagnostics.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOrGenerateTodaysBrief } from '@/lib/brief';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  if (user.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  try {
    const result = await getOrGenerateTodaysBrief();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('brief generation failed:', e);
    return NextResponse.json(
      { ok: false, error: 'brief_generation_failed', detail: String(e?.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function POST() {
  return GET();
}
