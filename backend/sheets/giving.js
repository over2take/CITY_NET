// GIVE ITEM at the table (4g2b; approved mockup docs/mockups/give-item.html, 2026-10-12): the GM
// picks an item the running game can give (shops/give.js), how many, and who gets it (player
// characters, online or not, and NPC tokens with a sheet), with a note if they like. Each gets all of
// it or none: a sheet with no room is named and skipped, and the others still get theirs. A preview
// says where it would land on each, and writes nothing.
//
// Each sheet is written through its write queue (mutateSheet), the gift placed against the sheet as
// it stands at write time, so a player typing into it then loses nothing. Only the recipient is told,
// privately (`notify`); the table isn't, so a gift can be a secret.
//
// A kit (7c4c) is given as an item is, from the catalogue KITS: every one the system has, a kit going to a
// player that way or one the GM alone gives, with its items landing as they do on finishing a new
// character (kitGiving.js). There is no way for a kit not to fit: they are inventory lines.

const { mutateSheet } = require('./mutate');
const { applyDerived } = require('./templates');
const { gather } = require('./rests');
const { itemOf, placeGift } = require('../shops/give');
const { INVENTORY_FIELD, readInventory } = require('../shops/placement');
const customSystems = require('../systemBuilder/runtime');
const { kitToGive, kitWords } = require('../systemBuilder/creation');
const { kitPatch } = require('./kitGiving');

const LIMITS = { qty: 99, note: 200, players: 100, npcs: 100 };
/** The catalogue GIVE.EXE lists a system's kits under: no shelf is called this. */
const KITS_CATALOGUE = 'kits';

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;

/**
 * Why a request can't be read, or null. A preview may ask about every player character in the game
 * (`players: true`), so the GM's window can say where it would land on each before any is ticked;
 * a GIVE names them.
 */
const requestProblem = ({ catalogue, id, qty, players, npcs, note, preview } = {}) => {
  if (!isId(catalogue) || !isId(id)) return 'catalogue and id: the item to give';
  if (qty !== undefined && !(Number.isInteger(qty) && qty >= 1 && qty <= LIMITS.qty)) return `qty: a whole number from 1 to ${LIMITS.qty}`;
  if (players === true && preview !== true) return 'players: name who gets it';
  if (players !== undefined && players !== true && !(Array.isArray(players) && players.length <= LIMITS.players && players.every(isId))) {
    return `players: a list of up to ${LIMITS.players} player names`;
  }
  if (npcs !== undefined && !(Array.isArray(npcs) && npcs.length <= LIMITS.npcs && npcs.every((n) => Number.isInteger(n) && n > 0))) {
    return `npcs: a list of up to ${LIMITS.npcs} token ids`;
  }
  if (players !== true && !(players || []).length && !(npcs || []).length) return 'Pick someone to give it to';
  if (note !== undefined && !(typeof note === 'string' && note.length <= LIMITS.note)) return `note: at most ${LIMITS.note} characters`;
  return null;
};

/**
 * Where a placed gift went, for the GM's window to say: the numbered rows it filled (`group`,
 * `rows`), a cyberware row, or the inventory (`stacked` when it joined a line already there).
 */
const landing = (data, patch) => {
  const rows = Object.keys(patch).map((k) => /^(weapon|vehicle)(\d+)_name$/.exec(k)).filter(Boolean);
  if (rows.length) return { shape: 'rows', group: rows[0][1], rows: rows.map((m) => Number(m[2])) };
  if (!(INVENTORY_FIELD in patch)) return { shape: 'cyberware' };
  return { shape: 'inventory', stacked: readInventory(patch).length === readInventory(data).length };
};

const who = (c) => ({ kind: c.kind, ...(c.kind === 'player' ? { username: c.username } : { location_id: c.location_id }), name: c.name });

/**
 * What is being given, and how one lands on a sheet: `place(data)` gives { ok, patch } or { ok: false,
 * reason }, and `lands(data, patch)` says where it went. Null when this game can't give it.
 */
const giftOf = (system, catalogue, id, qty) => {
  if (catalogue === KITS_CATALOGUE) {
    const kit = kitToGive(customSystems.definitionOf(system) ?? {}, id);
    if (!kit) return null;
    const items = kit.items.map((i) => ({ ...i, qty: i.qty * qty }));
    return {
      item: { catalogue, id: kit.id, name: kit.name, price: 0 },
      holds: kitWords(kit),
      place: (data) => ({ ok: true, patch: kitPatch(system, items, data) }),
      lands: () => ({ shape: 'kit', items: items.reduce((n, i) => n + i.qty, 0) }),
    };
  }
  const found = itemOf(system, catalogue, id);
  if (!found) return null;
  return {
    item: { catalogue, id: found.id, name: found.name, price: found.price },
    place: (data) => placeGift(system, catalogue, id, data, qty),
    lands: landing,
  };
};

/** Place it on one sheet, at write time: the placement, and the sheet it was placed on. */
const giveTo = (db, system, c, gift) => new Promise((ok, no) => {
  let result = null;
  mutateSheet(db, c.sheetId, (data) => {
    result = { ...gift.place(data), before: data };
    if (!result.ok) return undefined;
    const next = { ...data, ...result.patch };
    applyDerived(system, next);
    return next;
  }, (err) => (err ? no(err) : ok(result)));
});

/**
 * Give `qty` of an item, or preview it: { item, qty, note, preview, recipients }, each recipient
 * { kind, username | location_id, name, given, lands } or { ..., given: false, reason }. Null when
 * the game can't give the item. `notify(username, payload)` tells a player privately.
 */
const giveItem = async (db, io, { system, catalogue, id, qty = 1, players = [], npcs = [], note = '', preview = false }, notify) => {
  const gift = giftOf(system, catalogue, id, qty);
  if (!gift) return null;
  const { item } = gift;
  const people = await gather(db, system, players, npcs);
  const recipients = [];
  // A named player with no character in this game is said, not silently dropped.
  const have = new Set(people.filter((c) => c.kind === 'player').map((c) => c.username.toLowerCase()));
  for (const name of new Set(Array.isArray(players) ? players : [])) {
    if (!have.has(name.toLowerCase())) recipients.push({ kind: 'player', username: name, name, given: false, reason: 'No character in this game.' });
  }
  for (const c of people) {
    if (!c.sheetId) { recipients.push({ ...who(c), given: false, reason: 'No sheet in this game.' }); continue; }
    const result = preview ? gift.place(c.data) : await giveTo(db, system, c, gift);
    if (!result.ok) { recipients.push({ ...who(c), given: false, reason: result.reason }); continue; }
    recipients.push({ ...who(c), given: !preview, lands: gift.lands(result.before || c.data, result.patch) });
    if (preview || c.kind !== 'player') continue;
    io.emit('sheetUpdated', { username: c.username, system });
    notify(c.username, { item: item.name, catalogue, qty, note: note.trim(), holds: gift.holds });
  }
  return { item, qty, note: note.trim(), preview, recipients };
};

module.exports = { LIMITS, KITS_CATALOGUE, requestProblem, landing, giveItem };
