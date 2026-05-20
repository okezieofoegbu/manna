-- ===========================================================================
-- Manna — v0.1.2 migration  (the devotional engine)
-- ===========================================================================
-- Run this ONCE in the Supabase SQL Editor as part of the v0.1.2 setup. The
-- v0.1.1 corrected base schema is already live; this is only the delta.
--
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / DROP POLICY IF
-- EXISTS / a re-runnable UPDATE).
-- ===========================================================================

-- --- 1. Schema changes -----------------------------------------------------

-- The daily lens (contemplative | grace_faith | stretch). STATE_OF_APP 8h.
alter table devotional_days add column if not exists lens text;

-- The FUMS snippet for the day's passage. API.Bible's Fair Use Management
-- System requires a tracking snippet on any page that displays verse text;
-- it is captured at fetch time and rendered on the page. (STATE_OF_APP 8b.)
alter table devotional_days add column if not exists passage_fums text;

-- The page reads the devotional with the anon key, so devotional_days needs
-- a public read policy. Writes happen server-side with the service-role key,
-- which bypasses RLS — so no insert policy is needed for the anon key.
drop policy if exists "Public read access to devotional_days" on devotional_days;
create policy "Public read access to devotional_days"
  on devotional_days for select using (true);

-- --- 2. Curated further-reading (a DRAFT set — review and edit freely) -----
-- Two or three trusted-source links per abiding passage. Drawn only from the
-- three lens groups (contemplative / grace-faith / stretch). These are a
-- starting draft: the URLs in particular should be checked and the
-- selections refined with pastoral intent. (STATE_OF_APP 8f.)

update theme_passages tp
set further_reading = v.links::jsonb
from (values
  ('John 15:1-11', '[
    {"title":"The Divine Conspiracy (on the with-God life)","author":"Dallas Willard","url":"https://renovare.org/books/the-divine-conspiracy"},
    {"title":"Sermons on abiding and union with Christ","author":"Timothy Keller","url":"https://gospelinlife.com"},
    {"title":"Gospel of John — video study","author":"BibleProject","url":"https://bibleproject.com/explore/video/gospel-john/"}
  ]'),
  ('Psalm 91:1', '[
    {"title":"Dwelling in the secret place — teaching on Psalm 91","author":"Andrew Wommack Ministries","url":"https://www.awmi.net"},
    {"title":"From loneliness to solitude — the inner room","author":"Henri Nouwen Society","url":"https://henrinouwen.org"},
    {"title":"On the sheltered life with God","author":"Renovare","url":"https://renovare.org"}
  ]'),
  ('Psalm 27:4', '[
    {"title":"Sermons on Psalm 27 — the one thing","author":"Timothy Keller","url":"https://gospelinlife.com"},
    {"title":"Sacred Rhythms — longing and desire for God","author":"Ruth Haley Barton","url":"https://transformingcenter.org"},
    {"title":"Beholding the beauty of the Lord","author":"Renovare","url":"https://renovare.org"}
  ]'),
  ('1 John 2:24-28', '[
    {"title":"Teaching and commentary on 1 John","author":"N.T. Wright","url":"https://ntwrightpage.com"},
    {"title":"You have an anointing — abiding and assurance","author":"Andrew Wommack Ministries","url":"https://www.awmi.net"},
    {"title":"Practicing the Way — abiding in the teaching of Jesus","author":"John Mark Comer / Practicing the Way","url":"https://practicingtheway.org"}
  ]'),
  ('John 8:31-32', '[
    {"title":"Apprenticeship to Jesus and the freedom of truth","author":"Renovare (Dallas Willard stream)","url":"https://renovare.org"},
    {"title":"Sermons on truth and freedom in John 8","author":"Timothy Keller","url":"https://gospelinlife.com"},
    {"title":"Abiding in the Word — a Reformed reflection","author":"Desiring God (Edwards / Owen stream)","url":"https://www.desiringgod.org"}
  ]'),
  ('Psalm 1:1-3', '[
    {"title":"Psalms — video overview","author":"BibleProject","url":"https://bibleproject.com/explore/video/psalms/"},
    {"title":"Practicing the Way — rootedness and unhurried life","author":"John Mark Comer / Practicing the Way","url":"https://practicingtheway.org"},
    {"title":"On the inner life and being rooted","author":"Thomas Merton Center","url":"https://merton.org"}
  ]'),
  ('Colossians 3:1-4', '[
    {"title":"Teaching on Colossians — raised with Christ","author":"N.T. Wright","url":"https://ntwrightonline.org"},
    {"title":"Hidden with Christ — identity in Christ","author":"Andrew Wommack Ministries","url":"https://www.awmi.net"},
    {"title":"Life of the Beloved","author":"Henri Nouwen Society","url":"https://henrinouwen.org"}
  ]'),
  ('Exodus 33:14-15', '[
    {"title":"The with-God life — God''s presence as our rest","author":"Renovare (Dallas Willard stream)","url":"https://renovare.org"},
    {"title":"Sermons on the presence of God in Exodus","author":"Timothy Keller","url":"https://gospelinlife.com"},
    {"title":"The presence of God — an Orthodox reflection","author":"Ancient Faith (Kallistos Ware stream)","url":"https://www.ancientfaith.com"}
  ]')
) as v(reference, links)
where tp.reference = v.reference
  and tp.theme_id = (select id from themes where name = 'Abiding' limit 1);

-- --- 3. Verify -------------------------------------------------------------
-- Run these after the migration to confirm it took:
--   select reference, lens is null as lens_col_exists from devotional_days limit 1;
--   select reference, jsonb_array_length(further_reading) as links
--     from theme_passages order by sort_order;
-- Expect: eight rows, each with 2-3 links.
