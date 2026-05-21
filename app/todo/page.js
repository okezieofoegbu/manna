import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import { ownerTodayLong } from '@/lib/dates';
import {
  readOpenTodosForOwner,
  readCompletedTodayForOwner,
} from '@/lib/todo-reads';
import TodoQuickAdd from '@/components/TodoQuickAdd';
import TodoList from '@/components/TodoList';

// app/todo/page.js
//
// v0.1.7 — Manna's third surface. The working list.
//
// Reached from a "Continue to your ToDo →" affordance at the end of
// the Vitalis brief on the home page. Owner-only. Readers are
// redirected to the home page so they can't see this even exists
// (defence in depth; the link itself only renders for owners).
//
// Mobile-first design: the Manna home page is desktop-leaning (wide
// prose, generous margins); /todo is the surface the owner returns to
// throughout the day, often from a phone. Layout is single column,
// large tap targets, quick-add input pinned at the top.

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

      <TodoList open={open} completedToday={completedToday} />

      <footer className="manna-footer">
        <Link href="/" className="manna-todo-home-link">
          ← Back to the word
        </Link>
      </footer>
    </main>
  );
}
