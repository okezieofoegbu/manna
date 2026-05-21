import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import { ownerTodayLong } from '@/lib/dates';
import {
  readOpenTodosForOwner,
  readCompletedTodayForOwner,
} from '@/lib/todo-reads';
import { ownerTodayIso, ownerTomorrowIso } from '@/lib/todos';
import TodoQuickAdd from '@/components/TodoQuickAdd';
import TodoList from '@/components/TodoList';

// app/todo/page.js
//
// v0.1.7 — Manna's third surface. The working list.
// v0.1.8 — passes ownerTodayIso / ownerTomorrowIso to TodoList so the
//          client can render due-date labels (Today / Tomorrow / Overdue /
//          MMM D) without doing TZ math itself.

export const dynamic = 'force-dynamic';

export default async function TodoPage() {
  if (!isAuthConfigured()) {
    redirect('/login');
  }
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'owner') {
    // Readers shouldn't even know this page exists. Bounce home.
    redirect('/');
  }

  const dateLine = ownerTodayLong();
  const todayIso = ownerTodayIso();
  const tomorrowIso = ownerTomorrowIso();

  const [open, completedToday] = await Promise.all([
    readOpenTodosForOwner(user),
    readCompletedTodayForOwner(user),
  ]);

  return (
    <main className="manna-shell manna-todo-shell">
      <header className="manna-header manna-todo-header">
        <Link href="/" className="manna-wordmark manna-todo-wordmark">
          Manna
        </Link>
        <div className="manna-todo-title-line">ToDo</div>
        <div className="manna-meta">{dateLine}</div>
      </header>

      <TodoQuickAdd />

      <TodoList
        open={open}
        completedToday={completedToday}
        todayIso={todayIso}
        tomorrowIso={tomorrowIso}
      />

      <footer className="manna-footer">
        <Link href="/" className="manna-todo-home-link">
          ← Back to the word
        </Link>
      </footer>
    </main>
  );
}
