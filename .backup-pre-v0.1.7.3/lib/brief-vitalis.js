// lib/brief-vitalis.js
//
// v0.1.6 — Orchestration layer for the Vitalis Gmail brief.
//
// Sibling to lib/brief.js (which orchestrates the Transworld Zoho
// brief). Same shape, different source. Per PITFALLS §3, the two
// orchestrators run separate Anthropic calls with separate prompts
// and share no context.
//
// Daily flow (lazy, on first owner page-load of the day):
//   1. Check if a Vitalis brief already exists for today → return it.
//   2. Refresh the Google access token (shared with Calendar).
//   3. Load the priority_senders allow-list from Supabase.
//   4. Pull Gmail messages since last_pulled_at.
//   5. Get per-message metadata (From / Subject / snippet / threadId).
//   6. Run the Vitalis noise filter.
//   7. Compute system flags (5 flags, with precedence).
//   8. Build the JSON batch and call Anthropic via the Vitalis prompt.
//   9. Parse the JSON array, write rows to brief_items with
//      source='gmail_vitalis' and prompt_version='vitalis-v1.0'.
//  10. Update sync_state.last_pulled_at and last_brief_date.

import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './supabase.js';
import {
  isGmailConfigured,
  refreshGmailAccessToken,
  listMessagesSinceVitalis,
  getMessagesMetadata,
  extractEmailAddress,
  senderDomain,
  senderLocalPart,
  isAutomationLocalPart,
  isInStateCaseDomain,
  isInLtcCarrierDomain,
  buildGmailThreadLink,
} from './gmail.js';
import { filterBatchVitalis } from './email-filter-vitalis.js';
import { getSyncState, updateSyncState } from './sync-state.js';
import {
  VITALIS_SYNTHESIS_PROMPT_VERSION,
  buildVitalisSynthesisPrompt,
} from './synthesis-prompt-vitalis.js';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
export const GMAIL_VITALIS_SOURCE = 'gmail_vitalis';

// Self-contained — identical to brief.js's todayOwnerLocal(). Kept
// inline to avoid cross-module coupling for a 12-line helper.
function todayOwnerLocal() {
  const tz = process.env.MANNA_TIMEZONE || 'Africa/Lagos';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

// ─── public entry point ───────────────────────────────────────────

export async function getOrGenerateTodaysVitalisBrief() {
  if (!isGmailConfigured()) {
    return {
      status: 'not_configured',
      reason:
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN missing. After v0.1.6, the refresh token must be re-minted with both calendar.events AND gmail.readonly scopes — see INSTRUCTIONS.md §6b.',
      items: [],
    };
  }

  const today = todayOwnerLocal();
  const existing = await readVitalisBriefForDate(today);
  if (existing && existing.length > 0) {
    return { status: 'existing', date: today, items: existing };
  }

  const result = await generateVitalisBriefForDate(today);
  return {
    status: 'generated',
    date: today,
    items: result.items,
    diagnostics: result.diagnostics,
  };
}

export async function readVitalisBriefForDate(date) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('brief_items')
    .select(
      'id, date, source, source_email_id, source_link, sender, subject, category, synthesis, body_excerpt, suggested_owner, time_estimate, state, system_flag, prompt_version, created_at',
    )
    .eq('date', date)
    .eq('source', GMAIL_VITALIS_SOURCE)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─── priority sender allow-list ───────────────────────────────────

async function loadPriorityAllowList() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('vitalis_priority_senders')
    .select('email, display_name, role_title, organization')
    .eq('is_active', true);
  if (error) throw error;
  const byEmail = new Map();
  for (const r of data || []) {
    if (r.email) byEmail.set(String(r.email).toLowerCase().trim(), r);
  }
  return byEmail;
}

// ─── generation ───────────────────────────────────────────────────

