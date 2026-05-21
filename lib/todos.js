// lib/todos.js
//
// v0.1.7 — the ToDo list. Manna's new third surface (after the
// devotional and the briefs). Items get added here when the user
// triages a brief item with "Add to ToDo", and ad-hoc from the
// quick-add input on /todo.
//
// Design principles:
//   - Owner-only. Service-role DB writes; the public anon key sees
//     nothing in todos (RLS on, no policies).
//   - Open todos persist across days. The page filters Completed
//     items to "today only" so the working list stays current.
//   - No cascading state: when a todo is deleted or completed, the
//     originating brief_items row stays at state='added_to_todo'.
//     Brief item state means "I triaged this," not "I completed it."
//   - Unique index on todos.source_id prevents accidentally adding
//     the same brief item twice (e.g. double-click).
//
// Source mapping (set by add-from-brief path):
//   brief_items.source='zoho_transworld' → todos.source='brief_transworld'
//   brief_items.source='gmail_vitalis'   → todos.source='brief_vitalis'
//   Manual quick-add                     → todos.source='manual'

import { getServiceClient } from './supabase.js';

// brief_items.source → todos.source
function mapBriefSourceToTodoSource(briefSource) {
  if (briefSource === 'zoho_transworld') return 'brief_transworld';
  if (briefSource === 'gmail_vitalis') return 'brief_vitalis';
  return null;
}

// ---------------------------------------------------------------------------
// addFromBriefItem
// ---------------------------------------------------------------------------
//
// Adds a todo derived from a brief_items row, and marks the brief item
// as state='added_to_todo'. Both writes happen against the service
// client. If the unique index fires (double-click race), we catch and
// return the existing row.
//
// Returns { todo, briefItem } on success, throws on hard failure.
export async function addFromBriefItem(briefItemId) {
  if (!briefItemId) throw new Error('addFromBriefItem: briefItemId required');
  const supa = getServiceClient();

  // Load the brief item.
  const { data: bi, error: biErr } = await supa
    .from('brief_items')
    .select('*')
    .eq('id', briefItemId)
    .maybeSingle();
  if (biErr) throw new Error(`addFromBriefItem: load failed: ${biErr.message}`);
  if (!bi) throw new Error(`addFromBriefItem: brief item ${briefItemId} not found`);

  const todoSource = mapBriefSourceToTodoSource(bi.source);
  if (!todoSource) {
    throw new Error(
      `addFromBriefItem: unsupported brief source '${bi.source}' for item ${briefItemId}`,
    );
  }

  // Insert the todo. If the unique index hits (already added), recover.
  const insertRow = {
    source: todoSource,
    source_id: bi.id,
    title: bi.synthesis || bi.subject || '(no title)',
    body_excerpt: bi.body_excerpt || null,
    source_link: bi.source_link || null,
    state: 'open',
  };
  let todoRow = null;
  const { data: ins, error: insErr } = await supa
    .from('todos')
    .insert(insertRow)
    .select('*')
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation. Treat as idempotent success.
    if (insErr.code === '23505') {
      const { data: existing, error: exErr } = await supa
        .from('todos')
        .select('*')
        .eq('source_id', bi.id)
        .maybeSingle();
      if (exErr) {
        throw new Error(
          `addFromBriefItem: insert hit unique violation, lookup failed: ${exErr.message}`,
        );
      }
      todoRow = existing;
    } else {
      throw new Error(`addFromBriefItem: insert failed: ${insErr.message}`);
    }
  } else {
    todoRow = ins;
  }

  // Mark the brief item as added_to_todo. Safe to no-op if it already is.
  if (bi.state !== 'added_to_todo') {
    const { error: upErr } = await supa
      .from('brief_items')
      .update({ state: 'added_to_todo' })
      .eq('id', bi.id);
    if (upErr) {
      // The todo is already written; we don't want to fail the whole
      // request just because the state flip didn't land. Log and move
      // on — the next page refresh will still show "added_to_todo"
      // chips for items that DID flip; this one won't, but the todo
      // is on the list, which is what the user actually cares about.
      console.warn(
        `[todos] brief_items state update failed for ${bi.id}: ${upErr.message}`,
      );
    }
  }

  return { todo: todoRow, briefItem: bi };
}

