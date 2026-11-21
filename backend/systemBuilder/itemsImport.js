// Filling a system's items from a file (8aL3a; approved mockup docs/mockups/items-layout.html, 2026-11-14): the ITEMS
// tab's IMPORT reads a table of items and their features against the draft and shows what would change; nothing here
// saves. The file is made from the system it comes from (the user's call): a section per type, headed by that type's
// own columns, then what every item has:
//
//   [weapons]
//   name, damage, range, ammo, weight, price, grade, needs, cost, words
//   Pistol, 2d6 + @grace_mod, 30 m, 6, 2, 200, LIGHT, worn, , "A snub revolver."
//
//   [features]
//   item, feature, words, uses, refill
//   Boots of Quiet, Quiet Step, "Move without a sound.", 1, Long rest
//
// A section is a type by its id or its name; a column is one of its columns by name or id. COST is read only where the
// system has an install, and NEEDS says WORN, CARRIED, or one of its slots or installs by name. Matched by name,
// capitals and spaces at the ends aside, as CHOICES' import and the shops match: a name already there is updated (and
// made the section's type, keeping the values both types have), a new one added, nothing deleted or renamed. An empty
// cell leaves that part as it is; `-` clears it. A row with a mistake is skipped and said, by its line, and the rest
// goes in. What a feature does beyond words, uses and a rest stays as the builder has it.
//
// In a game with types of its own (8a7a3b2; decided 2026-11-21), each section also reads PRICE, an item's own (only for a
// type with no column of that name, which holds it otherwise), and IN SHOPS, yes or no.
//
// The rows are read with the catalogue import's own splitter (quotes, tabs, Excel's semicolons), as CHOICES' are.

const { LIMITS: CHOICE_LIMITS, choicesOf, namesOf } = require('./choices');
const { LIMITS, slotsOf, installsOf } = require('./items');
const { typesOf, ownTypes, typeNamed, valueProblem, MOST_PRICE } = require('./itemTypes');
const { idFrom, same, sameWords, refillsOf, formulaProblem, CLEAR, MAX_BYTES } = require('./choicesImport');
const { tablesOf } = require('./derived');
const { splitRow, delimiterOf, stripBom } = require('../shops/catalogueParse');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const FEATURE_COLUMNS = ['item', 'feature', 'words', 'uses', 'refill'];

/** Whether a type has a column called price, by name or id: then it holds the price, and no own PRICE is read (8a7a3b2). */
const pricedByColumn = (type) => type.columns.some((c) => same(c.id, 'price') || same(c.label || '', 'price'));
/** What an item section reads for the shops (8a7a3b2), in a game with types of its own: its own price, IN SHOPS. */
const shopColumnsOf = (type, own) => (own ? [...(pricedByColumn(type) ? [] : ['price']), 'in shops'] : []);
/** The columns an item section reads: its type's, then what every item has (COST only where an install is). */
const itemColumnsOf = (type, installs, own) => [...type.columns.map((c) => (c.label || c.id).toLowerCase()), ...shopColumnsOf(type, own), 'needs', ...(installs ? ['cost'] : []), 'words'];
/** IN SHOPS from a cell: yes or no, as a GM might say them. */
const SHOPS_WORDS = { yes: true, on: true, true: true, no: false, off: false, false: false };

/**
 * The rows of a file by section, each with its line and its cells by column; problems with whole sections (a missing
 * column, a section that is no type) as skipped lines; and notes about columns.
 */