async function generateVitalisBriefForDate(date) {
  const diagnostics = { steps: [] };
  const step = (label, info) => diagnostics.steps.push({ label, info });

  // 1. Token (shared with Calendar; expects gmail.readonly scope)
  const accessToken = await refreshGmailAccessToken();
  step('token_refresh', 'ok');

  // 2. Priority sender allow-list
  const allowListMap = await loadPriorityAllowList();
  const allowListSet = new Set(allowListMap.keys());
  step('priority_allow_list', { count: allowListSet.size });

  // 3. Sync state — determine pull window
  const syncState = await getSyncState(GMAIL_VITALIS_SOURCE);
  const sinceMs = syncState?.last_pulled_at
    ? new Date(syncState.last_pulled_at).getTime()
    : Date.now() - 24 * 60 * 60 * 1000;
  const pulledAt = new Date();

  // 4. List message IDs since sinceMs
  const ids = await listMessagesSinceVitalis(accessToken, sinceMs);
  step('listed', { count: ids.length, sinceMs });

  if (ids.length === 0) {
    // No messages — still update sync_state so we don't re-scan
    // the same window tomorrow.
    await updateSyncState(GMAIL_VITALIS_SOURCE, {
      last_pulled_at: pulledAt.toISOString(),
      last_brief_date: date,
    });
    step('done', { reason: 'no_messages' });
    return { items: [], diagnostics };
  }

  // 5. Fetch metadata for each message (From / Subject / snippet / etc.)
  const messages = await getMessagesMetadata(
    accessToken,
    ids.map((x) => x.id),
  );
  step('metadata_fetched', { count: messages.length });

  // 6. Run the noise filter
  const { kept, dropped } = filterBatchVitalis(messages, allowListSet);
  step('filtered', { kept: kept.length, dropped: dropped.length });

  // 7. Apply system flags
  const flagged = applyVitalisSystemFlags(kept, allowListSet, allowListMap);
  step('system_flagged', countFlags(flagged));

  // 8. Synthesize
  const items = await runVitalisSynthesis(flagged);
  step('synthesis', { items_returned: items.length });

  // 9. Write
  await writeVitalisBriefItems(date, items, flagged);
  step('written', { count: items.length });

  // 10. Update sync_state
  await updateSyncState(GMAIL_VITALIS_SOURCE, {
    last_pulled_at: pulledAt.toISOString(),
    last_brief_date: date,
  });
  step('done', { prompt_version: VITALIS_SYNTHESIS_PROMPT_VERSION });

  return { items: await readVitalisBriefForDate(date), diagnostics };
}

function countFlags(flagged) {
  const out = {
    legal: 0,
    state: 0,
    ltc_carrier: 0,
    new_prospect_intake: 0,
    priority_sender: 0,
    none: 0,
  };
  for (const m of flagged) {
    switch (m._flag) {
      case 'legal_compliance_action':
        out.legal++;
        break;
      case 'state_case_management':
        out.state++;
        break;
      case 'ltc_carrier_communication':
        out.ltc_carrier++;
        break;
      case 'new_prospect_intake':
        out.new_prospect_intake++;
        break;
      case 'priority_sender':
        out.priority_sender++;
        break;
      default:
        out.none++;
        break;
    }
  }
  return out;
}

// ─── system flags ─────────────────────────────────────────────────

// Legal / compliance action keywords. Precise on purpose — false
// positives are worse than misses here (they crowd "URGENT" with the
// wrong things). Add to this list as new patterns surface.
const LEGAL_KEYWORDS_RE = new RegExp(
  [
    'wage garnishment',
    'garnishment order',
    '\\bsubpoena\\b',
    '\\bsummons\\b',
    'deposition notice',
    'audit notice',
    'audit findings',
    'fraud',
    '\\bdispute\\b',
    'stop payment',
    'chargeback',
    'court order',
    'cease and desist',
    'OIG (audit|investigation)',
    'CMS audit',
    'OCR investigation',
    'licensure complaint',
    'survey deficiency',
    'stolen check',
  ].join('|'),
  'i',
);

// New-prospect-intake body keywords. Conservative — we'd rather miss
// a prospect than flood URGENT with sales pitches and platform
// notifications. The orchestration drops referral-platform mail
// already; what's left is direct human inquiry text.
const PROSPECT_INTAKE_KEYWORDS_RE = new RegExp(
  [
    'looking for (home )?care',
    'need home (health|care)',
    'need care for (my|our)',
    'inquir(y|ing) about (your )?services',
    'new client',
    'intake request',
    'starting care',
    'private duty',
    'hours of care',
    'caregiver for (my|our)',
  ].join('|'),
  'i',
);

// State / county broadcast subjects we should NOT auto-urgent even
// though the sender domain is in STATE_CASE_DOMAINS. Newsletters
// and general announcements from these domains shouldn't trigger
// the flag.
const BROADCAST_SUBJECT_RE = new RegExp(
  [
    '\\bnewsletter\\b',
    '\\beconomic edge\\b',
    '\\bbulletin\\b',
    '\\bweekly digest\\b',
    '\\bsave the date\\b',
    '\\bregister (now|today)\\b',
  ].join('|'),
  'i',
);

function applyVitalisSystemFlags(messages, allowListSet, allowListMap) {
  return messages.map((m) => {
    const fromAddr = extractEmailAddress(m.from);
    const fromDomain = senderDomain(m.from);
    const fromLocal = senderLocalPart(fromAddr);
    const subject = m.subject || '';
    const snippet = m.snippet || '';
    const haystack = `${subject}\n${snippet}`;

    // Precedence: legal > state > ltc_carrier > new_prospect_intake
    //             > priority_sender

    let flag = null;
    let flagContext = null;

    if (LEGAL_KEYWORDS_RE.test(haystack)) {
      flag = 'legal_compliance_action';
    } else if (
      isInStateCaseDomain(fromDomain) &&
      !BROADCAST_SUBJECT_RE.test(subject)
    ) {
      flag = 'state_case_management';
    } else if (
      isInLtcCarrierDomain(fromDomain) &&
      !isAutomationLocalPart(fromLocal)
    ) {
      flag = 'ltc_carrier_communication';
    } else if (PROSPECT_INTAKE_KEYWORDS_RE.test(haystack)) {
      flag = 'new_prospect_intake';
    } else if (allowListSet.has(fromAddr)) {
      flag = 'priority_sender';
      const r = allowListMap.get(fromAddr);
      if (r) {
        flagContext = {
          display_name: r.display_name,
          role_title: r.role_title,
          organization: r.organization,
        };
      }
    }

    return { ...m, _flag: flag, _flagContext: flagContext };
  });
}

