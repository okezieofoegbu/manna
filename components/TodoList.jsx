'use client';

// components/TodoList.jsx
//
// v0.1.7 — renders the open and completed-today sections of the ToDo page.
// v0.1.8 — adds Priority chip (Normal <-> High toggle) and Due-date chip
//          (click to open inline date picker; small x next to it clears
//          directly). High-priority rows get a red left border. Overdue
//          dates render in red, Today in amber. The page passes
//          todayIso/tomorrowIso so the row label uses the same "today"
//          reference as the sort.
// v0.1.8.1 — date input now has min/max attributes (today through +5y)
//          to prevent the Mac Chrome native picker from accepting a
//          partial-year typo (e.g. year 0023). Belt-and-braces: same
//          bound check in lib/todos.js setDueDate, and a defensive
//          year-range alert in handleDateChange.
//
// Layout per row (open):
//   - Title (serif, like the brief synthesis)
//   - Body excerpt (sans, muted) — only for brief-sourced todos
//   - Source link (Open in Gmail / Open in Zoho) — only for brief-sourced
//   - Chips row: [Priority] [Due-date]  [x to clear]
//   - Right side: Done button + small x for delete

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

// Compute the display label for a due date.
// Returns { label, status } where status is one of:
//   'overdue' | 'today' | 'tomorrow' | 'future' | null (no date set).
function computeDueLabel(dueDateIso, todayIso, tomorrowIso) {
  if (!dueDateIso) return { label: 'Set date', status: null };
  if (dueDateIso === todayIso) return { label: 'Today', status: 'today' };
  if (dueDateIso === tomorrowIso) return { label: 'Tomorrow', status: 'tomorrow' };

  if (dueDateIso < todayIso) {
    // Overdue. Compute days ago via UTC parse (pure calendar arithmetic).
    const today = new Date(todayIso + 'T00:00:00Z');
    const due = new Date(dueDateIso + 'T00:00:00Z');
    const diffDays = Math.round((today - due) / (1000 * 60 * 60 * 24));
    return { label: `Overdue · ${diffDays}d`, status: 'overdue' };
  }

  // Future. Format as "MMM D".
  const due = new Date(dueDateIso + 'T00:00:00Z');
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = `${monthNames[due.getUTCMonth()]} ${due.getUTCDate()}`;
  return { label, status: 'future' };
}

function TodoRow({
  todo,
  todayIso,
  tomorrowIso,
  minDateIso,
  maxDateIso,
  onDone,
  onReopen,
  onDelete,
  onPriorityToggle,
  onDueDateSet,
  pending,
}) {
  const isDone = todo.state === 'done';
  const lbl = sourceLabel(todo.source);
  const isHigh = todo.priority === 'high';
  const dueInfo = computeDueLabel(todo.due_date, todayIso, tomorrowIso);

  // Per-row state for the inline date editor.
  const [editingDate, setEditingDate] = useState(false);

  function handleDateChange(e) {
    const value = e.target.value || null;

    // v0.1.8.1 — defensive client-side year check. The browser's
    // native picker on Mac Chrome lets a 1- or 2-digit year through
    // if the user tabs off mid-typing. The min/max attributes catch
    // most cases, this is the safety net.
    if (value) {
      const year = Number(value.slice(0, 4));
      if (year < 2020 || year > 2100) {
        alert(
          `That doesn't look like a real date (year ${year}). ` +
          `Try again — make sure all four digits of the year are entered.`,
        );
        // Don't close the editor; let the user retry.
        return;
      }
    }

    onDueDateSet(todo.id, value);
    setEditingDate(false);
  }

  function handleDateClear() {
    onDueDateSet(todo.id, null);
  }

  return (
    <li
      className="manna-todo-row"
      data-state={todo.state}
      data-source={todo.source}
      data-priority={todo.priority || 'normal'}
      data-due={dueInfo.status || 'none'}
    >
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

        {/* Chips row — only on open todos. Done todos don't need to
            change priority or due date. */}
        {!isDone && (
          <div className="manna-todo-chips">
            <button
              type="button"
              className={`manna-todo-chip manna-todo-chip-priority manna-todo-chip-priority-${isHigh ? 'high' : 'normal'}`}
              onClick={() => onPriorityToggle(todo.id, isHigh ? 'normal' : 'high')}
              disabled={pending}
              aria-label={`Priority: ${isHigh ? 'High' : 'Normal'} (tap to toggle)`}
              title="Toggle priority"
            >
              {isHigh ? 'High' : 'Normal'}
            </button>

            <span className="manna-todo-due-wrap">
              {!editingDate ? (
                <>
                  <button
                    type="button"
                    className={`manna-todo-chip manna-todo-chip-due manna-todo-chip-due-${dueInfo.status || 'none'}`}
                    onClick={() => setEditingDate(true)}
                    disabled={pending}
                    aria-label={
                      todo.due_date
                        ? `Due ${dueInfo.label} (tap to change)`
                        : 'Set due date'
                    }
                  >
                    {dueInfo.label}
                  </button>
                  {todo.due_date && (
                    <button
                      type="button"
                      className="manna-todo-chip-due-clear"
                      onClick={handleDateClear}
                      disabled={pending}
                      aria-label="Clear due date"
                      title="Clear due date"
                    >
                      ×
                    </button>
                  )}
                </>
              ) : (
                <input
                  type="date"
                  className="manna-todo-date-input"
                  defaultValue={todo.due_date || ''}
                  onChange={handleDateChange}
                  onBlur={() => setEditingDate(false)}
                  min={minDateIso}
                  max={maxDateIso}
                  autoFocus
                />
              )}
            </span>
          </div>
        )}
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

export default function TodoList({
  open,
  completedToday,
  todayIso,
  tomorrowIso,
  minDateIso,
  maxDateIso,
}) {
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
      // PITFALLS §11 — reset in finally so undo/error paths reset too.
      setPending(false);
    }
  }

  const onDone = (todoId) => post('/api/todos/done', { todoId });
  const onReopen = (todoId) => post('/api/todos/reopen', { todoId });
  const onDelete = (todoId) => {
    if (!confirm('Delete this todo?')) return;
    post('/api/todos/delete', { todoId });
  };
  const onPriorityToggle = (todoId, priority) =>
    post('/api/todos/priority', { todoId, priority });
  const onDueDateSet = (todoId, dueDate) =>
    post('/api/todos/due', { todoId, dueDate });

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
                todayIso={todayIso}
                tomorrowIso={tomorrowIso}
                minDateIso={minDateIso}
                maxDateIso={maxDateIso}
                onDone={onDone}
                onReopen={onReopen}
                onDelete={onDelete}
                onPriorityToggle={onPriorityToggle}
                onDueDateSet={onDueDateSet}
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
                todayIso={todayIso}
                tomorrowIso={tomorrowIso}
                minDateIso={minDateIso}
                maxDateIso={maxDateIso}
                onDone={onDone}
                onReopen={onReopen}
                onDelete={onDelete}
                onPriorityToggle={onPriorityToggle}
                onDueDateSet={onDueDateSet}
                pending={pending}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
