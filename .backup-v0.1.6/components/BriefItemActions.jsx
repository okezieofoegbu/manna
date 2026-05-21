'use client';

// components/BriefItemActions.jsx
//
// v0.1.5 — the only client island in Manna. Renders the action controls
// for each brief item.
//
// v0.1.5.1 — simplified to two actions: Done (with optional note) and
// Schedule (creates Google Calendar event). The Delegate path was
// removed after live use revealed:
//   - Zoho's hash-route compose URL doesn't pre-fill anything; the
//     compose tab just opens to the inbox.
//   - The audit row fired the moment the compose tab was opened, so
//     items got marked "delegated" before any email was actually sent.
//   - In practice, delegation happens out-of-band (Zoho, phone, in
//     person) — the owner records what they did via the optional note
//     on Done, which is what the audit trail actually needs to know.
// The /api/actions/delegate route and the delegate_recipients table
// remain in place as dead code for possible future revival.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATE_LABELS = {
  done: 'Done',
  delegated: 'Delegated',
  scheduled: 'Scheduled',
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

// Default the schedule time to the next half-hour in the BROWSER's
// local time. The route reinterprets this in MANNA_TIMEZONE.
function defaultStartLocal() {
  const d = new Date();
  if (d.getMinutes() < 30) {
    d.setMinutes(30, 0, 0);
  } else {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function BriefItemActions({ item }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null); // null | 'done' | 'schedule'
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Per-panel local state
  const [note, setNote] = useState('');
  const [startLocal, setStartLocal] = useState(defaultStartLocal());
  const [duration, setDuration] = useState(
    Number(item.time_estimate) > 0 ? Number(item.time_estimate) : 30,
  );

  // Already-actioned items show a chip and no controls. Tomorrow's brief
  // will exclude them automatically (date-filtered query).
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

  async function submitSchedule() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/actions/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief_item_id: item.id,
          start_local: startLocal,
          duration_minutes: duration,
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
          onClick={() => toggle('schedule')}
          disabled={pending}
          data-expanded={expanded === 'schedule' ? 'true' : 'false'}
        >
          Schedule
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

      {expanded === 'schedule' && (
        <div className="manna-actions-panel">
          <label className="manna-action-label">When</label>
          <div className="manna-actions-row">
            <input
              type="datetime-local"
              className="manna-action-input"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              disabled={pending}
            />
            <input
              type="number"
              className="manna-action-input manna-action-duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              min={5}
              max={480}
              step={5}
              disabled={pending}
            />
            <span className="manna-action-unit">min</span>
          </div>
          <div className="manna-actions-row">
            <button
              type="button"
              className="manna-action-btn-primary"
              onClick={submitSchedule}
              disabled={pending}
            >
              {pending ? 'Scheduling…' : 'Schedule'}
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
