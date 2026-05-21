import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import Fums from '@/components/Fums';
import ReflectionNote from '@/components/ReflectionNote';

// app/days/[date]/page.js
//
// v0.1.7.1 — view a past day's devotional. URL: /days/YYYY-MM-DD.
//
// Open to both owner and reader roles for the devotional content
// itself. The ReflectionNote is owner-only (gated below).
//
// Render helpers are duplicated from app/page.js. That's deliberate
// for v0.1.7.1: the home page render and the archive render currently
// produce the same output, and consolidating them into a shared
// component is a refactor we can do once but don't need to do now.
// If they ever diverge, that's a v0.1.7.2 cleanup.

export const dynamic = 'force-dynamic';

// ---- Render helpers (mirror of app/page.js) ----

function PassageText({ text }) {
  const parts = String(text).split(/(\[\d+\])/g);
  return (
    <p className="manna-passage-text">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m) {
          return (
            <sup key={i} className="manna-verse-num">
              {m[1]}
            </sup>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

function renderInline(text) {
  const segments = text.split(/(\*[^*]+\*)/g).filter((s) => s !== '');
  return segments.map((seg, i) => {
    const m = seg.match(/^\*([^*]+)\*$/);
    if (m) {
      return (
        <strong key={i}>
          <em>{m[1]}</em>
        </strong>
      );
    }
    return <span key={i}>{seg}</span>;
  });
}

function Reflection({ text }) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="manna-reflection">
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p)}</p>
      ))}
    </div>
  );
}

function FurtherReading({ links }) {
  if (!Array.isArray(links) || links.length === 0) return null;
  return (
    <div className="manna-further">
      <div className="manna-further-label">For deeper study</div>
      <ul>
        {links.map((link, i) => (
          <li key={i}>
            {link.url ? (
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.title}
              </a>
            ) : (
              <span>{link.title}</span>
            )}
            {link.author ? (
              <span className="manna-further-author"> — {link.author}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatLongDate(yyyyMmDd) {
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

function isValidDate(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime());
}

export default async function DayPage({ params }) {
  if (!isAuthConfigured()) {
    redirect('/login');
  }
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { date } = await params;
  if (!isValidDate(date)) {
    notFound();
  }

  const supa = getServiceClient();
  const { data: day, error } = await supa
    .from('devotional_days')
    .select(
      `
      date,
      lens,
      passage_text,
      passage_fums,
      reflection,
      reflection_note,
      passage_id,
      theme_id,
      themes:themes(name),
      theme_passages:theme_passages(reference, further_reading)
    `,
    )
    .eq('date', date)
    .maybeSingle();

  if (error) {
    console.error('[/days/[date]] load failed:', error);
  }
  if (!day) {
    notFound();
  }

  // Adjacent dates for prev/next navigation. We only navigate to dates
  // that exist in devotional_days (not the literal previous calendar
  // day, which may have no row).
  const [{ data: prevRow }, { data: nextRow }] = await Promise.all([
    supa
      .from('devotional_days')
      .select('date')
      .lt('date', date)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supa
      .from('devotional_days')
      .select('date')
      .gt('date', date)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const themeName = day.themes?.name || '';
  const passageRef = day.theme_passages?.reference || '';
  const furtherLinks = day.theme_passages?.further_reading || [];
  const themeLine = themeName
    ? day.lens
      ? `${themeName} · ${day.lens}`
      : themeName
    : '';

  return (
    <main className="manna-shell">
      <header className="manna-header">
        <Link href="/days" className="manna-wordmark manna-todo-wordmark">
          Manna
        </Link>
        <div className="manna-meta">
          <span>{formatLongDate(day.date)}</span>
          {themeLine ? (
            <>
              <span className="manna-dot">·</span>
              <span className="manna-theme">{themeLine}</span>
            </>
          ) : null}
        </div>
        <nav className="manna-days-nav">
          {prevRow?.date ? (
            <Link href={`/days/${prevRow.date}`} className="manna-days-nav-link">
              ← {formatLongDate(prevRow.date)}
            </Link>
          ) : (
            <span className="manna-days-nav-link manna-days-nav-disabled">
              ← Earlier
            </span>
          )}
          {nextRow?.date ? (
            <Link href={`/days/${nextRow.date}`} className="manna-days-nav-link">
              {formatLongDate(nextRow.date)} →
            </Link>
          ) : (
            <span className="manna-days-nav-link manna-days-nav-disabled">
              Later →
            </span>
          )}
        </nav>
      </header>

      <section className="manna-devotional">
        <div className="manna-passage">
          <div className="manna-passage-ref">{passageRef}</div>
          <PassageText text={day.passage_text} />
          <Fums snippet={day.passage_fums} />
        </div>
        <Reflection text={day.reflection} />
        <FurtherReading links={furtherLinks} />
        {user.role === 'owner' ? <ReflectionNote date={day.date} /> : null}
      </section>

      <footer className="manna-footer">
        <Link href="/days" className="manna-todo-home-link">
          ← All past devotionals
        </Link>
        <span style={{ margin: '0 0.5rem', opacity: 0.4 }}>·</span>
        <Link href="/" className="manna-todo-home-link">
          Today
        </Link>
      </footer>
    </main>
  );
}
