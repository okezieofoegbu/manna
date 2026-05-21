'use client';

// components/BriefItemActions.jsx
//
// v0.1.7 — Done + Add to ToDo (Schedule removed from UI).
// v0.1.7.1 — undo link added next to the state chip.
// v0.1.7.2 — bug fix: setPending(false) was only called in the catch
//   branch of submitUndo. For Done and Add to ToDo this didn't matter
//   because the brief item changes state ('done' / 'added_to_todo')
//   and the component takes the early-return chip path, which has no
//   pending state to clear. But Undo returns the item to state='new',
//   so the same component keeps rendering Done / Add to ToDo buttons
//   — with pending stuck at true, leaving both buttons greyed out.
//   Fix: use a finally block so pending always resets after the
//   request completes, regardless of outcome. Same fix applied to
//   submitDone and submitAddToTodo for defense (though they don't
//   currently exhibit the bug).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATE_LABELS = {
  done: 'Done',
  delegated: 'Delegated',
  scheduled: 'Scheduled',
  added_to_todo: 'Added',
};

function ItemStateChip({ state, onUndo, pending }) {
  const label = STATE_LABELS[state] || state;
  return (
    <div className="manna-action-state">
      <span className="manna-action-state-chip" data-state={state}>
        {label}
      </span>
      <button
        type="button"
        className="manna-action-undo"
        onClick={onUndo}
        disabled={pending}
        aria-label="Undo"
      >
        undo
      </button>
    </div>
  );
}

export default function BriefItemActions({ item }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null); // null | 'done'
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');

  async function submitUndo() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/actions/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_item_id: item.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      // v0.1.7.2 — always reset pending. After undo the item goes
      // back to state='new' and this same component keeps rendering
      // the active buttons; without this, they stay disabled.
      setPending(false);
    }
  }

  // Already-actioned items show the chip + undo.
  if (item.state && item.state !== 'new') {
    return (
      <>
        <ItemStateChip state={item.state} onUndo={submitUndo} pending={pending} />
        {error && <div className="manna-action-error">{error}</div>}
      </>
    );
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
    } finally {
      setPending(false);
    }
  }

  async function submitAddToTodo() {
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
    } finally {
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
