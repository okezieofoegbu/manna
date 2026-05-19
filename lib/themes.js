import { getSupabaseClient } from './supabase';

// Data access for the theme library.
// In v0.1.0 this only reads — there is no write path yet.

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
