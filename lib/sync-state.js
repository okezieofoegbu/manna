// lib/sync-state.js
//
// Read/write helpers for the sync_state table.
//
// v0.1.4: the table is forward-shaped for multiple sources; v0.1.4
// uses only the 'zoho_transworld' row.
//
// v0.1.6: the second source is live — 'gmail_vitalis' for the
// Vitalis Healthcare Services Gmail inbox. Both rows are maintained
// independently. The helpers below are source-agnostic; callers pass
// the constant for the source they're operating on.

import { getServiceClient } from './supabase.js';

export const ZOHO_TRANSWORLD_SOURCE = 'zoho_transworld';
export const GMAIL_VITALIS_SOURCE = 'gmail_vitalis';

export async function getSyncState(source = ZOHO_TRANSWORLD_SOURCE) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('sync_state')
    .select('source, account_id, last_pulled_at, last_brief_date, updated_at')
    .eq('source', source)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSyncState(
  source,
  patch, // { account_id?, last_pulled_at?, last_brief_date? }
) {
  const supabase = getServiceClient();
  const row = {
    source,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('sync_state')
    .upsert(row, { onConflict: 'source' })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
