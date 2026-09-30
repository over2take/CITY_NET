// The system definition: what a custom game system is, as stored and as checked.
//
// A GM's system is one JSON document. This file says what a valid one looks like and checks
// a document against it, on the server, because a definition is typed into the builder or
// installed from someone else's file and is untrusted either way. See the plan
// (docs/system-builder-plan.md) for the whole format; this is the part that exists so far,
// format 1:
//
//   {
//     format: 1,
//     name: 'Vault Knights',                        // what the system picker shows
//     description: '...',                            // optional
//     words:   { hp: { singular: 'WOUND', plural: 'WOUNDS', short: 'W' }, ... },  // Layer 1
//     parts:   { vehicles: { on: false }, ... },                               // Layer 2
//     lookups: { ... }, derived: [ ... ],            // Layer 3, the Phase 1 engine's format
//     sheet:   { tabs, header, sections },           // the character sheet (sheet.js)
//     npc:     { sheet, tiers },                     // NPC layout and power tiers (npc.js)
//     core:    { health, advancement, dice, distance }, // the setup questions (core.js)
//   }
//
// Problems come in two weights. A **fatal** one means the document cannot be stored at all:
// not an object, too large, or not JSON. Anything else is an ordinary problem: a draft is
// saved with it, since a system half-built in the editor is normal, but it cannot be
// published until the list is empty. Every problem says where it is, and all of them are
// reported at once, for the builder to show as a list.
//
// Later pieces add sections (skills, rolls, choices...) and raise FORMAT; older documents
// are upgraded on read rather than refused.

const { compileSystem } = require('./derived');
const { checkSheet } = require('./sheet');
const { checkNpc } = require('./npc');
const { checkCore } = require('./core');

const FORMAT = 1;

const LIMITS = {
  /** A whole definition, as JSON. Generous: a large system is a few hundred KB. */
  bytes: 512 * 1024,
  name: 80,
  description: 2000,
  /** One glossary word. */
  word: 40,
};

/**
 * The app's own words a system may rename (Layer 1). The key is the stable id the app looks
 * up; the default is what shows when a system says nothing.
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

/** The parts of the app a system can turn off (Layer 2). All on unless a system says. */
const PARTS = [
  'bank', 'shops', 'vehicles', 'cyberware', 'initiative', 'combat', 'token_health',
  'death', 'luck', 'xp', 'npc_tiers', 'sheet_import',
];

const SECTIONS = new Set(['format', 'name', 'description', 'words', 'parts', 'lookups', 'derived', 'sheet', 'npc', 'core']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Parse text into a definition, or say why not. For files and request bodies alike. */
const parseDefinition = (text) => {
  if (typeof text !== 'string') return { ok: false, fatal: 'Not text' };
  if (Buffer.byteLength(text, 'utf8') > LIMITS.bytes) {
    return { ok: false, fatal: `Larger than ${Math.round(LIMITS.bytes / 1024)} KB` };
  }
  try {
    return { ok: true, definition: JSON.parse(text) };
  } catch {
    return { ok: false, fatal: 'Not valid JSON' };
  }
};

const checkText = (value, where, max, problems, { required = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) problems.push({ where, message: 'Required' });
    return;
  }
  if (typeof value !== 'string') { problems.push({ where, message: 'Must be text' }); return; }
  if (required && !value.trim()) problems.push({ where, message: 'Cannot be blank' });
  if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

const checkWords = (words, problems) => {
  if (words === undefined) return;
  if (!isPlainObject(words)) { problems.push({ where: 'words', message: 'Must be a set of terms' }); return; }
  for (const [term, forms] of Object.entries(words)) {
    const where = `words ${term}`;
    if (!has(TERMS, term)) { problems.push({ where, message: 'Not a term the app uses' }); continue; }
    if (!isPlainObject(forms)) { problems.push({ where, message: 'Must give singular, plural or short' }); continue; }
    for (const [form, value] of Object.entries(forms)) {
      if (!WORD_FORMS.includes(form)) { problems.push({ where: `${where}, ${form}`, message: 'Only singular, plural and short' }); continue; }
      checkText(value, `${where}, ${form}`, LIMITS.word, problems, { required: true });
    }
  }
};

const checkParts = (parts, problems) => {
  if (parts === undefined) return;
  if (!isPlainObject(parts)) { problems.push({ where: 'parts', message: 'Must be a set of parts' }); return; }
  for (const [part, setting] of Object.entries(parts)) {
    const where = `parts ${part}`;
    if (!PARTS.includes(part)) { problems.push({ where, message: 'Not a part of the app' }); continue; }
    if (!isPlainObject(setting) || typeof setting.on !== 'boolean') {
      problems.push({ where, message: 'Must say on: true or on: false' });
      continue;
    }
    for (const key of Object.keys(setting)) {
      if (key !== 'on') problems.push({ where: `${where}, ${key}`, message: 'Only "on" is set here' });
    }
  }
};

/**
 * Check a definition. Returns `{ fatal }` when it cannot be stored at all, otherwise
 * `{ problems }` (empty when it can be published).
 */
const checkDefinition = (definition) => {
  if (!isPlainObject(definition)) return { fatal: 'A system definition must be an object' };
  let size;
  try { size = Buffer.byteLength(JSON.stringify(definition), 'utf8'); } catch { return { fatal: 'Cannot be stored as JSON' }; }
  if (size > LIMITS.bytes) return { fatal: `Larger than ${Math.round(LIMITS.bytes / 1024)} KB` };

  const problems = [];
  for (const key of Object.keys(definition)) {
    if (!SECTIONS.has(key)) problems.push({ where: key, message: 'Not a section this version knows' });
  }
  if (definition.format !== undefined && definition.format !== FORMAT) {
    problems.push({ where: 'format', message: `This version reads format ${FORMAT}` });
  }
  checkText(definition.name, 'name', LIMITS.name, problems, { required: true });
  checkText(definition.description, 'description', LIMITS.description, problems);
  checkWords(definition.words, problems);
  checkParts(definition.parts, problems);

  if (definition.lookups !== undefined || definition.derived !== undefined) {
    const compiled = compileSystem({ lookups: definition.lookups, derived: definition.derived ?? [] });
    if (!compiled.ok) problems.push(...compiled.problems);
  }
  const derivedIds = new Set(Array.isArray(definition.derived)
    ? definition.derived.filter((d) => d && typeof d.id === 'string').map((d) => d.id) : []);
  checkSheet(definition.sheet, derivedIds, problems);
  checkCore(definition.core, derivedIds, problems);
  checkNpc(definition, derivedIds, problems);
  return { problems };
};

/** A new system's starting point: a name and nothing else. */
const blankDefinition = (name) => ({ format: FORMAT, name: String(name || '').trim() });

/** What the app calls `term` in this system: the system's word, or the app's own. */
const wordFor = (definition, term, form = 'singular') => {
  const own = definition && isPlainObject(definition.words) && isPlainObject(definition.words[term])
    ? definition.words[term][form] : undefined;
  if (typeof own === 'string' && own.trim()) return own;
  const fallback = TERMS[term];
  return fallback ? (fallback[form] || fallback.singular) : term;
};

/** Is `part` on in this system? Everything is, unless the system turns it off. */
const partOn = (definition, part) => {
  const setting = definition && isPlainObject(definition.parts) ? definition.parts[part] : undefined;
  return !(isPlainObject(setting) && setting.on === false);
};

module.exports = {
  FORMAT, LIMITS, TERMS, PARTS,
  parseDefinition, checkDefinition, blankDefinition, wordFor, partOn,
};
