# Manna

*Word before work.*

A private morning page — a slow, theme-based devotional engine and a curated
brief of what needs attention from the Transworld inbox.

This is **v0.1.0** — the shell and the data model (Step 1 of the Phase 1 scope).

## What works in v0.1.0

- The Manna page loads, privately, with the quiet header and the Word/work layout.
- The Supabase schema (five tables) is defined.
- The first theme — *abiding* — and its eight anchor passages are seeded.
- The page reads the active theme and its passages from the database.

## What is not built yet

- The devotional reflection (v0.1.2)
- The Bible text fetch (v0.1.2)
- The Zoho email pull and synthesis (v0.1.3)
- The delegate / schedule actions (v0.1.4)
- The morning Cron job (v0.1.5)

## Running it

See `INSTRUCTIONS.md` (in the update package) for full setup. In short:

1. Create a Supabase project; run `db/schema_v0.1.0.sql` in its SQL Editor.
2. Copy `.env.local.example` to `.env.local`; fill in the two Supabase values.
3. `npm install` then `npm run dev`; open the local URL.

## Stack

Next.js · Supabase · Vercel · GitHub — the same stack as the Transworld
accounting platform and the Vitalis Portal.
