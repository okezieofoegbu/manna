// =============================================================================
// Manna — the devotional engine (orchestration)
// =============================================================================
// Ties together: passage-of-the-day selection, the lens rotation, the Bible
// text fetch, and the reflection generation — and writes one devotional_days
// row per calendar day.
//
// IDEMPOTENT BY DESIGN. One devotional per day. If a row already exists for
// today (the owner's local day), it is served — never regenerated. The
// devotional_days.date column is UNIQUE, which also makes concurrent first
// loads safe. See STATE_OF_APP.md Section 8 and PITFALLS.md Section 4.
//
// This module is SERVER-ONLY for its write paths — getDevotionalGenerator()
// uses the service-role key. It must only be imported from API routes.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseClient, getServiceClient } from './supabase';
import { getActiveTheme, getThemePassages } from './themes';
import { lensForMorning } from './lens';
import { ownerToday } from './dates';
import { fetchPassage } from './bible';
import { buildReflectionPrompt, PROMPT_VERSION } from './reflection-prompt';

// The model used to generate the reflection. Overridable via env so the owner
// can move to an Opus model for maximum voice fidelity if desired. The
// reflection is the soul of Manna — a capable model is the right default.
const REFLECTION_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// --- Read path (anon key — safe anywhere) ------------------------------------
// Returns today's devotional_days row, or null if none has been generated yet.
export async function getTodaysDevotional() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('devotional_days')
    .select('*')
    .eq('date', ownerToday())
    .maybeSingle();

  if (error) {
    throw new Error('Could not load today\'s devotional: ' + error.message);
  }
  return data;
}

// --- Counting mornings served ------------------------------------------------
async function countRows(client, themeId) {
  // Global count -> the lens rotation index ("mornings served", rolls across
  // theme boundaries). Theme-scoped count -> the passage index within the
  // active theme. In Phase 1 there is one theme, so they are equal; both are
  // computed so the logic stays correct when more themes are added.
  const globalQuery = client
    .from('devotional_days')
    .select('id', { count: 'exact', head: true });
  const themeQuery = client
    .from('devotional_days')
    .select('id', { count: 'exact', head: true })
    .eq('theme_id', themeId);

  const [globalRes, themeRes] = await Promise.all([globalQuery, themeQuery]);
  if (globalRes.error) {
    throw new Error('Could not count devotional history: ' + globalRes.error.message);
  }
  if (themeRes.error) {
    throw new Error('Could not count theme history: ' + themeRes.error.message);
  }
  return { globalCount: globalRes.count || 0, themeCount: themeRes.count || 0 };
}

// --- The reflection generation call ------------------------------------------
async function generateReflection(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add your Anthropic key to .env.local ' +
        '(server-only). See INSTRUCTIONS.md Section 5.'
    );
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: REFLECTION_MODEL,
    max_tokens: 1200,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  });
  const text = (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error('The reflection generation returned no text.');
  }
  return text;
}

// --- Write path (service-role key — SERVER ONLY) -----------------------------
// Ensures today's devotional exists. If it already does, returns it untouched.
// Otherwise selects the passage and lens, fetches the text, generates the
// reflection, and writes the row. Returns { devotional, generated }.
export async function ensureTodaysDevotional() {
  const today = ownerToday();

  // 1. Idempotency guard — if today is already done, serve it.
  const existing = await getTodaysDevotional();
  if (existing) {
    return { devotional: existing, generated: false };
  }

  // 2. The active theme and its anchor passages, in served order.
  const theme = await getActiveTheme();
  if (!theme) {
    throw new Error('No active theme — cannot select a passage.');
  }
  const passages = await getThemePassages(theme.id);
  if (passages.length === 0) {
    throw new Error('The active theme has no anchor passages.');
  }

  // 3. Which morning is this? Count rows with the service client (RLS bypass)
  //    so the count is accurate regardless of read policies.
  const service = getServiceClient();
  const { globalCount, themeCount } = await countRows(service, theme.id);

  // morningIndex is zero-based: the count of mornings ALREADY served.
  const morningIndex = globalCount;

  // Passage-of-the-day: the next passage in sort_order. Wraps within the
  // theme once all anchor passages have been served (so the engine keeps
  // running on the only Phase 1 theme — see STATE_OF_APP.md Section 8a).
  const passage = passages[themeCount % passages.length];

  // The lens for this morning — deterministic 4/2/1 rotation.
  const lens = lensForMorning(morningIndex);

  // 4. Fetch the Bible text (NKJV -> NLT -> NIV -> WEB).
  const passageData = await fetchPassage(passage.reference);

  // 5. Build the prompt (ONE artifact, lens as a parameter) and generate.
  const prompt = buildReflectionPrompt({
    themeName: theme.name,
    themeDescription: theme.description,
    passageReference: passage.reference,
    passageText: passageData.text,
    translationLabel: passageData.translationLabel,
    lens,
    morningIndex,
  });
  const reflection = await generateReflection(prompt);

  // 6. Write the row. The unique constraint on `date` makes a concurrent
  //    first load safe — if another request won the race, we re-read.
  const row = {
    date: today,
    theme_id: theme.id,
    passage_id: passage.id,
    passage_text: passageData.text,
    reflection,
    lens,
    passage_fums: passageData.fums || null,
  };

  const { data, error } = await service
    .from('devotional_days')
    .insert(row)
    .select()
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation: a concurrent request created today's row
    // first. That is fine — re-read and serve theirs.
    if (error.code === '23505') {
      const winner = await getTodaysDevotional();
      if (winner) return { devotional: winner, generated: false };
    }
    throw new Error('Could not save today\'s devotional: ' + error.message);
  }

  return {
    devotional: data,
    generated: true,
    meta: { promptVersion: PROMPT_VERSION, model: REFLECTION_MODEL },
  };
}
