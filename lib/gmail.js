// lib/gmail.js
//
// v0.1.8.2 — RECOVERY. This file was inadvertently rewritten during
// v0.1.7 (commit 0b05515), losing twelve Vitalis-specific exports
// (refreshGmailAccessToken, listMessagesSinceVitalis, address parsing
// helpers, domain classification helpers, isVitalisInternalHuman, and
// the STATE_CASE_DOMAINS / LTC_CARRIER_DOMAINS / VITALIS_AUTOMATION_*
// constants). The regression was masked by Vercel build cache through
// v0.1.8 and surfaced on 2026-05-22 when a fresh build forced the
// Vitalis pipeline to re-resolve its imports. Restored from v0.1.6
// (f3a9ce4), with v0.1.7.2's buildGmailThreadLink fix preserved.
// See PITFALLS §17 — "preserve existing exports" is now a canonical
// rule.
//
// v0.1.6 — Gmail OAuth + Mail API client for the Vitalis brief.
//
// Mirrors lib/zoho.js in shape: a refresh-token exchange, then a thin
// wrapper around the API. Differs in OAuth provider (Google instead
// of Zoho).
//
// IMPORTANT — shared refresh token with Calendar.
// As of v0.1.6 the same Google account (okezie@vitalishealthcare.com)
// hosts both the Calendar OAuth (from v0.1.5) and the Gmail OAuth
// added here. The refresh token, when minted via OAuth Playground
// with BOTH scopes, covers both APIs:
//   - https://www.googleapis.com/auth/calendar.events
//   - https://www.googleapis.com/auth/gmail.readonly
// GOOGLE_REFRESH_TOKEN must be updated to the new value after the
// scope expansion. The old (calendar-only) token will 403 on Gmail.
//
// Vitalis-domain constants live here too: the named-human / state /
// LTC-carrier domain lists are imported by both the noise filter and
// the flag detector. Keeping them in one place mirrors how zoho.js
// owns TRANSWORLD_DOMAINS and REGULATOR_DOMAINS.
//
// Error philosophy: when Google returns an unexpected shape, throw
// with the raw response visible (first 400 chars). Same as zoho.js.
// PITFALLS §6 — never guess; surface the API error to the caller.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

// The address Gmail links should open in. Override via env var only
// if the Vitalis Workspace address ever changes. Used by
// buildGmailThreadLink to construct /u/<email>/ deep-links.
const DEFAULT_VITALIS_AUTHUSER = 'okezie@vitalishealthcare.com';

// Vitalis's own domain — staff senders unless an automation address
export const VITALIS_INTERNAL_DOMAIN = 'vitalishealthcare.com';

// Automation addresses at vitalishealthcare.com that are system-
// generated (CareMatch360 forwarder, etc.) — these LOOK internal but
// are bulk-mail patterns, so we treat them as routable not protected.
export const VITALIS_AUTOMATION_LOCAL_PARTS = [
  'team',          // CareMatch360 application forwarder, etc.
  'no-reply',
  'noreply',
  'notifications',
  'system',
];

// State case management — Maryland and county agencies whose mail is
// always urgent. Add to this list as you encounter new orgs (BLS
// Nurses orgs, additional Service Coordinator agencies).
export const STATE_CASE_DOMAINS = [
  'mcpsmd.org',                    // Montgomery County Public Schools (PDN cases)
  'coordinatingcenter.org',        // The Coordinating Center
  'baltimorecity.gov',             // Baltimore City (incl. BCHD)
  'howardcountymd.gov',            // Howard County
  'maryland.gov',                  // Maryland state (general)
  'md.gov',                        // Maryland state (short form)
  'mdh.maryland.gov',              // MDH (LTSS, BCHD via MDH)
  'md.maryland.gov',
];

// LTC insurance carriers — domain is one of these, but treat differently
// based on whether the sender's local-part looks like a named human or
// an automation address. Named-human → flag urgently. Automation → drop.
export const LTC_CARRIER_DOMAINS = [
  'carescout.com',                 // Genworth's CareScout brand
  'genworth.com',
  'johnhancock.com',
  'unum.com',
];

