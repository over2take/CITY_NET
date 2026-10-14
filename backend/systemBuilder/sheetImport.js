// A custom system's sheet, filled in outside CITY_NET and brought back through IMPORT (4h2a;
// approved mockup docs/mockups/sheet-import.html, 2026-10-13). The built-in games have importers
// written by hand (sheets/importers.js); a custom system's is made here from its own sheet, so it
// always reads what that sheet holds, and so do the blank PDF form (4h2b) and the JSON template.
//
// What a player fills in is every field they may edit. Left out, and reported if a file holds them:
//   - worked-out values: the game works them out (derived);
//   - what lives elsewhere: HP on the token, cash in the bank (a field's `source`);
//   - GM-only fields: an upload skips them anyway (sheets/templates playerMayEdit).
// A field is matched by its id or its label, in any case and spacing. A choice must be one of its
// options (by value or label). The inventory comes as lines ("2x Rope") or a list.
//
// Pure, needing no pdf-lib, so the browser's tests can hold the PDF form and this to each other.

const { effectiveSheet } = require('./sheet');
const { normaliseInventory } = require('../sheets/inventoryImport');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const norm = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const labelOf = (f) => (typeof f.label === 'string' && f.label.trim() ? f.label.trim() : f.id);
const optionValue = (o) => String(o.value ?? o.label);

/** The inventory's one field, whichever section holds it. */
const INVENTORY = 'inventory';
/** The blank PDF form's inventory lines (4h2b): a name and a quantity each, named inventory_<n>_name and _qty. */
const INVENTORY_ROWS = 12;
const ROW = /^inventory_(\d{1,2})_(name|qty)$/;

/** Each stat's range, by id: printed beside its box. */
const rangesOf = (definition) => new Map(list(definition && definition.stats)
  .filter(isPlainObject).flatMap((g) => list(g.stats))
  .filter((s) => isPlainObject(s) && typeof s.id === 'string')
  .map((s) => [s.id, { min: Number.isSafeInteger(s.min) ? s.min : null, max: Number.isSafeInteger(s.max) ? s.max : null }]));

/**
 * The sheet, read for importing: every field with why it isn't asked for (`left`: 'worked_out',
 * 'elsewhere', 'gm_only') or what it is (`ask`: { id, label, type, options?, min?, max?, tab,
 * section }), in the sheet's order. An inventory section asks for the inventory, once.
 */
const sheetFields = (definition) => {
  const derived = new Set(list(definition && definition.derived).filter(isPlainObject).map((d) => d.id));
  const ranges = rangesOf(definition);
  const sheet = effectiveSheet(definition);
  const ask = [];
  const left = [];
  let inventory = false;
  for (const s of list(sheet && sheet.sections).filter(isPlainObject)) {
    const where = { tab: typeof s.tab === 'string' ? s.tab : null, section: typeof s.label === 'string' ? s.label : s.id };
    if (s.layout === 'inventory') {
      if (!inventory) ask.push({ id: INVENTORY, label: 'Inventory', type: 'inventory', ...where });
      inventory = true;
      continue;
    }
    for (const f of list(s.fields).filter((x) => isPlainObject(x) && typeof x.id === 'string')) {
      const label = labelOf(f);
      if (derived.has(f.id)) { left.push({ id: f.id, label, why: 'worked_out' }); continue; }
      if (typeof f.source === 'string') { left.push({ id: f.id, label, why: 'elsewhere' }); continue; }
      if (f.edit === 'gm') { left.push({ id: f.id, label, why: 'gm_only' }); continue; }
      const range = ranges.get(f.id);
      ask.push({
        id: f.id, label, type: f.type || 'text', ...where,
        ...(f.type === 'select' ? { options: list(f.options).filter(isPlainObject).map((o) => ({ value: optionValue(o), label: String(o.label ?? o.value) })) } : {}),
        ...(range && range.min !== null ? { min: range.min } : {}),
        ...(range && range.max !== null ? { max: range.max } : {}),
      });
    }
  }
  return { ask, left };
};

/**
 * The PDF form's numbered inventory lines gathered into the inventory's list, in order, a missing
 * quantity read as one (a line with no name is dropped with the rest, below); an inventory already
 * given as a whole wins.
 */
const withRows = (candidates) => {
  const rows = new Map();
  const rest = {};
  for (const [key, value] of Object.entries(candidates)) {
    const m = ROW.exec(key);
    if (!m) { rest[key] = value; continue; }
    const n = Number(m[1]);
    rows.set(n, { ...(rows.get(n) || {}), [m[2]]: value });
  }
  const items = [...rows.entries()].sort((a, b) => a[0] - b[0])
    .map(([, r]) => ({ name: String(r.name ?? '').trim(), qty: Math.max(1, Math.floor(Number(r.qty)) || 1) }));
  if (items.length && rest[INVENTORY] === undefined) rest[INVENTORY] = items;
  return rest;
};

