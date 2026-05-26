// lib/share-image.jsx
//
// The JSX component @vercel/og renders into the share PNG. v0.1.8.3.1.
//
// Design — based on the v0.1.8.2 mockup (Python PIL aspirational
// layout), refined through v0.1.8.3 (inline emphasis now works) and
// v0.1.8.3.1 (justified body + taller frame to fit long reflections).
//
// 1200x2000 portrait, warm gradient cream→deeper-cream, centered
// header, date and theme line, passage reference, centered passage
// italic, small centered rule, reflection body with bold-italic
// emphasis on *...* segments flowing inline word-by-word, justified,
// footer.
//
// v0.1.8.3 → v0.1.8.3.1 changes:
//
// 1. Image height bumped 1800 → 2000. v0.1.8.3 on a long reflection
//    overflowed the 1800px frame; the absolutely-positioned footer
//    sat on top of the last paragraph. Adding 200px of vertical
//    room handles the longest reflections we're likely to see.
//
// 2. textAlign: 'justify' added to the reflection paragraph divs.
//    EXPERIMENTAL — satori's flex layout may or may not honor
//    text-align on a flex container with word-span children. If
//    satori does honor it, we get justified body text for free.
//    If not, the layout falls back to left-aligned (same as
//    v0.1.8.3), which already reads well.
//
// v0.1.8.3 baseline (still in effect):
//
// - Reflection paragraphs use word-by-word flex spans for inline
//   emphasis. CONFIRMED WORKING on Vercel — *...* phrases flow
//   inline with surrounding text instead of breaking as block
//   fragments. Each word becomes a one-word-wide flex item that
//   wraps naturally as paragraph text.
//
// - flexShrink: 0 on passage, small rule, and reflection body.
//   Prevents satori from compressing upper items to fit lower
//   content (fixed the passage/body overlap from v0.1.8.2.2).
//
// Satori CSS rules followed throughout:
// - Every <div> with multiple children has explicit display:'flex'.
// - Inline styles only, no className.
// - Width and height required on root.
// - The asterisk-emphasis parser mirrors renderInline() in
//   app/page.js so the bold-italic phrasing stays consistent
//   between the live page and the share image — at the run level.
//   The word-level expansion happens only at render time.

import React from 'react';

const COLORS = {
  ink: '#2C241C',
  inkSoft: '#6E5F50',
  amber: '#B5842F',
  creamTop: '#FDF8EE',
  creamBottom: '#F4E6CD',
};

// Parse *...* segments into a list of { text, emphasis } runs.
// Mirrors app/page.js renderInline() — same regex, same semantics.
function parseRuns(text) {
  const runs = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      runs.push({ text: text.slice(last, m.index), emphasis: false });
    }
    runs.push({ text: m[1], emphasis: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last), emphasis: false });
  }
  if (runs.length === 0) {
    runs.push({ text, emphasis: false });
  }
  return runs;
}