const rowsOf = (text, definition) => {
  const types = typesOf(definition);
  const installs = installsOf(definition).length > 0;
  const delimiter = delimiterOf(text);
  const sections = [];
  const features = [];
  const skipped = [];
  const notes = [];
  let at = null; // { kind: 'items', type } | { kind: 'features' }
  let columns = null;
  let ignoring = false;
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const opened = /^\s*\[\s*([^\]]+?)\s*\]\s*$/.exec(raw);
    if (opened) {
      const name = opened[1];
      columns = null;
      ignoring = false;
      if (same(name, 'features')) { at = { kind: 'features' }; return; }
      const type = types.find((t) => same(t.id, name) || same(t.label || '', name));
      if (!type) {
        skipped.push({ line, message: `[${name}] is no type of this system's (${types.map((t) => (t.label || t.id).toUpperCase()).join(', ')}): make it on TYPES first, or name the section after one` });
        ignoring = true;
        return;
      }
      at = { kind: 'items', type, rows: [] };
      sections.push(at);
      return;
    }
    if (ignoring) return;
    if (!at) { skipped.push({ line, message: 'Before any [section], so nothing knows what it is: start with a type, like [gear]' }); return; }
    const { cells, closed } = splitRow(raw, delimiter);
    if (!closed) { skipped.push({ line, message: 'A quote is opened and never closed' }); return; }
    if (!columns) {
      const named = cells.map((c) => c.trim().toLowerCase());
      if (at.kind === 'features') {
        const missing = ['item', 'feature'].filter((c) => !named.includes(c));
        if (missing.length) { skipped.push({ line, message: `[features] needs ${missing.map((c) => `a ${c} column`).join(' and ')}: its first line names the columns (${FEATURE_COLUMNS.join(', ')})` }); ignoring = true; return; }
        for (const c of named.filter((x) => x && !FEATURE_COLUMNS.includes(x))) notes.push({ line, message: `The ${c} column isn't read in [features]: only ${FEATURE_COLUMNS.join(', ')}` });
      } else {
        const read = itemColumnsOf(at.type, installs, ownTypes(definition));
        if (!named.includes('name')) { skipped.push({ line, message: `[${(at.type.label || at.type.id).toLowerCase()}] needs a name column: its first line names the columns (name, ${read.join(', ')})` }); ignoring = true; return; }
        // A column by its name or its id.
        const ids = new Map(at.type.columns.map((c) => [c.id.toLowerCase(), (c.label || c.id).toLowerCase()]));
        for (let k = 0; k < named.length; k += 1) if (!read.includes(named[k]) && ids.has(named[k])) named[k] = ids.get(named[k]);
        for (const c of named.filter((x) => x && x !== 'name' && !read.includes(x))) {
          notes.push({ line, message: c === 'cost' ? 'This system has no installs, so the cost column is ignored' : `The ${c} column isn't one of ${(at.type.label || at.type.id).toUpperCase()}'s: only name, ${read.join(', ')}` });
        }
      }
      columns = named;
      return;
    }
    const cols = columns;
    const row = { line, get: (c) => { const j = cols.indexOf(c); return j < 0 ? '' : (cells[j] ?? '').trim(); } };
    if (at.kind === 'features') features.push(row); else at.rows.push(row);
  });
  return { sections, features, skipped, notes };
};

/** A cell read as its column's kind: `{ value }`, or `{ problem }` in the words a GM is shown. */
const readValue = (column, text, names) => {
  const label = (column.label || column.id).toUpperCase();
  let value = text;
  if (column.kind === 'number' || column.kind === 'count') {
    value = Number(text);
    if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(value)) return { problem: `${label} is a number, not ${text}` };
  }
  if (column.kind === 'pick') {
    const word = list(column.options).find((w) => same(w, text));
    if (!word) return { problem: `${label} is ${list(column.options).join(' or ')}, not ${text}` };
    value = word;
  }
  const problem = valueProblem(column, value, names);
  return problem ? { problem: `${label}: ${problem}` } : { value };
};

/** What an item needs, from the words a file gives: WORN, CARRIED, or a slot or install by name or id. */
const needsFrom = (definition, text) => {
  if (same(text, 'worn')) return { needs: 'worn' };
  if (same(text, 'carried')) return { needs: 'carried' };
  const found = [...slotsOf(definition), ...installsOf(definition)].find((s) => same(s.id, text) || same(s.label || '', text));
  if (found) return { needs: found.id };
  const words = ['worn', 'carried', ...[...slotsOf(definition), ...installsOf(definition)].map((s) => (s.label || s.id).toLowerCase())];
  return { problem: `needs is ${words.join(', ')}, not ${text}` };
};

/**
 * A file read against `definition`'s items, nothing changed: `{ ok: false, error }` when it can't be read at all, else
 * `{ ok: true, items, added, changed, same, skipped, notes, changes }`: the items part as it would be; what is new
 * (items, features) and what changes (with each part from and to); how many rows change nothing; each line skipped and
 * why; what is good to know; and how many changes in all.
 */
