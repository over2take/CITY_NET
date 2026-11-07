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
// A line per list a character picks from (7c6; approved mockup new-character, and the user's calls of
// 2026-11-07): a dropdown where one is picked, with a level box if it has levels, or names with commas between
// where more can be ("Soldier 3, Mage 1"). They are read by name. An upload is the character, complete, so it
// is king: one not met comes in as it is, said in the preview, and it replaces whatever a list held, locked by
// a roll or the GM or not. A list picked under a feature is on the form too, its picks placed under whatever
// opens them, so nothing is left to set up. A list it doesn't name is cleared, as a field left blank is. Only
// what it can't place is left out: a name it can't find, no room, or nothing opening it, each said by its line.
// Applying reads the names again (withImportedPicks), as the browser only hands back what it was told. The
// inventory is the one thing it adds to (inventoryAdded), to be tidied on the sheet. What an option gives comes
// only through FINISH.
//
// Pure, needing no pdf-lib, so the browser's tests can hold the PDF form and this to each other.

const { effectiveSheet } = require('./sheet');
const { PICKS_KEY, ROLLED_KEY, LIMITS: CHOICE_LIMITS, choicesOf, pickedOf, capOf, meets, needsText, heldOf, openingsOf, openCountOf } = require('./choices');
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

/** The options of a list that can be named. */
const namedOptions = (c) => list(c.options).filter((o) => isPlainObject(o) && typeof o.id === 'string');
/** How many a list can hold: its own room, or for one picked under features, what those features give in all. */
const roomOf = (definition, c) => {
  if (pickedOf(c) !== 'features') return capOf(c);
  return choicesOf(definition).flatMap((l) => namedOptions(l)).flatMap((o) => list(o.features)).filter((f) => isPlainObject(f) && f.choice === c.id)
    .reduce((n, f) => n + openCountOf(f), 0);
};
/** The lists a form asks about: those a character picks from, with something in them and a way to pick it. */
const listsAsked = (definition) => choicesOf(definition).filter((c) => pickedOf(c) !== 'everyone' && namedOptions(c).length && roomOf(definition, c) > 0);
const optionLabel = (o) => String(o.label || o.id);

/**
 * The form's lines for the picks: { id, label, type, list, options?, hint?, levelOf?, min?, max?, section }.
 * Named pick_<list>, a name no sheet field is given, and read by the list's own words too.
 */
const pickLines = (definition) => listsAsked(definition).flatMap((c) => {
  const one = String(c.one || c.id);
  const names = namedOptions(c).map(optionLabel);
  const where = { tab: null, section: 'CHOICES' };
  if (roomOf(definition, c) !== 1) {
    return [{ id: `pick_${c.id}`, label: String(c.many || one), type: 'text', list: c, ...where, hint: c.levelled === true ? `Names and levels, commas between: ${names[0]} 2${names[1] ? `, ${names[1]} 1` : ''}` : `Names, commas between: ${names.join(', ')}` }];
  }
  return [
    { id: `pick_${c.id}`, label: one, type: 'select', list: c, ...where, options: namedOptions(c).map((o) => ({ value: o.id, label: optionLabel(o) })) },
    ...(c.levelled === true ? [{ id: `pick_${c.id}_level`, label: `${one} level`, type: 'number', levelOf: c, min: 1, max: CHOICE_LIMITS.level, ...where }] : []),
  ];
});

/** A level as written, in range, or null. */
const levelFrom = (v) => {
  const n = Number(v);
  return v !== '' && Number.isInteger(n) && n >= 1 && n <= CHOICE_LIMITS.level ? n : null;
};

/**
 * What one line names, as picks: { picks: [{ option, level? }], notFound, tooMany }. A name first as it
 * stands, then with a level off its end on a list with levels, so an option called "Rank 2" stays itself.
 */
const readLine = (definition, c, value, level) => {
  const options = namedOptions(c);
  const find = (name) => options.find((o) => norm(o.id) === norm(name) || norm(optionLabel(o)) === norm(name));
  const picks = [];
  const notFound = [];
  const tooMany = [];
  const parts = (Array.isArray(value) ? value : String(value).split(',')).map((p) => String(p).trim()).filter(Boolean);
  for (const part of parts) {
    let option = find(part);
    let own = null;
    if (!option && c.levelled === true) {
      const m = /^(.*\S)\s+(\d+)$/.exec(part);
      if (m && find(m[1])) { option = find(m[1]); own = levelFrom(m[2]); }
    }
    if (!option) { notFound.push(part); continue; }
    if (picks.some((p) => p.option === option.id)) continue;
    if (picks.length >= roomOf(definition, c)) { tooMany.push(optionLabel(option)); continue; }
    const at = own ?? level;
    picks.push({ option: option.id, ...(c.levelled === true ? { level: at ?? 1 } : {}) });
  }
  return { picks, notFound, tooMany };
};

/**
 * These picks written over what each list held: a list's own as they are, and one picked under features
 * under whatever opens it, down the lists, as a pick here can open the next. { stored, unopened }.
 */
const placePicks = (definition, data, wanted) => {
  const stored = isPlainObject(data[PICKS_KEY]) ? { ...data[PICKS_KEY] } : {};
  let waiting = [];
  for (const c of listsAsked(definition)) {
    if (!wanted[c.id]) continue;
    const under = pickedOf(c) === 'features';
    stored[c.id] = under ? [] : wanted[c.id];
    if (under) waiting = [...waiting, ...wanted[c.id].map((pick) => ({ c, pick }))];
  }
  for (let moved = true; moved && waiting.length;) {
    moved = false;
    waiting = waiting.filter(({ c, pick }) => {
      const held = heldOf(definition, { ...data, [PICKS_KEY]: stored }).filter((p) => p.active);
      const opening = openingsOf(definition, held).find((o) => o.list === c && o.used < o.count);
      if (!opening) return true;
      stored[c.id] = [...stored[c.id], { ...pick, from: opening.feature.id }];
      moved = true;
      return false;
    });
  }
  return { stored, unopened: waiting };
};