// Local-part prefixes that indicate an automation address regardless
// of the domain. If a sender's local-part matches one of these, it's
// not a named human.
const AUTOMATION_LOCAL_PART_PATTERNS = [
  /^no[-_.]?reply$/i,
  /^donotreply$/i,
  /^do[-_.]?not[-_.]?reply$/i,
  /^notifications?$/i,
  /^alerts?$/i,
  /^info$/i,
  /^support$/i,
  /^help$/i,
  /^verify$/i,
  /^verification$/i,
  /^auto(?:matic)?[-_.]?reply$/i,
  /^marketing$/i,
  /^news(?:letter)?$/i,
  /^onlinesolutions$/i,
  /^msp[-_.]?compliance$/i,
];

// ─── auth ─────────────────────────────────────────────────────────

export function isGmailConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
}

// Exchange the refresh token for a short-lived access token. We
// don't cache; per-pull refresh is fine for the volumes we see.
// Mirrors lib/google-calendar.js refreshAccessToken().
export async function refreshGmailAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!resp.ok || !json?.access_token) {
    throw new Error(
      `Gmail/Google token refresh failed (${resp.status}): ${text.slice(0, 400)}`,
    );
  }
  return json.access_token;
}

async function gmailGet(accessToken, pathAndQuery) {
  const url = pathAndQuery.startsWith('http')
    ? pathAndQuery
    : `${GMAIL_API_BASE}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Gmail API non-JSON response (status ${res.status}) from ${url}: ${text.slice(0, 400)}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Gmail API error (status ${res.status}) from ${url}: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return data;
}

// ─── message fetch ────────────────────────────────────────────────

// List messages in inbox since `sinceEpochMs`. Gmail's `q` parameter
// supports `after:UNIX_SECONDS` for precise time filtering. Exclude
// sent / drafts / chat. We paginate to handle volume (Vitalis is
// ~50/day; we cap at 200 to be safe against bursts).
//
// Returns an array of { id, threadId } pairs. Use getMessageMetadata()
// for each to fetch headers + snippet.
export async function listMessagesSinceVitalis(
  accessToken,
  sinceEpochMs,
  maxResults = 200,
) {
  const sinceSeconds = Math.floor(sinceEpochMs / 1000);
  // Gmail's `q` is URL-encoded; we build it carefully.
  const q = `in:inbox -in:sent -in:draft -is:chat after:${sinceSeconds}`;
  const perPage = 100;
  const out = [];
  let pageToken = null;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      q,
      maxResults: String(perPage),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gmailGet(
      accessToken,
      `/users/me/messages?${params.toString()}`,
    );
    const batch = data?.messages ?? [];
    for (const m of batch) {
      out.push({ id: m.id, threadId: m.threadId });
      if (out.length >= maxResults) return out;
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// Fetch metadata for a single message: From, To, Cc, Subject, Date,
// snippet, internalDate, threadId. We use format=metadata with the
// `metadataHeaders` filter — this returns the headers we need plus
// the snippet, without pulling the full MIME body. Snippet (~140
// chars from Gmail) is what the synthesis prompt sees, matching the
// Transworld pattern that uses `m.summary || m.snippet`.
export async function getMessageMetadata(accessToken, messageId) {
  const headerList = ['From', 'To', 'Cc', 'Subject', 'Date'].join(',');
  const params = new URLSearchParams({
    format: 'metadata',
    metadataHeaders: headerList,
  });
  // metadataHeaders is repeatable — but Gmail accepts a comma-separated
  // single value as well, so we keep it simple.
  const data = await gmailGet(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
  );

  // Headers come back as an array of { name, value }
  const headers = Array.isArray(data?.payload?.headers)
    ? data.payload.headers
    : [];
  const header = (name) => {
    const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
    return h?.value || '';
  };

  return {
    messageId: data.id,
    threadId: data.threadId,
    snippet: data.snippet || '',
    internalDateMs: Number(data.internalDate || 0),
    labelIds: data.labelIds || [],
    from: header('From'),
    to: header('To'),
    cc: header('Cc'),
    subject: header('Subject'),
    date: header('Date'),
  };
}

// Fetch metadata for a list of message IDs, sequentially. Gmail's
// per-user rate limit is 250 quota units/sec; messages.get is 5
// units, so ~50/sec is the practical ceiling. For our morning
// volume (~50 messages) sequential is comfortably within budget.
export async function getMessagesMetadata(accessToken, messageIds) {
  const out = [];
  for (const id of messageIds) {
    try {
      const m = await getMessageMetadata(accessToken, id);
      out.push(m);
    } catch (e) {
      // Continue on individual failures; one missing message
      // shouldn't fail the whole pull. Log into the message itself
      // so diagnostics can surface it.
      out.push({
        messageId: id,
        threadId: null,
        snippet: '',
        from: '',
        subject: '(fetch failed)',
        _fetchError: String(e).slice(0, 200),
      });
    }
  }
  return out;
}

// ─── helpers — address/domain classification ──────────────────────

export function extractEmailAddress(s) {
  if (!s) return '';
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).trim().toLowerCase();
}

export function senderDomain(s) {
  const addr = extractEmailAddress(s);
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1) : '';
}

export function senderLocalPart(s) {
  const addr = extractEmailAddress(s);
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(0, at) : addr;
}

export function senderDisplayName(s) {
  if (!s) return '';
  const trimmed = String(s).trim();
  const m = trimmed.match(/^"?([^"<]*?)"?\s*<[^>]+>$/);
  if (m) return m[1].trim();
  // No angle brackets — return the bare value (could be just an email
  // or just a name). We treat it as no display name available.
  return '';
}

// Matches if the local-part looks like an automation address (e.g.
// no-reply, notifications, info). Domain-agnostic.
export function isAutomationLocalPart(localPart) {
  if (!localPart) return false;
  const s = String(localPart).toLowerCase();
  return AUTOMATION_LOCAL_PART_PATTERNS.some((p) => p.test(s));
}

// Does the domain match (or end with) a state case management domain?
// We use suffix-match so subdomains like "secure.maryland.gov" or
// "alerts.baltimorecity.gov" still match.
export function isInStateCaseDomain(domain) {
  if (!domain) return false;
  const d = String(domain).toLowerCase();
  return STATE_CASE_DOMAINS.some(
    (sd) => d === sd || d.endsWith(`.${sd}`),
  );
}

// Same suffix-match for LTC carriers.
export function isInLtcCarrierDomain(domain) {
  if (!domain) return false;
  const d = String(domain).toLowerCase();
  return LTC_CARRIER_DOMAINS.some(
    (cd) => d === cd || d.endsWith(`.${cd}`),
  );
}

// Is the sender at vitalishealthcare.com AND NOT one of the known
// automation local-parts? I.e. is this a real Vitalis staff person?
export function isVitalisInternalHuman(fromAddr) {
  if (!fromAddr) return false;
  const domain = senderDomain(fromAddr);
  if (domain !== VITALIS_INTERNAL_DOMAIN) return false;
  const local = senderLocalPart(fromAddr);
  if (!local) return false;
  if (VITALIS_AUTOMATION_LOCAL_PARTS.includes(local.toLowerCase())) return false;
  return true;
}

// Build the Gmail webmail deep-link for a thread. Gmail supports
// per-thread deep-linking (unlike Zoho — see PITFALLS §7). The URL
// opens the specific thread in the user's logged-in webmail session.
//
// v0.1.7.2 — the @ must be LITERAL, not URL-encoded. Gmail's
// account-routing parser specifically expects /u/<email>/ with the
// raw @ in the path. Encoding it as %40 breaks the match and Gmail
// falls back to the default account.
//
// Default address is configured in code (DEFAULT_VITALIS_AUTHUSER)
// since the only Vitalis Gmail account these links should ever point
// to is the Workspace one. GMAIL_VITALIS_AUTHUSER overrides if you
// need a different address.
export function buildGmailThreadLink(threadId) {
  if (!threadId) return null;
  const envAddr = (process.env.GMAIL_VITALIS_AUTHUSER || '').trim();
  const authUser = envAddr || DEFAULT_VITALIS_AUTHUSER;
  // Do NOT use encodeURIComponent here. The @ must be literal.
  return `https://mail.google.com/mail/u/${authUser}/#inbox/${threadId}`;
}
