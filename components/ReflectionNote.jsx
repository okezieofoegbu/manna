'use client';

// components/ReflectionNote.jsx
//
// v0.1.7.1 — the user's margin note on each day's devotional. Sits
// below the "For deeper study" links, above the divider that
// introduces the brief. Owner-only on both render (gated by the
// parent page) and persistence (gated by the API route).
//
// Behavior:
//   - On mount: fetch the saved note for this date.
//   - User types: local state updates immediately, no save.
//   - On blur: if the value changed since last load, save to server.
//     A quiet "Saved" indicator fades in for ~2 seconds.
//   - Saves are whole-value replacement, not append. Last save wins.
//
// Auto-grows with content. No save button — the absence of one
// reinforces the quiet, no-friction character of the field.
//
// Same component is used on both the home page (with today's date)
// and /days/[date] (with that day's date). Date is opaque to the
// component beyond passing it to the API.

import { useState, useEffect, useRef } from 'react';

export default function ReflectionNote({ date }) {
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  // Load current note for this date.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/devotional/note?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) {
          throw new Error(json?.detail || json?.error || 'load_failed');
        }
        const text = json.note || '';
        setNote(text);
        setSavedNote(text);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Auto-grow the textarea to fit content.
  useEffect(() => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [note]);

  // Hide "Saved" after a short delay.
  useEffect(() => {
    if (!savedAt) return;
    const id = setTimeout(() => setSavedAt(null), 2200);
    return () => clearTimeout(id);
  }, [savedAt]);

  async function save() {
    if (note === savedNote) return; // nothing changed
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/devotional/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      }
      setSavedNote(note);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="manna-reflection-note">
      <div className="manna-reflection-note-label">Your thoughts</div>
      <textarea
        ref={textareaRef}
        className="manna-reflection-note-textarea"
        value={loading ? '' : note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
        placeholder={loading ? '' : 'A line, a question, a prayer — whatever stays with you.'}
        disabled={loading || saving}
        rows={2}
        maxLength={20000}
      />
      <div className="manna-reflection-note-status">
        {error && <span className="manna-reflection-note-error">Couldn&rsquo;t save: {error}</span>}
        {!error && saving && <span>Saving…</span>}
        {!error && !saving && savedAt && <span>Saved.</span>}
      </div>
    </div>
  );
}
