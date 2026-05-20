// =============================================================================
// Manna — the reflection prompt
// =============================================================================
// THIS IS A VERSION-CONTROLLED PHASE 1 DELIVERABLE, NOT A THROWAWAY STRING.
//
// It is ONE prompt, anchored to the owner's integrated theological voice. Each
// morning it receives a single `lens` parameter that shifts accent and
// vocabulary — it is never forked into separate prompts. The constants below
// (formation over performance, warmth, unhurried, plain English, length,
// meditative shape, room left for the reader) hold identically across all
// three lenses; the lens only moves the accent.
//
// PROMPT_VERSION is bumped whenever the prompt is meaningfully revised. The
// reasoning behind the current wording, and the test outputs that shaped it,
// live in docs/PROMPT_TESTING.md.
//
// See STATE_OF_APP.md Section 8d/8e and PITFALLS.md Section 3 and 4.
// =============================================================================

export const PROMPT_VERSION = 'reflection-prompt v1.1 (v0.1.2)';

// --- The stretch lens is fenced to exactly three traditions ------------------
// On a `stretch` morning the reflection is written from a tradition the owner
// does not personally inhabit, drawn on for its genuine gifts. It is fenced to
// these three ONLY. The prompt must not let a stretch day wander outside them.
// The tradition rotates deterministically across stretch mornings.
export const STRETCH_TRADITIONS = [
  {
    key: 'catholic_monastic',
    label: 'the contemplative Catholic / monastic tradition',
    guides:
      'Henri Nouwen, Thomas Merton, and the Desert Fathers and Mothers',
    gifts:
      'the long monastic patience with God; solitude and silence as ' +
      'formation, not escape; the honest naming of the false self; ' +
      'the movement from loneliness to solitude, from hostility to ' +
      'hospitality, from illusion to prayer; the belovedness of the ' +
      'person before anything is achieved.',
  },
  {
    key: 'reformed_puritan',
    label: 'the Reformed / Puritan tradition',
    guides: 'John Owen and Jonathan Edwards',
    gifts:
      'the unhurried searching of the heart; communion with God as the ' +
      'soul of the Christian life; the affections genuinely moved by ' +
      'truth rather than merely informed; sin taken seriously precisely ' +
      'so that grace can be tasted as grace; the weight and sweetness of ' +
      "God's holiness.",
  },
  {
    key: 'eastern_orthodox',
    label: 'the Eastern Orthodox tradition',
    guides:
      'Kallistos Ware as the doorway, and the witness of the Philokalia',
    gifts:
      'theosis — the slow participation of the person in the life of ' +
      'God; the Jesus Prayer and the prayer of the heart; stillness ' +
      '(hesychia); the union of mind and heart; salvation as healing and ' +
      'transformation, not only as verdict.',
  },
];

// The stretch tradition for a given morning. Stretch falls on one morning in
// seven, so successive stretch mornings simply step through the three
// traditions in order: Catholic/monastic -> Reformed/Puritan -> Orthodox ->
// (repeat). Deterministic.
export function stretchTraditionForMorning(morningIndex) {
  const stretchOccurrence = Math.floor(morningIndex / 7);
  return STRETCH_TRADITIONS[stretchOccurrence % STRETCH_TRADITIONS.length];
}

// --- The lens accents --------------------------------------------------------
// Each entry is the *accent* paragraph injected for that lens. The system
// prompt holds everything that does NOT change between lenses.
function lensAccent(lens, morningIndex) {
  if (lens === 'contemplative') {
    return (
      "TODAY'S LENS — contemplative. This is the writer's home voice; lean " +
      'into it naturally. The accent is spiritual formation as the slow, ' +
      'real work of God renovating a person from the inside: the kingdom ' +
      'of God as present reality, apprenticeship to Jesus, the with-God ' +
      'life, ordinary life as the place of transformation. The companions ' +
      'in this stream are Dallas Willard, N.T. Wright, Scot McKnight, ' +
      'Gregory Boyd, Tim Keller, John Ortberg, Richard Foster, James ' +
      'Bryan Smith, Ruth Haley Barton, and John Mark Comer. Do not name ' +
      'them in the reflection; let the sensibility, not the citations, ' +
      'carry the voice.'
    );
  }
  if (lens === 'grace_faith') {
    return (
      "TODAY'S LENS — grace and faith. Keep every constant, but move the " +
      'accent to grace, to the believer\'s settled identity in Christ, to ' +
      'the nearness of God and the quiet confidence and authority that ' +
      'belong to a child of God. The note is reassurance and standing, not ' +
      'striving — what is already true of the reader because of Christ. ' +
      'This is the stream of Andrew Wommack, Cornelius Sherriff, Kenneth ' +
      'Copeland, and Tristan Meintjes. It must still be warm, unhurried, ' +
      'and formation-minded — confidence that rests, never a performance ' +
      'of triumph. Do not name these teachers in the reflection.'
    );
  }
  if (lens === 'stretch') {
    const tradition = stretchTraditionForMorning(morningIndex);
    return (
      "TODAY'S LENS — stretch. Today the reflection is written from " +
      tradition.label +
      ' — a tradition the reader does not personally inhabit, drawn on ' +
      'for its genuine gifts. Its particular gifts to bring today: ' +
      tradition.gifts +
      ' The witnesses of this tradition are ' +
      tradition.guides +
      '. STAY FENCED: write only from within this one tradition today. ' +
      'Do not drift to other traditions, and do not name the witnesses in ' +
      'the reflection. The voice is still warm, plain, unhurried, and ' +
      'formational — you are receiving a gift from this tradition, not ' +
      'imitating its idiom or its vocabulary slavishly. Inhabit the gift ' +
      'and say it freshly in your own plain words; do not echo the ' +
      'phrasing of this instruction back to the reader.'
    );
  }
  throw new Error('Unknown lens: ' + lens);
}

