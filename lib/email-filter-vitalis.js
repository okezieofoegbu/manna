// lib/email-filter-vitalis.js
//
// v0.1.6 — Noise filter for the Vitalis Gmail inbox. Sibling to
// lib/email-filter.js (the Transworld filter); same shape, different
// rules. The patterns here were derived from a real one-week scan
// of okezie@vitalishealthcare.com — see the v0.1.6 conversation
// for the analysis.
//
// CANONICAL DESIGN RULE (PITFALLS §3): this filter knows only about
// the Vitalis domain. It must never import from email-filter.js or
// share noise patterns. Each source gets its own filter; that is the
// separation that keeps the brief honest.
//
// Filter pipeline order matters — protected pass-throughs run before
// hard drops so that a state-agency or named-human sender at an
// LTC carrier isn't accidentally dropped by a generic pattern match.

import {
  extractEmailAddress,
  senderDomain,
  senderLocalPart,
  senderDisplayName,
  isAutomationLocalPart,
  isInStateCaseDomain,
  isInLtcCarrierDomain,
  isVitalisInternalHuman,
} from './gmail.js';

// ─── pattern catalogs ─────────────────────────────────────────────

// Consumer brands sending to your work address — drop hard.
const CONSUMER_BRAND_DOMAINS = [
  'email.etsy.com',
  'msg.kayak.com',
  'mgs.opentable.com',
  'business.amazon.com',
  'bulkofficesupply.com',
  'mail.notarize.com',
  'patient.fullscript.com',
  'benefits.unitedhealthcare.com',
];

// Industry/professional marketing — drop hard.
const MARKETING_DOMAINS = [
  'onlinesolutions.polsinelli.com',
  'homecareevolution.com',
  'insights.getapp.com',
  'qemailserver.com',         // paid-survey solicitations
  'followingjesusbook.com',
];

// Chamber, economic development, government newsletters — drop hard.
const CHAMBER_EDA_DOMAINS = [
  'usblackchamber.ccsend.com',
  'usblackchambers.org',
  'howardcountyeda.org',
  'worksourcemontgomery.com',
];

// Property / building admin — drop hard.
const PROPERTY_ADMIN_DOMAINS = [
  'emailrelay.com',            // The Cameron parking notices etc.
];

// HR / workforce platform notification senders — drop hard. The
// applicant pipeline IS surfaced, but as an aggregated synthesis
// item, not via these per-applicant notifications. Per v0.1.6 design.
const HR_PLATFORM_DOMAINS = [
  'careerplug.com',            // applicant notifications
  'notifications.careerplug.com',
  'shiftmed.com',              // ShiftMed portal updates
  'msp.compliance.shiftmed.com',
];

// Bank notification firehose. We drop most of these; explicit
// exceptions below pass through (fraud, wires, payee changes, large
// Zelle payments).
const BANKING_DOMAINS = [
  'ealerts.bankofamerica.com',
  'mail.transfers.bankofamerica.com',
  'transfers.bankofamerica.com',
  'mail.bankofamerica.com',
];

// Specific senders we drop by exact address — easier than fitting
// them into a domain pattern.
const NOISY_SENDER_ADDRESSES = [
  // OpenGov procurement alerts — per user instruction in v0.1.6,
  // drop entirely (Vitalis isn't registered for these contract types).
  'procurement-notifications@opengov.com',
];

// Specific Baltimore City sender that's bulk-marketing. We don't
// drop all of *.baltimorecity.gov because that domain also carries
// real city case management mail.
const NOISY_SENDER_PATTERNS = [
  /^MWBD@alerts\.baltimorecity\.gov$/i,   // MWBD events / certifications
  /^no[-_.]?reply@/i,
  /^donotreply@/i,
  /^do[-_.]?not[-_.]?reply@/i,
  /^mailer[-_.]?daemon@/i,
  /^postmaster@/i,
  /^bounce@/i,
];

