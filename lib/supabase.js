import { createClient } from '@supabase/supabase-js';

// Manna's Supabase client.
// Reads credentials from environment variables — never hard-code them here.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The service-role key is SERVER-ONLY. It bypasses Row Level Security and is
// used solely inside API routes to write the devotional. It must never be
// prefixed with NEXT_PUBLIC_ and must never be imported into a client
// component. See PITFALLS.md Section 2.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

// The public (anon-key) client. Safe to use anywhere. Reads only what RLS
// public-read policies allow — themes, theme_passages, devotional_days.
export function getSupabaseClient() {
  assertConfigured();
  return createClient(supabaseUrl, supabaseAnonKey);
}

// The service-role client. SERVER-ONLY — call this only from API routes.
// Used to write rows to devotional_days (writes bypass RLS).
export function getServiceClient() {
  assertConfigured();
  if (!supabaseServiceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. The devotional engine writes ' +
      'server-side with the service-role key. Add it to .env.local ' +
      '(server-only — never NEXT_PUBLIC_). See INSTRUCTIONS.md Section 5.'
    );
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Convenience flag the page can use to show a friendly setup message
// instead of crashing, when the environment is not yet configured.
export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);
