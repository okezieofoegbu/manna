import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isConfigured } from '@/lib/supabase';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import {
  getActiveTheme,
  getThemePassages,
  getThemeMorningCount,
} from '@/lib/themes';
import { getTodaysDevotional } from '@/lib/devotional';
import { ownerTodayLong } from '@/lib/dates';
import { readTodaysBriefForOwner, groupByCategory } from '@/lib/brief-reads';
import Fums from '@/components/Fums';

// Manna's single page.
//
// v0.1.2: the devotional engine. On the first load of a new day the page
// asks the server-side /api/devotional route to prepare today's devotional —
// passage-of-the-day, Bible text, and the reflection — then renders it above
// the (still placeholder) brief.
//
// v0.1.2.1: the Reflection component now renders *...* segments as
// bold-italic. The prompt has not been changed; if a future day's reflection
// contains no asterisks, this renders identically to plain text.
//
// v0.1.3: the page is gated by auth. No session → /login. The brief
// section renders only for the 'owner' role; 'reader' sees the devotional
// only — no divider, no placeholder, no hint that anything is being withheld.
//
// v0.1.4.2: the brief is live. The owner-only section calls /api/brief to
// ensure today's brief exists (lazy generate, mirrors the devotional's
// pattern), reads brief_items via service-role, and renders items grouped
// by category. Sender display is now cleaned up; empty state is a quiet
// "nothing this morning" note rather than the prior v0.1.4 placeholder.

export const dynamic = 'force-dynamic';

