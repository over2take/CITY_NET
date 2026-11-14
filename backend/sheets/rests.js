// Calling a rest at the table (4f2b; approved mockup docs/mockups/builder-rests.html, 2026-10-09):
// the GM picks a rest of the running custom system and who rests (every player character, or the
// ones named, and the NPC tokens chosen); each is worked out by systemBuilder/resting.js and written
// back. A preview rolls nothing and writes nothing.
//
// Each character's sheet is written through its write queue (mutateSheet), the rest worked out
// from the sheet as it stands at write time, so a player typing into it then loses nothing. The
// token's health and conditions are written after: a player's onto every token of theirs, as the
// health route does, an NPC's onto its own. One dice-log line per character, for everyone.
//
// Rests finished on each sheet (R3a, R3b; approved mockup docs/mockups/rest-on-sheet.html, and the
// user's calls of 2026-10-30): a player takes their own with takeRest, from their sheet's REST
// section; the GM may for anyone. In such a system the GM's call rests the NPCs at once and opens the
// rest on each player's sheet instead (REST_CALL_KEY, recovery.js), finished there with takeRest.
// The GM sees who has finished, and may finish it for one or for everyone left (R4, finishCalled).

const crypto = require('crypto');
const { mutateSheet } = require('./mutate');
const { applyDerived } = require('./templates');
const { parseTokenConditions } = require('../tokens/conditions');
const { restOn, restLine, restDice } = require('../systemBuilder/resting');
const { conditionsOf } = require('../systemBuilder/conditions');
const { restingOf, REST_CALL_KEY, restCallOf, callOn, finishedCall, restCallsShown } = require('../systemBuilder/recovery');
const { restsOf } = require('../systemBuilder/rests');
const { withThrow, boardOf } = require('../utils/diceThrow');

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

/**
 * Work one character's rest out at write time, and write its sheet. A rest the GM called on it,
 * the same one, is finished with it (R3a), kept as finished by `by` for the GM's list (R4).
 */
const restSheet = (db, system, definition, rest, c, rng, by) => new Promise((ok, no) => {
  const args = { definition, restId: rest.id, token: tokenOf(c.token), conditions: parseTokenConditions(c.token && c.token.conditions), rng };
  if (!c.sheetId) { ok(restOn({ ...args, sheet: {} })); return; }
  let result = null;
  mutateSheet(db, c.sheetId, (data) => {
    result = restOn({ ...args, sheet: worked(system, data) });
    const call = restCallOf(data);
    const called = !!call && call.rest === rest.id;
    if (!result.ok || (!Object.keys(result.sheetPatch).length && !called)) return undefined;
    const next = { ...data, ...result.sheetPatch };
    // A call from before the GM's list (R3b) had no id: there's nothing to keep it for.
    if (called) {
      if (typeof data[REST_CALL_KEY].id === 'string') next[REST_CALL_KEY] = finishedCall(definition, data, by, result.changes);
      else delete next[REST_CALL_KEY];
    }
    applyDerived(system, next);
    return next;
  }, (err) => (err ? no(err) : ok(result)));
});

/**
 * One character's rest, rolled and written: its sheet, then its token's health and conditions, then
 * a dice-log line for everyone. What it got, as the GAME tab shows it, or null when it couldn't.
 */
const restCharacter = async (db, io, { system, definition, rest, c, rng, by = 'gm' }) => {
  const result = await restSheet(db, system, definition, rest, c, rng, by);
  if (!result || !result.ok) return null;
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
  // The tray's board names the rest (6c4d3). A rest that rolled nothing is quiet (quiet rests,
  // 2026-10-30): its line goes into the log, but no tray opens, flashes or throws for it.
  const quiet = Object.keys(results).length ? {} : { quiet: true };
  io.emit('diceRollBroadcast', withThrow({ userName: c.name, account, results, modifiers: [], color: LOG_COLOR, total, historyString, board: boardOf(String(rest.name).toUpperCase()), ...quiet }));
  if (c.kind === 'player') io.emit('sheetUpdated', { username: c.username });
  return { ...shown(definition, c, result), line: historyString };
};