const readItemsFile = (definition, input) => {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'Nothing to read' };
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) return { ok: false, error: `That is more than ${MAX_BYTES / 1000} KB. Split it into smaller files.` };
  const part = isPlainObject(definition.items) ? JSON.parse(JSON.stringify(definition.items)) : {};
  part.list = list(part.list).filter((i) => isPlainObject(i) && typeof i.id === 'string');
  const { sections, features, skipped, notes } = rowsOf(stripBom(input), definition);
  const added = { items: [], features: [] };
  const changed = { items: [], features: [] };
  let unchanged = 0;
  const own = ownTypes(definition);
  const names = { known: (n) => namesOf(definition).has(n), refused: (n) => `@${n} isn't one of this system's names` };
  const skip = (line, message) => skipped.push({ line, message });
  const clearing = (v) => v === CLEAR;
  const isInstall = (needs) => installsOf(definition).some((s) => s.id === needs);

  // Ids an item or its feature could clash with: options, features and items share one set, and formulas read names.
  const taken = new Set();
  for (const c of choicesOf(definition)) {
    taken.add(c.id);
    for (const o of list(c.options).filter(isPlainObject)) { taken.add(o.id); for (const f of list(o.features).filter(isPlainObject)) taken.add(f.id); }
  }
  for (const i of part.list) { taken.add(i.id); for (const f of list(i.features).filter(isPlainObject)) taken.add(f.id); }
  for (const n of namesOf(definition).keys()) taken.add(n);

  for (const { type, rows } of sections) {
    for (const row of rows) {
      const name = row.get('name');
      if (!name || clearing(name)) { skip(row.line, 'No name'); continue; }
      if (name.length > CHOICE_LIMITS.label) { skip(row.line, `${name.slice(0, 20)}…: a name is ${CHOICE_LIMITS.label} characters at most`); continue; }
      const matches = part.list.filter((i) => same(i.label ?? '', name));
      if (matches.length > 1) { skip(row.line, `${name}: there are ${matches.length} items called that; rename one in the builder first`); continue; }
      // Every cell read before anything changes, so a row with a mistake changes nothing.
      const values = {};
      let wrong = null;
      for (const column of type.columns) {
        const text = row.get((column.label || column.id).toLowerCase());
        if (!text) continue;
        if (clearing(text)) { values[column.id] = null; continue; }
        const read = readValue(column, text, names);
        if (read.problem) { wrong = read.problem; break; }
        values[column.id] = read.value;
      }
      if (wrong) { skip(row.line, `${name}: ${wrong}`); continue; }
      const needsText = row.get('needs');
      const needsRead = needsText && !clearing(needsText) ? needsFrom(definition, needsText) : null;
      if (needsRead && needsRead.problem) { skip(row.line, `${name}: ${needsRead.problem}`); continue; }
      const costText = installsOf(definition).length ? row.get('cost') : '';
      const cost = costText && !clearing(costText) ? Number(costText) : null;
      if (costText && !clearing(costText) && (!/^\d+(\.\d+)?$/.test(costText) || cost > LIMITS.cost)) { skip(row.line, `${name}: cost is a number from 0 to ${LIMITS.cost}, not ${costText}`); continue; }
      const words = row.get('words');
      if (words.length > CHOICE_LIMITS.description) { skip(row.line, `${name}: the words are longer than ${CHOICE_LIMITS.description} characters`); continue; }
      // Its own price and IN SHOPS (8a7a3b2): null clears, undefined leaves as it is.
      const priceText = own && !pricedByColumn(type) ? row.get('price') : '';
      const price = !priceText ? undefined : clearing(priceText) ? null : Number(priceText);
      if (priceText && !clearing(priceText) && (!/^\d+(\.\d+)?$/.test(priceText) || price > MOST_PRICE)) { skip(row.line, `${name}: price is a number from 0 to ${MOST_PRICE}, not ${priceText}`); continue; }
      const shopsText = own ? row.get('in shops') : '';
      const shopsWord = shopsText.toLowerCase();
      const shops = !shopsText ? undefined : clearing(shopsText) ? null : SHOPS_WORDS[shopsWord];
      if (shops === undefined && shopsText) { skip(row.line, `${name}: in shops is yes or no, not ${shopsText}`); continue; }

      let item = matches[0];
      const typeWas = item ? typeNamed(definition, item.type).id : null;
      const needsTo = needsRead ? needsRead.needs : clearing(needsText) ? 'worn' : (item ? item.needs || 'worn' : 'worn');
      if (cost !== null && !isInstall(needsTo)) { skip(row.line, `${name}: a cost is only for an item installed as ${installsOf(definition).map((s) => (s.label || s.id).toUpperCase()).join(' or ')}`); continue; }

      if (!item) {
        if (part.list.length >= LIMITS.items) { skip(row.line, `${name}: there are ${LIMITS.items} items, the most a system holds`); continue; }
        item = { id: idFrom(name, taken), label: name };
        if (own) item.type = type.id;
        const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
        if (Object.keys(kept).length) item.values = kept;
        if (needsTo !== 'worn') item.needs = needsTo;
        if (isInstall(needsTo)) item.cost = cost ?? 1;
        if (words && !clearing(words)) item.description = words;
        if (typeof price === 'number') item.price = price;
        if (typeof shops === 'boolean') item.in_shops = shops;
        part.list.push(item);
        added.items.push({ line: row.line, item: name, type: (type.one || type.label || type.id) });
        continue;
      }

      const parts = [];
      // Another type: its own, keeping the values of columns both have, of the same kind.
      let held = isPlainObject(item.values) ? { ...item.values } : {};
      if (typeWas !== type.id) {
        const from = typeNamed(definition, typeWas);
        held = Object.fromEntries(Object.entries(held).filter(([c]) => { const a = from.columns.find((x) => x.id === c); const b = type.columns.find((x) => x.id === c); return a && b && a.kind === b.kind; }));
        parts.push({ part: 'type', from: (from.label || from.id).toUpperCase(), to: (type.label || type.id).toUpperCase() });
        item.type = type.id;
      }
      for (const [c, v] of Object.entries(values)) {
        const column = type.columns.find((x) => x.id === c);
        const was = held[c];
        if (v === null ? was === undefined : was === v) continue;
        parts.push({ part: (column.label || column.id).toLowerCase(), from: was === undefined ? '' : String(was), to: v === null ? '' : String(v) });
        if (v === null) delete held[c]; else held[c] = v;
      }
      if (Object.keys(held).length) item.values = held; else delete item.values;
      if (needsTo !== (item.needs || 'worn')) {
        parts.push({ part: 'needs', from: item.needs || 'worn', to: needsTo });
        if (needsTo === 'worn') delete item.needs; else item.needs = needsTo;
      }
      if (isInstall(item.needs)) {
        const to = cost ?? (typeof item.cost === 'number' ? item.cost : 1);
        if (item.cost !== to) { parts.push({ part: 'cost', from: item.cost === undefined ? '' : String(item.cost), to: String(to) }); item.cost = to; }
      } else if (item.cost !== undefined) { parts.push({ part: 'cost', from: String(item.cost), to: '' }); delete item.cost; }
      if (words) {
        const from = typeof item.description === 'string' ? item.description : '';
        const to = clearing(words) ? '' : words;
        if (!sameWords(from, to)) { parts.push({ part: 'words', from, to }); if (to) item.description = to; else delete item.description; }
      }
      if (price !== undefined && (price === null ? item.price !== undefined : item.price !== price)) {
        parts.push({ part: 'price', from: item.price === undefined ? '' : String(item.price), to: price === null ? '' : String(price) });
        if (price === null) delete item.price; else item.price = price;
      }
      const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : '');
      if (shops !== undefined && (shops === null ? item.in_shops !== undefined : item.in_shops !== shops)) {
        parts.push({ part: 'in shops', from: yesNo(item.in_shops), to: yesNo(shops) });
        if (shops === null) delete item.in_shops; else item.in_shops = shops;
      }
      if (parts.length) changed.items.push({ line: row.line, item: item.label, parts });
      else unchanged += 1;
    }
  }

  // FEATURES: on an item named in the list or added above; words, uses and a rest.
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const isTable = (n) => Object.prototype.hasOwnProperty.call(tables, n);
  const known = new Set(namesOf(definition).keys());
  const rests = refillsOf(definition);
  for (const row of features) {
    const itemName = row.get('item');
    const name = row.get('feature');
    const words = row.get('words');
    const uses = row.get('uses');
    const refill = row.get('refill');
    if (!itemName || !name || clearing(name)) { skip(row.line, 'Needs an item and a feature'); continue; }
    const items = part.list.filter((i) => same(i.label ?? '', itemName));
    if (!items.length) { skip(row.line, `${itemName}: no item of that name here or in the file`); continue; }
    if (items.length > 1) { skip(row.line, `${itemName}: there are ${items.length} items called that; rename one in the builder first`); continue; }
    const item = items[0];
    item.features = list(item.features);
    if (name.length > CHOICE_LIMITS.label) { skip(row.line, `${name.slice(0, 20)}…: a name is ${CHOICE_LIMITS.label} characters at most`); continue; }
    if (words.length > CHOICE_LIMITS.description) { skip(row.line, `${name}: the words are longer than ${CHOICE_LIMITS.description} characters`); continue; }
    if (uses && !clearing(uses)) {
      const bad = formulaProblem(uses, known, isTable);
      if (bad) { skip(row.line, `${name}: uses: ${bad}`); continue; }
    }
    let rest = null;
    if (refill && !clearing(refill)) {
      rest = rests.find(refill);
      if (!rest) { skip(row.line, `${name}: refill: "${refill}" isn't one of this system's rests (${rests.names})`); continue; }
    }
    const feature = item.features.find((f) => isPlainObject(f) && same(f.label ?? '', name));
    if (!feature) {
      if (item.features.length >= LIMITS.features) { skip(row.line, `${name}: ${item.label} has ${LIMITS.features} features, the most an item holds`); continue; }
      const count = uses && !clearing(uses) ? uses : null;
      if (rest && !count) { skip(row.line, `${name}: a refill needs uses`); continue; }
      const made = { id: idFrom(name, taken), label: name };
      if (words && !clearing(words)) made.text = words;
      if (count) made.uses = { count, ...(rest ? { refill: rest } : {}) };
      item.features.push(made);
      added.features.push({ line: row.line, item: item.label, feature: name });
      continue;
    }
    const parts = [];
    const text = typeof feature.text === 'string' ? feature.text : '';
    if (words && !sameWords(text, clearing(words) ? '' : words)) {
      parts.push({ part: 'words', from: text, to: clearing(words) ? '' : words });
      if (clearing(words)) delete feature.text; else feature.text = words;
    }
    const had = isPlainObject(feature.uses) ? feature.uses : null;
    const count = !uses ? (had ? had.count : null) : clearing(uses) ? null : uses;
    const refillTo = !refill ? (count && had && typeof had.refill === 'string' ? had.refill : null) : clearing(refill) ? null : rest;
    if (refillTo && !count) { skip(row.line, `${name}: a refill needs uses`); continue; }
    if (uses && (had ? String(had.count) : '') !== (count ?? '')) parts.push({ part: 'uses', from: had ? String(had.count) : '', to: count ?? '' });
    if (refill && (had && typeof had.refill === 'string' ? had.refill : '') !== (count ? refillTo ?? '' : '')) parts.push({ part: 'refill', from: had && typeof had.refill === 'string' ? had.refill : '', to: count ? refillTo ?? '' : '' });
    if (count) feature.uses = { count, ...(refillTo ? { refill: refillTo } : {}) };
    else delete feature.uses;
    if (parts.length) changed.features.push({ line: row.line, item: item.label, feature: feature.label, parts });
    else unchanged += 1;
    const keeps = [['modifiers', 'its modifiers'], ['rolls', 'the rolls it gives'], ['changes', 'the roll changes it allows']]
      .filter(([k]) => Array.isArray(feature[k]) && feature[k].length).map(([, w]) => w);
    if (keeps.length) notes.push({ line: row.line, message: `${item.label} · ${feature.label} keeps ${keeps.join(', ')}, set in the builder` });
  }

  if (!part.list.length) delete part.list;
  const changes = added.items.length + added.features.length + changed.items.length + changed.features.length;
  skipped.sort((a, b) => a.line - b.line);
  notes.sort((a, b) => a.line - b.line);
  return { ok: true, items: part, added, changed, same: unchanged, skipped, notes, changes };
};

module.exports = { readItemsFile };
