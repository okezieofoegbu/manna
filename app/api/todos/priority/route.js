// app/api/todos/priority/route.js
//
// POST /api/todos/priority
// Body: { todoId: "<uuid>", priority: "normal" | "high" }
// Owner-only. v0.1.8.
//
// Used by the priority chip on /todo. Toggles between normal and high.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { setPriority } from '@/lib/todos';

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
  const priority = body?.priority;

  if (!todoId) {
    return NextResponse.json(
      { ok: false, error: 'missing_input', detail: 'todoId required' },
      { status: 400 },
    );
  }
  if (priority !== 'normal' && priority !== 'high') {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_priority',
        detail: "priority must be 'normal' or 'high'",
      },
      { status: 400 },
    );
  }

  try {
    const todo = await setPriority(todoId, priority);
    return NextResponse.json({ ok: true, todo });
  } catch (e) {
    console.error('[/api/todos/priority] failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'set_priority_failed',
        detail: String(e.message || e).slice(0, 500),
      },
      { status: 500 },
    );
  }
}
