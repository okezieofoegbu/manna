// app/api/devotional/image/[date]/route.js
//
// GET /api/devotional/image/[date]
// Owner-only. v0.1.8.2.
//
// Generates a PNG share image of the devotional for the given date.
// Returns 404 if no devotional exists for that date, 401/403 for auth,
// image bytes on success.
//
// Image is 1200x1800 portrait, warm-gradient background, justified body
// with bold-italic emphasis on *...* segments. The reflection note
// (devotional_days.reflection_note) is NEVER read or rendered — it is
// private to the owner.
//
// Fonts: Lora (regular + italic, variable) bundled at public/fonts/.
// Uses Node runtime (not edge) so fs.readFileSync can load the font
// files. The fonts are read once at module init and cached.
//
// Mirrors the join shape from app/days/[date]/page.js so the data
// access pattern stays consistent across the surface.

import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getServiceClient } from '@/lib/supabase';
import { ShareImage } from '@/lib/share-image';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

// Cache the loaded fonts at module scope so they only read from disk once
// per server instance.
let cachedFonts = null;
function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const fontsDir = join(process.cwd(), 'public', 'fonts');
  const regular = readFileSync(join(fontsDir, 'Lora-Regular.ttf'));
  const italic = readFileSync(join(fontsDir, 'Lora-Italic.ttf'));
  cachedFonts = { regular, italic };
  return cachedFonts;
}

// Mirror of the isValidDate helper from app/api/devotional/note/route.js
// and app/days/[date]/page.js — calendar-correct, not just regex-valid.
function isValidDate(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// Render "Tuesday, May 26, 2026" from "2026-05-26", TZ-safe.
function formatLongDate(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Compute "morning N" for the given date within its theme. For today's
// devotional this matches getThemeMorningCount(); for a past day we
// count how many devotional_days rows exist for the same theme up to
// and including this date. Returns 0 on any error.
async function getMorningCountForDate(supa, themeId, date) {
  try {
    const { count, error } = await supa
      .from('devotional_days')
      .select('id', { count: 'exact', head: true })
      .eq('theme_id', themeId)
      .lte('date', date);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function GET(request, { params }) {
  // Auth: owner only.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  if (user.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const { date } = await params;
  if (!isValidDate(date)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_date', detail: 'date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  // Fetch the devotional day — same join shape as app/days/[date]/page.js
  // but WITHOUT reflection_note. The note is private to the owner and
  // never appears on the share image.
  const supa = getServiceClient();
  const { data: day, error } = await supa
    .from('devotional_days')
    .select(
      `
      date,
      passage_text,
      reflection,
      theme_id,
      themes:themes(name),
      theme_passages:theme_passages(reference)
    `,
    )
    .eq('date', date)
    .maybeSingle();

  if (error) {
    console.error('[image route] devotional_days fetch failed:', error);
    return NextResponse.json(
      { ok: false, error: 'db_error', detail: String(error.message || error).slice(0, 200) },
      { status: 500 },
    );
  }
  if (!day) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const themeName = day.themes?.name ?? 'Devotional';
  const passageReference = day.theme_passages?.reference ?? '';
  const passageText = day.passage_text ?? '';
  const reflection = day.reflection ?? '';
  const longDate = formatLongDate(day.date);
  const morningCount = await getMorningCountForDate(supa, day.theme_id, day.date);

  let fonts;
  try {
    fonts = loadFonts();
  } catch (e) {
    console.error('[image route] font load failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'font_load_failed',
        detail: String(e?.message || e).slice(0, 200),
      },
      { status: 500 },
    );
  }

  try {
    return new ImageResponse(
      (
        <ShareImage
          longDate={longDate}
          themeName={themeName}
          morningCount={morningCount}
          passageReference={passageReference}
          passageText={passageText}
          reflection={reflection}
        />
      ),
      {
        width: 1200,
        height: 1800,
        fonts: [
          { name: 'Lora', data: fonts.regular, style: 'normal', weight: 400 },
          { name: 'Lora', data: fonts.regular, style: 'normal', weight: 700 },
          { name: 'Lora', data: fonts.italic,  style: 'italic', weight: 400 },
          { name: 'Lora', data: fonts.italic,  style: 'italic', weight: 700 },
        ],
        headers: {
          // Don't cache — owner fetches once per day, server-side cost is trivial.
          'Cache-Control': 'private, max-age=0, no-store',
        },
      },
    );
  } catch (e) {
    console.error('[image route] ImageResponse failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'image_render_failed',
        detail: String(e?.message || e).slice(0, 200),
      },
      { status: 500 },
    );
  }
}
