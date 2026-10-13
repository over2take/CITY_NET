// Where an item lands on a sheet, on the server (4g1a; approved mockup docs/mockups/give-item.html,
// 2026-10-12). GIVE ITEM places a gift here, so it is on the sheet the moment it is given, whether
// or not its player is online (the user's call: "it needs to show up when given, not after a
// login"). A purchase is still placed by the buyer's own window.
//
// **Mirrored from the frontend, and held to it by a test.** frontend/src/sheets/shopPlacement.ts
// (placeUploaded) and inventory.ts are the originals; frontend/src/sheets/__tests__/
// serverPlacement.test.ts walks both against the same sheets, so a gift lands exactly where buying
// the same thing would. This file covers what every game shares: an uploaded catalogue's entry, and
// the inventory. The CWN book's shelves come in 4g1b.
//
// Three shapes, as the shop has them:
//
//   slots      - the first free numbered row of the group (weapon, vehicle).
//   list       - a new cyberware row, not yet placed on the body.
//   inventory  - a line in the inventory, stacked onto a carried one of the same name.
//
// Pure: a sheet's data in, a patch out. The caller writes it through the sheet's queue.

const sheetSlots = require('./sheetSlots');
const cyberware = require('../sheets/cyberware');
const { fittedIds } = require('../sheets/cwnCyberMods');

const INVENTORY_FIELD = 'inventory';

/** Which numbered group a slot-shaped catalogue fills. */
const GROUP_OF = { weapons: 'weapon', vehicles: 'vehicle' };

/**
 * The systems whose sheet draws a cyberware table, so a cyberware catalogue fills it rather than
 * the inventory (the frontend reads this off the templates' layouts: catalogueSchema.ts layoutsOf).
 * A custom system's sheet has no such table.
 */
const CYBERWARE_TABLE = new Set(['cities_without_number', 'cyberpunk_red']);

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ─── The inventory (frontend inventory.ts) ────────────────────────────────────

const carryOf = (v) => {
  const s = str(v).trim().toLowerCase();
  return s === 'readied' || s === 'stowed' ? s : 'stash';
};

/** An item with every field present, whatever it was handed. */
const normaliseItem = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    name: str(r.name),
    qty: Math.max(1, Math.floor(num(r.qty)) || 1),
    enc: str(r.enc),
    bundled: r.bundled === true,
    carry: carryOf(r.carry),
    location: str(r.location),
  };
};

/** Whatever the sheet holds, as items; anything unreadable is an empty inventory. */
const readInventory = (data) => {
  let value = data ? data[INVENTORY_FIELD] : undefined;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map(normaliseItem);
};

const writeInventory = (items) => JSON.stringify(items);

/** A new line: one of it, Stowed, as you walk off with it. */
const blankItem = () => ({ name: '', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' });

/**
 * The inventory with one more of something: stacked onto a carried line that `same` matches (by
 * default, one of the same name), or a new line. Stash lines are never stacked onto: a box in a
 * locker is yours, but it is not what you were just handed.
 */
const addToInventory = (data, name, enc, same = (item) => item.name === name) => {
  const items = readInventory(data);
  const i = items.findIndex((item) => item.carry !== 'stash' && same(item));
  const next = i >= 0
    ? items.map((item, n) => (n === i ? { ...item, qty: item.qty + 1 } : item))
    : [...items, { ...blankItem(), name, qty: 1, enc: str(enc) }];
  return { [INVENTORY_FIELD]: writeInventory(next) };
};

// ─── Uploaded catalogues (frontend shopPlacement.ts) ──────────────────────────

/** How a catalogue's items land under a system: numbered rows, the cyberware table, or the inventory. */
const shapeOf = (system, catalogue) => {
  const group = GROUP_OF[catalogue];
  if (group && sheetSlots.slotsOf(system)[group]) return 'slots';
  if (catalogue === 'cyberware' && CYBERWARE_TABLE.has(system)) return 'list';
  return 'inventory';
};

/**
 * A sheet's cyberware rows as the shop reads them (frontend cyberwareRows.ts readRows): each with the
 * mods fitted to it. The server's own normaliseRow predates that list and would drop it, stripping
 * mods off chrome the character already has.
 */
const cyberRows = (data) => {
  const value = data && data[cyberware.FIELD];
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map((r) => ({ ...cyberware.normaliseRow(r), cyberMods: fittedIds(r) }));
};

/** The first row of a group with no name in it, or null when every one is taken. */
const firstFreeSlot = (data, group, rows) => {
  for (let i = 1; i <= rows; i += 1) {
    if (!str(data[`${group}${i}_name`]).trim()) return i;
  }
  return null;
};

/**
 * One uploaded catalogue entry ({ name, price, fields }) onto a sheet: { ok: true, patch }, or
 * { ok: false, reason } when it has nowhere to go.
 */
const placeUploaded = (system, catalogue, entry, data) => {
  const sheet = data && typeof data === 'object' ? data : {};
  const fields = (entry && entry.fields) || {};
  const shape = shapeOf(system, catalogue);

  if (shape === 'slots') {
    const group = GROUP_OF[catalogue];
    const slots = sheetSlots.slotsOf(system)[group];
    const row = firstFreeSlot(sheet, group, slots.rows);
    if (row === null) return { ok: false, reason: `No free ${group} slot — all ${slots.rows} are full. Clear one on the sheet first.` };
    // Only what the row has: a GM's file can carry a column from another game's sheet.
    const patch = {};
    for (const suffix of slots.fields) {
      if (suffix === 'name') continue;
      const value = fields[suffix];
      if (value !== undefined && value !== '') patch[`${group}${row}_${suffix}`] = String(value);
    }
    if (slots.fields.includes('cost')) patch[`${group}${row}_cost`] = String(entry.price);
    patch[`${group}${row}_name`] = entry.name;
    return { ok: true, patch };
  }

  if (shape === 'list') {
    // Unplaced: owning a piece and having it in your body are two different facts.
    const row = cyberware.normaliseRow({
      name: entry.name,
      type: fields.type ?? '',
      hl: fields.strain ?? 0,
      cost: entry.price,
      conc: fields.conc ?? '',
      data: fields.effect ?? '',
      equipped: true,
      placed: false,
    });
    // Nothing fitted to a new piece yet.
    return { ok: true, patch: { [cyberware.FIELD]: [...cyberRows(sheet), { ...row, cyberMods: [] }] } };
  }

  return { ok: true, patch: addToInventory(sheet, entry.name, fields.enc ?? '') };
};

/**
 * `qty` of something placed one at a time, each against the sheet as the last left it: { ok: true,
 * patch } with every unit in it, or { ok: false, reason, placed } when they don't all fit (none of
 * them placed: a gift is all or nothing). `place(data)` places one.
 */
const placeTimes = (place, data, qty) => {
  const n = Math.max(1, Math.floor(num(qty)) || 1);
  let sheet = data && typeof data === 'object' ? { ...data } : {};
  const patch = {};
  for (let i = 0; i < n; i += 1) {
    const one = place(sheet);
    if (!one.ok) return { ok: false, reason: one.reason, placed: i };
    Object.assign(patch, one.patch);
    sheet = { ...sheet, ...one.patch };
  }
  return { ok: true, patch };
};

module.exports = {
  INVENTORY_FIELD, CYBERWARE_TABLE, GROUP_OF,
  normaliseItem, readInventory, writeInventory, blankItem, addToInventory, cyberRows,
  shapeOf, firstFreeSlot, placeUploaded, placeTimes,
};
