import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';

// app/days/page.js
//
// v0.1.7.1 — the archive. A quiet list of past devotional days.
// Each row links to /days/[date] for the full reading.
//
// Open to BOTH owner and reader roles. The devotional itself is not
// private. (Reflection notes are owner-only — those are hidden on
// the per-day page for readers.)
//
// Shows up to 60 days, ordered most recent first. Includes today.
// If a date has a reflection_note, a small italic indicator appears
// in the row (owner only).

export const dynamic = 'force-dynamic';

function formatLongDate(yyyyMmDd) {
  // Render "Thursday, May 21, 2026" from a YYYY-MM-DD string. We
  // construct as midday UTC to avoid timezone edge cases shifting
  // the displayed weekday.
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function firstSentence(reflection) {
  if (!reflection || typeof reflection !== 'string') return null;
  // Trim leading whitespace and strip the *...* markers used for
  // bold-italic so the preview reads cleanly.
  const cleaned = reflection.trim().replace(/\*([^*]+)\*/g, '$1');
  const m = cleaned.match(/^[^.!?]+[.!?]/);
  if (m) {
    let s = m[0].trim();
    if (s.length > 200) s = s.slice(0, 197).trimEnd() + '…';
    return s;
  }
  // No sentence-terminator in the first chunk — take a hard cap.
  if (cleaned.length > 200) return cleaned.slice(0, 197).trimEnd() + '…';
  return cleaned;
}

export default async function DaysIndexPage() {
  if (!isAuthConfigured()) {
    redirect('/login');
  }
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  // Readers and owners both allowed. No role check on archive access.

  const supa = getServiceClient();
  const { data: days, error } = await supa
    .from('devotional_days')
    .select(
      'date, lens, reflection, reflection_note, theme_id, themes:themes(name)',
    )
    .order('date', { ascending: false })
    .limit(60);

  return (
    <main className="manna-shell manna-days-shell">
      <header className="manna-header manna-todo-header">
        <Link href="/" className="manna-wordmark manna-todo-wordmark">
          Manna
        </Link>
        <div className="manna-todo-title-line">Past devotionals</div>
      </header>

      {error ? (
        <div className="manna-action-error" style={{ marginBottom: '1rem' }}>
          Couldn&rsquo;t load the archive: {error.message}
        </div>
      ) : null}

      {!error && (!days || days.length === 0) ? (
        <p className="manna-todo-empty">
          No past devotionals yet. They&rsquo;ll appear here as the mornings accumulate.
        </p>
      ) : null}

      {!error && days && days.length > 0 ? (
        <ul className="manna-days-list">
          {days.map((d) => {
            const themeName = d.themes?.name || '';
            const preview = firstSentence(d.reflection);
            const hasNote = user.role === 'owner' && d.reflection_note;
            return (
              <li key={d.date} className="manna-days-row">
                <Link href={`/days/${d.date}`} className="manna-days-link">
                  <div className="manna-days-row-top">
                    <span className="manna-days-date">{formatLongDate(d.date)}</span>
                    <span className="manna-days-meta">
                      {themeName}
                      {d.lens ? ` · ${d.lens}` : ''}
                    </span>
                  </div>
                  {preview ? (
                    <div className="manna-days-preview">{preview}</div>
                  ) : null}
                  {hasNote ? (
                    <div className="manna-days-note-indicator">
                      Your thoughts saved
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer className="manna-footer">
        <Link href="/" className="manna-todo-home-link">
          ← Back to today
        </Link>
      </footer>
    </main>
  );
}
