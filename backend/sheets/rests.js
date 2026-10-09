// Calling a rest at the table (4f2b; approved mockup docs/mockups/builder-rests.html, 2026-10-09):
// the GM picks a rest of the running custom system and who rests (every player character, or the
// ones named, and the NPC tokens chosen); each is worked out by systemBuilder/resting.js and written
// back. A preview rolls nothing and writes nothing.
//
// Each character's sheet is written through its write queue (mutateSheet), the rest worked out
// from the sheet as it stands at write time, so a player typing into it then loses nothing. The
// token's health and conditions are written after: a player's onto every token of theirs, as the
// health route does, an NPC's onto its own. One dice-log line per character, for everyone.

const crypto = require('crypto');
const { mutateSheet } = require('./mutate');
const { applyDerived } = require('./templates');
const { parseTokenConditions } = require('../tokens/conditions');
const { restOn, restLine, restDice } = require('../systemBuilder/resting');
const { conditionsOf } = require('../systemBuilder/conditions');

const LIMITS = { players: 100, npcs: 100 };
const NPC_SHAPES = ['enemy_rhombus', 'friendly_rhombus'];
const LOG_COLOR = '#00ff00';

const parse = (text) => { try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const all = (db, sql, params) => new Promise((ok, no) => db.all(sql, params, (e, rows) => (e ? no(e) : ok(rows || []))));
const run = (db, sql, params) => new Promise((ok, no) => db.run(sql, params, (e) => (e ? no(e) : ok())));
const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

/** Why a request's `players` and `npcs` can't be read, or null. */
const whoProblem = (players, npcs) => {
  if (players !== undefined && players !== true && players !== false
    && !(Array.isArray(players) && players.length <= LIMITS.players && players.every((p) => typeof p === 'string'))) {
    return `players: true, or a list of up to ${LIMITS.players} player names`;
  }
  if (npcs !== undefined && !(Array.isArray(npcs) && npcs.length <= LIMITS.npcs && npcs.every((n) => Number.isInteger(n) && n > 0))) {
    return `npcs: a list of up to ${LIMITS.npcs} token ids`;
  }
  return null;
};

/**
 * Who rests: player characters in `system` (all of them for `players: true`, the named ones for a
 * list), each with the first of its tokens; and the chosen NPC tokens with the sheets linked to
 * them in `system`. Each as { kind, username?, location_id?, name, sheetId, data, token, conditions }.
 */
const gather = async (db, system, players, npcs) => {
  const out = [];
  if (players === true || (Array.isArray(players) && players.length)) {
    const sheets = await all(db, 'SELECT id, username, data FROM character_sheets WHERE system = ? AND is_npc = 0 ORDER BY username COLLATE NOCASE', [system]);
    const wanted = Array.isArray(players) ? new Set(players.map((p) => p.toLowerCase())) : null;
    for (const s of sheets.filter((x) => !wanted || wanted.has(String(x.username).toLowerCase()))) {
      const [token] = await all(db, `SELECT id, hp_current, hp_max, hp_temp, conditions FROM locations WHERE shape = 'rhombus' AND owner = ? ORDER BY id LIMIT 1`, [s.username]);
      const data = parse(s.data);
      out.push({ kind: 'player', username: s.username, name: (typeof data.name === 'string' && data.name.trim()) || s.username, sheetId: s.id, data, token: token || null });
    }
  }
  if (Array.isArray(npcs) && npcs.length) {
    const rows = await all(db,
      `SELECT l.id, l.name, l.hp_current, l.hp_max, l.hp_temp, l.conditions, cs.id AS sheet_id, cs.data
         FROM locations l
         LEFT JOIN npc_sheet_links k ON k.location_id = l.id
         LEFT JOIN character_sheets cs ON cs.id = k.sheet_id AND cs.system = ?
        WHERE l.id IN (${npcs.map(() => '?').join(',')}) AND l.shape IN (${NPC_SHAPES.map(() => '?').join(',')})
        ORDER BY l.id`,
      [system, ...npcs, ...NPC_SHAPES]);
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ kind: 'npc', location_id: r.id, name: r.name || 'NPC', sheetId: r.sheet_id || null, data: r.sheet_id ? parse(r.data) : {}, token: r });
    }
  }
  return out;
};

