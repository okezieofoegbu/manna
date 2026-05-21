// app/api/todos/due/route.js
//
// POST /api/todos/due
// Body: { todoId: "<uuid>", dueDate: "YYYY-MM-DD" | null }
// Owner-only. v0.1.8.
//
// Sets or clears the due_date on a todo. Pass null (or omit dueDate)
// to clear. Date is validated for shape; Postgres rejects invalid
// calendar dates.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { setDueDate } from '@/lib/todos';

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
  // dueDate may be null, undefined, "" or a YYYY-MM-DD string.
  const dueDate = body?.dueDate;

  if (!todoId) {
    return NextResponse.json(
      { ok: false, error: 'missing_input', detail: 'todoId required' },
      { status: 400 },
    );
  }

  try {
    const todo = await setDueDate(todoId, dueDate);
    return NextResponse.json({ ok: true, todo });
  } catch (e) {
    console.error('[/api/todos/due] failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'set_due_failed',
        detail: String(e.message || e).slice(0, 500),
      },
      { status: 500 },
    );
  }
}