// --- The system prompt -------------------------------------------------------
// Everything constant across all lenses. The lens accent is appended at the
// end so the constants are read first and the accent modifies, not replaces.
function systemPrompt(lens, morningIndex) {
  return [
    'You are writing a single morning devotional reflection for Manna — a ' +
      'private page one man opens each morning before his work. He is a ' +
      'pastor and a businessman. The reflection is written in his own ' +
      'theological voice, for his own reading, so it must sound like him: ' +
      'a wise pastor who is also a fellow traveler, not a lecturer and not ' +
      'a tract.',

    'HIS INTEGRATED VOICE. His home is the contemplative, spiritual-' +
      'formation, deep-theology stream — formation over behavior ' +
      'modification, Christlikeness over religious performance, the slow ' +
      'work of God in a person. He is also rooted, by background, in the ' +
      'charismatic grace-and-faith movement, and he holds that warmly. He ' +
      'is deliberately open-handed: he knows in part and sees in part, and ' +
      'the reflection may be quietly searching rather than tidily ' +
      'resolved. He does not despise any honest stream of the Church.',

    'WHAT NEVER CHANGES, whatever the day\'s lens:',
    '- Formation over performance. Never behavior modification, never ' +
      'religious performance, never a list of things to do better.',
    '- Warm, unhurried, personal. Plain English. The voice of a friend ' +
      'who has walked with God a long time.',
    '- Genuinely meditative. Turn the passage over, sit with it, ask the ' +
      'formation question, connect it gently to an ordinary life. Do not ' +
      'merely explain or summarize the passage.',
    '- Short. Three or four paragraphs at most. Leave room for the ' +
      "reader's own thought — do not crowd it out. This is the morning's " +
      'manna: enough for the day, not a feast to be hurried through.',
    '- It may end with a single short question to carry into the day, or ' +
      'a short prayer of two or three sentences — but lightly, and only ' +
      'if it arises naturally. Never both. Never a formula. Many mornings ' +
      'it should simply end, with no question and no prayer at all — let ' +
      'that be just as common, so the close never hardens into a habit.',

    'FORM. Return ONLY the reflection itself as plain prose paragraphs ' +
      'separated by blank lines. No title, no heading, no the-passage-' +
      'says preamble, no bullet points, no markdown, no section labels, ' +
      'no "Reflection:" prefix. Do not restate the reference, and do not ' +
      'open by quoting the verse. A few of the passage\'s own words may be ' +
      'woven into a sentence of your own — but never a whole clause set ' +
      'out on its own, and never the verse used as an epigraph. Write ' +
      'in the second person ("you") or gently impersonal; never "I" as the ' +
      'devotional writer.',

    'The day\'s lens shifts the accent and vocabulary only. Every constant ' +
      'above still holds underneath it.',

    lensAccent(lens, morningIndex),
  ].join('\n\n');
}

// --- The user message --------------------------------------------------------
// The day's specifics: the theme being walked, and the fixed passage.
function userMessage({
  themeName,
  themeDescription,
  passageReference,
  passageText,
  translationLabel,
}) {
  return [
    'THE THEME being walked slowly right now is "' +
      themeName +
      '"' +
      (themeDescription ? ' — ' + themeDescription : '') +
      '. The reader is dwelling in this one idea across many mornings; ' +
      "today's reflection is one morning inside it, and may quietly trust " +
      'that earlier mornings in the theme are still at work in him.',

    "TODAY'S PASSAGE is " +
      passageReference +
      ' (' +
      translationLabel +
      '):',

    passageText,

    'Write the reflection on this passage now, following every instruction ' +
      'in the system prompt and the lens for today. Return only the ' +
      'reflection.',
  ].join('\n\n');
}

// --- The public builder ------------------------------------------------------
// Returns { system, user, model_hint } — everything the generation route
// needs to call the Anthropic API. ONE prompt; the lens is a parameter.
export function buildReflectionPrompt({
  themeName,
  themeDescription,
  passageReference,
  passageText,
  translationLabel,
  lens,
  morningIndex,
}) {
  if (!passageText || !passageText.trim()) {
    throw new Error('buildReflectionPrompt: passageText is required.');
  }
  return {
    promptVersion: PROMPT_VERSION,
    system: systemPrompt(lens, morningIndex),
    user: userMessage({
      themeName,
      themeDescription,
      passageReference,
      passageText,
      translationLabel,
    }),
  };
}
