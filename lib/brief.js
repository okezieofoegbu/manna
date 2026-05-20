// lib/brief.js
//
// The orchestration layer for v0.1.4.
//
// Daily flow (lazy, on first owner page-load of the day):
//   1. Check if a brief already exists for today → if yes, return it.
//   2. Refresh the Zoho access token.
//   3. Resolve account + folder IDs (cached in sync_state.account_id
//      across days).
//   4. Pull messages since last_pulled_at across the target folders.
//   5. Run the noise filter (lib/email-filter.js).
//   6. Compute system flags:
//      - investment_no_response_breach (re-emit-once across days)
//      - regulator_staff_communication
//   7. Build the JSON batch and call Anthropic via the synthesis prompt.
//   8. Parse the JSON array response, validate shape, write rows to
//      brief_items.
//   9. Update sync_state.last_pulled_at and last_brief_date.
//
// CANONICAL DESIGN RULE: this orchestrator does NOT touch anything in
// the devotional pipeline. Different lib files, different Anthropic
// call, different prompt. Never combine.

import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from './supabase.js';
import {
  isZohoConfigured,
  refreshAccessTokenInternal,
  getAccount,
  getFolders,
  resolveTargetFolderIds,
  listMessagesSince,
  getThread,
  extractEmailAddress,
  isTransworldSender,
  isRegulatorSender,
  isAddressedToInvestment,
} from './zoho.js';
import { filterBatch } from './email-filter.js';
import { getSyncState, updateSyncState, ZOHO_TRANSWORLD_SOURCE } from './sync-state.js';
import { SYNTHESIS_PROMPT_VERSION, buildSynthesisPrompt } from './synthesis-prompt.js';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Self-contained — kept independent of lib/dates.js so this module has
// zero coupling to date helpers used by the devotional engine.
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

export async function getOrGenerateTodaysBrief() {
  if (!isZohoConfigured()) {
    return {
      status: 'not_configured',
      reason: 'ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN missing',
      items: [],
    };
  }

  const today = todayOwnerLocal(); // 'YYYY-MM-DD' in owner's TZ
  const existing = await readBriefForDate(today);
  if (existing && existing.length > 0) {
    return { status: 'existing', date: today, items: existing };
  }

  // No brief yet for today — generate.
  const result = await generateBriefForDate(today);
  return { status: 'generated', date: today, items: result.items, diagnostics: result.diagnostics };
}

export async function readBriefForDate(date) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('brief_items')
    .select(
      'id, date, source_email_id, source_link, sender, subject, category, synthesis, suggested_owner, time_estimate, state, system_flag, created_at',
    )
    .eq('date', date)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─── generation ───────────────────────────────────────────────────

async function generateBriefForDate(date) {
  const diagnostics = { steps: [] };
  const step = (label, info) => diagnostics.steps.push({ label, info });

  // 1. Token
  const accessToken = await refreshAccessTokenInternal();
  step('token_refresh', 'ok');

  // 2. sync_state — get accountId if cached, else discover
  let syncState = await getSyncState(ZOHO_TRANSWORLD_SOURCE);
  let accountId = syncState?.account_id;
  if (!accountId) {
    const account = await getAccount(accessToken);
    accountId = account.accountId;
    await updateSyncState(ZOHO_TRANSWORLD_SOURCE, { account_id: accountId });
    syncState = await getSyncState(ZOHO_TRANSWORLD_SOURCE);
    step('account_discovered', { accountId });
  }

  // 3. Folders
  const folders = await getFolders(accessToken, accountId);
  const { folderIds, notes } = resolveTargetFolderIds(folders);
  step('folders', { resolved: folderIds, notes });

  // 4. Pull
  const sinceMs = syncState?.last_pulled_at
    ? new Date(syncState.last_pulled_at).getTime()
    : Date.now() - 24 * 60 * 60 * 1000;
  const pulledAt = new Date();

  const pulled = [];
  for (const f of folderIds) {
    const msgs = await listMessagesSince(
      accessToken,
      accountId,
      f.folderId,
      sinceMs,
    );
    for (const m of msgs) {
      pulled.push({ ...m, _folderId: f.folderId, _folderName: f.folderName });
    }
  }
  step('pulled', { count: pulled.length, sinceMs });

  // 5. Filter
  const { kept, dropped } = filterBatch(pulled);
  step('filtered', { kept: kept.length, dropped: dropped.length });

  // 6. System flags
  const flagged = await applySystemFlags(accessToken, accountId, kept, folderIds);
  step('system_flagged', {
    investment_breach: flagged.filter((m) => m._flag === 'investment_no_response_breach').length,
    regulator: flagged.filter((m) => m._flag === 'regulator_staff_communication').length,
  });

  // 7. Synthesize
  const items = await runSynthesis(flagged);
  step('synthesis', { items_returned: items.length });

  // 8. Write
  await writeBriefItems(date, items, flagged);
  step('written', { count: items.length });

  // 9. Update sync_state
  await updateSyncState(ZOHO_TRANSWORLD_SOURCE, {
    last_pulled_at: pulledAt.toISOString(),
    last_brief_date: date,
  });

  step('done', { prompt_version: SYNTHESIS_PROMPT_VERSION });

  return { items: await readBriefForDate(date), diagnostics };
}

