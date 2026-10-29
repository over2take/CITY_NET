// Filling one of a system's lists from a file (choices import 1; approved mockup
// docs/mockups/choices-import.html, 2026-10-28): the CHOICES page's IMPORT reads a table of options
// and their features against the draft and shows what would change; nothing here saves.
//
//   [options]
//   name, description, requires
//   Ranger, "At home past the last road.", @dex >= 13
//
//   [features]
//   option, feature, level, words, uses, refill
//   Ranger, Favored Foe, 1, "Mark a quarry.", @wis, Long rest
//
// Matched by name, capitals and spaces at the ends aside: a name already in the list is updated, a
// new one is added, and nothing is deleted or renamed. A feature is found within its option by name,
// and by level too only when that option has the name at more than one level, in the list or in the
// file (ABILITY SCORE IMPROVEMENT at 4 and 8). An empty cell leaves that part as it is; `-` clears it.
// Only words, levels, requirements and uses come from a file: modifiers, rolls, roll changes and the
// list a feature opens stay as the builder has them. A row with a mistake is skipped and said, by its
// line, and the rest goes in (the user asked for the GM to be warned of each, 2026-10-28).
//
// The rows are read with the catalogue import's own splitter (quotes, tabs, Excel's semicolons). The
// result is the list as it would be, which the builder puts into the draft: saved with it, live on
// PUBLISH, through the version preview like any other change.

const { parse, references, NAME } = require('./expression');
const { LIMITS, choicesOf, levelNamesOf, namesOf } = require('./choices');
const { restIdsOf, restsOf } = require('./rests');
const { effectiveSheet, fieldsOf } = require('./sheet');
const { tablesOf } = require('./derived');
const { splitRow, delimiterOf, stripBom } = require('../shops/catalogueParse');

/** The most a file may be, in bytes: a few hundred options and features with room to spare. */
const MAX_BYTES = 200_000;
/** The columns each part reads; the first ones named are required. */
const COLUMNS = {
  options: { required: ['name'], read: ['name', 'description', 'requires'] },
  features: { required: ['option', 'feature'], read: ['option', 'feature', 'level', 'words', 'uses', 'refill'] },
};
/** What a cell says to clear its part. */
const CLEAR = '-';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
/**
 * Words that differ only in spacing are the same: a cell is trimmed and can't hold a line break, so
 * a list downloaded and imported back keeps its words as they were.
 */
const sameWords = (a, b) => String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();
const nameKey = (option, feature) => `${String(option).trim().toLowerCase()}|${String(feature).trim().toLowerCase()}`;
/** A feature's level: 1 when it has none, as the builder shows it. */
const atOf = (f) => (Number.isInteger(f.at) ? f.at : 1);

/** An id from a name, free in `taken`, which it is then added to: `Favored Foe` is favored_foe, then favored_foe_2. */
const idFrom = (name, taken) => {
  let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `x_${base}`.replace(/_+$/, '');
  base = base.slice(0, 50);
  let id = base;
  for (let n = 2; taken.has(id) || !NAME.test(id); n += 1) id = `${base}_${n}`;
  taken.add(id);
  return id;
};

/**
 * The rests a file may name for a refill, by name or id: those the system offers, and by id one it
 * has turned off (a feature may still name it, as the builder allows).
 */
const refillsOf = (definition) => {
  const offered = restsOf(definition);
  const ids = restIdsOf(definition);
  return {
    find: (written) => (offered.find((r) => same(r.id, written) || same(r.name, written))
      ?? [...ids].map((id) => ({ id })).find((r) => same(r.id, written)) ?? { id: null }).id,
    names: offered.map((r) => r.name).join(', ') || 'none',
  };
};

/**
 * What's wrong with a formula a file gives, or null: one that doesn't read, or names something the
 * system hasn't got (@dexx). `known` holds every name a sheet can read, levels included.
 */
const formulaProblem = (text, known, isTable) => {
  let tree;
  try { tree = parse(text, isTable); } catch (e) { return e.message; }
  const unknown = [...references(tree).fields].find((n) => !known.has(n));
  return unknown ? `@${unknown} isn't one of this system's names` : null;
};

/**
 * The rows of a file by part, each with its line and its cells by column; the problems with whole
 * parts (a missing column, a part this doesn't read) as skipped lines; and notes about columns.
 */
