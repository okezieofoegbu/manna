// app/api/todos/delete/route.js
//
// POST /api/todos/delete
// Body: { todoId: "<uuid>" }
//
// Hard-deletes a todo. Used for typos and mistaken adds. The
// originating brief_items row (if any) keeps its state='added_to_todo'
// — see lib/todos.js for why.
//
// Owner-only.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { deleteTodo } from '@/lib/todos';

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
    await deleteTodo(todoId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[/api/todos/delete] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'delete_failed', detail: String(e.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}
