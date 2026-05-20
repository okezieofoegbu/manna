// lib/brief-reads.js
//
// Owner-only read of today's brief, used by the server component
// in app/page.js.
//
// Security model:
//   - The page's server component calls getCurrentUser() and checks
//     user.role === 'owner' BEFORE calling readTodaysBriefForOwner().
//   - This function additionally takes the user object and asserts
//     the role itself, as defence in depth.
//   - All reads go through the service-role client; the anon key
//     can see nothing in brief_items (RLS on, no policies).
//   - When user.role !== 'owner', this returns [] and the page
//     renders nothing — no placeholder, no hint that data exists.

import { readBriefForDate } from './brief.js';

// Self-contained — independent of lib/dates.js.
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

export async function readTodaysBriefForOwner(user) {
  if (!user || user.role !== 'owner') return [];
  const date = todayOwnerLocal();
  return readBriefForDate(date);
}

// Group items by category for the page render. Returns an ordered
// array of [category, items[]] tuples so the page can iterate without
// re-sorting.
export function groupByCategory(items) {
  const order = ['urgent', 'schedule', 'delegate', 'fyi'];
  const grouped = new Map();
  for (const c of order) grouped.set(c, []);
  for (const it of items) {
    if (!grouped.has(it.category)) grouped.set(it.category, []);
    grouped.get(it.category).push(it);
  }
  return order.map((c) => [c, grouped.get(c) || []]);
}
