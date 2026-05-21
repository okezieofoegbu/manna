'use client';

// components/TodoList.jsx
//
// v0.1.7 — renders the open and completed-today sections of the ToDo
// page. Each row has its own interactive bits (Done / Reopen / a small
// × for delete), so the whole list is a client island even though most
// of the content is text.
//
// Layout per row:
//   - Title (serif, like the brief synthesis)
//   - Body excerpt (sans, muted) — only for brief-sourced todos
//   - Source link (Open in Gmail / Open in Zoho) — only for
//     brief-sourced todos
//   - Action: Done (open) or Reopen (done)
//   - Delete: small × button, less prominent. Only really for typos
//     and mistaken adds — see lib/todos.js header on why this doesn't
//     revert the originating brief item's state.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function sourceLabel(source) {
  if (source === 'brief_transworld') return 'Transworld';
  if (source === 'brief_vitalis') return 'Vitalis';
  if (source === 'devotional') return 'From the word';
  return null; // manual: no label
}

function openLinkLabel(source) {
  if (source === 'brief_vitalis') return 'Open in Gmail →';
  if (source === 'brief_transworld') return 'Open in Zoho →';
  return 'Open →';
}

function TodoRow({ todo, onDone, onReopen, onDelete, pending }) {
  const isDone = todo.state === 'done';
  const lbl = sourceLabel(todo.source);
  return (
    <li className="manna-todo-row" data-state={todo.state} data-source={todo.source}>
      <div className="manna-todo-row-main">
        <div className="manna-todo-title">{todo.title}</div>
        {todo.body_excerpt && (
          <div className="manna-todo-excerpt">{todo.body_excerpt}</div>
        )}
        <div className="manna-todo-meta">
          {lbl && <span className="manna-todo-source">{lbl}</span>}
          {lbl && todo.source_link && <span className="manna-brief-dot">·</span>}
          {todo.source_link && (
            <a
              href={todo.source_link}
              target="_blank"
              rel="noopener noreferrer"
              className="manna-brief-open-zoho"
            >
              {openLinkLabel(todo.source)}
            </a>
          )}
        </div>
      </div>
      <div className="manna-todo-row-actions">
        {!isDone && (
          <button
            type="button"
            className="manna-action-btn"
            onClick={() => onDone(todo.id)}
            disabled={pending}
          >
            Done
          </button>
        )}
        {isDone && (
          <button
            type="button"
            className="manna-action-btn"
            onClick={() => onReopen(todo.id)}
            disabled={pending}
          >
            Reopen
          </button>
        )}
        <button
          type="button"
          className="manna-todo-delete"
          onClick={() => onDelete(todo.id)}
          disabled={pending}
          aria-label="Delete"
          title="Delete"
        >
          ×
        </button>
      </div>
    </li>
  );
}

export default function TodoList({ open, completedToday }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function post(url, body) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  const onDone = (todoId) => post('/api/todos/done', { todoId });
  const onReopen = (todoId) => post('/api/todos/reopen', { todoId });
  const onDelete = (todoId) => {
    if (!confirm('Delete this todo?')) return;
    post('/api/todos/delete', { todoId });
  };

  const hasOpen = open && open.length > 0;
  const hasCompleted = completedToday && completedToday.length > 0;

  return (
    <div className="manna-todo-list">
      {error && <div className="manna-action-error">{error}</div>}

      <section className="manna-todo-section">
        <div className="manna-todo-section-label">Open</div>
        {hasOpen ? (
          <ul className="manna-todo-ul">
            {open.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                onDone={onDone}
                onReopen={onReopen}
                onDelete={onDelete}
                pending={pending}
              />
            ))}
          </ul>
        ) : (
          <p className="manna-todo-empty">
            Nothing on your list. Add something above, or triage the brief.
          </p>
        )}
      </section>

      {hasCompleted && (
        <section className="manna-todo-section">
          <div className="manna-todo-section-label">Completed today</div>
          <ul className="manna-todo-ul">
            {completedToday.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                onDone={onDone}
                onReopen={onReopen}
                onDelete={onDelete}
                pending={pending}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
