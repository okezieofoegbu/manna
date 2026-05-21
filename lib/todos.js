// lib/todos.js
//
// v0.1.7 — the ToDo list. Manna's third surface.
// v0.1.8 — added priority + due_date columns and the helpers that set
//          them. listOpen now sorts by due_date asc nulls last,
//          priority asc (lex: 'high' < 'normal'), created_at desc.
//          addFromBriefItem maps brief category='urgent' -> priority='high'.
//
// Design principles (unchanged):
// - Owner-only. Service-role DB writes; the public anon key sees
//   nothing in todos (RLS on, no policies).
// - Open todos persist across days. The page filters Completed
//   items to "today only" so the working list stays current.
// - No cascading state: when a todo is deleted or completed, the
//   originating brief_items row stays at state='added_to_todo'.
// - Unique index on todos.source_id prevents accidentally adding
//   the same brief item twice (e.g. double-click).
//
// Source mapping (set by add-from-brief path):
//   brief_items.source='zoho_transworld' -> todos.source='brief_transworld'
//   brief_items.source='gmail_vitalis'   -> todos.source='brief_vitalis'
//   Manual quick-add                    -> todos.source='manual'
//
// Priority mapping (v0.1.8):
//   brief_items.category='urgent' -> todos.priority='high'
//   else                          -> todos.priority='normal'
//   Manual quick-add              -> todos.priority='normal'

import { getServiceClient } from './supabase.js';

// brief_items.source -> todos.source
function mapBriefSourceToTodoSource(briefSource) {
  if (briefSource === 'zoho_transworld') return 'brief_transworld';
  if (briefSource === 'gmail_vitalis') return 'brief_vitalis';
  return null;
}

// brief_items.category -> todos.priority (v0.1.8)
function mapBriefCategoryToPriority(category) {
  return category === 'urgent' ? 'high' : 'normal';
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
// v0.1.8: priority is set from brief category. urgent -> high, else normal.
//         due_date is always null on creation (owner sets it on /todo).
//
// Returns { todo, briefItem } on success, throws on hard failure.
export async function addFromBriefItem(briefItemId) {
  if (!briefItemId) throw new Error('addFromBriefItem: briefItemId required');

  const supa = getServiceClient();

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

  const insertRow = {
    source: todoSource,
    source_id: bi.id,
    title: bi.synthesis || bi.subject || '(no title)',
    body_excerpt: bi.body_excerpt || null,
    source_link: bi.source_link || null,
    state: 'open',
    priority: mapBriefCategoryToPriority(bi.category),
    due_date: null,
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
// Priority defaults to normal, no due date — owner sets these on the row.
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
      priority: 'normal',
      due_date: null,
    })
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`addManual: insert failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// markDone / reopen / deleteTodo — unchanged from v0.1.7
// ---------------------------------------------------------------------------
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

export async function deleteTodo(todoId) {
  if (!todoId) throw new Error('deleteTodo: todoId required');
  const supa = getServiceClient();
  const { error } = await supa.from('todos').delete().eq('id', todoId);
  if (error) throw new Error(`deleteTodo: delete failed: ${error.message}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// setPriority — v0.1.8
// ---------------------------------------------------------------------------
//
// Set priority to 'normal' or 'high'. Schema CHECK enforces this too.
export async function setPriority(todoId, priority) {
  if (!todoId) throw new Error('setPriority: todoId required');
  if (priority !== 'normal' && priority !== 'high') {
    throw new Error(`setPriority: invalid priority '${priority}'`);
  }
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .update({ priority })
    .eq('id', todoId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`setPriority: update failed: ${error.message}`);
  if (!data) throw new Error(`setPriority: todo ${todoId} not found`);
  return data;
}

// ---------------------------------------------------------------------------
// setDueDate — v0.1.8
// ---------------------------------------------------------------------------
//
// Set or clear the due_date on a todo. dueDate is a YYYY-MM-DD string
// (a calendar date, no time component) or null to clear.
export async function setDueDate(todoId, dueDate) {
  if (!todoId) throw new Error('setDueDate: todoId required');
  let value = null;
  if (dueDate !== null && dueDate !== undefined && dueDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error(`setDueDate: invalid date '${dueDate}' (expected YYYY-MM-DD)`);
    }
    value = dueDate;
  }
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .update({ due_date: value })
    .eq('id', todoId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`setDueDate: update failed: ${error.message}`);
  if (!data) throw new Error(`setDueDate: todo ${todoId} not found`);
  return data;
}

// ---------------------------------------------------------------------------
// listOpen — all open todos, sorted for v0.1.8
// ---------------------------------------------------------------------------
//
// Sort: due_date asc nulls last, then priority asc (lex: 'high' < 'normal',
// so asc puts high first), then created_at desc.
//
// NOTE: this priority sort relies on the lex order of the two values
// ('h' < 'n' so 'high' < 'normal' alphabetically). Adding a 'low'
// priority later would require a different scheme — integer rank, or
// in-JS sort after fetch. For v0.1.8 (normal + high only) lex works.
export async function listOpen() {
  const supa = getServiceClient();
  const { data, error } = await supa
    .from('todos')
    .select('*')
    .eq('state', 'open')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listOpen: query failed: ${error.message}`);
  return data || [];
}

// ---------------------------------------------------------------------------
// listCompletedToday — done todos completed today (local TZ)
// ---------------------------------------------------------------------------
//
// "Today" means the local owner timezone (MANNA_TIMEZONE). Sort is just
// completed_at desc — priority and due date are less meaningful once
// an item is done.
export async function listCompletedToday() {
  const supa = getServiceClient();
  const tz = process.env.MANNA_TIMEZONE || 'Africa/Lagos';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;

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

// ---------------------------------------------------------------------------
// ownerTodayIso / ownerTomorrowIso — v0.1.8
// ---------------------------------------------------------------------------
//
// YYYY-MM-DD strings representing today and tomorrow in MANNA_TIMEZONE.
// Used by /todo to compute due-date labels server-side, so the client
// doesn't have to do TZ math itself — pure string comparison against
// todo.due_date (which is also a YYYY-MM-DD string from Postgres).

export function ownerTodayIso() {
  const tz = process.env.MANNA_TIMEZONE || 'Africa/Lagos';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

export function ownerTomorrowIso() {
  const today = ownerTodayIso();
  // Pure calendar arithmetic on the date string. We parse as UTC just
  // to use Date's date arithmetic; the TZ doesn't matter because we
  // only read the date components back out.
  const t = new Date(today + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// computeTzMidnightIso — unchanged from v0.1.7
// ---------------------------------------------------------------------------
function computeTzMidnightIso(tz, y, m, d) {
  const utcGuess = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0);

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
    offsetMs = tzWallUtc - utcGuess;
  }

  const trueMidnightMs = utcGuess - offsetMs;
  return new Date(trueMidnightMs).toISOString();
}
