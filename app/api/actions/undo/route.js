// app/api/actions/undo/route.js
//
// POST /api/actions/undo
// Body: { brief_item_id: string }
//
// Reverts a brief item to state='new'. For state='added_to_todo'
// items, also deletes the corresponding todo. See lib/actions.js
// recordUndo for the full cascade rules.
//
// Owner-only.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { recordUndo } from '@/lib/actions';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  if (user.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const briefItemId = body?.brief_item_id;
  if (!briefItemId) {
    return NextResponse.json(
      { ok: false, error: 'missing_brief_item_id' },
      { status: 400 },
    );
  }

  try {
    const result = await recordUndo(briefItemId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[/api/actions/undo] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'undo_failed', detail: String(e?.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}
