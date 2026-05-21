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
// v0.1.8.1 — also passes minDateIso / maxDateIso for the date input's
//          min/max attributes (prevents far-past / far-future year typos
//          from the browser's fiddly MM/DD/YYYY date picker).

export const dynamic = 'force-dynamic';

// Bound the date picker to a sensible window. The browser's native
// <input type="date"> on Mac Chrome accepts a partially-typed year
// (e.g. user tabs off after typing "2" — accepts year 0002). min/max
// attributes greys out invalid dates in the calendar picker AND mark
// the input invalid if the user types an out-of-range value.
function isoShiftYears(iso, deltaYears) {
  const y = Number(iso.slice(0, 4));
  return `${y + deltaYears}${iso.slice(4)}`;
}

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
  const minDateIso = todayIso;                          // no past dates
  const maxDateIso = isoShiftYears(todayIso, 5);        // 5 years out

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
        minDateIso={minDateIso}
        maxDateIso={maxDateIso}
      />

      <footer className="manna-footer">
        <Link href="/" className="manna-todo-home-link">
          ← Back to the word
        </Link>
      </footer>
    </main>
  );
}