const rowsOf = (text, levelled, many) => {
  const delimiter = delimiterOf(text);
  const rows = { options: [], features: [] };
  const skipped = [];
  const notes = [];
  let part = null;
  let columns = null;
  let ignoring = false;
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const opened = /^\s*\[\s*([a-z0-9_]+)\s*\]\s*$/i.exec(raw);
    if (opened) {
      part = opened[1].toLowerCase();
      columns = null;
      ignoring = !COLUMNS[part];
      if (ignoring) skipped.push({ line, message: `[${opened[1]}] isn't read here: a file has [options] and [features]` });
      return;
    }
    if (ignoring) return;
    if (!part) { skipped.push({ line, message: 'Before [options] or [features], so nothing knows what it is' }); return; }
    const { cells, closed } = splitRow(raw, delimiter);
    if (!closed) { skipped.push({ line, message: 'A quote is opened and never closed' }); return; }
    if (!columns) {
      const named = cells.map((c) => c.trim().toLowerCase());
      const missing = COLUMNS[part].required.filter((c) => !named.includes(c));
      if (missing.length) {
        skipped.push({ line, message: `[${part}] needs ${missing.map((c) => `a ${c} column`).join(' and ')}: its first line names the columns (${COLUMNS[part].read.join(', ')})` });
        ignoring = true;
        return;
      }
      columns = named;
      for (const c of named.filter((x) => x && !COLUMNS[part].read.includes(x))) notes.push({ line, message: `The ${c} column isn't read: only ${COLUMNS[part].read.join(', ')}` });
      if (part === 'features' && named.includes('level') && !levelled) notes.push({ line, message: `${many} isn't levelled, so the level column is ignored` });
      return;
    }
    const cols = columns;
    rows[part].push({ line, get: (c) => { const j = cols.indexOf(c); return j < 0 ? '' : (cells[j] ?? '').trim(); } });
  });
  return { rows, skipped, notes };
};

/**
 * A file read against list `listId` of `definition`, nothing changed: `{ ok: false, error }` when it
 * can't be read at all, else `{ ok: true, list, added, changed, same, skipped, notes, changes }`:
 * the list as it would be; what is new (options, features) and what changes (with each part from and
 * to); how many rows change nothing; each line skipped and why; what is good to know; and how many
 * changes in all.
 */
