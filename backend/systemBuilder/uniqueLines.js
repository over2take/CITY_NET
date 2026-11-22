// UNIQUE (G5a; decided 2026-11-20, the user: "mark it as Unique so the GM can see changes at a glance"; approved mockup
// docs/mockups/sheet-gear-layout.html, "changing one line"). A gear line named like one of the system's items, of that
// item's type, takes the item's values; a column it fills with a value of its own that isn't the item's makes it that item
// made unique (the Cutlass made 2d8 to level with the player).
//
// The server keeps who changed each such column and when, on the line: `changed: { damage: { by: 'kes', at: ISO } }`, with
// `gm: true` where it was the GM. Worked out on every write of the inventory from what was stored before, never from what
// the sheet sends: a column the write left as it was keeps its record, one changed gets the writer's, one put back to the
// item's (THE ITEM'S, or cleared) loses it. A line made unique by no one (bought from a catalogue with values of its own)
// is still unique, with no one named.
//
// Pure; the sheet writes call it (sockets updateSheetField, the GM's PUT /api/sheets/user/:username and /npcs/:id).
//
// PLAYERS CHANGE GEAR (G6a; decided 2026-11-20, all A: a GAME tab switch, on to start; off, only the GM changes columns,
// players still name, count and move their things; the user: "the GM can still open, view and change things"). Off, a
// player's write keeps every line's column values as stored, and a line they add comes without any: keepColumns.

/** The table's setting (global_settings): '0' switches PLAYERS CHANGE GEAR off. */
const PLAYERS_GEAR_SETTING = 'players_change_gear';

const { typesOf, typeNamed } = require('./itemTypes');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const key = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
/** A value as given, read loosely: 2 and "2" are one, spaces around don't count. */
const same = (a, b) => a !== undefined && b !== undefined && String(a).trim() === String(b).trim();
const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Gear lines as stored (a JSON string or a list), or null where they can't be read. */
const parse = (v) => {
  if (typeof v === 'string') { try { const rows = JSON.parse(v); return Array.isArray(rows) ? rows : null; } catch { return null; } }
  return Array.isArray(v) ? v : null;
};

/** The system's item a line is, with the line's type, where the line is named like it and of its type; else null. */
const itemOf = (definition, line) => {
  const name = key(line && line.name);
  if (!name || !isPlainObject(definition) || !isPlainObject(definition.items)) return null;
  const item = list(definition.items.list).find((i) => isPlainObject(i) && key(i.label) === name);
  if (!item) return null;
  const itemType = typeNamed(definition, item.type);
  const type = typesOf(definition).find((t) => t.id === line.type) || itemType;
  return type.id === itemType.id ? { item, type } : null;
};

/** The columns a line fills with a value of its own that isn't its item's, by id, in the type's order. */
const uniqueColumns = (definition, line) => {
  const of = isPlainObject(line) ? itemOf(definition, line) : null;
  if (!of) return [];
  const own = isPlainObject(line.values) ? line.values : {};
  const given = isPlainObject(of.item.values) ? of.item.values : {};
  return of.type.columns.filter((c) => filled(own[c.id]) && !same(own[c.id], given[c.id])).map((c) => c.id);
};

/**
 * The line each of `next` was in `prev`, or null for one that is new: the one in its place where it has the same name, else
 * the first unclaimed of its name. Its type needn't match: a line made another type than its item's is no longer the item.
 */
const pairLines = (prev, next) => {
  const claimed = new Set();
  const fits = (p, line) => isPlainObject(p) && isPlainObject(line) && key(p.name) === key(line.name);
  return next.map((line, i) => {
    const j = !claimed.has(i) && fits(prev[i], line) ? i : prev.findIndex((p, n) => !claimed.has(n) && fits(p, line));
    if (j < 0) return null;
    claimed.add(j);
    return prev[j];
  });
};

/**
 * A player's lines with PLAYERS CHANGE GEAR off (G6a): each line's column values as stored for the line it was, none on a
 * line that is new; its name, how many, where it is and the rest as sent. In the form given; as given where unreadable.
 */
const keepColumns = (before, after) => {
  const next = parse(after);
  if (!next) return after;
  const was = pairLines(parse(before) || [], next);
  const out = next.map((line, i) => {
    if (!isPlainObject(line)) return line;
    const { values: _typed, ...rest } = line;
    return was[i] && isPlainObject(was[i].values) ? { ...rest, values: { ...was[i].values } } : rest;
  });
  return typeof after === 'string' ? JSON.stringify(out) : out;
};

/**
 * The lines `after` as they are to be stored, each with `changed` worked out against `before` (what was stored): `who` is
 * { by: username, gm }. In the form given (a JSON string stays one); as given where the system has no definition or the
 * lines can't be read.
 */
const withChanges = (definition, before, after, who, at = new Date().toISOString()) => {
  if (!isPlainObject(definition)) return after;
  const next = parse(after);
  if (!next) return after;
  const prev = parse(before) || [];
  const stamp = { by: who && typeof who.by === 'string' ? who.by : '', ...(who && who.gm ? { gm: true } : {}), at };
  const wasLines = pairLines(prev, next);
  const out = next.map((line, i) => {
    if (!isPlainObject(line)) return line;
    // What the sheet says was changed is never taken: worked out here alone.
    const { changed: _sent, ...rest } = line;
    const was = wasLines[i];
    const kept = was && isPlainObject(was.changed) ? was.changed : {};
    const wasOwn = was && isPlainObject(was.values) ? was.values : {};
    const changed = {};
    for (const id of uniqueColumns(definition, rest)) {
      if (was && same(rest.values[id], wasOwn[id])) { if (isPlainObject(kept[id])) changed[id] = kept[id]; } else changed[id] = stamp;
    }
    return Object.keys(changed).length ? { ...rest, changed } : rest;
  });
  return typeof after === 'string' ? JSON.stringify(out) : out;
};

module.exports = { PLAYERS_GEAR_SETTING, withChanges, keepColumns, pairLines, uniqueColumns, itemOf };