/**
 * The sheet with an upload's picks on it (7c6), each list named taking them in place of whatever it held.
 * What was sent is read again here, and placed again against the sheet as it is now. With `whole`, the upload
 * is the whole character: a list it doesn't name is cleared too, and any roll waiting goes with it.
 */
const withImportedPicks = (definition, data, sent, { whole = false } = {}) => {
  if (!definition || (!isPlainObject(sent) && !whole)) return data;
  const given = isPlainObject(sent) ? sent : {};
  const wanted = {};
  for (const c of listsAsked(definition)) {
    if (!Array.isArray(given[c.id])) {
      if (whole) wanted[c.id] = [];
      continue;
    }
    const named = namedOptions(c);
    const picks = [];
    for (const p of given[c.id].filter(isPlainObject)) {
      if (!named.some((o) => o.id === p.option) || picks.some((x) => x.option === p.option) || picks.length >= roomOf(definition, c)) continue;
      picks.push({ option: p.option, ...(c.levelled === true ? { level: levelFrom(p.level) ?? 1 } : {}) });
    }
    wanted[c.id] = picks;
  }
  const { [ROLLED_KEY]: rolled, ...rest } = data;
  return { ...(whole ? rest : data), [PICKS_KEY]: placePicks(definition, data, wanted).stored };
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
  // After the sheet's own: a field called Class is the field.
  for (const f of pickLines(definition)) {
    const words = f.list ? [f.id, f.label, f.list.one, f.list.many] : [f.id, f.label];
    for (const k of words) if (typeof k === 'string' && !byKey.has(norm(k))) byKey.set(norm(k), f);
  }

  const mapFields = (raw) => {
    const mapped = {};
    const out = { unmapped: {}, skipped: {}, workedOut: {}, gmOnly: {}, notAChoice: {} };
    const lines = new Map();
    const levels = new Map();
    for (const [key, value] of Object.entries(candidatesOf(raw))) {
      if (value === '' || value === null || value === undefined) continue;
      const f = byKey.get(norm(key));
      if (!f) { out.unmapped[key] = value; continue; }
      if (f.list) { lines.set(f.list, { key, value }); continue; }
      if (f.levelOf) { levels.set(f.levelOf, { key, value }); continue; }
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
    // The picks last, so what they need is read against the numbers just taken.
    const picks = {};
    const picksSaid = [];
    const picksNotFound = {};
    const picksTooMany = {};
    for (const [c, { key, value }] of lines) {
      const given = levels.get(c);
      const level = given ? levelFrom(given.value) : null;
      if (given && level === null) out.unmapped[given.key] = given.value;
      const read = readLine(definition, c, value, level);
      if (read.picks.length) picks[c.id] = read.picks;
      if (read.notFound.length) picksNotFound[key] = read.notFound;
      if (read.tooMany.length) picksTooMany[key] = read.tooMany;
    }
    for (const [c, { key, value }] of levels) if (!lines.has(c)) out.unmapped[key] = value;
    // Placed as they will be, so a list under a feature with nothing opening it is said now.
    const placed = placePicks(definition, mapped, picks);
    const picksUnopened = {};
    for (const { c, pick } of placed.unopened) {
      const { key } = lines.get(c);
      picksUnopened[key] = [...(picksUnopened[key] ?? []), optionLabel(namedOptions(c).find((o) => o.id === pick.option))];
      picks[c.id] = picks[c.id].filter((p) => p !== pick);
      if (!picks[c.id].length) delete picks[c.id];
    }
    const seen = { ...mapped, [PICKS_KEY]: placed.stored };
    for (const c of listsAsked(definition)) {
      for (const p of picks[c.id] ?? []) {
        const option = namedOptions(c).find((o) => o.id === p.option);
        const unmet = meets(definition, seen, option) ? null : needsText(definition, option.requires);
        picksSaid.push({ list: c.id, one: String(c.one || c.id), option: optionLabel(option), ...(p.level === undefined ? {} : { level: p.level }), ...(unmet ? { unmet } : {}) });
      }
    }
    return {
      mapped,
      ...out,
      ...(picksSaid.length ? { picks, picksSaid } : {}),
      ...(Object.keys(picksNotFound).length ? { picksNotFound } : {}),
      ...(Object.keys(picksTooMany).length ? { picksTooMany } : {}),
      ...(Object.keys(picksUnopened).length ? { picksUnopened } : {}),
      ...(mapped[INVENTORY] === undefined ? {} : { inventoryAdds: true }),
    };
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
  if (f.hint) return `${f.label}. ${f.hint}`;
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
  const lines = pickLines(definition);
  return {
    system: String(name || (definition && definition.name) || ''),
    version: Number.isSafeInteger(version) ? version : null,
    instructions: [
      'Fill in the values under fields. Leave out anything you don\'t know.',
      'Keep the keys as they are: they are the sheet\'s own.',
      'Upload this file in CITY_NET: your sheet -> IMPORT.',
    ],
    fields: Object.fromEntries([...ask, ...lines].map((f) => [f.id, f.type === 'inventory' ? [] : f.type === 'number' ? null : ''])),
    help: Object.fromEntries([...ask, ...lines].map((f) => [f.id, helpFor(f)])),
  };
};

module.exports = { INVENTORY, INVENTORY_ROWS, sheetFields, pickLines, withImportedPicks, customImporter, jsonTemplate, norm };