// ─── system flags ─────────────────────────────────────────────────

async function applySystemFlags(accessToken, accountId, messages, folderIds) {
  const out = [];
  for (const m of messages) {
    let flag = null;

    // Regulator check — sender domain in the regulator list
    const fromAddr = extractEmailAddress(m.fromAddress || m.sender || m.from);
    if (isRegulatorSender(fromAddr) && !isBroadcastCircular(m)) {
      flag = 'regulator_staff_communication';
    }

    out.push({ ...m, _flag: flag });
  }

  // investment_no_response_breach — scan the last 7 days of messages
  // addressed to investment@, check thread for any Transworld reply.
  // We do this in addition to the normal pull; some breaching emails
  // arrived before last_pulled_at.
  const breachItems = await scanInvestmentBreach(accessToken, accountId, folderIds);

  // Dedupe — if a breach item is already in `out`, just tag its flag;
  // otherwise append. Re-emit-once is enforced at write time against
  // the brief_items table (see writeBriefItems).
  const seenIds = new Set(out.map((m) => m.messageId));
  for (const b of breachItems) {
    if (seenIds.has(b.messageId)) {
      const existing = out.find((m) => m.messageId === b.messageId);
      existing._flag = 'investment_no_response_breach';
      existing._ageHours = b._ageHours;
    } else {
      out.push({ ...b, _flag: 'investment_no_response_breach' });
    }
  }

  return out;
}

function isBroadcastCircular(m) {
  const subj = (m.subject || '').toLowerCase();
  if (subj.startsWith('circular')) return true;
  if (subj.startsWith('bulletin')) return true;
  const from = extractEmailAddress(m.fromAddress || m.sender || m.from);
  if (from.startsWith('no-reply@') || from.startsWith('noreply@')) return true;
  return false;
}

async function scanInvestmentBreach(accessToken, accountId, folderIds) {
  const lookbackMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const inboxFolder = folderIds.find((f) => /inbox/i.test(f.folderName));
  if (!inboxFolder) return [];

  const recent = await listMessagesSince(
    accessToken,
    accountId,
    inboxFolder.folderId,
    lookbackMs,
    10,
  );

  const candidates = recent.filter((m) => {
    const toField = m.toAddress || m.to || '';
    const ccField = m.ccAddress || m.cc || '';
    return (
      (isAddressedToInvestment(toField) || isAddressedToInvestment(ccField)) &&
      !isTransworldSender(m.fromAddress || m.sender || m.from)
    );
  });

  const out = [];
  for (const m of candidates) {
    const ageMs = Date.now() - Number(m.receivedTime ?? m.sentDateInGMT ?? 0);
    if (!ageMs || ageMs <= 0) continue;
    const ageHours = ageMs / (60 * 60 * 1000);
    const threshold = breachThresholdHours(m);
    if (ageHours < threshold) continue;

    // Has any Transworld staff member replied in the thread?
    let hasReply = false;
    try {
      const thread = await getThread(
        accessToken,
        accountId,
        m._folderId || inboxFolder.folderId,
        m.messageId,
      );
      for (const tm of thread) {
        if (tm.messageId === m.messageId) continue;
        if (isTransworldSender(tm.fromAddress || tm.sender || tm.from)) {
          hasReply = true;
          break;
        }
      }
    } catch (e) {
      // Thread API failed for this message — be conservative and
      // assume no reply, but log so we can iterate on the API call.
      out.push({ ...m, _threadError: String(e).slice(0, 200) });
      out[out.length - 1]._ageHours = Math.round(ageHours);
      continue;
    }
    if (!hasReply) {
      out.push({ ...m, _ageHours: Math.round(ageHours) });
    }
  }
  return out;
}

function breachThresholdHours(m) {
  const arrivedAt = new Date(Number(m.receivedTime ?? m.sentDateInGMT ?? 0));
  // Day-of-week in owner's local TZ. Friday = 5 (Sun=0).
  // Use locale parts for the owner's TZ.
  const tz = process.env.MANNA_TIMEZONE || 'Africa/Lagos';
  const dayName = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: tz,
  }).format(arrivedAt);
  if (dayName === 'Fri') return 72;
  return 24;
}

