// lib/email-filter.js
//
// Noise filter that runs BEFORE the synthesis prompt is called.
//
// Two reasons it lives in code, not the prompt:
//   1. Cost — every email filtered here saves Anthropic tokens.
//   2. Determinism — automated noise patterns are exact-match rules,
//      not judgment calls. Code is better at them than a model.
//
// The prompt has a backup list of the same patterns (see
// synthesis-prompt.js) in case the model sees something the filter
// missed; that's belt-and-braces, not the primary defence.

import { extractEmailAddress } from './zoho.js';

const NOISY_SENDER_PATTERNS = [
  /^no[-_.]?reply@/i,
  /^donotreply@/i,
  /^do[-_.]?not[-_.]?reply@/i,
  /^notifications?@/i,
  /^mailer[-_.]?daemon@/i,
  /^postmaster@/i,
  /^bounce@/i,
  /^alerts?@/i,
  /^auto(?:matic)?[-_.]?reply@/i,
];

const NOISY_SENDER_DOMAINS = [
  // Zoho's own automated notifications
  'zoho.com',
  'zohomail.com',
  'notifications.zoho.com',
  'notify.zoho.com',
];

// Substring patterns in the sender address (lowercased)
const NOISY_SENDER_SUBSTRINGS = [
  'mailer-daemon',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
];

const NOISY_SUBJECT_PATTERNS = [
  /^out of office/i,
  /^automatic reply/i,
  /^auto[-:\s]*reply/i,
  /^undeliverable/i,
  /^delivery (status notification|failure)/i,
  /^read[-:\s]*receipt/i,
  /^your password/i,
  /^otp[\s:]/i,
  /verification code/i,
  /^welcome to /i,
  /unsubscribe/i,
  /^\[?newsletter\]?/i,
  // Transworld portal auto-emails: "Payment Approved — ..."
  /^payment approved/i,
  // Zoho Sheet comment notifications
  /has commented in the/i,
  // Calendar invites — those go to Calendar, not the brief
  /^invitation:/i,
  /^updated invitation:/i,
  /^canceled event:/i,
];

const NOISY_SENDER_NAMES = [
  /^zoho sheet notification$/i,
  /^zoho books$/i,
  /^transworld portal$/i,
];

function senderRaw(m) {
  // Zoho returns sender variously as `fromAddress` or `sender` depending
  // on endpoint. Try both.
  return m.fromAddress || m.sender || m.from || '';
}

function senderNameRaw(m) {
  return m.fromName || m.senderName || '';
}

export function isNoisyMessage(m) {
  const fromAddr = extractEmailAddress(senderRaw(m));
  const fromName = senderNameRaw(m);
  const subject = m.subject || '';

  if (NOISY_SENDER_PATTERNS.some((p) => p.test(fromAddr))) return true;
  if (NOISY_SENDER_SUBSTRINGS.some((s) => fromAddr.includes(s))) return true;

  const domain = fromAddr.split('@')[1] || '';
  if (NOISY_SENDER_DOMAINS.includes(domain.toLowerCase())) return true;

  if (NOISY_SENDER_NAMES.some((p) => p.test(fromName))) return true;
  if (NOISY_SUBJECT_PATTERNS.some((p) => p.test(subject))) return true;

  return false;
}

// Split a batch into kept + dropped, with a reason on each drop —
// useful for diagnostic logs when tuning.
export function filterBatch(messages) {
  const kept = [];
  const dropped = [];
  for (const m of messages) {
    if (isNoisyMessage(m)) {
      dropped.push({
        messageId: m.messageId,
        subject: m.subject,
        from: senderRaw(m),
      });
    } else {
      kept.push(m);
    }
  }
  return { kept, dropped };
}
