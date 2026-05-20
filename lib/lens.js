// =============================================================================
// Manna — the lens rotation
// =============================================================================
// The reflection is written by ONE prompt anchored to the owner's integrated
// theological voice. Each morning that prompt receives a `lens` — a parameter
// that shifts accent and vocabulary while every constant holds (see
// lib/reflection-prompt.js).
//
// The rotation is a FIXED seven-slot pattern, repeating continuously, indexed
// by the count of mornings served. It is deterministic — never randomized —
// so two page loads on the same day always yield the same lens, and the
// pattern rolls straight across theme boundaries.
//
//   4 contemplative / 2 grace_faith / 1 stretch  per seven mornings,
//   spread rather than clustered.
//
// See STATE_OF_APP.md Section 8e and PITFALLS.md Section 4.
// =============================================================================

// The three lenses. The order of this list is not the rotation — see ROTATION.
export const LENSES = ['contemplative', 'grace_faith', 'stretch'];

// The fixed seven-slot rotation. Index 0..6.
//   slot 1: contemplative
//   slot 2: contemplative
//   slot 3: grace_faith
//   slot 4: contemplative
//   slot 5: stretch
//   slot 6: contemplative
//   slot 7: grace_faith
export const ROTATION = [
  'contemplative',
  'contemplative',
  'grace_faith',
  'contemplative',
  'stretch',
  'contemplative',
  'grace_faith',
];

// The lens for a given morning, indexed by the count of mornings served.
//
// `morningIndex` is ZERO-BASED: the very first morning Manna ever serves is
// morningIndex 0; the second is 1; and so on. It is the number of
// devotional_days rows that already existed before today's was created.
//
// Because it is `morningIndex % 7`, the rotation repeats forever and is
// independent of dates and of which theme is active.
export function lensForMorning(morningIndex) {
  if (!Number.isInteger(morningIndex) || morningIndex < 0) {
    throw new Error(
      'lensForMorning expects a zero-based non-negative integer; got: ' +
        morningIndex
    );
  }
  return ROTATION[morningIndex % ROTATION.length];
}