// Subject-line patterns that reliably indicate noise across senders.
const NOISY_SUBJECT_PATTERNS = [
  /^out of office/i,
  /^automatic reply/i,
  /^auto[-:\s]*reply/i,
  /^undeliverable/i,
  /^delivery (status notification|failure)/i,
  /^read[-:\s]*receipt/i,
  /verification code/i,
  /^your .* code/i,                       // "Your Intuit code", etc.
  /^\[?newsletter\]?/i,

  // Marketing rhetorical patterns
  /webinar/i,
  /\bboot ?camp\b/i,
  /last chance/i,
  /register today/i,
  /save the date/i,
  /don.?t miss/i,
  /free trial/i,
  /^early access:/i,
  /^advancing\b/i,                        // chamber-style "Advancing X Through Y!"
  /^introducing\b/i,                      // marketing intro pattern
  /^new! /i,                              // "New! Water Baptism Handbook..."
  /^spring into\b/i,                      // seasonal promo openers
  /^now is the time/i,                    // motivational coaching pitches
  /are you currently hiring/i,            // recruiting events
  /^business essentials/i,
  /^travel farther/i,
  /^explore trending/i,
  /^real vintage/i,

  // Emoji-prefixed subjects are reliably noise
  /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1FA70}-\u{1FAFF}]/u,
];

// Sender display names that are reliably automation regardless of address
const NOISY_SENDER_NAMES = [
  /economic edge/i,
  /usblack[-_ ]?chamber/i,
];

// ─── banking firehose carve-outs ──────────────────────────────────

// Bank-of-America Zelle subject pattern + amount extractor.
// Sample: "Zelle® payment of $1,350.00 to SOMTO ILOMUANYA has been sent"
const ZELLE_SUBJECT_RE = /Zelle.*payment of \$([\d,]+(?:\.\d+)?)/i;
const WIRE_RECEIVED_RE = /^you.?ve received a wire/i;
const FRAUD_KEYWORDS_RE =
  /\b(fraud|dispute|stop payment|unauthorized|unrecognized|suspicious|stolen)/i;
const SECURITY_NOTIF_RE =
  /^(payee added|you.?ve added .* as|account.*closed|password.*reset|alert:|action required)/i;

// Pass-through Zelle threshold: $5K, per v0.1.6 design.
const ZELLE_PASS_THROUGH_THRESHOLD = 5000;

// Returns true if a banking-firehose message should pass through
// to synthesis (rare exception). Returns false if it should be
// dropped (the common case).
function isBankingExceptionPassThrough(m) {
  const subject = m.subject || '';
  const snippet = m.snippet || '';
  const combined = `${subject} ${snippet}`;

  if (FRAUD_KEYWORDS_RE.test(combined)) return true;
  if (WIRE_RECEIVED_RE.test(subject)) return true;
  if (SECURITY_NOTIF_RE.test(subject)) return true;

  const zelle = subject.match(ZELLE_SUBJECT_RE);
  if (zelle) {
    const amount = parseFloat(String(zelle[1]).replace(/,/g, ''));
    if (Number.isFinite(amount) && amount >= ZELLE_PASS_THROUGH_THRESHOLD) {
      return true;
    }
    return false;          // routine sub-threshold Zelle
  }

  return false;
}

// ─── Quo / Sona-handled call detection ────────────────────────────

// Quo's Sona AI agent emails a summary of every call she handles.
// The Vitalis Quo deployment runs through okezie@vitalishealthcare.com.
// We drop Sona-handled marketing/robocalls and keep real-call summaries.
// Per v0.1.6 design: Quo + Claude Connector already gives Okezie call
// analysis directly, so the brief only needs the higher-signal cases.
const QUO_DOMAIN_RE = /(^|\.)quo\.com$/i;
const SONA_HANDLED_SUBJECT_RE = /^sona handled a call/i;
const SONA_MARKETING_BODY_RE =
  /\b(unsolicited|marketing|robocall|telemarket|spam|cold call|sales (call|pitch)|cash back|extended warranty)/i;

function isQuoNoise(m) {
  const domain = senderDomain(m.from);
  if (!QUO_DOMAIN_RE.test(domain)) return false;
  const subject = m.subject || '';
  if (!SONA_HANDLED_SUBJECT_RE.test(subject)) return false;
  const snippet = m.snippet || '';
  return SONA_MARKETING_BODY_RE.test(snippet);
}

