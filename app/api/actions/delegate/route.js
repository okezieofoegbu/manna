// app/api/actions/delegate/route.js
//
// v0.1.5 — log a delegation of a brief item to one of the configured
// Transworld colleagues. Owner-only.
//
// The actual email composition happens client-side: the client picks
// a recipient from the dropdown, calls this route to log the action,
// and then opens a compose window via window.open() — either the
// Zoho webmail compose URL or a mailto: link. The route returns the
// recipient's email so the client can build either URL.
//
// Body: { brief_item_id: string, recipient_key: string }
// Returns: { ok: true, item_id, state: 'delegated', action_id,
//            recipient: { key, display_name, email } }
//
// Design note: by recording the delegation server-side BEFORE the
// client opens the compose window, the audit trail is intact even
// if the user closes the compose window without sending. The
// audit answers "I marked this delegated" — not "I confirm an
// email was sent." That's by intent (see INSTRUCTIONS.md §11(a)).

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { recordDelegated } from '@/lib/actions';
import { getRecipientByKey } from '@/lib/delegate-recipients';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'unauthenticated' },
      { status: 401 },
    );
  }
  if (user.role !== 'owner') {
    return NextResponse.json(
      { ok: false, error: 'forbidden' },
      { status: 403 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const briefItemId = body?.brief_item_id;
  const recipientKey = body?.recipient_key;
  if (!briefItemId || !recipientKey) {
    return NextResponse.json(
      { ok: false, error: 'missing_fields' },
      { status: 400 },
    );
  }

  let recipient;
  try {
    recipient = await getRecipientByKey(recipientKey);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: 'recipient_lookup_failed',
        detail: String(e?.message || e).slice(0, 300),
      },
      { status: 500 },
    );
  }
  if (!recipient) {
    return NextResponse.json(
      { ok: false, error: 'unknown_recipient' },
      { status: 400 },
    );
  }

  try {
    const result = await recordDelegated(briefItemId, {
      key: recipient.key,
      email: recipient.email,
      displayName: recipient.display_name,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      recipient: {
        key: recipient.key,
        display_name: recipient.display_name,
        email: recipient.email,
      },
    });
  } catch (e) {
    console.error('delegate action failed:', e);
    return NextResponse.json(
      {
        ok: false,
        error: 'delegate_failed',
        detail: String(e?.message || e).slice(0, 500),
      },
      { status: 500 },
    );
  }
}
