// The glossary (Layer 1): the app's own words a system may rename, and what a system calls them.
//
// Its own module, with nothing required, so the definition checks (definition.js), the starter
// sheet (sheet.js, core.js) and the running game (runtime.js) can all use it without a circle.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The app's own words a system may rename. The key is the stable id the app looks up; the
 * default is what the builder shows when a system says nothing.
 */
const TERMS = {
  character: { singular: 'CHARACTER', plural: 'CHARACTERS' },
  hp: { singular: 'HP', plural: 'HP', short: 'HP' },
  money: { singular: 'CREDIT', plural: 'CREDITS', short: 'CR' },
  level: { singular: 'LEVEL', plural: 'LEVELS', short: 'LVL' },
  xp: { singular: 'XP', plural: 'XP', short: 'XP' },
  class: { singular: 'CLASS', plural: 'CLASSES' },
  initiative: { singular: 'INITIATIVE', plural: 'INITIATIVE', short: 'INIT' },
  round: { singular: 'ROUND', plural: 'ROUNDS' },
  turn: { singular: 'TURN', plural: 'TURNS' },
  gm: { singular: 'GM', plural: 'GMS', short: 'GM' },
  shop: { singular: 'SHOP', plural: 'SHOPS' },
  bank: { singular: 'BANK', plural: 'BANKS' },
  vehicle: { singular: 'VEHICLE', plural: 'VEHICLES' },
};
const WORD_FORMS = ['singular', 'plural', 'short'];

/** What the app calls `term` in this system: the system's word, or the app's own. */
const wordFor = (definition, term, form = 'singular') => {
  const own = definition && isPlainObject(definition.words) && isPlainObject(definition.words[term])
    ? definition.words[term][form] : undefined;
  if (typeof own === 'string' && own.trim()) return own;
  const fallback = TERMS[term];
  return fallback ? (fallback[form] || fallback.singular) : term;
};

/**
 * Every term the app can rename, in every form, as this system says it: its own word where it
 * set one, the neutral default otherwise. For the builder, to show what a term will read as.
 */
const resolveWords = (definition) => Object.fromEntries(Object.keys(TERMS).map((term) => [
  term, Object.fromEntries(WORD_FORMS.map((form) => [form, wordFor(definition, term, form)])),
]));

/**
 * Only the terms this system renamed, every form filled from its own other forms (a system that
 * gave only WOUNDS reads WOUNDS in every form). What the running game's windows use: a term the
 * system did not rename keeps the text each place shows today, so nothing changes that nobody
 * chose to change (decided with the user, 2026-09-30).
 */
const ownWords = (definition) => {
  const words = definition && isPlainObject(definition.words) ? definition.words : {};
  const out = {};
  for (const term of Object.keys(TERMS)) {
    const own = isPlainObject(words[term]) ? words[term] : null;
    if (!own) continue;
    const pick = (form) => (typeof own[form] === 'string' && own[form].trim() ? own[form] : null);
    const singular = pick('singular') || pick('plural') || pick('short');
    if (!singular) continue;
    out[term] = { singular, plural: pick('plural') || singular, short: pick('short') || singular };
  }
  return out;
};

module.exports = { TERMS, WORD_FORMS, wordFor, resolveWords, ownWords };