// ─── the filter ───────────────────────────────────────────────────

// `priorityAllowList`: Set<string> of lowercased email addresses from
// the vitalis_priority_senders table. These bypass the filter entirely.
//
// Returns { noisy: boolean, reason: string|null }. The reason is for
// diagnostic logs; the caller cares only about `noisy`.
export function classifyVitalisMessage(m, priorityAllowList = new Set()) {
  const fromAddr = extractEmailAddress(m.from);
  const fromDomain = senderDomain(m.from);
  const fromLocal = senderLocalPart(fromAddr);
  const fromName = senderDisplayName(m.from);
  const subject = m.subject || '';

  // STAGE 1 — Protected pass-throughs. These never count as noise,
  // regardless of any pattern match below.
  if (fromAddr && priorityAllowList.has(fromAddr)) {
    return { noisy: false, reason: 'priority_sender_allowlist' };
  }
  if (isVitalisInternalHuman(fromAddr)) {
    return { noisy: false, reason: 'vitalis_internal_human' };
  }
  if (isInStateCaseDomain(fromDomain)) {
    return { noisy: false, reason: 'state_case_domain' };
  }

  // STAGE 2 — LTC carrier named-human carve-out. Domain is one of
  // the four LTC carriers; we keep only when the local-part looks
  // like a real person, dropping verification codes and marketing.
  if (isInLtcCarrierDomain(fromDomain)) {
    if (isAutomationLocalPart(fromLocal)) {
      return { noisy: true, reason: 'ltc_carrier_automation' };
    }
    return { noisy: false, reason: 'ltc_carrier_named_human' };
  }

  // STAGE 3 — Hard drops by address / domain / pattern.
  if (NOISY_SENDER_ADDRESSES.includes(fromAddr)) {
    return { noisy: true, reason: 'noisy_sender_address' };
  }
  if (NOISY_SENDER_PATTERNS.some((p) => p.test(fromAddr))) {
    return { noisy: true, reason: 'noisy_sender_pattern' };
  }
  if (
    CONSUMER_BRAND_DOMAINS.includes(fromDomain) ||
    MARKETING_DOMAINS.includes(fromDomain) ||
    CHAMBER_EDA_DOMAINS.includes(fromDomain) ||
    PROPERTY_ADMIN_DOMAINS.includes(fromDomain) ||
    HR_PLATFORM_DOMAINS.includes(fromDomain)
  ) {
    return { noisy: true, reason: 'noisy_sender_domain' };
  }
  if (NOISY_SUBJECT_PATTERNS.some((p) => p.test(subject))) {
    return { noisy: true, reason: 'noisy_subject_pattern' };
  }
  if (NOISY_SENDER_NAMES.some((p) => p.test(fromName))) {
    return { noisy: true, reason: 'noisy_sender_name' };
  }

  // STAGE 4 — Banking firehose. Drop most, pass exceptions through.
  if (BANKING_DOMAINS.includes(fromDomain)) {
    if (isBankingExceptionPassThrough(m)) {
      return { noisy: false, reason: 'banking_exception' };
    }
    return { noisy: true, reason: 'banking_routine' };
  }

  // STAGE 5 — Quo / Sona-handled marketing calls.
  if (isQuoNoise(m)) {
    return { noisy: true, reason: 'quo_sona_marketing' };
  }

  // Not noise — pass through to system flags + synthesis.
  return { noisy: false, reason: 'pass_through' };
}

// Split a batch. Mirrors filterBatch() in email-filter.js so the
// orchestrator can use the same shape regardless of source.
export function filterBatchVitalis(messages, priorityAllowList = new Set()) {
  const kept = [];
  const dropped = [];
  for (const m of messages) {
    const { noisy, reason } = classifyVitalisMessage(m, priorityAllowList);
    if (noisy) {
      dropped.push({
        messageId: m.messageId,
        subject: m.subject,
        from: m.from,
        reason,
      });
    } else {
      kept.push(m);
    }
  }
  return { kept, dropped };
}
