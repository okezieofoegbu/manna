// lib/sync-state.js
//
// Read/write helpers for the sync_state table.
//
// The table is forward-shaped for multiple sources; v0.1.4 uses only
// the 'zoho_transworld' row. A future Gmail integration would add a
// 'gmail_personal' row alongside.

import { getServiceClient } from './supabase.js';

export const ZOHO_TRANSWORLD_SOURCE = 'zoho_transworld';

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
