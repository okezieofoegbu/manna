// app/api/brief/route.js
//
// Server-side endpoint for the daily brief(s). Owner-only.
//
//   GET   /api/brief  → triggers lazy generation if no brief exists
//                       for today, returns today's brief items.
//   POST  /api/brief  → forces regeneration (in practice both methods
//                       lazy-generate; POST is the convention page.js
//                       uses to trigger generation server-side).
//
// v0.1.6 — this endpoint now triggers BOTH the Transworld brief and
// the Vitalis brief, running them in parallel via Promise.allSettled.
// Per PITFALLS §3 the two pipelines are independent — different
// providers, different filters, different prompts, different Anthropic
// calls. One failing must not block the other.
//
// The page.js server component calls into lib/brief-reads.js directly
// (for both sources) rather than going through HTTP, but this route
// exists for a possible future client-side refresh trigger and for
// diagnostics.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOrGenerateTodaysBrief } from '@/lib/brief';
import { getOrGenerateTodaysVitalisBrief } from '@/lib/brief-vitalis';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  if (user.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const [transworld, vitalis] = await Promise.allSettled([
    getOrGenerateTodaysBrief(),
    getOrGenerateTodaysVitalisBrief(),
  ]);

  // Each pipeline either succeeded (status 'fulfilled' with a result
  // object) or failed (status 'rejected' with an error). We surface
  // both in the response so the page can see partial outcomes.
  const body = { ok: true, transworld: null, vitalis: null };

  if (transworld.status === 'fulfilled') {
    body.transworld = transworld.value;
  } else {
    body.transworld = {
      status: 'error',
      error: 'transworld_generation_failed',
      detail: String(transworld.reason?.message || transworld.reason).slice(0, 500),
    };
    console.error('Transworld brief generation failed:', transworld.reason);
  }

  if (vitalis.status === 'fulfilled') {
    body.vitalis = vitalis.value;
  } else {
    body.vitalis = {
      status: 'error',
      error: 'vitalis_generation_failed',
      detail: String(vitalis.reason?.message || vitalis.reason).slice(0, 500),
    };
    console.error('Vitalis brief generation failed:', vitalis.reason);
  }

  return NextResponse.json(body);
}

export async function POST() {
  return GET();
}