const readChoicesFile = (definition, listId, input) => {
  const source = choicesOf(definition).find((c) => c.id === listId);
  if (!source) return { ok: false, error: 'No such list' };
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Nothing to read' };
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) return { ok: false, error: `That is more than ${MAX_BYTES / 1000} KB. Split it into smaller files.` };

  const next = JSON.parse(JSON.stringify(source));
  next.options = list(next.options).filter((o) => isPlainObject(o) && typeof o.id === 'string');
  const levelled = next.levelled === true;
  const many = (next.many || next.id).toUpperCase();
  const { rows, skipped, notes } = rowsOf(stripBom(input), levelled, many);
  const added = { options: [], features: [] };
  const changed = { options: [], features: [] };
  let unchanged = 0;

  // Ids already used anywhere a new one could clash: options and features (one set across the
  // system), lists, and what formulas read (an option's level reads as @<id>_level).
  const taken = new Set();
  for (const c of choicesOf(definition)) {
    taken.add(c.id);
    for (const o of list(c.options).filter(isPlainObject)) {
      taken.add(o.id);
      for (const f of list(o.features).filter(isPlainObject)) taken.add(f.id);
    }
  }
  const sheetNames = fieldsOf(effectiveSheet(definition)).filter((f) => f && typeof f.id === 'string').map((f) => f.id);
  for (const n of [...namesOf(definition).keys(), ...sheetNames]) { taken.add(n); taken.add(n.replace(/_level$/, '')); }
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const isTable = (name) => Object.prototype.hasOwnProperty.call(tables, name);
  const rests = refillsOf(definition);
  /** Every name a formula may read, with the list as it is becoming (a new option's level too). */
  const known = () => {
    const withNext = { ...definition, choices: choicesOf(definition).map((c) => (c.id === listId ? next : c)) };
    return new Set([...namesOf(withNext).keys(), ...levelNamesOf(withNext), ...sheetNames]);
  };
  const skip = (line, message) => skipped.push({ line, message });
  const clearing = (v) => v === CLEAR;

  // OPTIONS first, so features can name an option the same file adds.
  for (const row of rows.options) {
    const name = row.get('name');
    const description = row.get('description');
    const requires = row.get('requires');
    if (!name || clearing(name)) { skip(row.line, 'No name'); continue; }
    if (name.length > LIMITS.label) { skip(row.line, `${name.slice(0, 20)}…: a name is ${LIMITS.label} characters at most`); continue; }
    if (description.length > LIMITS.description) { skip(row.line, `${name}: the description is longer than ${LIMITS.description} characters`); continue; }
    if (requires && !clearing(requires)) {
      const wrong = formulaProblem(requires, known(), isTable);
      if (wrong) { skip(row.line, `${name}: requires: ${wrong}`); continue; }
    }
    const matches = next.options.filter((o) => same(o.label ?? '', name));
    if (matches.length > 1) { skip(row.line, `${name}: ${many} has ${matches.length} options called that; rename one in the builder first`); continue; }
    const option = matches[0];
    if (!option) {
      if (next.options.length >= LIMITS.options) { skip(row.line, `${name}: ${many} has ${LIMITS.options} options, the most a list holds`); continue; }
      const made = { id: idFrom(name, taken), label: name, features: [] };
      if (description && !clearing(description)) made.description = description;
      if (requires && !clearing(requires)) made.requires = requires;
      next.options.push(made);
      added.options.push({ line: row.line, option: name, ...(made.requires ? { requires: made.requires } : {}) });
      continue;
    }
    const parts = [];
    for (const [key, value] of [['description', description], ['requires', requires]]) {
      if (!value) continue;
      const to = clearing(value) ? '' : value;
      const from = typeof option[key] === 'string' ? option[key] : '';
      if (sameWords(from, to)) continue;
      parts.push({ part: key, from, to });
      if (to) option[key] = to; else delete option[key];
    }
    if (parts.length) changed.options.push({ line: row.line, option: option.label, parts });
    else unchanged += 1;
  }

  // The names an option has at more than one level, in the list or in this file: those are found by
  // level. A name once in each is one feature, which a new level moves.
  const inList = new Map();
  const inFile = new Map();
  const noteLevel = (levels, key, at) => { if (!levels.has(key)) levels.set(key, new Set()); levels.get(key).add(at); };
  if (levelled) {
    for (const o of next.options) for (const f of list(o.features).filter(isPlainObject)) noteLevel(inList, nameKey(o.label ?? '', f.label ?? ''), atOf(f));
    for (const row of rows.features) {
      const at = Number(row.get('level'));
      if (row.get('level') && Number.isInteger(at)) noteLevel(inFile, nameKey(row.get('option'), row.get('feature')), at);
    }
  }
  const repeats = (key) => (inList.get(key)?.size ?? 0) > 1 || (inFile.get(key)?.size ?? 0) > 1;
  const addedHere = new Set();

  for (const row of rows.features) {
    const optionName = row.get('option');
    const name = row.get('feature');
    const words = row.get('words');
    const uses = row.get('uses');
    const refill = row.get('refill');
    const levelText = levelled ? row.get('level') : '';
    if (!optionName || !name || clearing(name)) { skip(row.line, 'Needs an option and a feature'); continue; }
    const options = next.options.filter((o) => same(o.label ?? '', optionName));
    if (!options.length) { skip(row.line, `${optionName}: no option of that name in ${many} or in [options]`); continue; }
    if (options.length > 1) { skip(row.line, `${optionName}: ${many} has ${options.length} options called that; rename one in the builder first`); continue; }
    const option = options[0];
    option.features = list(option.features);
    if (name.length > LIMITS.label) { skip(row.line, `${name.slice(0, 20)}…: a name is ${LIMITS.label} characters at most`); continue; }
    if (words.length > LIMITS.description) { skip(row.line, `${name}: the words are longer than ${LIMITS.description} characters`); continue; }
    let level;
    if (levelText) {
      level = Number(levelText);
      if (!/^\d+$/.test(levelText) || level < 1 || level > LIMITS.level) { skip(row.line, `${name}: level: a whole number from 1 to ${LIMITS.level}`); continue; }
    }
    if (uses && !clearing(uses)) {
      const wrong = formulaProblem(uses, known(), isTable);
      if (wrong) { skip(row.line, `${name}: uses: ${wrong}`); continue; }
    }
    let rest = null;
    if (refill && !clearing(refill)) {
      rest = rests.find(refill);
      if (!rest) { skip(row.line, `${name}: refill: "${refill}" isn't one of this system's rests (${rests.names})`); continue; }
    }

    const named = option.features.filter((f) => isPlainObject(f) && same(f.label ?? '', name));
    const byLevel = levelled && repeats(nameKey(option.label ?? '', name));
    if (byLevel && level === undefined) { skip(row.line, `${name}: ${option.label} has more than one, so say which level`); continue; }
    const feature = byLevel ? named.find((f) => atOf(f) === level) : named[0];

    if (!feature) {
      if (option.features.length >= LIMITS.features) { skip(row.line, `${name}: ${option.label} has ${LIMITS.features} features, the most an option holds`); continue; }
      const count = uses && !clearing(uses) ? uses : null;
      if (rest && !count) { skip(row.line, `${name}: a refill needs uses`); continue; }
      const made = { id: idFrom(name, taken), label: name };
      // Level 1 is stored as no level, as the builder writes it.
      if (levelled && level > 1) made.at = level;
      if (words && !clearing(words)) made.text = words;
      if (count) made.uses = { count, ...(rest ? { refill: rest } : {}) };
      option.features.push(made);
      if (levelled) option.features.sort((a, b) => atOf(a) - atOf(b));
      added.features.push({ line: row.line, option: option.label, feature: name, ...(levelled ? { level: atOf(made) } : {}), ...(made.uses ? { uses: made.uses.count, ...(rest ? { refill: rest } : {}) } : {}) });
      const before = named.filter((f) => !addedHere.has(f.id));
      if (before.length) notes.push({ line: row.line, message: `${option.label} already has ${name} at level ${before.map(atOf).join(', ')}: this one is added beside it, at level ${atOf(made)}, not moved` });
      addedHere.add(made.id);
      continue;
    }

    const parts = [];
    const set = (part, from, to, write) => { if (from !== to) { parts.push({ part, from, to }); write(to); } };
    if (levelled && level !== undefined) set('level', atOf(feature), level, (to) => { if (to > 1) feature.at = to; else delete feature.at; });
    const text = typeof feature.text === 'string' ? feature.text : '';
    if (words && !sameWords(text, clearing(words) ? '' : words)) set('words', text, clearing(words) ? '' : words, (to) => { if (to) feature.text = to; else delete feature.text; });
    const had = isPlainObject(feature.uses) ? feature.uses : null;
    const count = !uses ? (had ? had.count : null) : clearing(uses) ? null : uses;
    // Uses cleared take their refill with them, unless the row names one.
    const refillTo = !refill ? (count && had && typeof had.refill === 'string' ? had.refill : null) : clearing(refill) ? null : rest;
    if (refillTo && !count) { skip(row.line, `${name}: a refill needs uses`); continue; }
    if (uses) set('uses', had ? String(had.count) : '', count ?? '', () => {});
    if (refill) set('refill', had && typeof had.refill === 'string' ? had.refill : '', count ? refillTo ?? '' : '', () => {});
    if (count) feature.uses = { count, ...(refillTo ? { refill: refillTo } : {}) };
    else delete feature.uses;
    if (levelled && parts.some((p) => p.part === 'level')) option.features.sort((a, b) => atOf(a) - atOf(b));
    if (parts.length) changed.features.push({ line: row.line, option: option.label, feature: feature.label, parts });
    else unchanged += 1;
    const keeps = [['modifiers', 'its modifiers'], ['rolls', 'the rolls it gives'], ['changes', 'the roll changes it allows'], ['choice', 'the list it opens']]
      .filter(([k]) => (Array.isArray(feature[k]) ? feature[k].length : feature[k] !== undefined)).map(([, words2]) => words2);
    if (keeps.length) notes.push({ line: row.line, message: `${option.label} · ${feature.label} keeps ${keeps.join(', ')}, set in the builder` });
  }

  const changes = added.options.length + added.features.length + changed.options.length + changed.features.length;
  skipped.sort((a, b) => a.line - b.line);
  notes.sort((a, b) => a.line - b.line);
  return { ok: true, list: next, added, changed, same: unchanged, skipped, notes, changes };
};

module.exports = { readChoicesFile, MAX_BYTES };