const tokenOf = (row) => (row ? { current: row.hp_current, max: row.hp_max, temp: row.hp_temp } : null);

/** The sheet as a rest reads it: with its formulas worked out. */
const worked = (system, data) => { const d = { ...data }; applyDerived(system, d); return d; };

/** What one character sends back to the GAME tab. */
const shown = (definition, c, result) => {
  const names = new Map(conditionsOf(definition).map((x) => [x.id, x.name]));
  return {
    kind: c.kind,
    ...(c.kind === 'player' ? { username: c.username } : { location_id: c.location_id }),
    name: c.name,
    changes: result.changes,
    gone: result.gone.map((id) => names.get(id) || id),
  };
};

/** What a rest would do to each one: nothing rolled, nothing written. */
const previewRest = async (db, { system, definition, rest, players, npcs }) => {
  const characters = await gather(db, system, players, npcs);
  return characters.map((c) => shown(definition, c, restOn({
    definition, restId: rest.id, sheet: worked(system, c.data), token: tokenOf(c.token), conditions: parseTokenConditions(c.token && c.token.conditions),
  })));
};

/** Work one character's rest out at write time, and write its sheet. */
const restSheet = (db, system, definition, rest, c, rng) => new Promise((ok, no) => {
  const args = { definition, restId: rest.id, token: tokenOf(c.token), conditions: parseTokenConditions(c.token && c.token.conditions), rng };
  if (!c.sheetId) { ok(restOn({ ...args, sheet: {} })); return; }
  let result = null;
  mutateSheet(db, c.sheetId, (data) => {
    result = restOn({ ...args, sheet: worked(system, data) });
    if (!result.ok || !Object.keys(result.sheetPatch).length) return undefined;
    const next = { ...data, ...result.sheetPatch };
    applyDerived(system, next);
    return next;
  }, (err) => (err ? no(err) : ok(result)));
});

/**
 * Call a rest: each character worked out and written in turn, a dice-log line each, and every
 * screen told. Answers what each one got.
 */
const callRest = async (db, io, { system, definition, rest, players, npcs, rng = cryptoRng }) => {
  const characters = await gather(db, system, players, npcs);
  const done = [];
  for (const c of characters) {
    const result = await restSheet(db, system, definition, rest, c, rng);
    if (!result || !result.ok) continue;
    if (c.token) {
      const t = result.token;
      const conditions = JSON.stringify(result.conditions);
      if (c.kind === 'player') {
        await run(db, `UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ?, conditions = ? WHERE shape = 'rhombus' AND owner = ?`, [t.current, t.max, t.temp, conditions, c.username]);
      } else {
        await run(db, 'UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ?, conditions = ? WHERE id = ?', [t.current, t.max, t.temp, conditions, c.location_id]);
      }
    }
    const historyString = restLine(definition, rest.name, c.name, result);
    const { results, total } = restDice(result);
    const account = c.kind === 'player' ? c.username : c.name;
    await run(db, 'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)', [account, total, JSON.stringify(results), LOG_COLOR, historyString]);
    io.emit('diceRollBroadcast', { userName: c.name, account, results, modifiers: [], color: LOG_COLOR, total, historyString });
    if (c.kind === 'player') io.emit('sheetUpdated', { username: c.username });
    done.push({ ...shown(definition, c, result), line: historyString });
  }
  if (done.length) io.emit('dataUpdated', { isRhombusOnly: true });
  return done;
};

module.exports = { LIMITS, whoProblem, gather, previewRest, callRest };
