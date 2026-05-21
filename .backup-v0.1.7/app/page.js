import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isConfigured } from '@/lib/supabase';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import {
  getActiveTheme,
  getThemePassages,
  getThemeMorningCount,
} from '@/lib/themes';
import { getTodaysDevotional } from '@/lib/devotional';
import { ownerTodayLong } from '@/lib/dates';
import {
  readTodaysBriefForOwner,
  readTodaysVitalisBriefForOwner,
  groupByCategory,
} from '@/lib/brief-reads';
import Fums from '@/components/Fums';
import BriefItemActions from '@/components/BriefItemActions';

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
// by category.
//
// v0.1.5: each brief item carries Done / Delegate / Schedule action
// controls via a small client island (components/BriefItemActions).
//
// v0.1.5.1 — simplification round, based on real use:
//   - Delegate UI is removed. The action route + recipients table remain
//     for possible future use. Delegation now happens out-of-band (in
//     Zoho/by phone/in person), and the owner records what they did via
//     the optional note on Done.
//   - body_excerpt is rendered between the synthesis and the meta line.
//     This makes the brief self-contained for triage; clicking through
//     to Zoho is rarely needed.
//   - The subject is no longer styled as a link. Zoho's webmail does
//     not support deep-linking to specific emails, so the v0.1.4.2
//     subject-link was misleading. A small "Open in Zoho →" affordance
//     at the end of the meta line opens the user's Zoho inbox; the
//     user searches by subject from there.
//
// v0.1.6 — second source. The Vitalis Healthcare Services Gmail inbox
// is now a second brief section, rendered below the Transworld brief
// under its own divider and "THE VITALIS BRIEF" label. Per PITFALLS §3
// the two pipelines run completely independently — different prompts,
// different Anthropic calls, different filters, different flag sets.
// They share only the brief_items table (with source column) and the
// page-render code below.
//
// Render details for the Vitalis section:
//   - Same BriefItem / BriefCategory / BriefSection components, with a
//     `sourceLabel` and `emptyMessage` parameterized per section.
//   - BriefItem inspects item.source to pick "Open in Gmail →" (which
//     DOES deep-link, unlike Zoho) vs "Open in Zoho →".
//   - formatFlagTag now recognizes the five Vitalis flag types.
//   - Action buttons (Done / Schedule) work identically for Vitalis
//     items because the actions table is source-agnostic.

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
// v0.1.6 — this single call triggers BOTH Transworld and Vitalis brief
// generations server-side (the /api/brief route runs them in parallel
// via Promise.allSettled). One page-load, two briefs.
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

// ─── brief render helpers ───────────────────────────────────────────

// Sender field cleanup. Zoho and Gmail both return the sender as either
// "Display Name <email@x>" or a bare email; this normalizes either case.
function formatSender(s) {
  if (!s) return 'unknown sender';
  const trimmed = String(s).trim();
  const m = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, '');
    const email = m[2].trim();
    return name || email;
  }
  return trimmed;
}

// Format the system_flag as a small tag. v0.1.6 — five new Vitalis
// flags join the two Transworld flags.
function formatFlagTag(item) {
  switch (item.system_flag) {
    // Transworld flags
    case 'investment_no_response_breach': {
      const m = item.synthesis && item.synthesis.match(/(\d+)\s*hours?/i);
      return m ? `${m[1]}h unanswered` : 'unanswered';
    }
    case 'regulator_staff_communication':
      return 'regulator';
    // Vitalis flags
    case 'legal_compliance_action':
      return 'legal';
    case 'state_case_management':
      return 'state';
    case 'ltc_carrier_communication':
      return 'LTC carrier';
    case 'new_prospect_intake':
      return 'new prospect';
    case 'priority_sender':
      return 'priority';
    default:
      return null;
  }
}

