// app/api/actions/schedule/route.js
//
// v0.1.5 — schedule a brief item. Owner-only.
//
// Two-step server flow:
//   1. Create the calendar event in Google Calendar via
//      lib/google-calendar.js (refresh-token → access-token → POST
//      /calendars/{id}/events).
//   2. Record the action in actions + update brief_items.state.
// If step 1 fails, no row is written. If step 1 succeeds and step 2
// fails, the event exists in Google but the audit row is missing —
// surfaced in the error so the owner can decide whether to retry.
//
// Body: {
//   brief_item_id: string,
//   start_local: string,     // "YYYY-MM-DDTHH:MM" from <input type="datetime-local">
//   duration_minutes: number, // 5-480
// }
// Returns: { ok: true, item_id, state: 'scheduled', action_id,
//            event: { event_id, html_link, start, end, calendar_id } }
//
// Timezone handling: start_local is interpreted as the owner's local
// time (MANNA_TIMEZONE env var, defaults to Africa/Lagos). The end
// time is computed by clock arithmetic on the local string — we
// never have to translate offsets, since Google accepts a
// dateTime+timeZone pair and does the math itself.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { recordScheduled } from '@/lib/actions';
import { isGoogleConfigured, createCalendarEvent } from '@/lib/google-calendar';
import { getServiceClient } from '@/lib/supabase';

const OWNER_TZ_DEFAULT = 'Africa/Lagos';

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

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'google_not_configured',
        detail:
          'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN missing. See INSTRUCTIONS.md §6b.',
      },
      { status: 500 },
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
  const startLocal = body?.start_local;
  const durationMinutes = Number(body?.duration_minutes);

  if (!briefItemId || !startLocal || !Number.isFinite(durationMinutes)) {
    return NextResponse.json(
      { ok: false, error: 'missing_fields' },
      { status: 400 },
    );
  }
  if (durationMinutes < 5 || durationMinutes > 480) {
    return NextResponse.json(
      { ok: false, error: 'invalid_duration' },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startLocal)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_start_format' },
      { status: 400 },
    );
  }

  // Fetch the brief item — used for event summary, description, and
  // source link. Also asserts the item exists before we go to Google.
  const supabase = getServiceClient();
  const { data: item, error: itemErr } = await supabase
    .from('brief_items')
    .select('subject, synthesis, source_link, category')
    .eq('id', briefItemId)
    .maybeSingle();
  if (itemErr) {
    return NextResponse.json(
      {
        ok: false,
        error: 'brief_item_lookup_failed',
        detail: String(itemErr?.message || itemErr).slice(0, 300),
      },
      { status: 500 },
    );
  }
  if (!item) {
    return NextResponse.json(
      { ok: false, error: 'brief_item_not_found' },
      { status: 404 },
    );
  }

  // Clock arithmetic in the local "naive" frame. Parsing as UTC and
  // formatting as UTC gives us the local time + duration, regardless
  // of the actual timezone (because we never apply an offset).
  const startWithSeconds =
    startLocal.length === 16 ? `${startLocal}:00` : startLocal;
  const startNaive = new Date(`${startWithSeconds}Z`);
  if (Number.isNaN(startNaive.getTime())) {
    return NextResponse.json(
      { ok: false, error: 'invalid_start' },
      { status: 400 },
    );
  }
  const endNaive = new Date(
    startNaive.getTime() + durationMinutes * 60 * 1000,
  );
  const pad = (n) => String(n).padStart(2, '0');
  const fmtNaive = (d) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
      d.getUTCDate(),
    )}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
      d.getUTCSeconds(),
    )}`;
  const startDateTime = fmtNaive(startNaive);
  const endDateTime = fmtNaive(endNaive);

  const tz = process.env.MANNA_TIMEZONE || OWNER_TZ_DEFAULT;
  const summary = item.subject?.trim() || '(Manna brief — no subject)';
  const description = [
    item.synthesis || '',
    '',
    item.source_link ? `Source: ${item.source_link}` : null,
    '',
    'Scheduled from Manna brief.',
  ]
    .filter((s) => s !== null)
    .join('\n');

  // Step 1: create event in Google Calendar
  let event;
  try {
    event = await createCalendarEvent({
      summary,
      description,
      startDateTime,
      endDateTime,
      timeZone: tz,
    });
  } catch (e) {
    console.error('calendar event creation failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'calendar_event_failed',
        detail: String(e?.message || e).slice(0, 500),
      },
      { status: 502 },
    );
  }

  // Step 2: record the action (also flips brief_items.state)
  try {
    const result = await recordScheduled(briefItemId, event);
    return NextResponse.json({
      ok: true,
      ...result,
      event: {
        event_id: event.eventId,
        html_link: event.htmlLink,
        start: event.start,
        end: event.end,
        calendar_id: event.calendarId,
      },
    });
  } catch (e) {
    console.error('schedule audit write failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'schedule_audit_failed',
        detail: `Calendar event created (id ${event.eventId}) but audit row failed: ${String(
          e?.message || e,
        ).slice(0, 400)}`,
        event: {
          event_id: event.eventId,
          html_link: event.htmlLink,
        },
      },
      { status: 500 },
    );
  }
}