/**
 * Open a called rest on a player's sheet, for them to finish (R3b): it waits there, under
 * REST_CALL_KEY, until they do. A sheet with one waiting already has it replaced.
 */
const openOnSheet = (db, io, definition, rest, c, call) => new Promise((ok, no) => {
  mutateSheet(db, c.sheetId, (data) => ({ ...data, [REST_CALL_KEY]: callOn(definition, rest, call, data) }), (err) => {
    if (err) { no(err); return; }
    io.emit('sheetUpdated', { username: c.username });
    ok();
  });
});

/**
 * Call a rest: each character worked out and written in turn, a dice-log line each, and every
 * screen told. Answers what each one got. Where rests are finished on each sheet (R3b), a player
 * character's is opened on their sheet instead, answered as `called`, nothing changed yet.
 */
const callRest = async (db, io, { system, definition, rest, players, npcs, rng = cryptoRng }) => {
  const characters = await gather(db, system, players, npcs);
  const onSheets = restingOf(definition).finish === 'sheet';
  // The call, kept on each sheet it opens on: the GM's list reads the latest one (R4).
  const call = { id: crypto.randomUUID(), at: new Date().toISOString(), npcs: characters.filter((c) => c.kind === 'npc').length };
  const done = [];
  for (const c of characters) {
    if (onSheets && c.kind === 'player') {
      await openOnSheet(db, io, definition, rest, c, call);
      done.push({ kind: 'player', username: c.username, name: c.name, changes: [], gone: [], called: true });
      continue;
    }
    const got = await restCharacter(db, io, { system, definition, rest, c, rng });
    if (got) done.push(got);
  }
  if (done.some((d) => !d.called)) io.emit('dataUpdated', { isRhombusOnly: true });
  return done;
};

/**
 * One player character's rest, taken from their sheet (R3a): `rest` one the game offers. A rest
 * the GM called on that sheet is finished with it. Answers what it got, or { error } in words.
 */
const takeRest = async (db, io, { system, definition, restId, username, by = 'player', rng = cryptoRng }) => {
  const rest = restsOf(definition).find((r) => r.id === restId);
  if (!rest) return { error: 'Not one of this game\'s rests' };
  const [c] = await gather(db, system, [username], []);
  if (!c) return { error: 'That character has no sheet yet' };
  const got = await restCharacter(db, io, { system, definition, rest, c, rng, by });
  if (!got) return { error: 'The rest could not be taken' };
  io.emit('dataUpdated', { isRhombusOnly: true });
  return got;
};

/** The GM's view of the latest rest called on the players' sheets (recovery.js restCallsShown), or null. */
const calledShown = async (db, system, definition) => {
  const sheets = await all(db, 'SELECT username, data FROM character_sheets WHERE system = ? AND is_npc = 0', [system]);
  return restCallsShown(definition, sheets.map((s) => ({ username: s.username, data: parse(s.data) })));
};

/**
 * The GM finishes the latest called rest for those still resting (R4): `players` true for everyone
 * left, or the ones named. Each is taken as the player would, kept as finished by the GM. Answers
 * how many were finished and the view after.
 */
const finishCalled = async (db, io, { system, definition, players, rng = cryptoRng }) => {
  const view = await calledShown(db, system, definition);
  if (!view) return { error: 'No rest is waiting to be finished' };
  const named = Array.isArray(players) ? new Set(players.map((p) => p.toLowerCase())) : null;
  const left = view.players.filter((p) => p.state !== 'finished' && (!named || named.has(p.username.toLowerCase())));
  for (const p of left) await takeRest(db, io, { system, definition, restId: view.rest, username: p.username, by: 'gm', rng });
  // Counted from what the sheets say now, so one that couldn't be taken isn't counted.
  const after = await calledShown(db, system, definition);
  const done = new Set((after ? after.players : []).filter((p) => p.state === 'finished').map((p) => p.username));
  return { finished: left.filter((p) => done.has(p.username)).length, call: after };
};

module.exports = { LIMITS, whoProblem, gather, previewRest, callRest, takeRest, calledShown, finishCalled };
