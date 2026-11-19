// A player's token conditions on their sheet (8a5e1; approved mockup docs/mockups/condition-modifiers.html, 2026-11-18): a
// condition APPLIED changes the sheet's numbers (SLOWED halving Speed), and those are worked out from the sheet (choices.js
// overlayOf), while the conditions are on the token. So whenever a player's token conditions change, by hand, by an
// encumbrance band, rounds running out or a rest, the ids are written onto the sheet under CONDITIONS_KEY and the sheet is
// worked out again: Speed follows at once. A table's APPLY CONDITION MODIFIERS (CONDITIONS_SETTING '0') keeps them all a
// reminder: none written. Nothing is written for a system whose conditions apply nothing, nor when nothing changed.

const { mutateSheet } = require('./mutate');
const { CONDITIONS_KEY } = require('../systemBuilder/choices');
const { conditionsOf } = require('../systemBuilder/conditions');
const { parseTokenConditions } = require('../tokens/conditions');

/** The table's switch: '0' keeps every condition's modifiers a reminder; anything else, or nothing, applies them. */
const CONDITIONS_SETTING = 'apply_condition_modifiers';

const get = (db, sql, args) => new Promise((ok, no) => db.get(sql, args, (e, row) => (e ? no(e) : ok(row))));
const all = (db, sql, args) => new Promise((ok, no) => db.all(sql, args, (e, rows) => (e ? no(e) : ok(rows || []))));

/** What the sheet should hold (pure): the token's condition ids, sorted, with the table's switch on; none with it off. */
const conditionsToKeep = (tokenConditions, on) => (on ? [...new Set(parseTokenConditions(tokenConditions).map((c) => c.id))].sort() : []);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * One player's sheet given their token's conditions, worked out again where they changed. `runtime` is the running systems
 * (systemBuilder/runtime.js), `io` where a changed sheet is told. Resolves when done; never rejects.
 */
const syncConditionsOnSheet = async (db, { username, io, runtime }) => {
  try {
    const game = await get(db, "SELECT value FROM global_settings WHERE key = 'game_system'", []);
    const system = game && game.value;
    const definition = system ? runtime.definitionOf(system) : null;
    if (!definition) return;
    const sheet = await get(db, 'SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [username, system]);
    if (!sheet) return;
    const had = JSON.parse(sheet.data || '{}')[CONDITIONS_KEY];
    // A system none of whose conditions applies anything, and a sheet holding none: nothing to keep.
    if (!conditionsOf(definition).some((c) => c.applied) && had === undefined) return;
    const token = await get(db, "SELECT conditions FROM locations WHERE shape = 'rhombus' AND owner = ? LIMIT 1", [username]);
    const setting = await get(db, 'SELECT value FROM global_settings WHERE key = ?', [CONDITIONS_SETTING]);
    const want = conditionsToKeep(token ? token.conditions : '[]', !(setting && setting.value === '0'));
    if (same(want, Array.isArray(had) ? had : [])) return;
    // Loaded here: the sheet templates load the running systems, which load this module's neighbours.
    const sheetTemplates = require('./templates');
    await new Promise((ok) => mutateSheet(db, sheet.id, (d) => {
      const next = { ...d };
      if (want.length) next[CONDITIONS_KEY] = want; else delete next[CONDITIONS_KEY];
      sheetTemplates.applyDerived(system, next);
      return next;
    }, () => ok()));
    io.emit('sheetUpdated', { username, system });
  } catch (e) {
    console.error('[conditions on sheet]', e.message);
  }
};

/** Every player's, as when the table's switch changes. */
const syncAllConditionsOnSheets = async (db, { io, runtime }) => {
  const players = await all(db, "SELECT DISTINCT owner FROM locations WHERE shape = 'rhombus' AND owner IS NOT NULL", []).catch(() => []);
  for (const p of players) await syncConditionsOnSheet(db, { username: p.owner, io, runtime });
};

module.exports = { CONDITIONS_SETTING, conditionsToKeep, syncConditionsOnSheet, syncAllConditionsOnSheets };
