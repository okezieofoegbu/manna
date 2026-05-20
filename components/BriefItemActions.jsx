'use client';

// components/BriefItemActions.jsx
//
// v0.1.5 — the only client island in Manna. Renders the Done /
// Delegate / Schedule controls below each brief item, plus the
// expandable panels for each action.
//
// Why a client island: the rest of the page is server-rendered. We
// keep that pattern and add interactivity only here: useState for
// the expanded panel + form values, useRouter().refresh() after a
// successful POST so the page re-renders from the DB.
//
// State machine for a single item:
//   item.state === 'new'        → render the action row + panels
//   item.state === 'done'       → render a small chip, no actions
//   item.state === 'delegated'  → render chip
//   item.state === 'scheduled'  → render chip with html_link if useful
//
// The chip approach is by design (INSTRUCTIONS.md §11(c)): done items
// stay visible in today's brief but quieted; tomorrow they're gone
// naturally because the daily query filters on date = current_date.

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
// local time. The route reinterprets this in MANNA_TIMEZONE, so
// owners who travel briefly out of WAT can still type "9:00" in
// the input meaning "9:00 Lagos." If that ever becomes a real edge
// case, we'll add an explicit tz dropdown.
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

export default function BriefItemActions({ item, recipients = [] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(null); // null | 'done' | 'delegate' | 'schedule'
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Per-panel local state
  const [note, setNote] = useState('');
  const [recipientKey, setRecipientKey] = useState(
    recipients[0]?.key || '',
  );
  const [startLocal, setStartLocal] = useState(defaultStartLocal());
  const [duration, setDuration] = useState(
    Number(item.time_estimate) > 0 ? Number(item.time_estimate) : 30,
  );

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

  function submitDelegate(target) {
    // Synchronous prep — window.open must be called inside the click
    // handler tick, before any await, or popup blockers will block it.
    const recipient = recipients.find((r) => r.key === recipientKey);
    if (!recipient) {
      setError('No recipient selected.');
      return;
    }

    const subject = `Fwd: ${item.subject || ''}`.trim();
    const bodyLines = [
      item.synthesis || '',
      '',
      item.source_link ? `Source: ${item.source_link}` : null,
      '',
      `— sent from Manna brief, ${new Date().toLocaleDateString()}`,
    ].filter((l) => l !== null);
    const composeBody = bodyLines.join('\n');

    let url;
    if (target === 'mailto') {
      url = `mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(composeBody)}`;
    } else {
      // Zoho webmail compose URL. The hash-fragment URL pattern is
      // best-effort — the body parameter may or may not be honored
      // depending on Zoho's webmail behavior. If it isn't, the
      // recipient + subject still pre-fill, and the body is visible
      // in the same conversation thread once you click into the source.
      url = `https://mail.zoho.com/zm/#mail/compose?to=${encodeURIComponent(
        recipient.email,
      )}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(composeBody)}`;
    }

    // Open compose window synchronously
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened && target !== 'mailto') {
      // Popup blocked — fall back to mailto: in the same tab.
      window.location.href = `mailto:${encodeURIComponent(
        recipient.email,
      )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(composeBody)}`;
    }

    // Now log the delegation server-side. If this fails, the compose
    // window is already open — the audit is missing but the email
    // can still be sent.
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch('/api/actions/delegate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brief_item_id: item.id,
            recipient_key: recipient.key,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          throw new Error(json.detail || json.error || `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setError(`Compose opened but logging failed: ${e.message}`);
        setPending(false);
      }
    })();
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

  const noRecipients = recipients.length === 0;

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
          onClick={() => toggle('delegate')}
          disabled={pending || noRecipients}
          title={noRecipients ? 'No delegate recipients configured' : undefined}
          data-expanded={expanded === 'delegate' ? 'true' : 'false'}
        >
          Delegate
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
            placeholder="e.g. Called Florence, she's handling"
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

      {expanded === 'delegate' && (
        <div className="manna-actions-panel">
          <label className="manna-action-label" htmlFor={`recipient-${item.id}`}>
            Delegate to
          </label>
          <select
            id={`recipient-${item.id}`}
            className="manna-action-select"
            value={recipientKey}
            onChange={(e) => setRecipientKey(e.target.value)}
            disabled={pending}
          >
            {recipients.map((r) => (
              <option key={r.key} value={r.key}>
                {r.display_name}
                {r.role_title ? ` — ${r.role_title}` : ''}
              </option>
            ))}
          </select>
          <div className="manna-actions-row">
            <button
              type="button"
              className="manna-action-btn-primary"
              onClick={() => submitDelegate('zoho')}
              disabled={pending || !recipientKey}
            >
              {pending ? 'Logging…' : 'Confirm & open in Zoho'}
            </button>
            <button
              type="button"
              className="manna-action-btn-secondary"
              onClick={() => submitDelegate('mailto')}
              disabled={pending || !recipientKey}
              title="Open in your system default email client"
            >
              Use default email
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
