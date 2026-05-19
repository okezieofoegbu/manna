import { createClient } from '@supabase/supabase-js';

// Manna's Supabase client.
// Reads credentials from environment variables — never hard-code them here.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// A clear, early failure is better than a confusing one later.
function assertConfigured() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Manna is not configured. Copy .env.local.example to .env.local ' +
      'and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'See INSTRUCTIONS.md.'
    );
  }
}

export function getSupabaseClient() {
  assertConfigured();
  return createClient(supabaseUrl, supabaseAnonKey);
}

// Convenience flag the page can use to show a friendly setup message
// instead of crashing, when the environment is not yet configured.
export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);
