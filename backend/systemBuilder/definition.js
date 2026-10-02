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
//     author: '...', license: '...',                 // optional, free text; a shared file's cover
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
const { TERMS, WORD_FORMS, wordFor, resolveWords, ownWords } = require('./terms');
const { PARTS, partOn } = require('./parts');

const FORMAT = 1;

const LIMITS = {
  /** A whole definition, as JSON. Generous: a large system is a few hundred KB. */
  bytes: 512 * 1024,
  name: 80,
  description: 2000,
  /** Free text: there are no accounts across servers, so an author is whatever they type. */
  author: 80,
  license: 200,
  /** One glossary word. */
  word: 40,
};

const SECTIONS = new Set(['format', 'name', 'description', 'author', 'license', 'words', 'parts', 'lookups', 'derived', 'sheet', 'npc', 'core']);

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
  checkText(definition.author, 'author', LIMITS.author, problems);
  checkText(definition.license, 'license', LIMITS.license, problems);
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

module.exports = {
  FORMAT, LIMITS, TERMS, PARTS, WORD_FORMS,
  parseDefinition, checkDefinition, blankDefinition, wordFor, resolveWords, ownWords, partOn,
};