// v0.1.6 — pick the right "Open in X" affordance based on the item's
// source. Gmail supports per-thread deep-linking (unlike Zoho), so the
// title attribute is more accurate for Vitalis items.
function openInLabel(item) {
  if (item.source === 'gmail_vitalis') return 'Open in Gmail →';
  return 'Open in Zoho →';
}
function openInTitle(item) {
  if (item.source === 'gmail_vitalis') {
    return 'Opens this email thread in Gmail in a new tab.';
  }
  return 'Opens your Zoho inbox in a new tab. Search by subject to find this email.';
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
  const stateAttr = item.state || 'new';
  return (
    <div className="manna-brief-item" data-state={stateAttr}>
      {flagTag ? <span className="manna-brief-flag">{flagTag}</span> : null}
      <div className="manna-brief-synthesis">{item.synthesis}</div>
      {/* v0.1.5.1 — raw body excerpt between synthesis and meta. CSS
          line-clamps to a few lines so long emails don't dominate. */}
      {item.body_excerpt ? (
        <div className="manna-brief-excerpt">{item.body_excerpt}</div>
      ) : null}
      <div className="manna-brief-meta">
        <span className="manna-brief-subject">{item.subject}</span>
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
        {item.source_link ? (
          <>
            <span className="manna-brief-dot"> · </span>
            <a
              href={item.source_link}
              target="_blank"
              rel="noopener noreferrer"
              className="manna-brief-open-zoho"
              title={openInTitle(item)}
            >
              {openInLabel(item)}
            </a>
          </>
        ) : null}
      </div>
      {/* v0.1.5.1 — Done + Schedule only. Delegate dropped.
          v0.1.6 — works identically for Vitalis items; actions table
          is source-agnostic. */}
      <BriefItemActions item={item} />
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

// v0.1.6 — `label` and `emptyMessage` parameterized so the same
// component renders both the Transworld brief and the Vitalis brief
// with appropriate framing.
function BriefSection({ groups, hadError, label, emptyMessage }) {
  const total = groups.reduce((sum, [, items]) => sum + items.length, 0);
  if (total === 0) {
    return (
      <section className="manna-brief manna-brief-empty">
        <p className="manna-brief-empty-note">
          {hadError
            ? 'The inbox could not be reached this morning.'
            : emptyMessage}
        </p>
      </section>
    );
  }
  return (
    <section className="manna-brief manna-brief-populated">
      <div className="manna-brief-label">{label}</div>
      {groups.map(([cat, items]) => (
        <BriefCategory key={cat} category={cat} items={items} />
      ))}
    </section>
  );
}

// ─── page ───────────────────────────────────────────────────────────

export default async function MannaPage() {
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

  const user = await getCurrentUser();
  if (!user) redirect('/login');

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

  const { error: genError } = await ensureTodaysDevotionalViaApi();
  let devotional = null;
  let morningCount = 0;
  try {
    devotional = await getTodaysDevotional();
    morningCount = await getThemeMorningCount(theme.id);
  } catch {
    // Leave devotional null — handled gracefully below.
  }

  // v0.1.5.1 / v0.1.6 — brief generation + read for both sources.
  // Owner-only; reader sees the devotional alone. A single /api/brief
  // call triggers both Transworld and Vitalis generations server-side.
  let transworldGroups = groupByCategory([]);
  let vitalisGroups = groupByCategory([]);
  let briefError = null;
  if (user.role === 'owner') {
    const briefGen = await ensureTodaysBriefViaApi();
    briefError = briefGen.error;
    try {
      const transworldItems = await readTodaysBriefForOwner(user);
      transworldGroups = groupByCategory(transworldItems);
    } catch (e) {
      briefError = briefError || e.message;
    }
    try {
      const vitalisItems = await readTodaysVitalisBriefForOwner(user);
      vitalisGroups = groupByCategory(vitalisItems);
    } catch (e) {
      briefError = briefError || e.message;
    }
  }

  const passageById = (id) => passages.find((p) => p.id === id) || null;
  const todaysPassage = devotional ? passageById(devotional.passage_id) : null;

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

      {user.role === 'owner' && (
        <>
          {/* Transworld brief */}
          <div className="manna-divider" />
          <BriefSection
            groups={transworldGroups}
            hadError={Boolean(briefError)}
            label="The brief"
            emptyMessage="Nothing in the inbox this morning that needs you."
          />

          {/* v0.1.6 — Vitalis brief, parallel section */}
          <div className="manna-divider" />
          <BriefSection
            groups={vitalisGroups}
            hadError={Boolean(briefError)}
            label="The Vitalis brief"
            emptyMessage="Nothing in the Vitalis inbox this morning that needs you."
          />

          {/* v0.1.7 — the bridge to the working list. Triage above,
              work below. Inside the owner conditional so readers
              never see this. */}
          <div className="manna-todo-bridge">
            <Link href="/todo" className="manna-todo-bridge-link">
              Continue to your ToDo →
            </Link>
          </div>
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