// ─── synthesis ────────────────────────────────────────────────────

async function runSynthesis(flaggedMessages) {
  if (flaggedMessages.length === 0) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const batch = flaggedMessages.map((m) => ({
    source_email_id: m.messageId,
    sender_name: m.fromName || m.senderName || '',
    sender_address: extractEmailAddress(m.fromAddress || m.sender || m.from),
    to: m.toAddress || m.to || '',
    cc: m.ccAddress || m.cc || '',
    subject: m.subject || '',
    received_at: new Date(Number(m.receivedTime ?? m.sentDateInGMT ?? 0)).toISOString(),
    body_excerpt: truncateBody(m.summary || m.snippet || m.shortContent || ''),
    system_flag: m._flag || null,
    age_hours: m._ageHours ?? null,
  }));

  const prompt = buildSynthesisPrompt(JSON.stringify(batch, null, 2));

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

  // The model sometimes wraps the JSON array in prose reasoning despite
  // being told not to. Extract the array — try fence-stripping first,
  // then bracket-balanced extraction as a fallback. v0.1.4.1 fix.
  const parsed = extractJsonArray(text);
  if (parsed === null) {
    throw new Error(
      `Synthesis output contained no JSON array. First 600 chars: ${text.slice(0, 600)}`,
    );
  }
  return parsed;
}

// Extract a JSON array from a string that may have prose around it.
// Returns the parsed array, or null if no valid array was found.
function extractJsonArray(text) {
  // Attempt 1: strip markdown fences, parse the whole thing.
  const fenced = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
  try {
    const v = JSON.parse(fenced);
    if (Array.isArray(v)) return v;
  } catch {
    // fall through
  }

  // Attempt 2: walk the text from the first '[' to its matching ']',
  // counting brackets while respecting string literals (so brackets
  // inside strings don't confuse us). If parsing the slice succeeds
  // and yields an array, use it.
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
          // fall through to return null
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

async function writeBriefItems(date, items, flaggedMessages) {
  if (items.length === 0) return;
  const supabase = getServiceClient();

  // Build a quick lookup from source_email_id → flagged message,
  // so we can carry the system_flag onto the row and skip re-emits.
  const flagIndex = new Map();
  for (const m of flaggedMessages) {
    flagIndex.set(m.messageId, m);
  }

  // Re-emit-once enforcement: drop any item whose source_email_id
  // already has a row with the same system_flag in brief_items.
  const breachIds = items
    .filter((it) => flagIndex.get(it.source_email_id)?._flag === 'investment_no_response_breach')
    .map((it) => it.source_email_id);

  let alreadyEmittedBreaches = new Set();
  if (breachIds.length > 0) {
    const { data: existing } = await supabase
      .from('brief_items')
      .select('source_email_id, system_flag')
      .in('source_email_id', breachIds)
      .eq('system_flag', 'investment_no_response_breach');
    for (const r of existing || []) {
      alreadyEmittedBreaches.add(r.source_email_id);
    }
  }

  const rows = items
    .filter((it) => {
      const flagged = flagIndex.get(it.source_email_id);
      if (
        flagged?._flag === 'investment_no_response_breach' &&
        alreadyEmittedBreaches.has(it.source_email_id)
      ) {
        return false;
      }
      return true;
    })
    .map((it) => {
      const flagged = flagIndex.get(it.source_email_id);
      const sourceLink = buildZohoMessageLink(flagged);
      return {
        date,
        source_email_id: it.source_email_id,
        source_link: sourceLink,
        sender: it.sender || '',
        subject: it.subject || '',
        category: it.category,
        synthesis: it.synthesis,
        suggested_owner: it.category === 'delegate' ? it.suggested_owner || null : null,
        time_estimate: it.category === 'schedule' ? it.time_estimate || null : null,
        state: 'new',
        system_flag: flagged?._flag || null,
      };
    });

  if (rows.length === 0) return;
  const { error } = await supabase.from('brief_items').insert(rows);
  if (error) throw error;
}

function buildZohoMessageLink(flagged) {
  // Zoho Mail webmail URL format (best-effort — opens the thread in
  // the user's logged-in webmail session).
  if (!flagged) return null;
  const folderId = flagged._folderId || '';
  const messageId = flagged.messageId || '';
  if (!folderId || !messageId) return null;
  return `https://mail.zoho.com/zm/#mail/folder/${folderId}/${messageId}`;
}
