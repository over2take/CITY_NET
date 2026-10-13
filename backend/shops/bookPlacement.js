// Where an item from the CWN book lands on a sheet, on the server (4g1b), for GIVE ITEM: the twin of
// the shop's own frontend/src/sheets/bookPlacement.ts, which the shop's shelves call. Held to it by
// frontend/src/sheets/__tests__/serverBookPlacement.test.ts, which places every book item, and
// uploaded ones, both ways on the same sheets.
//
//   weapons            a carried weapon row, Stowed
//   vehicles           a vehicle row from the preset's stat block, the * / ** immunity in its notes
//   cyberware          a cyberware row, not yet placed
//   armor, gear        an inventory line with its Encumbrance (blank where the book prints a symbol)
//   pharmaceuticals    an inventory line, stacked onto a dose of the same drug by any of its names
//   mods, fittings,    an inventory line
//   vehicle weapons
//
// A row is a book entry (bookRow) or a GM's uploaded one shaped like it (asBookRow): on CWN an upload
// joins the book's shelf and is placed the CWN way. Pure: a sheet in, a patch out.

const bookItems = require('./bookItems');
const { CATALOGUE } = require('./prices');
const { PHARMACEUTICALS } = require('../sheets/cwnPharma');
const cyberware = require('../sheets/cyberware');
const { addToInventory } = require('./placement');

/** How many carried weapon rows and vehicle slots a CWN sheet has (its template). */
const WEAPON_ROWS = 6;
const VEHICLE_ROWS = 6;

const text = (v) => (v === undefined || v === null ? '' : String(v));

/** An uploaded entry as a row on one of the book's shelves, both spellings of its name. */
const asBookRow = (e) => ({ id: e.id, name: e.name, label: e.name, price: e.price, cost: e.price, ...((e && e.fields) || {}) });

/**
 * One of the book's own entries as its shelf's row, or null. Names come from prices.js where the
 * book has nothing else a sheet needs.
 */
const bookRow = (catalogue, id) => {
  const key = String(id ?? '');
  const own = { weapons: bookItems.WEAPONS, vehicles: bookItems.VEHICLES, cyberware: bookItems.CYBERWARE, armor: bookItems.ARMOR, gear: bookItems.GEAR }[catalogue];
  if (own) return Object.prototype.hasOwnProperty.call(own, key) ? { id: key, ...own[key] } : null;
  const table = CATALOGUE[catalogue];
  if (!table || !Object.prototype.hasOwnProperty.call(table, key)) return null;
  const [label, price] = table[key];
  return { id: key, label, name: label, cost: price, price };
};

/** The first row of a group with no name in it, or null when every one is taken. */
const firstFree = (data, group, rows) => {
  for (let i = 1; i <= rows; i += 1) if (!text(data[`${group}${i}_name`]).trim()) return i;
  return null;
};

/** A drug by any of its names, as the sheet matches a dose to the catalogue (cwnPharma.ts pharmaByName). */
const norm = (s) => text(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const PHARMA_BY_NAME = new Map(PHARMACEUTICALS.flatMap((p) => [[norm(p.id), p], [norm(p.label), p]]));
const pharmaByName = (name) => PHARMA_BY_NAME.get(norm(name)) || null;

/** A weapon row's fields as a carried row: Stowed, no attack bonus or mods yet (cwnWeaponStash.ts). */
const carriedWeapon = (w, i) => ({
  [`weapon${i}_name`]: text(w.name), [`weapon${i}_dmg`]: text(w.dmg), [`weapon${i}_skill`]: text(w.skill),
  [`weapon${i}_attr`]: text(w.attr), [`weapon${i}_trauma`]: text(w.trauma), [`weapon${i}_shock`]: text(w.shock),
  [`weapon${i}_atk`]: 0, [`weapon${i}_enc`]: text(w.enc), [`weapon${i}_mods`]: '', [`weapon${i}_carry`]: 'stowed',
});

/** A vehicle preset's fields for slot `i`; armor left alone where the book prints * or ** (vehiclePresets.ts). */
const vehicleFields = (i, p) => {
  const v = (value) => (value === undefined || value === null ? '' : value);
  const out = {
    [`vehicle${i}_name`]: v(p.label), [`vehicle${i}_type`]: v(p.id), [`vehicle${i}_hp`]: v(p.hp), [`vehicle${i}_hp_max`]: v(p.hp),
    [`vehicle${i}_ac`]: v(p.ac), [`vehicle${i}_spd`]: v(p.spd), [`vehicle${i}_tt`]: v(p.tt), [`vehicle${i}_crew`]: v(p.crew),
    [`vehicle${i}_hrdpt`]: v(p.hrdpt), [`vehicle${i}_pow`]: v(p.pow), [`vehicle${i}_mass`]: v(p.mass), [`vehicle${i}_cost`]: v(p.cost),
    [`vehicle${i}_size`]: v(p.size),
  };
  if (p.armor !== null && p.armor !== undefined) out[`vehicle${i}_armor`] = p.armor;
  return out;
};

const line = (data, label, enc = '') => ({ ok: true, patch: addToInventory(data, label, enc, (item) => item.name === label) });

/** One row of a book shelf onto a sheet: { ok: true, patch } or { ok: false, reason }. */
const placeBook = (catalogue, row, data) => {
  const sheet = data && typeof data === 'object' ? data : {};
  switch (catalogue) {
    case 'weapons': {
      const slot = firstFree(sheet, 'weapon', WEAPON_ROWS);
      if (slot === null) return { ok: false, reason: `No free weapon row — all ${WEAPON_ROWS} are full. Clear one on the sheet first.` };
      return { ok: true, patch: carriedWeapon(row, slot) };
    }
    case 'vehicles': {
      const slot = firstFree(sheet, 'vehicle', VEHICLE_ROWS);
      if (slot === null) return { ok: false, reason: `No free vehicle slot — all ${VEHICLE_ROWS} are full. Clear one on the sheet first.` };
      const fields = vehicleFields(slot, row);
      if (row.note) fields[`vehicle${slot}_notes`] = row.note;
      return { ok: true, patch: fields };
    }
    case 'cyberware': {
      const made = cyberware.normaliseRow({
        name: row.name, type: row.type, hl: row.strain, cost: row.price, conc: row.conc, data: row.effect,
        mods: (Array.isArray(row.mods) ? row.mods : []).map((m) => ({ ...m })), equipped: true, placed: false,
      });
      return { ok: true, patch: { [cyberware.FIELD]: [...cyberware.rows(sheet), made] } };
    }
    case 'pharmaceuticals':
      return { ok: true, patch: addToInventory(sheet, text(row.label), '', (item) => (pharmaByName(item.name) || {}).id === row.id) };
    case 'armor':
      return line(sheet, text(row.label), text(row.enc));
    case 'gear':
      return line(sheet, text(row.label), row.encNote ? '' : text(row.enc));
    case 'weapon_mods':
    case 'armor_mods':
    case 'vehicle_fittings':
    case 'vehicle_weapons':
      return line(sheet, text(row.label));
    default:
      return { ok: false, reason: 'Not one of the book\'s shelves.' };
  }
};

/** The book's shelves, by catalogue. */
const BOOK_CATALOGUES = Object.keys(CATALOGUE);

module.exports = { BOOK_CATALOGUES, asBookRow, bookRow, placeBook, pharmaByName };
