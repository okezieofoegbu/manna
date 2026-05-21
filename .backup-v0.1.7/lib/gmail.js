// lib/gmail.js
//
// Gmail API helpers for the Vitalis brief pipeline. Mirrors the shape
// of lib/zoho.js (auth, list, fetch) but uses Gmail's REST API with
// the user's own OAuth credentials.
//
// v0.1.6 — initial.
// v0.1.7 — buildGmailThreadLink now uses ?authuser=<email> instead of
// /u/0/ so the link opens in the correct Google account regardless of
// which account is signed in first in the browser. See PITFALLS for
// the diagnosis (it was landing in the wrong account when okezie@
// gmail and okezie@vitalishealthcare were both signed in).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

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

// Cache module-level. Refresh ~5 min before expiry.
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
//
// Returns an array of { id, threadId } pairs. Use getMessageMetadata()
// to fetch headers + snippet for each.
//
// Query strategy:
//   - in:inbox       : exclude items that hit a label-only path
//   - -in:sent       : exclude messages we sent
//   - -in:draft      : exclude drafts
//   - -is:chat       : exclude Hangouts/Chat
//   - after:<epoch>  : messages received since the cutoff
//
// The `after:` operator on Gmail accepts seconds since epoch.
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
//
// We don't need the full body; the email-filter and synthesis prompt
// work from headers (From/Subject/Date/List-Unsubscribe/To/Cc) +
// snippet, internalDate, threadId. We use format=metadata with the
// metadataHeaders param to keep payloads minimal.
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
//
// Gmail supports batched requests via multipart, but that's overkill
// for our brief sizes. Sequential with a tiny pool keeps things simple
// and well within rate limits.
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
        // Skip failed-fetch messages rather than abort the whole batch.
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
// parseSenderEmail — pull the bare email out of a "Display Name <addr>"
// ---------------------------------------------------------------------------
export function parseSenderEmail(fromHeader) {
  if (!fromHeader) return null;
  const m = fromHeader.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  // No angle brackets — assume the whole thing is the address.
  const trimmed = fromHeader.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return null;
}

// ---------------------------------------------------------------------------
// extractDomain — get the domain portion of an email address
// ---------------------------------------------------------------------------
export function extractDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// buildGmailThreadLink — deep-link to the specific thread
// ---------------------------------------------------------------------------
//
// v0.1.7 — Uses ?authuser=<email> so the link opens in the correct
// Google account regardless of which account is signed in first.
//
// Background: the previous form was /u/0/#inbox/{threadId}, which
// means "account index 0 in this browser session." When the user is
// signed into multiple Google accounts (e.g. personal okezie@gmail
// and Vitalis okezie@vitalishealthcare.com), /u/0/ resolves to
// whichever was signed in first — not necessarily Vitalis. The thread
// then doesn't exist in that account and Gmail shows the inbox or
// "conversation not found."
//
// ?authuser=<email> tells Gmail explicitly which account to open the
// link in. The email is configured via GMAIL_VITALIS_AUTHUSER with
// a sensible default. If unset or empty, falls back to /u/0/ (the
// pre-v0.1.7 behavior) so dev/staging environments without the env
// var still produce a usable (if wrong-account-prone) link.
export function buildGmailThreadLink(threadId) {
  if (!threadId) return null;
  const authUser = (process.env.GMAIL_VITALIS_AUTHUSER || '').trim();
  if (authUser) {
    return (
      `https://mail.google.com/mail/u/0/?authuser=${encodeURIComponent(authUser)}` +
      `#inbox/${threadId}`
    );
  }
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}
