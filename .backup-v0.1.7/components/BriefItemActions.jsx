'use client';

// components/BriefItemActions.jsx
//
// v0.1.7 — the brief becomes a triage surface. Two actions:
//
//   Done       — mark this item handled (with optional note).
//                Same expand-panel pattern as v0.1.5.1: the note is
//                a quiet audit trail for "delegated to Joseph by
//                phone", "replied directly", etc. Optional.
//
//   Add to ToDo — single click. Copies the synthesis into a row in
//                the todos table and marks this brief item as
//                state='added_to_todo'. The work moves to /todo,
//                accessed via "Continue to your ToDo →" at the end
//                of the Vitalis brief.
//
// What changed from v0.1.5.1:
//   - Schedule (Google Calendar event creation) removed from the UI.
//     The /api/actions/schedule route remains as dead code; we may
//     resurrect it inside the ToDo page later. Same approach as
//     v0.1.5.1's removal of Delegate.
//
//   - Why: in practice, "what should I block time for?" is a
//     decision the morning doesn't have context for. The brief is
//     for triage (signal vs noise); the ToDo is for planning (when,
//     who, how long) — done later with the full day in view.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATE_LABELS = {
  done: 'Done',
  delegated: 'Delegated',
  scheduled: 'Scheduled',
  added_to_todo: 'Added',
};

function ItemStateChip({ state }) {
  const label = STATE_LABELS[state] || state;
  return (
    <div className="manna-action-state">
      <span className="manna-action-state-chip" data-state={state}>
        {label}
      </span>
    </div>
  );
}

export default function BriefItemActions({ item }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null); // null | 'done'
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');

  // Already-actioned items show a chip and no controls. Tomorrow's brief
  // will exclude them automatically (date-filtered query). The chip's
  // visual treatment (dim + label) signals "handled this morning."
  if (item.state && item.state !== 'new') {
    return <ItemStateChip state={item.state} />;
  }

  function toggle(panel) {
    setError(null);
    setExpanded((e) => (e === panel ? null : panel));
  }

  async function submitDone() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/actions/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief_item_id: item.id,
          note: note || '',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e.message);
      setPending(false);
    }
  }

  async function submitAddToTodo() {
    // One-click action — no expand panel. The synthesis becomes the
    // todo title verbatim. If wording is wrong, the user deletes the
    // todo on /todo and re-creates it manually; an inline edit on the
    // brief is deliberately out of scope for v0.1.7.
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/todos/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefItemId: item.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e.message);
      setPending(false);
    }
  }

  return (
    <div className="manna-actions">
      <div className="manna-actions-row">
        <button
          type="button"
          className="manna-action-btn"
          onClick={() => toggle('done')}
          disabled={pending}
          data-expanded={expanded === 'done' ? 'true' : 'false'}
        >
          Done
        </button>
        <button
          type="button"
          className="manna-action-btn"
          onClick={submitAddToTodo}
          disabled={pending}
        >
          Add to ToDo
        </button>
      </div>

      {expanded === 'done' && (
        <div className="manna-actions-panel">
          <label className="manna-action-label" htmlFor={`note-${item.id}`}>
            Optional note
          </label>
          <textarea
            id={`note-${item.id}`}
            className="manna-action-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Delegated to Joseph by phone; replied directly; CC'd Florence"
            rows={2}
            disabled={pending}
          />
          <div className="manna-actions-row">
            <button
              type="button"
              className="manna-action-btn-primary"
              onClick={submitDone}
              disabled={pending}
            >
              {pending ? 'Marking…' : 'Mark done'}
            </button>
            <button
              type="button"
              className="manna-action-btn-cancel"
              onClick={() => setExpanded(null)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="manna-action-error">{error}</div>}
    </div>
  );
}
