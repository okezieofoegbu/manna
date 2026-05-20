'use client';

// =============================================================================
// Manna — FUMS
// =============================================================================
// API.Bible requires a Fair Use Management System (FUMS) tracking snippet to
// be rendered on any page that displays verse text. Each passage response
// carries that snippet; the devotional engine stores it on
// devotional_days.passage_fums, and this component renders it.
//
// The snippet may be a <script> include or a noscript/img pixel. React does
// not execute <script> tags inserted via innerHTML, so any script tag is
// re-created as a real, executable element here.
// =============================================================================

import { useEffect, useRef } from 'react';

export default function Fums({ snippet }) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!snippet || !container) return;

    container.innerHTML = snippet;

    // Re-create any <script> tags so the browser actually executes them.
    const scripts = container.querySelectorAll('script');
    scripts.forEach((oldScript) => {
      const s = document.createElement('script');
      for (const attr of oldScript.attributes) {
        s.setAttribute(attr.name, attr.value);
      }
      if (oldScript.textContent) s.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(s, oldScript);
    });
  }, [snippet]);

  if (!snippet) return null;

  // Kept in the document (FUMS must be present) but visually unobtrusive.
  return <div ref={ref} className="manna-fums" aria-hidden="true" />;
}
