// A band's condition on the character's token (8a5d1; approved mockup docs/mockups/encumbrance-bands.html, 2026-11-18, the
// user: "word + optional (on/off) condition"): an encumbrance band, or the word past them, may name one of the system's
// conditions; while the character is in that band it is on their token, and leaving the band takes it off.
//
// Decided with the mockup: the band takes off only what it put on (a SLOWED the GM put on for a spell stays when the pack
// comes off), kept on the sheet under BAND_KEY; a condition already on the token when the band reaches it is the GM's and
// is left alone; one the GM takes off while the band holds stays off until the band changes. A line in the dice log says
// each one put on or taken off ("VEX · OVERLOADED: SLOWED ON"), quietly, with no dice. A table can switch band conditions
// off (BAND_SETTING '0'), and with no token on the map there is nothing to put one on.
//
// After every write to a sheet (sheets/mutate.js setAfterWrite), so whatever changed the gear, a stash, a GIVE, a shop, a
// RELOAD, the token follows. One sheet's runs wait on each other, so two saves close together never put it on twice.

const { mutateSheet } = require('./mutate');
const { carriedOf, bandAt, namesCondition, encumbranceOf, CAPACITY, BAND_KEY } = require('../systemBuilder/encumbrance');
const { CONDITIONS_KEY } = require('../systemBuilder/choices');
const { parseTokenConditions } = require('../tokens/conditions');
const { withThrow } = require('../utils/diceThrow');

/** The table's switch: '0' turns band conditions off; anything else, or nothing, leaves them on. */
const BAND_SETTING = 'band_conditions';
const LOG_COLOR = '#00ff00';

/**
 * What to do (pure): `want` the condition the band names now (null: none, or switched off), `had` what the band put on
 * before, `onToken` the token's condition ids. `{ remove, add, record }`: the id to take off and to put on (or null), and
 * what the band has put on after it, to keep on the sheet.
 */
const bandStep = ({ want, had, onToken }) => {
  if (want === had) return { remove: null, add: null, record: had };
  const remove = had && onToken.has(had) ? had : null;
  // Already on, and not the band's: the GM's, left alone and never taken off by the band.
  const add = want && !onToken.has(want) ? want : null;
  return { remove, add, record: add };
};

/**
 * CAN CARRY as the band reads it (8a5e1): the sheet's, or, where the band's own condition is APPLIED on it, worked out again
 * without that one, so a condition raising Might can't lift a character out of the band that put it on and back.
 */
const canCarry = (runtime, definition, data, held) => {
  const on = Array.isArray(data[CONDITIONS_KEY]) ? data[CONDITIONS_KEY] : [];
  if (!held || !on.includes(held)) return Number(data[CAPACITY]);
  const bare = { ...data, [CONDITIONS_KEY]: on.filter((id) => id !== held) };
  runtime.metaOf(definition).recompute(bare);
  return Number(bare[CAPACITY]);
};

const chains = new Map();
/** One sheet's runs one after another. */
const inTurn = (key, run) => {
  const mine = (chains.get(key) || Promise.resolve()).then(run, run).catch((e) => console.error('[band conditions]', e.message));
  chains.set(key, mine);
  mine.then(() => { if (chains.get(key) === mine) chains.delete(key); });
  return mine;
};

const get = (db, sql, args) => new Promise((ok, no) => db.get(sql, args, (e, row) => (e ? no(e) : ok(row))));
const run = (db, sql, args) => new Promise((ok, no) => db.run(sql, args, (e) => (e ? no(e) : ok())));

/**
 * Makes the hook sheets/mutate.js calls after each write. `runtime` is the running systems (systemBuilder/runtime.js),
 * `io` where the change is told.
 */
