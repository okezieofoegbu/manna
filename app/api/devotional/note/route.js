// app/api/devotional/note/route.js
//
// v0.1.7.1 — the reflection note. One nullable column on each
// devotional_days row. Owner-only on both read and write — readers
// never see this; the reader role on the page is for the devotional
// only, and notes are emphatically private.
//
//   GET  /api/devotional/note?date=YYYY-MM-DD
//        Returns { ok: true, note: string | null }
//
//   POST /api/devotional/note
//        Body: { date: "YYYY-MM-DD", note: string }
//        Writes the note to devotional_days.reflection_note for that
//        date. Empty/whitespace-only note stores as NULL (cleaner
//        than empty string for "no note set").
//
// Auto-save model: the client posts on blur. Save is whole-value
// replacement, not append. No history of past versions kept — the
// last save wins. (If versioning ever becomes useful, a separate
// table later — for now this is a margin note, not a journal.)

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

// Validate a YYYY-MM-DD date string.
function isValidDate(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  if (user.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!isValidDate(date)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_date', detail: 'date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  try {
    const supa = getServiceClient();
    const { data, error } = await supa
      .from('devotional_days')
      .select('reflection_note')
      .eq('date', date)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      date,
      note: data?.reflection_note || null,
    });
  } catch (e) {
    console.error('[/api/devotional/note GET] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'read_failed', detail: String(e?.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}

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

  const date = body?.date;
  const noteRaw = body?.note;
  if (!isValidDate(date)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_date', detail: 'date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (typeof noteRaw !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'invalid_note', detail: 'note must be a string' },
      { status: 400 },
    );
  }

  // Reasonable upper bound. A margin note isn't a novel.
  if (noteRaw.length > 20000) {
    return NextResponse.json(
      { ok: false, error: 'note_too_long', detail: 'max 20,000 chars' },
      { status: 400 },
    );
  }

  const noteToStore = noteRaw.trim() ? noteRaw : null;

  try {
    const supa = getServiceClient();
    // The devotional_days row for this date must already exist (it's
    // created when the devotional generates). If it doesn't, the
    // update is a no-op and we return ok with a hint. We do NOT
    // create a stub row here — a reflection note without a devotional
    // would be a weird shape.
    const { data, error } = await supa
      .from('devotional_days')
      .update({ reflection_note: noteToStore })
      .eq('date', date)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          error: 'no_devotional_for_date',
          detail: 'No devotional exists for this date yet; reflection note cannot be saved.',
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, date, note: noteToStore });
  } catch (e) {
    console.error('[/api/devotional/note POST] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'write_failed', detail: String(e?.message || e).slice(0, 500) },
      { status: 500 },
    );
  }
}
