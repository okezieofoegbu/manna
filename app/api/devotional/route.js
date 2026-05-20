// =============================================================================
// Manna — /api/devotional
// =============================================================================
// The server-side trigger for the devotional engine. The Anthropic and Bible
// keys are used ONLY here (server code) — they never reach the browser.
//
//   GET   — return today's devotional if one exists; never generates.
//   POST  — ensure today's devotional exists (generate if missing), return it.
//           Idempotent: a second POST on the same day regenerates nothing.
//
// In v0.1.2 the page POSTs here on the first load of a new day. From v0.1.5
// the morning Cron job will POST here before dawn instead.
// =============================================================================

import { NextResponse } from 'next/server';
import { ensureTodaysDevotional, getTodaysDevotional } from '@/lib/devotional';

// The Anthropic SDK needs the Node.js runtime, and generation must run fresh
// every request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const devotional = await getTodaysDevotional();
    return NextResponse.json({ ok: true, devotional: devotional || null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await ensureTodaysDevotional();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
