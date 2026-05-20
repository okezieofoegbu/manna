// lib/delegate-recipients.js
//
// v0.1.5 — read the Transworld colleagues from the delegate_recipients
// table. The table is seeded with six rows (Joseph, Clement, Ifunanya,
// Florence, Daniel, Roland) via a one-time SQL seed; this module is
// the read interface used by:
//   - app/page.js — to populate the delegate dropdown for each item
//   - app/api/actions/delegate/route.js — to validate the recipient_key
//     and fetch the email address used in the audit row
//
// The table lives in Supabase with RLS on and no policies — only
// service-role reads work. We never expose this data to the reader
// role; the page only fetches it when user.role === 'owner'.
//
// Adding a colleague later is a SQL insert. No code change.

import { getServiceClient } from './supabase.js';

export async function listActiveRecipients() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('delegate_recipients')
    .select('key, display_name, role_title, domain_note, email, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getRecipientByKey(key) {
  if (!key) return null;
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('delegate_recipients')
    .select('key, display_name, role_title, email')
    .eq('key', key)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