// ---------------------------------------------------------------------------
// addManual
// ---------------------------------------------------------------------------
//
// Adds a free-text todo from the quick-add input on /todo. Title only;
// no body excerpt, no source link. source='manual', source_id=null.
export async function addManual(title) {
  const t = (title || '').trim();
  if (!t) throw new Error('addManual: title required');
  if (t.length > 500) throw new Error('addManual: title too long (max 500)');
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .insert({
      source: 'manual',
      source_id: null,
      title: t,
      state: 'open',
    })
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`addManual: insert failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// markDone
// ---------------------------------------------------------------------------
//
// Flip a todo to state='done' and stamp completed_at. Idempotent —
// re-running on an already-done item just refreshes completed_at,
// which is a reasonable behavior.
export async function markDone(todoId) {
  if (!todoId) throw new Error('markDone: todoId required');
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .update({ state: 'done', completed_at: new Date().toISOString() })
    .eq('id', todoId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`markDone: update failed: ${error.message}`);
  if (!data) throw new Error(`markDone: todo ${todoId} not found`);
  return data;
}

// ---------------------------------------------------------------------------
// reopen
// ---------------------------------------------------------------------------
//
// Flip a done todo back to open. Clears completed_at.
export async function reopen(todoId) {
  if (!todoId) throw new Error('reopen: todoId required');
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .update({ state: 'open', completed_at: null })
    .eq('id', todoId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`reopen: update failed: ${error.message}`);
  if (!data) throw new Error(`reopen: todo ${todoId} not found`);
  return data;
}

// ---------------------------------------------------------------------------
// deleteTodo
// ---------------------------------------------------------------------------
//
// Hard delete. Used for typos / mistaken adds. Brief item state is
// NOT reverted — see file header for why. If the user wants the brief
// item back in their face, they can mark it Done from the brief itself
// (the chip will switch from "Added" to "Done").
//
// Hmm actually, an already-added_to_todo brief item won't show action
// buttons. So deleting the todo leaves the brief item permanently in
// "Added" state for that day with no way to act on it from the brief.
// That's acceptable: the user deletes a todo because they decided it
// wasn't worth tracking, which is functionally equivalent to "Done
// without doing it." The next day's brief is a fresh slate anyway.
export async function deleteTodo(todoId) {
  if (!todoId) throw new Error('deleteTodo: todoId required');
  const supa = getServiceClient();
  const { error } = await supa.from('todos').delete().eq('id', todoId);
  if (error) throw new Error(`deleteTodo: delete failed: ${error.message}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// listOpen — all open todos, newest first
// ---------------------------------------------------------------------------
export async function listOpen() {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .select('*')
    .eq('state', 'open')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listOpen: query failed: ${error.message}`);
  return data || [];
}

// ---------------------------------------------------------------------------
// listCompletedToday — done todos completed today (local TZ)
// ---------------------------------------------------------------------------
//
// "Today" means the local owner timezone (MANNA_TIMEZONE). We compute
// the start-of-day in that TZ and use it as the lower bound on
// completed_at. Items completed yesterday or earlier are still in the
// DB but don't render.
export async function listCompletedToday() {
  const supa = getServiceClient();
  const tz = process.env.MANNA_TIMEZONE || 'Africa/Lagos';
  // Get today's date components in the owner TZ.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  // Construct an ISO instant for midnight in the owner TZ. We use the
  // trick of building a date in UTC matching those wall components and
  // then adjusting by the TZ offset at that moment. For our purposes
  // (filtering completed_at >= midnight TZ-local), a simple ISO with
  // the offset suffix works because Postgres compares timestamptzs in
  // absolute time.
  const localMidnightIso = computeTzMidnightIso(tz, y, m, d);
  const { data, error } = await supa
    .from('todos')
    .select('*')
    .eq('state', 'done')
    .gte('completed_at', localMidnightIso)
    .order('completed_at', { ascending: false });
  if (error) {
    throw new Error(`listCompletedToday: query failed: ${error.message}`);
  }
  return data || [];
}

// Helper: given (tz, year, month, day) compute the ISO 8601 instant
// representing 00:00:00 on that date in that TZ. We do this by
// formatting an arbitrary anchor date through Intl to derive the
// offset at that moment, then building the ISO string.
function computeTzMidnightIso(tz, y, m, d) {
  // Build "YYYY-MM-DDT00:00:00" as if local, then derive offset.
  // The trick: Date.UTC gives us a UTC ms for the same wall components,
  // and Intl with timeZone tells us what UTC time the formatter would
  // call "that wall time," which gives us the offset.
  const utcGuess = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0);
  // Render that UTC moment through the target TZ to find what it
  // displays as. The diff between displayed wall and the wall we want
  // is the offset.
  const tzString = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcGuess));
  // tzString is like "2026-05-21, 02:00:00" depending on locale; en-CA
  // gives "YYYY-MM-DD, HH:MM:SS"
  const match = tzString.match(/(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2}):(\d{2})/);
  let offsetMs = 0;
  if (match) {
    const tzWallUtc = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    // tzWallUtc - utcGuess tells us how many ms the TZ wall is "ahead"
    // of UTC for the same instant.
    offsetMs = tzWallUtc - utcGuess;
  }
  // True UTC instant for midnight in TZ = utcGuess - offsetMs.
  const trueMidnightMs = utcGuess - offsetMs;
  return new Date(trueMidnightMs).toISOString();
}