// ─── synthesis ────────────────────────────────────────────────────

async function runVitalisSynthesis(flaggedMessages) {
  if (flaggedMessages.length === 0) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const batch = flaggedMessages.map((m) => ({
    source_email_id: m.messageId,
    thread_id: m.threadId || null,
    sender: m.from || '',
    to: m.to || '',
    cc: m.cc || '',
    subject: m.subject || '',
    received_at:
      m.internalDateMs && Number.isFinite(m.internalDateMs)
        ? new Date(m.internalDateMs).toISOString()
        : null,
    body_excerpt: truncateBody(m.snippet || ''),
    system_flag: m._flag || null,
    flag_context: m._flagContext || null,
  }));

  const prompt = buildVitalisSynthesisPrompt(JSON.stringify(batch, null, 2));

  const resp = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  const parsed = extractJsonArray(text);
  if (parsed === null) {
    throw new Error(
      `Vitalis synthesis output contained no JSON array. First 600 chars: ${text.slice(
        0,
        600,
      )}`,
    );
  }
  return parsed;
}

// Bracket-balanced JSON array extractor — identical to brief.js's
// version. Kept inline rather than imported across the source boundary
// to keep the two pipelines independent (PITFALLS §3).
function extractJsonArray(text) {
  const fenced = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
  try {
    const v = JSON.parse(fenced);
    if (Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  const start = text.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const v = JSON.parse(candidate);
          if (Array.isArray(v)) return v;
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

function truncateBody(s, max = 800) {
  if (!s) return '';
  const str = String(s).replace(/\s+/g, ' ').trim();
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

// ─── write ────────────────────────────────────────────────────────

async function writeVitalisBriefItems(date, items, flaggedMessages) {
  if (items.length === 0) return;
  const supabase = getServiceClient();

  const flagIndex = new Map();
  for (const m of flaggedMessages) {
    flagIndex.set(m.messageId, m);
  }

  // Re-emit-once for the flags that should not re-surface day after
  // day for the same source_email_id. legal_compliance_action and
  // state_case_management items can drift across multiple days
  // (subpoenas, ongoing case threads); we want them once, not
  // repeatedly. Same approach as brief.js's breach handling.
  const reEmitOnceFlags = new Set([
    'legal_compliance_action',
    'state_case_management',
    'ltc_carrier_communication',
  ]);

  const candidateIds = items
    .map((it) => it.source_email_id)
    .filter(Boolean);

  let alreadyEmitted = new Map(); // source_email_id → Set<flag>
  if (candidateIds.length > 0) {
    const { data: existing } = await supabase
      .from('brief_items')
      .select('source_email_id, system_flag')
      .eq('source', GMAIL_VITALIS_SOURCE)
      .in('source_email_id', candidateIds);
    for (const r of existing || []) {
      if (!r.system_flag) continue;
      if (!alreadyEmitted.has(r.source_email_id)) {
        alreadyEmitted.set(r.source_email_id, new Set());
      }
      alreadyEmitted.get(r.source_email_id).add(r.system_flag);
    }
  }

  const rows = items
    .filter((it) => {
      const flagged = flagIndex.get(it.source_email_id);
      const flag = flagged?._flag;
      if (!flag) return true;
      if (!reEmitOnceFlags.has(flag)) return true;
      const seen = alreadyEmitted.get(it.source_email_id);
      if (seen && seen.has(flag)) return false;
      return true;
    })
    .map((it) => {
      const flagged = flagIndex.get(it.source_email_id);
      const sourceLink = buildGmailThreadLink(flagged?.threadId || null);
      const bodyExcerpt = flagged
        ? truncateBody(flagged.snippet || '')
        : '';
      return {
        date,
        source: GMAIL_VITALIS_SOURCE,
        source_email_id: it.source_email_id,
        source_link: sourceLink,
        sender: it.sender || '',
        subject: it.subject || '',
        category: it.category,
        synthesis: it.synthesis,
        body_excerpt: bodyExcerpt || null,
        suggested_owner:
          it.category === 'delegate' ? it.suggested_owner || null : null,
        time_estimate:
          it.category === 'schedule' ? it.time_estimate || null : null,
        state: 'new',
        system_flag: flagged?._flag || null,
        prompt_version: VITALIS_SYNTHESIS_PROMPT_VERSION,
      };
    });

  if (rows.length === 0) return;
  const { error } = await supabase.from('brief_items').insert(rows);
  if (error) throw error;
}
