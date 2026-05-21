// app/api/todos/reopen/route.js
//
// POST /api/todos/reopen
// Body: { todoId: "<uuid>" }
//
// Flips a done todo back to open. Clears completed_at.
// Owner-only.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { reopen } from '@/lib/todos';

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

  const todoId = body?.todoId;
  if (!todoId) {
    return NextResponse.json(
      { ok: false, error: 'missing_input', detail: 'todoId required' },
      { status: 400 },
    );
  }

  try {
    const todo = await reopen(todoId);
    return NextResponse.json({ ok: true, todo });
  } catch (e) {
    console.error('[/api/todos/reopen] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'reopen_failed', detail: String(e.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}
