-- ===========================================================================
-- Manna — Database Schema and Seed · v0.1.0
-- ===========================================================================
-- Run this entire file in the Supabase SQL Editor:
--   Supabase project > SQL Editor > New query > paste all of this > Run.
--
-- It is safe to re-run. Every CREATE uses IF NOT EXISTS, and the seed
-- uses ON CONFLICT so it will not create duplicate rows.
-- ===========================================================================

-- --- Table 1: themes -------------------------------------------------------
-- The theme library — Manna's curated devotional curriculum.
create table if not exists themes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  sort_order  int  not null default 0,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- --- Table 2: theme_passages ----------------------------------------------
-- The hand-curated anchor passages within each theme.
create table if not exists theme_passages (
  id              uuid primary key default gen_random_uuid(),
  theme_id        uuid not null references themes(id) on delete cascade,
  reference       text not null,
  sort_order      int  not null default 0,
  further_reading jsonb default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

-- --- Table 3: devotional_days ---------------------------------------------
-- One row per morning — the devotional that was served, kept as history.
create table if not exists devotional_days (
  id           uuid primary key default gen_random_uuid(),
  date         date not null unique,
  theme_id     uuid references themes(id),
  passage_id   uuid references theme_passages(id),
  passage_text text,
  reflection   text,
  created_at   timestamptz not null default now()
);

-- --- Table 4: brief_items --------------------------------------------------
-- The synthesized email items — the day's brief, with state.
create table if not exists brief_items (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  source_email_id text,
  source_link     text,
  sender          text,
  subject         text,
  category        text check (category in ('urgent','schedule','delegate','fyi')),
  synthesis       text,
  suggested_owner text,
  time_estimate   int,
  state           text not null default 'new'
                    check (state in ('new','done','delegated','scheduled')),
  created_at      timestamptz not null default now()
);

-- --- Table 5: actions ------------------------------------------------------
-- A record of what was done from the brief — delegations and scheduled blocks.
create table if not exists actions (
  id            uuid primary key default gen_random_uuid(),
  brief_item_id uuid references brief_items(id) on delete cascade,
  action_type   text check (action_type in ('delegated','scheduled')),
  detail        jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- --- Helpful indexes -------------------------------------------------------
create index if not exists idx_theme_passages_theme on theme_passages(theme_id);
create index if not exists idx_devotional_days_date on devotional_days(date);
create index if not exists idx_brief_items_date     on brief_items(date);
create index if not exists idx_brief_items_state    on brief_items(state);
create index if not exists idx_actions_brief_item   on actions(brief_item_id);

-- ===========================================================================
-- Seed: the first theme — abiding
-- ===========================================================================
-- Inserts the 'Abiding' theme and its eight anchor passages.
-- ON CONFLICT keeps this safe to re-run.

insert into themes (name, description, sort_order, is_active)
values (
  'Abiding',
  'A slow walk through what it means to remain in Christ — to dwell, to stay, to be rooted. The first theme of Manna.',
  1,
  true
)
on conflict do nothing;

-- Insert the eight anchor passages, linked to the Abiding theme.
-- The WITH clause finds the theme id by name so this block is self-contained.
with t as (
  select id from themes where name = 'Abiding' limit 1
)
insert into theme_passages (theme_id, reference, sort_order)
select t.id, v.reference, v.sort_order
from t, (values
  ('John 15:1-11',     1),
  ('Psalm 91:1',       2),
  ('Psalm 27:4',       3),
  ('1 John 2:24-28',   4),
  ('John 8:31-32',     5),
  ('Psalm 1:1-3',      6),
  ('Colossians 3:1-4', 7),
  ('Exodus 33:14-15',  8)
) as v(reference, sort_order)
where not exists (
  select 1 from theme_passages tp
  where tp.theme_id = t.id and tp.reference = v.reference
);

-- ===========================================================================
-- Verify (optional) — run these after the above to confirm the seed.
-- ===========================================================================
-- select name, is_active from themes;
-- select reference, sort_order from theme_passages order by sort_order;
-- Expect: one theme 'Abiding' (is_active = true), and eight passages.
-- ===========================================================================
