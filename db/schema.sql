-- ===========================================================================
-- Manna — database schema  (current through v0.1.2)
-- ===========================================================================
-- This is the AUTHORITATIVE, complete schema for Manna's Supabase database.
-- It supersedes the original `db/schema_v0.1.0.sql`, which was the pre-fix
-- schema (missing the themes unique constraint and the RLS read policies that
-- were added live during v0.1.0 setup).
--
-- It folds in:
--   * the v0.1.0 base schema — five tables;
--   * the v0.1.1 corrections — `themes_name_unique`, and RLS read policies on
--     `themes` and `theme_passages` (see PITFALLS.md Section 6);
--   * the v0.1.2 devotional-engine changes — `devotional_days.lens`,
--     `devotional_days.passage_fums`, and a public read policy on
--     `devotional_days` (see DB_SCHEMA.md Section 6).
--
-- The live database on the owner's Supabase project already has every object
-- below. This file exists so the repository matches reality and a fresh
-- install is possible. EVERY statement is guarded (IF NOT EXISTS / DROP
-- POLICY IF EXISTS / ON CONFLICT) so the whole file is safe to re-run.
--
-- A fresh setup runs this file once, top to bottom, in the Supabase SQL
-- Editor. An existing install needs only the v0.1.2 delta — see
-- `db/migrate_v0.1.2.sql`.
-- ===========================================================================


-- ===========================================================================
-- 1. TABLES
-- ===========================================================================

-- --- themes -----------------------------------------------------------------
-- The devotional theme library. One theme is active at a time; Manna walks
-- its anchor passages slowly, morning by morning.
create table if not exists themes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- v0.1.1 fix: the original seed used `on conflict do nothing` with no unique
-- constraint to act on, which let a duplicate "Abiding" row through. A unique
-- constraint on the name makes the seed genuinely idempotent.
alter table themes drop constraint if exists themes_name_unique;
alter table themes add constraint themes_name_unique unique (name);

-- --- theme_passages ---------------------------------------------------------
-- The anchor passages of a theme, in the order they are served. Each carries
-- a curated further-reading set (v0.1.2) as JSONB: an array of
-- { title, author, url } objects.
create table if not exists theme_passages (
  id              uuid primary key default gen_random_uuid(),
  theme_id        uuid not null references themes (id) on delete cascade,
  reference       text not null,
  sort_order      integer not null default 0,
  further_reading jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists theme_passages_theme_id_idx
  on theme_passages (theme_id);

-- --- devotional_days --------------------------------------------------------
-- One row per calendar day — the devotional that was served that morning.
-- `date` is UNIQUE: it is the idempotency key (one devotional per day) and it
-- makes a concurrent first page load safe.
--
--   passage_text  the Bible text as fetched from API.Bible (v0.1.2)
--   reflection    the generated morning reflection (v0.1.2)
--   lens          the day's lens: contemplative | grace_faith | stretch
--                 (v0.1.2 — see DB_SCHEMA.md Section 6 and lib/lens.js)
--   passage_fums  API.Bible's FUMS tracking snippet for the day's passage,
--                 rendered on the page (v0.1.2 — see PITFALLS.md Section 4)
create table if not exists devotional_days (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  theme_id     uuid references themes (id) on delete set null,
  passage_id   uuid references theme_passages (id) on delete set null,
  passage_text text,
  reflection   text,
  lens         text,
  passage_fums text,
  created_at   timestamptz not null default now()
);

alter table devotional_days drop constraint if exists devotional_days_date_unique;
alter table devotional_days add constraint devotional_days_date_unique unique (date);

-- --- brief_items ------------------------------------------------------------
-- The curated Transworld inbox items. Defined now; first written in v0.1.3.
create table if not exists brief_items (
  id               uuid primary key default gen_random_uuid(),
  devotional_day_id uuid references devotional_days (id) on delete cascade,
  source           text,
  summary          text,
  priority         integer not null default 0,
  created_at       timestamptz not null default now()
);

-- --- actions ----------------------------------------------------------------
-- Actions taken on brief items — done, delegate, schedule. Defined now; first
-- written in v0.1.4.
create table if not exists actions (
  id            uuid primary key default gen_random_uuid(),
  brief_item_id uuid references brief_items (id) on delete cascade,
  kind          text,
  state         text,
  created_at    timestamptz not null default now()
);


-- ===========================================================================
-- 2. ROW LEVEL SECURITY
-- ===========================================================================
-- RLS is ON for all five tables. Read policies are granted only where the
-- page needs to read with the anon key. All writes happen server-side with
-- the service-role key, which bypasses RLS — so no insert/update policies are
-- needed.

alter table themes          enable row level security;
alter table theme_passages  enable row level security;
alter table devotional_days enable row level security;
alter table brief_items     enable row level security;
alter table actions         enable row level security;

-- v0.1.1: the page reads the theme library with the anon key.
drop policy if exists "Public read access to themes" on themes;
create policy "Public read access to themes"
  on themes for select using (true);

drop policy if exists "Public read access to theme_passages" on theme_passages;
create policy "Public read access to theme_passages"
  on theme_passages for select using (true);

-- v0.1.2: the page reads the day's devotional with the anon key.
drop policy if exists "Public read access to devotional_days" on devotional_days;
create policy "Public read access to devotional_days"
  on devotional_days for select using (true);

-- brief_items and actions intentionally have RLS on with NO policy — they are
-- locked until the version that uses them (v0.1.3 / v0.1.4).


-- ===========================================================================
-- 3. SEED — the first theme: Abiding
-- ===========================================================================
-- One theme, eight anchor passages. Re-runnable: the unique constraints make
-- the `on conflict` clauses genuinely idempotent.

insert into themes (name, description, is_active, sort_order)
values (
  'Abiding',
  'To remain in Christ — the unhurried, rooted life of a branch in the vine. '
  'Not striving, but staying; not performing, but dwelling.',
  true,
  1
)
on conflict (name) do nothing;

-- The eight anchor passages of Abiding, in served order.
insert into theme_passages (theme_id, reference, sort_order)
select t.id, p.reference, p.sort_order
from themes t
cross join (values
  ('John 15:1-11',   1),
  ('Psalm 91:1',     2),
  ('Psalm 27:4',     3),
  ('1 John 2:24-28', 4),
  ('John 8:31-32',   5),
  ('Psalm 1:1-3',    6),
  ('Colossians 3:1-4', 7),
  ('Exodus 33:14-15', 8)
) as p(reference, sort_order)
where t.name = 'Abiding'
on conflict do nothing;

-- The curated further-reading set for each passage is applied by
-- `db/migrate_v0.1.2.sql` (a re-runnable UPDATE). It is kept in the migration
-- file, rather than inlined here, so the draft links stay in one place for
-- the owner to review and refine. See STATE_OF_APP.md Section 8f.


-- ===========================================================================
-- 4. VERIFY
-- ===========================================================================
-- After running this file, these should all hold:
--   select count(*) from themes;                       -- 1
--   select count(*) from theme_passages;               -- 8
--   select name, is_active from themes;                -- Abiding, true
--   select reference from theme_passages order by sort_order;  -- 8 rows
-- ===========================================================================
