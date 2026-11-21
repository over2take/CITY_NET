// A shop catalogue's new lines made items of the system (8a7a4a; decided 2026-11-21, mockup docs/mockups/types-in-shops.html,
// questions 10 to 13): with ADD NEW LINES TO ITEMS switched on in the catalogue's preview, each line that isn't one of the
// system's items already becomes one, in the builder's DRAFT (live when the GM publishes; the file's line sells it until
// then): of its section's type, a shelf's lines of the DEFAULT type (the first); its columns' values where they fit, its
// price (in the type's PRICE column where it has one, else its own), IN SHOPS, its words as its words. Past the most a
// system holds, the rest aren't added, each said.
//
// Pure: a definition and the file's sections to the items to add, what is said about each, and nothing changed.

const { LIMITS: CHOICE_LIMITS, choicesOf, namesOf } = require('./choices');
const { LIMITS, itemsOf } = require('./items');
const { typesOf, ownTypes, valueProblem, PRICE_COLUMN, isPrice } = require('./itemTypes');
const { idFrom } = require('./choicesImport');
const { normaliseName } = require('../shops/prices');

const list = (v) => (Array.isArray(v) ? v : []);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Dice read whatever names they read: the builder checks them, as it does any item's. */
const ANY_NAME = { known: () => true, refused: (n) => `@${n}` };

/**
 * { items: the items to add, added: [{ line, catalogue, name, type }], skipped: [{ line, catalogue, name, message }] } for the
 * lines of `sections` (a catalogue as parsed, catalogue -> entries) against `definition`. Nothing for a system without types
 * of its own, whose items no shop sells by themselves.
 */
const itemsFromLines = (definition, sections) => {
  const out = { items: [], added: [], skipped: [] };
  if (!definition || !ownTypes(definition)) return out;
  const types = typesOf(definition);
  const existing = itemsOf(definition);
  const named = new Set(existing.map((i) => normaliseName(i.label)));
  // The names an item's id could clash with: options, features and items share one set, and formulas read names.
  const taken = new Set();
  for (const c of choicesOf(definition)) {
    taken.add(c.id);
    for (const o of list(c.options).filter(isPlainObject)) { taken.add(o.id); for (const f of list(o.features).filter(isPlainObject)) taken.add(f.id); }
  }
  for (const i of existing) { taken.add(i.id); for (const f of list(i.features).filter(isPlainObject)) taken.add(f.id); }
  for (const n of namesOf(definition).keys()) taken.add(n);
  let room = LIMITS.items - existing.length;

  for (const [catalogue, entries] of Object.entries(sections || {})) {
    const type = String(catalogue).startsWith('type:') ? types.find((t) => `type:${t.id}` === catalogue) : types[0];
    if (!type) continue;
    for (const e of list(entries)) {
      const name = String((e && e.name) || '').trim();
      const at = { line: (e && e.line) || 0, catalogue, name };
      // One already: the file's line overrules it, as the preview says; never a second.
      if (!name || named.has(normaliseName(name))) continue;
      if (name.length > CHOICE_LIMITS.label) { out.skipped.push({ ...at, message: `an item's name is ${CHOICE_LIMITS.label} characters at most: not added` }); continue; }
      if (room <= 0) { out.skipped.push({ ...at, message: `ITEMS holds ${LIMITS.items}, the most a system can: not added` }); continue; }
      const fields = isPlainObject(e.fields) ? e.fields : {};
      const values = {};
      for (const column of type.columns) {
        const value = fields[column.id];
        if (value === undefined || value === '' || column.id === PRICE_COLUMN) continue;
        if (!valueProblem(column, value, ANY_NAME)) values[column.id] = value;
      }
      const pricedByColumn = type.columns.some((c) => c.id === PRICE_COLUMN && c.kind === 'number');
      const price = isPrice(e.price) ? e.price : undefined;
      if (pricedByColumn && price !== undefined) values[PRICE_COLUMN] = price;
      const words = typeof fields.description === 'string' ? fields.description.trim().slice(0, CHOICE_LIMITS.description) : '';
      const item = {
        id: idFrom(name, taken), label: name, type: type.id,
        ...(Object.keys(values).length ? { values } : {}),
        ...(!pricedByColumn && price !== undefined ? { price } : {}),
        in_shops: price !== undefined,
        ...(words ? { description: words } : {}),
      };
      named.add(normaliseName(name));
      room -= 1;
      out.items.push(item);
      out.added.push({ ...at, type: String(type.label || type.id).toUpperCase() });
    }
  }
  return out;
};

module.exports = { itemsFromLines };
