import { getSupabaseClient } from './supabase';

// Data access for the theme library.
// This module only reads — the theme library is curated, not generated.

// Returns the currently active theme (is_active = true), or null.
export async function getActiveTheme() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('themes')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error('Could not load the active theme: ' + error.message);
  }
  return data;
}

// Returns all anchor passages for a theme, in their served order.
export async function getThemePassages(themeId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('theme_passages')
    .select('*')
    .eq('theme_id', themeId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error('Could not load theme passages: ' + error.message);
  }
  return data || [];
}

// Returns how many mornings of a theme have been served so far — i.e. the
// number of devotional_days rows for that theme. Once today's devotional has
// been generated, this is "morning N" for the header line. Read-only.
export async function getThemeMorningCount(themeId) {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('devotional_days')
    .select('id', { count: 'exact', head: true })
    .eq('theme_id', themeId);

  if (error) {
    throw new Error('Could not count theme mornings: ' + error.message);
  }
  return count || 0;
}

// Returns every theme in the library, in walk-through order.
export async function getAllThemes() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('themes')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error('Could not load themes: ' + error.message);
  }
  return data || [];
}