/** A JSON template's own fields, unwrapped, or the candidates as they came; a form's lines gathered. */
const candidatesOf = (raw) => {
  if (!isPlainObject(raw)) return {};
  return withRows(isPlainObject(raw.fields) && (raw.help !== undefined || raw.instructions !== undefined || raw.system !== undefined) ? raw.fields : raw);
};

/**
 * The importer for one custom system: { mapFields(raw), parseText(text) }, the same shape as the
 * built-in games' (sheets/importers.js). mapFields answers { mapped, unmapped, skipped } as theirs
 * do (skipped: what lives elsewhere), with what else was left and why: `workedOut`, `gmOnly`, and
 * `notAChoice` (a choice that isn't one of the options).
 */
const customImporter = (definition) => {
  const { ask, left } = sheetFields(definition);
  const byKey = new Map();
  for (const f of [...ask, ...left]) {
    for (const k of [f.id, f.label]) if (!byKey.has(norm(k))) byKey.set(norm(k), f);
  }

  const mapFields = (raw) => {
    const mapped = {};
    const out = { unmapped: {}, skipped: {}, workedOut: {}, gmOnly: {}, notAChoice: {} };
    for (const [key, value] of Object.entries(candidatesOf(raw))) {
      if (value === '' || value === null || value === undefined) continue;
      const f = byKey.get(norm(key));
      if (!f) { out.unmapped[key] = value; continue; }
      if (f.why === 'elsewhere') { out.skipped[key] = value; continue; }
      if (f.why === 'worked_out') { out.workedOut[key] = value; continue; }
      if (f.why === 'gm_only') { out.gmOnly[key] = value; continue; }
      if (f.type === 'inventory') {
        mapped[INVENTORY] = Array.isArray(value) ? JSON.stringify(value.filter((r) => isPlainObject(r) && String(r.name ?? '').trim())) : String(value);
        continue;
      }
      if (f.type === 'number') {
        const n = Number(value);
        if (typeof value === 'boolean' || !Number.isFinite(n)) { out.unmapped[key] = value; continue; }
        mapped[f.id] = n;
        continue;
      }
      if (f.type === 'select') {
        const wanted = norm(value);
        const option = f.options.find((o) => norm(o.value) === wanted || norm(o.label) === wanted);
        if (!option) { out.notAChoice[key] = value; continue; }
        mapped[f.id] = option.value;
        continue;
      }
      mapped[f.id] = String(value);
    }
    // An empty list leaves the inventory out altogether.
    normaliseInventory(mapped);
    return { mapped, ...out };
  };

  /**
   * A pasted stat block: "Might 14", "Calling: Knight", one to a line or two spaces apart. The
   * longest label or id a piece starts with is the field; the rest is its value.
   */
  const keys = new Set(byKey.keys());
  const parseText = (text) => {
    const found = {};
    for (const piece of String(text).split(/\r?\n|\s{2,}|;/)) {
      // The first colon or equals sign parts the name from the value, spaced or not (Luck=2).
      const words = piece.replace(/\s*[:=]\s*/, ' ').trim().split(/\s+/).filter(Boolean);
      for (let n = words.length - 1; n >= 1; n -= 1) {
        const k = norm(words.slice(0, n).join(' '));
        if (!keys.has(k)) continue;
        found[byKey.get(k).id] = words.slice(n).join(' ');
        break;
      }
    }
    return found;
  };

  return { mapFields, parseText };
};

/** What the JSON template says about one field: its label, and what it takes. */
const helpFor = (f) => {
  if (f.type === 'inventory') return 'Inventory: a list of { "name", "qty" }, one per item';
  if (f.type === 'select') return `${f.label}, one of ${f.options.map((o) => o.label).join(', ')}`;
  if (f.type === 'number') {
    const range = f.min !== undefined && f.max !== undefined ? ` ${f.min} to ${f.max}`
      : f.min !== undefined ? `, at least ${f.min}` : f.max !== undefined ? `, at most ${f.max}` : '';
    return `${f.label}, a number${range}`;
  }
  return `${f.label}, any text`;
};

/**
 * The JSON template a player downloads and fills in: the fields by id, empty, a HELP line for each,
 * and instructions. Imported as it stands once filled in (customImporter unwraps it).
 */
const jsonTemplate = (definition, { name, version } = {}) => {
  const { ask } = sheetFields(definition);
  return {
    system: String(name || (definition && definition.name) || ''),
    version: Number.isSafeInteger(version) ? version : null,
    instructions: [
      'Fill in the values under fields. Leave out anything you don\'t know.',
      'Keep the keys as they are: they are the sheet\'s own.',
      'Upload this file in CITY_NET: your sheet -> IMPORT.',
    ],
    fields: Object.fromEntries(ask.map((f) => [f.id, f.type === 'inventory' ? [] : f.type === 'number' ? null : ''])),
    help: Object.fromEntries(ask.map((f) => [f.id, helpFor(f)])),
  };
};

module.exports = { INVENTORY, INVENTORY_ROWS, sheetFields, customImporter, jsonTemplate, norm };
