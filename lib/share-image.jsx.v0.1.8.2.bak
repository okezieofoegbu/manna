// lib/share-image.jsx
//
// The JSX component @vercel/og renders into the share PNG. v0.1.8.2.
//
// Design — locked from the mockup:
//   1200x1800 portrait, warm gradient cream→deeper-cream, centered
//   header (Manna · Word before work · amber rule · date and theme
//   · passage reference · centered passage italic · small centered
//   rule · justified reflection body with bold-italic emphasis on
//   *...* segments · footer).
//
// IMPORTANT: @vercel/og uses satori under the hood, which supports a
// subset of CSS. Inline styles only, no className. Flex must specify
// display:'flex' when a node has multiple children. Width and height
// required on root. The asterisk-emphasis parser mirrors the shape
// of renderInline() in app/page.js so the bold-italic phrasing
// stays consistent between the live page and the share image.

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
  const themeLine =
    morningCount > 0 ? `${themeName} — morning ${morningCount}` : themeName;

  return (
    <div
      style={{
        width: 1200,
        height: 1800,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(180deg, ${COLORS.creamTop} 0%, ${COLORS.creamBottom} 100%)`,
        fontFamily: 'Lora',
        color: COLORS.ink,
        padding: '90px 110px',
        position: 'relative',
      }}
    >
      {/* Soft top glow — faint radial gradient suggesting dawn light */}
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

      {/* Header: Manna · Word before work · amber rule */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: 40,
        }}
      >
        <div style={{ fontSize: 38, color: COLORS.ink, marginBottom: 6 }}>Manna</div>
        <div
          style={{
            fontSize: 24,
            color: COLORS.inkSoft,
            fontStyle: 'italic',
            marginBottom: 20,
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

      {/* Date and theme line */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          fontSize: 24,
          color: COLORS.inkSoft,
          marginBottom: 50,
        }}
      >
        {longDate}   ·   {themeLine}
      </div>

      {/* Passage reference */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          fontSize: 28,
          color: COLORS.amber,
          letterSpacing: 2,
          marginBottom: 40,
        }}
      >
        {(passageReference || '').toUpperCase()}
      </div>

      {/* Passage text — centered, italic */}
      <div
        style={{
          display: 'flex',
          alignSelf: 'center',
          textAlign: 'center',
          fontStyle: 'italic',
          fontSize: 34,
          lineHeight: 1.4,
          maxWidth: 870,
          marginBottom: 50,
          color: COLORS.ink,
        }}
      >
        {passageClean}
      </div>

      {/* Small centered rule */}
      <div
        style={{
          display: 'flex',
          alignSelf: 'center',
          width: 30,
          height: 1,
          backgroundColor: COLORS.amber,
          marginBottom: 40,
        }}
      />

      {/* Reflection body — justified, with emphasis runs */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 30,
          lineHeight: 1.5,
          color: COLORS.ink,
        }}
      >
        {paragraphs.map((para, i) => {
          const runs = parseRuns(para);
          return (
            <div
              key={i}
              style={{
                display: 'block',
                marginBottom: 26,
                textAlign: 'justify',
              }}
            >
              {runs.map((run, j) => (
                <span
                  key={j}
                  style={{
                    fontStyle: run.emphasis ? 'italic' : 'normal',
                    fontWeight: run.emphasis ? 700 : 400,
                  }}
                >
                  {run.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer pinned at the bottom */}
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