// Ask our own server-side API route to ensure today's devotional exists.
// Generation runs entirely server-side; the Anthropic and Bible keys never
// reach the browser. Returns { devotional, error }.
async function ensureTodaysDevotionalViaApi() {
  const h = await headers();
  const host = h.get('host');
  if (!host) return { devotional: null, error: 'No host header on request.' };
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = isLocal ? 'http' : 'https';
  try {
    const res = await fetch(`${proto}://${host}/api/devotional`, {
      method: 'POST',
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return { devotional: null, error: json.error || `HTTP ${res.status}` };
    }
    return { devotional: json.devotional || null, error: null };
  } catch (e) {
    return { devotional: null, error: e.message };
  }
}

// v0.1.4.2 — mirror of ensureTodaysDevotionalViaApi for the brief side.
// Calls /api/brief on the owner's behalf to trigger lazy generation if
// today's brief is not yet in the DB. Cookies forwarded so the route's
// auth check passes. Errors are returned, never thrown — the page reads
// the DB after and renders whatever's there.
async function ensureTodaysBriefViaApi() {
  const h = await headers();
  const host = h.get('host');
  const cookie = h.get('cookie') || '';
  if (!host) return { error: 'No host header on request.' };
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = isLocal ? 'http' : 'https';
  try {
    const res = await fetch(`${proto}://${host}/api/brief`, {
      method: 'POST',
      cache: 'no-store',
      headers: { cookie },
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { error: json.error || `HTTP ${res.status}` };
    }
    return { error: null };
  } catch (e) {
    return { error: e.message };
  }
}

// Render the stored passage text. API.Bible text mode returns verse numbers
// in brackets, e.g. "[1] ... [2] ..." — shown here as small superscripts.
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

// v0.1.2.1 — render *...* segments as bold-italic. The devotional engine
// has been emitting these around short Scripture quotations inside the
// reflection; the prompt does not yet ask for this, so this renderer just
// handles it gracefully when it appears. If a paragraph contains no
// asterisks, this renders identically to plain text.
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

function Shell({ children }) {
  return (
    <main className="manna-shell">
      <header className="manna-header">
        <div className="manna-wordmark">Manna</div>
        <div className="manna-tagline">Word before work.</div>
      </header>
      {children}
    </main>
  );
}

// ─── v0.1.4.2 — brief render helpers ────────────────────────────────

// Sender field cleanup. Zoho sometimes returns the sender as " <email@x>"
// (leading space, empty display name). Strip cleanly and fall back to the
// bare email when no name is present.
function formatSender(s) {
  if (!s) return 'unknown sender';
  const trimmed = String(s).trim();
  const m = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (m) {
    const name = m[1].trim();
    const email = m[2].trim();
    return name || email;
  }
  return trimmed;
}

// Format the system_flag as a small tag. For breach items, try to extract
// the age (hours) from the synthesis line, which the prompt requires.
function formatFlagTag(item) {
  if (item.system_flag === 'investment_no_response_breach') {
    const m = item.synthesis && item.synthesis.match(/(\d+)\s*hours?/i);
    if (m) return `${m[1]}h unanswered`;
    return 'unanswered';
  }
  if (item.system_flag === 'regulator_staff_communication') {
    return 'regulator';
  }
  return null;
}

const CATEGORY_LABELS = {
  urgent: 'Urgent',
  schedule: 'To schedule',
  delegate: 'To delegate',
  fyi: 'For your information',
};

function BriefItem({ item }) {
  const senderClean = formatSender(item.sender);
  const flagTag = formatFlagTag(item);
  return (
    <div className="manna-brief-item">
      {flagTag ? <span className="manna-brief-flag">{flagTag}</span> : null}
      <div className="manna-brief-synthesis">{item.synthesis}</div>
      <div className="manna-brief-meta">
        {item.source_link ? (
          <a
            href={item.source_link}
            target="_blank"
            rel="noopener noreferrer"
            className="manna-brief-subject"
          >
            {item.subject}
          </a>
        ) : (
          <span className="manna-brief-subject">{item.subject}</span>
        )}
        <span className="manna-brief-dot"> · </span>
        <span className="manna-brief-sender">{senderClean}</span>
        {item.category === 'schedule' && item.time_estimate ? (
          <>
            <span className="manna-brief-dot"> · </span>
            <span className="manna-brief-time">{item.time_estimate} min</span>
          </>
        ) : null}
        {item.category === 'delegate' && item.suggested_owner ? (
          <>
            <span className="manna-brief-dot"> · </span>
            <span className="manna-brief-owner">{item.suggested_owner}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BriefCategory({ category, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="manna-brief-category" data-category={category}>
      <div className="manna-brief-cat-label">{CATEGORY_LABELS[category]}</div>
      {items.map((item) => (
        <BriefItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function BriefSection({ groups, hadError }) {
  const total = groups.reduce((sum, [, items]) => sum + items.length, 0);
  if (total === 0) {
    return (
      <section className="manna-brief manna-brief-empty">
        <p className="manna-brief-empty-note">
          {hadError
            ? 'The inbox could not be reached this morning.'
            : 'Nothing in the inbox this morning that needs you.'}
        </p>
      </section>
    );
  }
  return (
    <section className="manna-brief manna-brief-populated">
      <div className="manna-brief-label">The brief</div>
      {groups.map(([cat, items]) => (
        <BriefCategory key={cat} category={cat} items={items} />
      ))}
    </section>
  );
}

// ─── page ───────────────────────────────────────────────────────────

export default async function MannaPage() {
  // Not configured — show a calm setup message rather than crashing.
  if (!isConfigured) {
    return (
      <Shell>
        <section className="manna-setup">
          <h2>Manna is not configured yet</h2>
          <p className="manna-note">
            Copy <code>.env.local.example</code> to <code>.env.local</code> and
            fill in your Supabase URL and anon key, then restart the dev
            server. See <code>INSTRUCTIONS.md</code>.
          </p>
        </section>
      </Shell>
    );
  }

  // v0.1.3 — auth not configured: friendly setup message.
  if (!isAuthConfigured()) {
    return (
      <Shell>
        <section className="manna-setup">
          <h2>Auth is not configured yet</h2>
          <p className="manna-note">
            <code>SESSION_SECRET</code> is not set. Generate one and add it to{' '}
            <code>.env.local</code> (and to Vercel for production). See the
            v0.1.3 README.
          </p>
        </section>
      </Shell>
    );
  }

  // v0.1.3 — auth gate. No session → /login.
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Load the theme library.
  let theme = null;
  let passages = [];
  let loadError = null;
  try {
    theme = await getActiveTheme();
    if (theme) passages = await getThemePassages(theme.id);
  } catch (e) {
    loadError = e.message;
  }

  if (loadError) {
    return (
      <Shell>
        <section className="manna-setup">
          <h2>Could not load the theme</h2>
          <p className="manna-note">{loadError}</p>
        </section>
      </Shell>
    );
  }

  if (!theme) {
    return (
      <Shell>
        <section className="manna-setup">
          <h2>No active theme found</h2>
          <p className="manna-note">
            The schema is applied but no theme is seeded and active. Run the
            seed SQL in <code>DB_SCHEMA.md</code>.
          </p>
        </section>
      </Shell>
    );
  }

  // Ensure today's devotional exists (generates on the first load of a new
  // day), then read it. Both steps are tolerant — if the engine is not yet
  // fully configured, the page still renders the theme calmly.
  const { error: genError } = await ensureTodaysDevotionalViaApi();
  let devotional = null;
  let morningCount = 0;
  try {
    devotional = await getTodaysDevotional();
    morningCount = await getThemeMorningCount(theme.id);
  } catch {
    // Leave devotional null — handled gracefully below.
  }

  // v0.1.4.2 — ensure today's brief exists, then read it. Owner-only;
  // for the reader role we skip both steps so the brief data never reaches
  // the reader's browser. The devotional and brief are entirely separate
  // operations — see PITFALLS §3.
  let briefGroups = groupByCategory([]);
  let briefError = null;
  if (user.role === 'owner') {
    const briefGen = await ensureTodaysBriefViaApi();
    briefError = briefGen.error;
    try {
      const items = await readTodaysBriefForOwner(user);
      briefGroups = groupByCategory(items);
    } catch (e) {
      briefError = briefError || e.message;
    }
  }

  const passageById = (id) => passages.find((p) => p.id === id) || null;
  const todaysPassage = devotional ? passageById(devotional.passage_id) : null;

  // The header theme line. Quiet — date and theme only, never the lens.
  const themeLine =
    devotional && morningCount > 0
      ? `${theme.name} — morning ${morningCount}`
      : theme.name;

  return (
    <main className="manna-shell">
      <header className="manna-header">
        <div className="manna-wordmark">Manna</div>
        <div className="manna-tagline">Word before work.</div>
        <div className="manna-meta">
          <span className="manna-date">{ownerTodayLong()}</span>
          <span className="manna-dot">·</span>
          <span className="manna-theme">{themeLine}</span>
        </div>
      </header>

      {/* The devotional — above the fold, room to breathe. */}
      <section className="manna-devotional">
        {devotional ? (
          <>
            <div className="manna-passage">
              <div className="manna-passage-ref">
                {todaysPassage ? todaysPassage.reference : ''}
              </div>
              <PassageText text={devotional.passage_text} />
              <Fums snippet={devotional.passage_fums} />
            </div>
            <Reflection text={devotional.reflection} />
            <FurtherReading
              links={todaysPassage ? todaysPassage.further_reading : []}
            />
          </>
        ) : (
          <div className="manna-setup manna-devotional-pending">
            <h2>This morning&rsquo;s devotional is not ready</h2>
            <p className="manna-note">
              The theme <strong>{theme.name}</strong> is set, with{' '}
              {passages.length} anchor passages. The devotional engine could
              not prepare today&rsquo;s reading
              {genError ? <> — {genError}</> : null}. Check that{' '}
              <code>ANTHROPIC_API_KEY</code>, <code>BIBLE_API_KEY</code>, and{' '}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> are set in{' '}
              <code>.env.local</code>, then reload. See{' '}
              <code>INSTRUCTIONS.md</code>.
            </p>
            <ul className="manna-passage-list">
              {passages.map((p) => (
                <li key={p.id}>{p.reference}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* v0.1.3 — the brief is owner-only. Reader sees the devotional alone. */}
      {user.role === 'owner' && (
        <>
          <div className="manna-divider" />
          <BriefSection groups={briefGroups} hadError={Boolean(briefError)} />
        </>
      )}

      <footer className="manna-footer">
        <span>Manna · Word before work.</span>
        {' · '}
        <form action="/api/auth/logout" method="POST" className="manna-logout-form">
          <button type="submit" className="manna-logout">Sign out</button>
        </form>
      </footer>
    </main>
  );
}
