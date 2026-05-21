'use client';

// components/TodoQuickAdd.jsx
//
// v0.1.7 — the quick-add input on /todo. One-line text field, Enter
// to add. Title-only by design: no notes, no due date, no priority.
// Anything fancier lives in Motion / Granola / wherever; Manna stays
// quiet.
//
// Use cases the owner described:
//   - "call church member"
//   - "discuss topic with wife"
//   - "pray about a word received"
// i.e. todos that come from the devotional, or just from being a
// human in motion through the day.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TodoQuickAdd() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/todos/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      setTitle('');
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="manna-todo-quickadd">
      <input
        type="text"
        className="manna-todo-quickadd-input"
        placeholder="Add something to do today…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={pending}
        maxLength={500}
        autoComplete="off"
      />
      <button
        type="button"
        className="manna-todo-quickadd-btn"
        onClick={submit}
        disabled={pending || !title.trim()}
      >
        {pending ? 'Adding…' : 'Add'}
      </button>
      {error && <div className="manna-action-error">{error}</div>}
    </div>
  );
}
