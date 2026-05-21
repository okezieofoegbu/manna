// lib/actions.js
//
// v0.1.5 — server-side write helpers for the actions table. The
// API routes do the owner-only auth check before calling these;
// this module just performs the writes via the service-role client.
//
// v0.1.7.1 — two changes:
//   1. recordDone now ALSO writes the optional note to
//      brief_items.done_note, so the page can render it in the
//      brief item without joining to the audit table.
//   2. New recordUndo() — reverts a brief item to state='new',
//      clears done_note, and (for added_to_todo items) deletes
//      the corresponding todo to avoid orphans.
//
// The actions audit table is append-only history: rows are never
// deleted on undo. The brief_items.state is the current view; the
// actions table is the journal. These serve different purposes and
// can disagree by design.

import { getServiceClient } from './supabase.js';

const VALID_STATES = ['done', 'delegated', 'scheduled'];

export async function recordDone(briefItemId, { note = '' } = {}) {
  const trimmed = typeof note === 'string' ? note.trim() : '';
  return recordAction(briefItemId, 'done', {
    note: trimmed || null,
  });
}

export async function recordDelegated(briefItemId, recipient) {
  if (!recipient || !recipient.key || !recipient.email) {
    throw new Error('recordDelegated requires recipient { key, email, displayName }');
  }
  return recordAction(briefItemId, 'delegated', {
    recipient_key: recipient.key,
    recipient_email: recipient.email,
    display_name: recipient.displayName || recipient.display_name || '',
  });
}

export async function recordScheduled(briefItemId, event) {
  if (!event || !event.eventId) {
    throw new Error('recordScheduled requires event { eventId, ... }');
  }
  return recordAction(briefItemId, 'scheduled', {
    event_id: event.eventId,
    calendar_id: event.calendarId || 'primary',
    html_link: event.htmlLink || null,
    start: event.start || null,
    end: event.end || null,
  });
}

async function recordAction(briefItemId, state, detail) {
  if (!briefItemId) throw new Error('brief_item_id is required');
  if (!VALID_STATES.includes(state)) {
    throw new Error(`Invalid state: ${state}`);
  }
  const supabase = getServiceClient();

  // Confirm the brief item exists.
  const { data: item, error: fetchErr } = await supabase
    .from('brief_items')
    .select('id, state, date')
    .eq('id', briefItemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!item) throw new Error('brief_item_not_found');

  // Update state. For 'done', also write the note to done_note so the
  // page can render it on the brief item itself. (The actions audit
  // row still carries note in detail.note as canonical.)
  const updatePayload = { state };
  if (state === 'done') {
    updatePayload.done_note = detail?.note || null;
  }
  const { error: updateErr } = await supabase
    .from('brief_items')
    .update(updatePayload)
    .eq('id', briefItemId);
  if (updateErr) throw updateErr;

  // Insert audit row in actions.
  const { data: action, error: insertErr } = await supabase
    .from('actions')
    .insert({
      brief_item_id: briefItemId,
      action_type: state,
      detail: detail || {},
    })
    .select('id')
    .single();
  if (insertErr) throw insertErr;

  return {
    item_id: briefItemId,
    state,
    action_id: action.id,
  };
}

// ---------------------------------------------------------------------------
// v0.1.7.1 — recordUndo
// ---------------------------------------------------------------------------
//
// Revert a brief item to state='new'. Used by the small "undo" link
// next to the state chip in the brief render. Cascade behavior:
//
//   - state='done'          → clear done_note, leave audit row alone
//   - state='delegated'     → leave audit row alone
//   - state='scheduled'     → leave audit row alone (and leave the
//                             Google Calendar event in place — user
//                             can delete it manually from Calendar
//                             if they no longer want it)
//   - state='added_to_todo' → ALSO delete the todo row where
//                             source_id = brief_item.id. Otherwise
//                             the todo would be an orphan and the
//                             unique index would prevent re-adding.
//
// Idempotent for items already at state='new' (no-op except for the
// fetch).
export async function recordUndo(briefItemId) {
  if (!briefItemId) throw new Error('recordUndo: brief_item_id required');
  const supabase = getServiceClient();

  const { data: item, error: fetchErr } = await supabase
    .from('brief_items')
    .select('id, state')
    .eq('id', briefItemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!item) throw new Error('brief_item_not_found');

  if (item.state === 'new') {
    return { item_id: briefItemId, state: 'new', already_new: true };
  }

  // For added_to_todo items, also delete the linked todo so the user
  // can re-add later (and avoid an orphan).
  if (item.state === 'added_to_todo') {
    const { error: delErr } = await supabase
      .from('todos')
      .delete()
      .eq('source_id', briefItemId);
    if (delErr) {
      // If todo delete fails we still want to flip the state — the
      // user's intent was "undo." A stale todo can be deleted from
      // /todo by them later if needed.
      console.warn(
        `[actions] todo delete failed during undo of ${briefItemId}: ${delErr.message}`,
      );
    }
  }

  const { error: updateErr } = await supabase
    .from('brief_items')
    .update({ state: 'new', done_note: null })
    .eq('id', briefItemId);
  if (updateErr) throw updateErr;

  return { item_id: briefItemId, state: 'new', previous_state: item.state };
}
