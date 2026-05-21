// lib/actions.js
//
// v0.1.5 — server-side write helpers for the actions table. The
// API routes do the owner-only auth check before calling these;
// this module just performs the writes via the service-role client.
//
// Two writes happen per call, in order:
//   1. brief_items.state is updated to 'done' | 'delegated' | 'scheduled'
//   2. a row is inserted into actions with the matching action_type
//      and a JSON detail blob (note, recipient, calendar event, etc.)
//
// RLS on brief_items and actions stays locked — the anon key cannot
// read or write either table. Everything here uses the service-role
// client.
//
// Design rule: the actions module knows nothing about the synthesis
// prompt, the devotional engine, or anything else outside this small
// surface. Mirrors the same separation enforced for the brief and
// devotional pipelines (see PITFALLS §3).

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

  // Confirm the brief item exists. We don't enforce "must currently
  // be 'new'" — re-marking an already-done item is harmless and lets
  // the owner correct mistakes (e.g. accidentally clicked Done →
  // wants to delegate instead).
  const { data: item, error: fetchErr } = await supabase
    .from('brief_items')
    .select('id, state, date')
    .eq('id', briefItemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!item) throw new Error('brief_item_not_found');

  // Update state on brief_items
  const { error: updateErr } = await supabase
    .from('brief_items')
    .update({ state })
    .eq('id', briefItemId);
  if (updateErr) throw updateErr;

  // Insert audit row in actions. The action_type column maps 1:1 to
  // state for v0.1.5; the two-column setup leaves room for future
  // distinctions (e.g. multiple action_types per state).
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
