// lib/zoho.js
//
// Zoho Mail OAuth + API client for v0.1.4.
//
// Token model: a long-lived refresh token (set up once via the Self
// Client flow, stored as ZOHO_REFRESH_TOKEN env var) is exchanged for
// a short-lived access token on each pull. The access token lives for
// about an hour; we don't bother caching it — one pull per day means
// one refresh per day, and the overhead is negligible.
//
// Data center: this client assumes the .com data center. If the
// account ever moves to .eu / .in / .com.au / .jp, update the two
// base URLs below.
//
// Error philosophy: when Zoho returns an unexpected shape, throw with
// the raw response visible. Never silently coerce. See PITFALLS §6 —
// never guess.

const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.com';
const ZOHO_MAIL_BASE = 'https://mail.zoho.com/api';

const TRANSWORLD_DOMAINS = ['transworld.com.ng', 'transworldltd.com.ng'];
const INVESTMENT_ADDRESS = 'investment@transworldltd.com.ng';
const REGULATOR_DOMAINS = [
  'sec.gov.ng',
  'ngxgroup.com',
  'cbn.gov.ng',
  'ndic.gov.ng',
  'frcnigeria.gov.ng',
];

// ─── auth ─────────────────────────────────────────────────────────

export function isZohoConfigured() {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN,
  );
}

export async function refreshAccessTokenInternal() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });

  const res = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Zoho token refresh: non-JSON response (status ${res.status}): ${text.slice(0, 400)}`,
    );
  }

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Zoho token refresh failed (status ${res.status}): ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return data.access_token;
}

async function zohoGet(accessToken, pathAndQuery) {
  const url = pathAndQuery.startsWith('http')
    ? pathAndQuery
    : `${ZOHO_MAIL_BASE}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Zoho API non-JSON response (status ${res.status}) from ${url}: ${text.slice(0, 400)}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Zoho API error (status ${res.status}) from ${url}: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return data;
}

// ─── account + folder discovery ───────────────────────────────────

export async function getAccount(accessToken) {
  const data = await zohoGet(accessToken, '/accounts');
  const account = data?.data?.[0];
  if (!account || !account.accountId) {
    throw new Error(
      `Zoho /accounts returned unexpected shape: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return account;
}

export async function getFolders(accessToken, accountId) {
  const data = await zohoGet(
    accessToken,
    `/accounts/${accountId}/folders`,
  );
  const folders = data?.data ?? [];
  if (!Array.isArray(folders) || folders.length === 0) {
    throw new Error(
      `Zoho /folders returned unexpected shape: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return folders;
}

// Resolve the folder IDs for Inbox + the two custom folders the
// owner wants pulled (Newsletter, Notification). Returns whatever
// can be matched; missing custom folders are simply skipped (logged).
export function resolveTargetFolderIds(folders) {
  const wanted = ['inbox', 'newsletter', 'notification', 'notifications'];
  const out = [];
  const notes = [];
  for (const f of folders) {
    const name = (f.folderName || '').toLowerCase().trim();
    if (wanted.includes(name)) {
      out.push({ folderId: f.folderId, folderName: f.folderName });
    }
  }
  if (!out.find((f) => /inbox/i.test(f.folderName))) {
    notes.push('Inbox folder not found — pull will be empty.');
  }
  return { folderIds: out, notes };
}

// ─── message fetch ────────────────────────────────────────────────

// Pull messages from a folder, received after `sinceEpochMs`.
// Zoho returns pages; we paginate until we hit a message older than
// the cutoff or run out.
export async function listMessagesSince(
  accessToken,
  accountId,
  folderId,
  sinceEpochMs,
  maxPages = 5,
) {
  const out = [];
  const limit = 50;
  for (let page = 0; page < maxPages; page++) {
    const start = page * limit + 1; // Zoho is 1-indexed
    const data = await zohoGet(
      accessToken,
      `/accounts/${accountId}/messages/view?folderId=${folderId}&start=${start}&limit=${limit}`,
    );
    const batch = data?.data ?? [];
    if (!Array.isArray(batch) || batch.length === 0) break;

    let hitOlder = false;
    for (const m of batch) {
      const t = Number(m.receivedTime ?? m.sentDateInGMT ?? 0);
      if (!t) continue;
      if (t < sinceEpochMs) {
        hitOlder = true;
        continue;
      }
      out.push(m);
    }
    if (hitOlder) break;
    if (batch.length < limit) break;
  }
  return out;
}

// Get the body content for a single message.
export async function getMessageContent(
  accessToken,
  accountId,
  folderId,
  messageId,
) {
  const data = await zohoGet(
    accessToken,
    `/accounts/${accountId}/messages/${folderId}/${messageId}/content`,
  );
  return data?.data ?? null;
}

// Get all messages in a thread (for the no-response check on
// investment@ emails). Returns the message list with sender info.
export async function getThread(
  accessToken,
  accountId,
  folderId,
  messageId,
) {
  // Zoho's thread endpoint varies; we try the canonical shape first.
  const data = await zohoGet(
    accessToken,
    `/accounts/${accountId}/messages/${folderId}/${messageId}/thread`,
  );
  return data?.data ?? [];
}

// ─── helpers — domain/address classification ──────────────────────

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

export function isTransworldSender(s) {
  return TRANSWORLD_DOMAINS.includes(senderDomain(s));
}

export function isRegulatorSender(s) {
  return REGULATOR_DOMAINS.includes(senderDomain(s));
}

export function isAddressedToInvestment(toField) {
  if (!toField) return false;
  return String(toField).toLowerCase().includes(INVESTMENT_ADDRESS);
}

export {
  TRANSWORLD_DOMAINS,
  INVESTMENT_ADDRESS,
  REGULATOR_DOMAINS,
};
