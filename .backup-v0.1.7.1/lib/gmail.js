// lib/gmail.js
//
// Gmail API helpers for the Vitalis brief pipeline. Mirrors the shape
// of lib/zoho.js (auth, list, fetch) but uses Gmail's REST API with
// the user's own OAuth credentials.
//
// v0.1.6 — initial.
// v0.1.7 — first attempt at fixing the multi-account-routing issue.
//   Added an env-var-controlled ?authuser= parameter but fell back
//   to the broken /u/0/ URL when the env var was unset. This silently
//   continued the bug because the env var was optional and unset.
// v0.1.7.1 — actual fix. Two changes:
//   - Default address is now in code (okezie@vitalishealthcare.com),
//     so the env var is genuinely optional.
//   - URL pattern is /u/<email>/ instead of /u/0/?authuser=<email>.
//     This is Gmail's primary account routing pattern (same shape
//     as Google Drive's /u/<email>/ URLs) and is more reliable than
//     the query-param approach.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// The address Gmail links should open in. Override via the env var
// only if the Vitalis Workspace address ever changes.
const DEFAULT_VITALIS_AUTHUSER = 'okezie@vitalishealthcare.com';

// ---------------------------------------------------------------------------
// Config check
// ---------------------------------------------------------------------------

export function isGmailConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
}

// ---------------------------------------------------------------------------
// Access token refresh
// ---------------------------------------------------------------------------

let cachedToken = null;
let cachedExp = 0;

export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExp - 5 * 60 * 1000) {
    return cachedToken;
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail token refresh failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Gmail token refresh: no access_token in response`);
  }
  cachedToken = json.access_token;
  cachedExp = now + (Number(json.expires_in || 3600) * 1000);
  return cachedToken;
}

// ---------------------------------------------------------------------------
// Generic Gmail GET
// ---------------------------------------------------------------------------

async function gmailGet(url) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Gmail API error (status ${res.status}) from ${url}: ${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// listMessageIds — query messages.list for our window
// ---------------------------------------------------------------------------
export async function listMessageIds({ sinceEpochSeconds, maxResults = 100 } = {}) {
  if (!sinceEpochSeconds || typeof sinceEpochSeconds !== 'number') {
    throw new Error('listMessageIds: sinceEpochSeconds (number) is required');
  }
  const q = `in:inbox -in:sent -in:draft -is:chat after:${sinceEpochSeconds}`;
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
    `q=${encodeURIComponent(q)}&maxResults=${maxResults}`;
  const data = await gmailGet(url);
  const out = [];
  if (Array.isArray(data.messages)) {
    for (const m of data.messages) {
      out.push({ id: m.id, threadId: m.threadId });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// getMessageMetadata — headers + snippet
// ---------------------------------------------------------------------------
const HEADER_NAMES = [
  'From',
  'To',
  'Cc',
  'Subject',
  'Date',
  'List-Unsubscribe',
  'Auto-Submitted',
  'Precedence',
  'X-Auto-Response-Suppress',
];

export async function getMessageMetadata(id) {
  const headerParam = HEADER_NAMES
    .map((h) => `metadataHeaders=${encodeURIComponent(h)}`)
    .join('&');
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}` +
    `?format=metadata&${headerParam}`;
  const data = await gmailGet(url);
  const headers = {};
  if (data.payload && Array.isArray(data.payload.headers)) {
    for (const h of data.payload.headers) {
      headers[h.name.toLowerCase()] = h.value;
    }
  }
  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet || '',
    internalDate: data.internalDate
      ? Number(data.internalDate)
      : null,
    labelIds: Array.isArray(data.labelIds) ? data.labelIds : [],
    headers,
  };
}

// ---------------------------------------------------------------------------
// getMessageMetadataBatch — sequential fetch with small concurrency
// ---------------------------------------------------------------------------
export async function getMessageMetadataBatch(ids, { concurrency = 4 } = {}) {
  const out = [];
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= ids.length) break;
      try {
        const meta = await getMessageMetadata(ids[idx]);
        out[idx] = meta;
      } catch (e) {
        out[idx] = {
          id: ids[idx],
          threadId: null,
          snippet: '',
          internalDate: null,
          labelIds: [],
          headers: {},
          _error: e.message,
        };
      }
    }
  }
  const pool = Array.from({ length: Math.min(concurrency, ids.length) }, () =>
    worker(),
  );
  await Promise.all(pool);
  return out;
}

// ---------------------------------------------------------------------------
// parseSenderEmail / extractDomain — helpers used by the Vitalis filter
// ---------------------------------------------------------------------------
export function parseSenderEmail(fromHeader) {
  if (!fromHeader) return null;
  const m = fromHeader.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  const trimmed = fromHeader.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return null;
}

export function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// buildGmailThreadLink — v0.1.7.1: actually routes to the right account
// ---------------------------------------------------------------------------
//
// Pattern: https://mail.google.com/mail/u/<email>/#inbox/{threadId}
//
// This is the same routing pattern Google Drive uses (e.g.
// /drive/u/<email>/...) and is the most reliable way to force a
// link to open in a specific signed-in account. Unlike the v0.1.7
// attempt with /u/0/?authuser=, the email-in-path form is parsed
// by Google's URL handler before the page loads, so there's no
// race condition with whichever account loaded first.
//
// The default is configured in code as okezie@vitalishealthcare.com
// because that's the only address Vitalis links should open in.
// GMAIL_VITALIS_AUTHUSER overrides it if you ever need to.
export function buildGmailThreadLink(threadId) {
  if (!threadId) return null;
  const envAddr = (process.env.GMAIL_VITALIS_AUTHUSER || '').trim();
  const authUser = envAddr || DEFAULT_VITALIS_AUTHUSER;
  return `https://mail.google.com/mail/u/${encodeURIComponent(authUser)}/#inbox/${threadId}`;
}
