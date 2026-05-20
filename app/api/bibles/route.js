// =============================================================================
// Manna — /api/bibles  (diagnostic)
// =============================================================================
// A small verification helper, not part of the daily rhythm. Visit it once
// after adding the API.Bible key to confirm which of the preferred
// translations the account actually grants:
//
//   NKJV (primary) -> NLT -> NIV, with WEB as the public-domain safety net.
//
// If NKJV is not granted, the engine falls back automatically — this route
// just makes the situation visible. See STATE_OF_APP.md Section 8b.
// =============================================================================

import { NextResponse } from 'next/server';
import { resolveBibleIds, TRANSLATION_PREFERENCE } from '@/lib/bible';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ids = await resolveBibleIds();
    const translations = TRANSLATION_PREFERENCE.map((p) => ({
      abbreviation: p.abbr,
      label: p.label,
      available: Boolean(ids[p.abbr]),
      bibleId: ids[p.abbr] || null,
    }));
    const primary = translations.find((t) => t.available);
    return NextResponse.json({
      ok: true,
      preferenceOrder: TRANSLATION_PREFERENCE.map((p) => p.abbr),
      translations,
      activePrimary: primary ? primary.abbreviation : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
