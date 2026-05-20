// app/api/actions/done/route.js
//
// v0.1.5 — mark a brief item as done. Owner-only. Optional note.
//
// Body: { brief_item_id: string, note?: string }
// Returns: { ok: true, item_id, state: 'done', action_id }
//
// Two writes happen, transactionally-ish (Supabase doesn't expose
// transactions over PostgREST):
//   - brief_items.state → 'done'
//   - actions row with action_type='done' and detail.note
// If the second write fails after the first succeeds, the brief item
// is marked done but the audit row is missing — surfaced via the
// error response so the owner can decide whether to retry.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { recordDone } from '@/lib/actions';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'unauthenticated' },
      { status: 401 },
    );
  }
  if (user.role !== 'owner') {
    return NextResponse.json(
      { ok: false, error: 'forbidden' },
      { status: 403 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const briefItemId = body?.brief_item_id;
  const note = typeof body?.note === 'string' ? body.note : '';
  if (!briefItemId) {
    return NextResponse.json(
      { ok: false, error: 'missing_brief_item_id' },
      { status: 400 },
    );
  }

  try {
    const result = await recordDone(briefItemId, { note });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('done action failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'done_failed',
        detail: String(e?.message || e).slice(0, 500),
      },
      { status: 500 },
    );
  }
}
