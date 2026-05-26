'use client';

// components/ShareButton.jsx
//
// "Share this morning" button. v0.1.8.2.
//
// Owner-only (parent is responsible for not rendering this for readers
// — see app/page.js where it's gated by user.role === 'owner').
//
// Tap behavior:
//   1. Fetch /api/devotional/image/[date] as a PNG blob.
//   2. Try the Web Share API with files (works on iOS Safari, modern
//      Android Chrome, and some desktop browsers).
//   3. Fall back to a direct download if Web Share isn't available.
//
// Disabled and shows "Preparing…" while the image is being fetched.

import { useState } from 'react';

export default function ShareButton({ date }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleShare() {
    if (busy) return;
    setError(null);
    setBusy(true);

    try {
      const res = await fetch(`/api/devotional/image/${date}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Image fetch failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const filename = `manna-${date}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      // Try Web Share API with files (mobile-first, but increasingly
      // supported on desktop too).
      const canShareFile =
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFile) {
        try {
          await navigator.share({
            files: [file],
            title: 'Manna',
            text: 'Manna — Word before work.',
          });
          return;
        } catch (shareErr) {
          // AbortError = user cancelled the share sheet. Don't fall through.
          if (shareErr && shareErr.name === 'AbortError') {
            return;
          }
          // Other Web Share errors — fall through to download.
        }
      }

      // Desktop fallback: trigger a download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Slight delay before revoking — some browsers need the URL alive briefly.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('[ShareButton] failed:', e);
      setError(String(e?.message || e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manna-share">
      <button
        type="button"
        className="manna-share-btn"
        onClick={handleShare}
        disabled={busy}
        aria-busy={busy ? 'true' : 'false'}
      >
        {busy ? 'Preparing…' : 'Share this morning'}
      </button>
      {error && <div className="manna-share-error">{error}</div>}
    </div>
  );
}