const bandConditionHook = ({ io, runtime }) => (db, sheetId, data) => {
  // Nothing to do, and not a query asked, unless a system running here names a band condition or this sheet holds one.
  const had = typeof data[BAND_KEY] === 'string' ? data[BAND_KEY] : null;
  if (!had && !runtime.list().some((s) => namesCondition(runtime.definitionOf(s.id)))) return Promise.resolve();
  return inTurn(String(sheetId), async () => {
    const sheet = await get(db, 'SELECT username, system, is_npc, data FROM character_sheets WHERE id = ?', [sheetId]);
    if (!sheet || sheet.is_npc) return;
    const game = await get(db, "SELECT value FROM global_settings WHERE key = 'game_system'", []);
    // Only the game being played: a token's conditions are that game's.
    if (!game || game.value !== sheet.system) return;
    const definition = runtime.definitionOf(sheet.system);
    if (!definition) return;
    const now = JSON.parse(sheet.data || '{}');
    const held = typeof now[BAND_KEY] === 'string' ? now[BAND_KEY] : null;
    const setting = await get(db, 'SELECT value FROM global_settings WHERE key = ?', [BAND_SETTING]);
    const on = !(setting && setting.value === '0');
    const offered = new Map(runtime.conditionsIn(sheet.system).map((c) => [c.id, c]));
    // CAN CARRY without the band's own condition (8a5e1): one changing it must never take the band, and so itself, away.
    const band = encumbranceOf(definition) ? bandAt(definition, carriedOf(definition, now), canCarry(runtime, definition, now, held)) : null;
    const want = on && band && band.condition && offered.has(band.condition) ? band.condition : null;
    if (want === held) return;
    const token = await get(db, "SELECT conditions FROM locations WHERE shape = 'rhombus' AND owner = ? LIMIT 1", [sheet.username]);
    const keep = (record) => (record === held ? Promise.resolve()
      : new Promise((ok) => mutateSheet(db, sheetId, (d) => {
        const next = { ...d };
        if (record) next[BAND_KEY] = record; else delete next[BAND_KEY];
        return next;
      }, () => ok())));
    // No token: nothing to put on; what the band had put on went with its token.
    if (!token) return keep(null);
    const list = parseTokenConditions(token.conditions);
    let changedToken = false;
    const step = bandStep({ want, had: held, onToken: new Set(list.map((c) => c.id)) });
    if (step.remove || step.add) {
      const c = step.add ? offered.get(step.add) : null;
      const next = [...list.filter((x) => x.id !== step.remove), ...(c ? [c.ends === 'rounds' && Number.isInteger(c.rounds) ? { id: c.id, left: c.rounds } : { id: c.id }] : [])];
      await run(db, "UPDATE locations SET conditions = ? WHERE shape = 'rhombus' AND owner = ?", [JSON.stringify(next), sheet.username]);
      // A band's condition APPLIED changes their numbers too (8a5e1), worked out after the band is kept.
      changedToken = true;
      const who = (typeof now.name === 'string' && now.name.trim()) || sheet.username;
      const nameOf = (id) => String((offered.get(id) || {}).name || id).toUpperCase();
      const said = [...(step.remove ? [`${nameOf(step.remove)} OFF`] : []), ...(step.add ? [`${nameOf(step.add)} ON`] : [])].join(', ');
      const historyString = `${who.toUpperCase()} · ${band ? band.word : 'CARRYING'}: ${said}`;
      await run(db, 'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)', [sheet.username, 0, '{}', LOG_COLOR, historyString]);
      io.emit('diceRollBroadcast', withThrow({ userName: who, account: sheet.username, results: {}, modifiers: [], color: LOG_COLOR, total: 0, historyString, quiet: true }));
      io.emit('dataUpdated', { isRhombusOnly: true });
    }
    await keep(step.record);
    if (changedToken) await require('./conditionsOnSheet').syncConditionsOnSheet(db, { username: sheet.username, io, runtime });
    io.emit('sheetUpdated', { username: sheet.username, system: sheet.system });
  });
};

/**
 * The table's BAND CONDITIONS switched (8a6b; approved mockup docs/mockups/carrying-on-sheet.html): every player's sheet of the
 * game being played run through the hook at once, so switching off takes off what the bands put on, and on puts it back, without
 * waiting for each one's next save. Resolves when all are done.
 */
const syncAllBandConditions = (db, { io, runtime }) => new Promise((ok) => {
  // Every sheet: the hook passes over an NPC's and another game's itself.
  db.all('SELECT id, data FROM character_sheets', [], async (err, rows) => {
    if (err || !rows) return ok();
    const hook = bandConditionHook({ io, runtime });
    for (const row of rows) {
      let data = {};
      try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
      await hook(db, row.id, data);
    }
    ok();
  });
});

module.exports = { BAND_KEY, BAND_SETTING, bandStep, bandConditionHook, syncAllBandConditions };
