// app/api/todos/add/route.js
//
// POST /api/todos/add
//
// Two modes, distinguished by request body shape:
//
//   { briefItemId: "<uuid>" }
//     Add a todo from a brief item. Copies synthesis, body excerpt,
//     and source link; marks the brief item as state='added_to_todo'.
//     Used by the "Add to ToDo" button on each brief item.
//
//   { title: "<string>" }
//     Add a free-text todo (manual quick-add). Title only. Used by
//     the quick-add input on /todo.
//
// Returns { ok: true, todo: <row> } on success.
//
// Owner-only.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { addFromBriefItem, addManual } from '@/lib/todos';

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
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const briefItemId = body?.briefItemId;
  const title = body?.title;

  // Exactly one of the two must be set.
  if (!briefItemId && !title) {
    return NextResponse.json(
      { ok: false, error: 'missing_input', detail: 'briefItemId or title required' },
      { status: 400 },
    );
  }
  if (briefItemId && title) {
    return NextResponse.json(
      { ok: false, error: 'ambiguous_input', detail: 'provide briefItemId OR title, not both' },
      { status: 400 },
    );
  }

  try {
    if (briefItemId) {
      const { todo } = await addFromBriefItem(briefItemId);
      return NextResponse.json({ ok: true, todo });
    } else {
      const todo = await addManual(title);
      return NextResponse.json({ ok: true, todo });
    }
  } catch (e) {
    console.error('[/api/todos/add] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'add_failed', detail: String(e.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}