// Split reflection into paragraphs (blank-line separated). Mirrors
// the Reflection component in app/page.js.
function splitParagraphs(reflection) {
  if (!reflection) return [];
  return reflection
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Strip API.Bible verse-number brackets [1] [2] etc. from passage text
// for the share image. The live page renders them as superscripts via
// PassageText; in the image we omit them to keep the typography clean.
function stripVerseBrackets(text) {
  if (!text) return '';
  return String(text).replace(/\[\d+\]\s*/g, '').replace(/\s+/g, ' ').trim();
}

// Expand runs into word-tokens for satori inline flow. Each token is
// "word " (non-whitespace followed by optional trailing whitespace).
// Each token carries the emphasis flag of its parent run, so emphasis
// renders correctly even though the run is now multiple flex items.
//
// The trailing space is rendered via whiteSpace: 'pre' on the span,
// which gives satori the correct inter-word gap. When a token wraps
// to a new line via flexWrap, the trailing space sits at the line
// break — invisible to the eye.
function tokenizeRunsToWords(runs) {
  const words = [];
  runs.forEach((run, runIdx) => {
    const tokens = run.text.match(/\S+\s*/g) || [];
    tokens.forEach((token, tokenIdx) => {
      words.push({
        text: token,
        emphasis: run.emphasis,
        key: `${runIdx}-${tokenIdx}`,
      });
    });
  });
  return words;
}

export function ShareImage({
  longDate,
  themeName,
  morningCount,
  passageReference,
  passageText,
  reflection,
}) {
  const paragraphs = splitParagraphs(reflection);
  const passageClean = stripVerseBrackets(passageText);
  const themeLineText =
    morningCount > 0 ? `${themeName} — morning ${morningCount}` : themeName;

  // Single string so the date+theme div has exactly one text-node child.
  const dateThemeLine = `${longDate} · ${themeLineText}`;
  const passageRefUpper = (passageReference || '').toUpperCase();

  return (
    <div
      style={{
        width: 1200,
        height: 2000,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(180deg, ${COLORS.creamTop} 0%, ${COLORS.creamBottom} 100%)`,
        fontFamily: 'Lora',
        color: COLORS.ink,
        padding: '90px 110px',
        position: 'relative',
      }}
    >
      {/* Soft top glow — faint radial gradient suggesting dawn light. */}
      <div
        style={{
          position: 'absolute',
          top: -200,
          left: 0,
          right: 0,
          height: 500,
          background:
            'radial-gradient(ellipse at center top, rgba(255, 235, 195, 0.4) 0%, rgba(255, 235, 195, 0) 70%)',
          display: 'flex',
        }}
      />

      {/* Header: Manna · Word before work · amber rule (3 children) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: 40,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 38, color: COLORS.ink, marginBottom: 6, display: 'flex' }}>
          Manna
        </div>
        <div
          style={{
            fontSize: 24,
            color: COLORS.inkSoft,
            fontStyle: 'italic',
            marginBottom: 20,
            display: 'flex',
          }}
        >
          Word before work.
        </div>
        <div
          style={{
            width: 80,
            height: 2,
            backgroundColor: COLORS.amber,
            display: 'flex',
          }}
        />
      </div>

      {/* Date and theme line — single text child */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          fontSize: 24,
          color: COLORS.inkSoft,
          marginBottom: 50,
          flexShrink: 0,
        }}
      >
        {dateThemeLine}
      </div>

      {/* Passage reference — single text child */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          fontSize: 28,
          color: COLORS.amber,
          letterSpacing: 2,
          marginBottom: 40,
          flexShrink: 0,
        }}
      >
        {passageRefUpper}
      </div>

      {/* Passage text — single text child. flexShrink: 0 + marginBottom 70. */}
      <div
        style={{
          display: 'flex',
          alignSelf: 'center',
          textAlign: 'center',
          fontStyle: 'italic',
          fontSize: 34,
          lineHeight: 1.4,
          maxWidth: 870,
          marginBottom: 70,
          color: COLORS.ink,
          flexShrink: 0,
        }}
      >
        {passageClean}
      </div>

      {/* Small centered rule. flexShrink: 0. */}
      <div
        style={{
          display: 'flex',
          alignSelf: 'center',
          width: 30,
          height: 1,
          backgroundColor: COLORS.amber,
          marginBottom: 40,
          flexShrink: 0,
        }}
      />

      {/* Reflection body — column of paragraph blocks. flexShrink: 0. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 30,
          lineHeight: 1.5,
          color: COLORS.ink,
          flexShrink: 0,
        }}
      >
        {paragraphs.map((para, i) => {
          const runs = parseRuns(para);
          const words = tokenizeRunsToWords(runs);
          return (
            // v0.1.8.3.1 — textAlign: 'justify' added.
            // Experimental: satori may or may not honor it on a flex
            // container with word-span children. If yes, justified
            // body text. If no, falls back to left-aligned.
            <div
              key={i}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                marginBottom: 26,
                flexShrink: 0,
                textAlign: 'justify',
              }}
            >
              {words.map((w) => (
                <span
                  key={w.key}
                  style={{
                    fontStyle: w.emphasis ? 'italic' : 'normal',
                    fontWeight: w.emphasis ? 700 : 400,
                    whiteSpace: 'pre',
                  }}
                >
                  {w.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer pinned at the bottom — single text child. Anchored to
          bottom: 60 of the now-2000-tall frame. */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          fontSize: 20,
          fontStyle: 'italic',
          color: COLORS.inkSoft,
        }}
      >
        manna · a private morning page
      </div>
    </div>
  );
}
