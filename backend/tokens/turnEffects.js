// A condition's EACH TURN fired at the table (8a9a; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19).
//
// The turn and the round, as agreed with the user ("perfect"):
// - D&D style (individual): a TURN is one combatant's go, from the tracker landing on them until NEXT; a ROUND is every
//   combatant in the scene's order having one turn.
// - Group style (sides): a TURN is a whole side's go; a ROUND is every side having its turn. A condition's "its turn" is
//   its side's turn: what fires, fires for every member.
// - Shadowrun: a turn per pass; the round ends when every pass is spent.
// - One NEXT: END OF TURN for who was up, START OF TURN for who is next. On the round's last turn: END OF TURN, END OF
//   ROUND for the scene, ROUND +1 and the rounds countdown, START OF ROUND for the scene, START OF TURN for the first.
//   Round 1 has a BEGIN: START OF ROUND, then the first one's START OF TURN.
//
// What fires: each condition on a combatant's token with an EACH TURN at that moment, rolled by the table with the
// server's dice (rolled by the player, or the GM for an NPC, is 8a9a2's), the roll read against the character's sheet.
// DAMAGE and HEAL change one pool of HP on their own unless the GM chose otherwise; ROLL TO END takes the condition off on
// its number or more; JUST ROLL goes to the log. Every one is a line in the dice log saying whose, what and when, who
// rolled it, what came up and what it did. A condition that ends AT THE END OF ITS NEXT TURN is marked started when its
// turn begins and taken off when that turn ends. The table's CONDITION TURN EFFECTS ('0') stops the rolls; the endings
// are how conditions end, and go on. Nothing happens outside a fight.

const { cryptoRng } = require('../utils/random');
const { withThrow, boardOf } = require('../utils/diceThrow');
const { parseTokenConditions } = require('./conditions');
const { poolAfter } = require('./poolHealth');
const { onTurns } = require('../systemBuilder/conditions');
const { rollAmount } = require('../systemBuilder/tierRolls');
const { namesOf, effectiveData } = require('../systemBuilder/choices');

/** The table's switch on the GAME tab: '0' stops a condition's EACH TURN rolls. */
const TURN_EFFECTS_SETTING = 'condition_turn_effects';
const LOG_COLOR = '#00ff00';
const WHEN_WORDS = { turn_start: 'START OF ITS TURN', turn_end: 'END OF ITS TURN', round_start: 'START OF ROUND', round_end: 'END OF ROUND' };
/** When, to the one asked to roll (8a9c2). */
const YOUR_WHEN = { turn_start: 'Start of your turn', turn_end: 'End of your turn', round_start: 'Start of the round', round_end: 'End of the round' };

/**
 * What an ask rolls, in the words of the one asked (8a9c2; the mockup's "End of your turn: d20 + Con mod, 13 or more ends
 * it."): its @names said by the system's own names (`labels`, choices.js namesOf), one it doesn't have left as typed.
 */
const yourWords = (effect, labels) => {
  const roll = effect.roll.replace(/@([a-z][a-z0-9_]*)/g, (m, id) => labels.get(id) || m);
  const what = effect.does === 'roll_to_end' ? `${roll}, ${effect.ends_on} or more ends it`
    : effect.does === 'just_roll' ? `${roll}, to the log`
      : `${roll} ${effect.does === 'damage' ? 'damage' : 'healed'}${effect.changes_hp === false ? ', for the GM to apply' : ''}`;
  return `${YOUR_WHEN[effect.when]}: ${what}.`;
};

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const idsOf = (list) => (Array.isArray(list) ? list : []).filter((c) => isPlainObject(c) && typeof c.id === 'string').map((c) => c.id);

/** A side's members, by the tracker's ids: each combatant on side `sideId`. */
const membersOf = (combatants, sideId) => idsOf((combatants || []).filter((c) => isPlainObject(c) && c.sideId === sideId));

/**
 * What one NEXT fires, in order (pure): `[{ when, ids }]`, the tracker's combatant ids. `mode` 'individual' or 'side';
 * `before` the order as it was and `after` as it is now (Shadowrun's next pass is the survivors); `sides` sorted as the
 * tracker sorts them; `from` and `to` the turn index before and after; `wrapped` whether the order came round;
 * `roundEnds` whether that ends the round (Shadowrun's passes don't, till the last). Where everyone rolls again for the
 * new round, `after` is empty: its START OF ROUND waits on BEGIN.
 */
const momentsOfNext = ({ mode = 'individual', before = [], after = before, sides = [], from, to, wrapped, roundEnds = wrapped }) => {
  const turnOf = (list, index) => (mode === 'side'
    ? (sides[index] ? membersOf(before, sides[index].id) : [])
    : idsOf([list[index]]));
  const out = [{ when: 'turn_end', ids: turnOf(before, from) }];
  if (wrapped && roundEnds) {
    out.push({ when: 'round_end', ids: idsOf(before) });
    out.push({ when: 'round_start', ids: idsOf(after) });
  }
  out.push({ when: 'turn_start', ids: turnOf(after, to) });
  return out.filter((m) => m.ids.length);
};

/** What BEGIN fires (pure): START OF ROUND for the scene, then the first one's START OF TURN. */
const momentsOfBegin = ({ mode = 'individual', combatants = [], sides = [], index = 0 }) => [
  { when: 'round_start', ids: idsOf(combatants) },
  { when: 'turn_start', ids: mode === 'side' ? (sides[index] ? membersOf(combatants, sides[index].id) : []) : idsOf([combatants[index]]) },
].filter((m) => m.ids.length);

/** What the conditions on a token do at `when` (pure): `[{ condition, effect }]`, in the token's order, then each one's. */
const effectsAt = (when, onToken, offered) => {
  const byId = new Map((offered || []).map((c) => [c.id, c]));
  return onToken.flatMap((t) => {
    const c = byId.get(t.id);
    return c && Array.isArray(c.each_turn) ? c.each_turn.filter((e) => e.when === when).map((effect) => ({ condition: c, effect })) : [];
  });
};

/**
 * AT THE END OF ITS NEXT TURN (pure): at its turn's start, each one not started is marked; at its end, each started one
 * comes off. `{ list, ended, changed }`.
 */
const nextTurnStep = (when, onToken, offered) => {
  const nextTurn = new Set((offered || []).filter((c) => c.ends === 'next_turn').map((c) => c.id));
  if (when === 'turn_start') {
    const list = onToken.map((t) => (nextTurn.has(t.id) && !t.started ? { ...t, started: true } : t));
    return { list, ended: [], changed: list.some((t, i) => t !== onToken[i]) };
  }
  if (when === 'turn_end') {
    const ended = onToken.filter((t) => nextTurn.has(t.id) && t.started).map((t) => t.id);
    return { list: onToken.filter((t) => !ended.includes(t.id)), ended, changed: ended.length > 0 };
  }
  return { list: onToken, ended: [], changed: false };
};

/** An effect's name in the log: the condition's, and SAVE for a ROLL TO END. */
const effectName = (condition, effect) => `${condition.name.toUpperCase()}${effect.does === 'roll_to_end' ? ' SAVE' : ''}`;
/** When, in the log: START OF ITS TURN, and the scene where the token is in two fights (8a9a2). */
const whenWords = (effect, where) => `${WHEN_WORDS[effect.when]}${where ? ` in ${where}` : ''}`;

/**
 * An effect rolled and what it did, in words (pure but for the dice): `{ value, dice, hp?, ends?, line }`. `values` are the
 * sheet's, `pool` the token's HP or null where the game has none to change, `who` its name as the log says it, `by` who
 * rolled it (the table, the player, the GM: 8a9a2), `where` its scene where it is in two fights.
 */
const rollEffect = ({ condition, effect, values, names, pool, who, rng, by = 'the table', where = null }) => {
  const rolled = rollAmount(effect.roll, values, names, rng);
  if ('error' in rolled || 'blank' in rolled) return { error: rolled.error || 'Nothing to roll' };
  const head = `${who} · ${effectName(condition, effect)}, ${whenWords(effect, where)} · rolled by ${by}: ${effect.roll} → ${rolled.value}`;
  const out = { value: rolled.value, dice: rolled.dice };
  if (effect.does === 'damage' || effect.does === 'heal') {
    const word = effect.does === 'damage' ? 'DAMAGE' : 'HEALED';
    if (!effect.changes_hp) return { ...out, line: `${head} ${word} · NOT APPLIED, the GM's to apply` };
    if (!pool) return { ...out, line: `${head} ${word} · NOT APPLIED, this game's health changes in HEALTH` };
    const after = poolAfter(pool, effect.does, rolled.value);
    return { ...out, hp: after, line: `${head} ${word} · HP ${pool.current ?? 0} → ${after.current}` };
  }
  if (effect.does === 'roll_to_end') {
    const ends = rolled.value >= effect.ends_on;
    return { ...out, ends, line: `${head} vs ${effect.ends_on} · ${ends ? `${condition.name.toUpperCase()} OFF` : 'stays on'}` };
  }
  return { ...out, line: head };
};

const get = (db, sql, args = []) => new Promise((ok, no) => db.get(sql, args, (e, row) => (e ? no(e) : ok(row))));
const all = (db, sql, args = []) => new Promise((ok, no) => db.all(sql, args, (e, rows) => (e ? no(e) : ok(rows || []))));
const run = (db, sql, args = []) => new Promise((ok, no) => db.run(sql, args, function (e) { if (e) no(e); else ok(this); }));

const TOKEN_COLUMNS = 'id, name, shape, owner, hp_current, hp_max, hp_temp, conditions';
/** A combatant's token and the sheet it reads from, by the tracker's id; null for one with none. */
const tokenOf = async (db, id) => {
  const m = /^(npc|player):(.+)$/.exec(String(id));
  if (!m) return null;
  if (m[1] === 'player') {
    const row = await get(db, `SELECT ${TOKEN_COLUMNS} FROM locations WHERE shape = 'rhombus' AND owner = ? LIMIT 1`, [m[2]]);
    return row ? { row, player: m[2] } : null;
  }
  if (!/^\d+$/.test(m[2])) return null;
  const row = await get(db, `SELECT ${TOKEN_COLUMNS} FROM locations WHERE id = ? AND shape IN ('enemy_rhombus', 'friendly_rhombus')`, [Number(m[2])]);
  return row ? { row, player: null } : null;
};
/** A token by its row id (an ask's): a player's or an NPC's, as tokenOf gives it. */
const tokenById = async (db, locationId) => {
  const row = await get(db, `SELECT ${TOKEN_COLUMNS} FROM locations WHERE id = ?`, [locationId]);
  if (!row) return null;
  if (row.shape === 'rhombus' && row.owner) return { row, player: row.owner };
  return row.shape === 'enemy_rhombus' || row.shape === 'friendly_rhombus' ? { row, player: null } : null;
};
const whoOf = (token) => `${String(token.row.name || token.player || 'TOKEN').toUpperCase()}${token.player ? '' : ' (NPC)'}`;

/** The sheet a token's rolls read: the player's own in this game, or the NPC's linked one. */
const sheetOf = async (db, token, system) => {
  const row = token.player
    ? await get(db, 'SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [token.player, system])
    : await get(db, 'SELECT cs.data FROM npc_sheet_links l JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ?', [token.row.id]).catch(() => null);
  try { return row ? JSON.parse(row.data || '{}') : {}; } catch { return {}; }
};

/**
 * A scene by name (8a9a2), as the combats list names it: CITY MAP, a building's name, or a building's floor ("NEON PLAZA —
 * ROOF"); its key where nothing names it.
 */
const sceneName = async (db, key) => {
  if (key === 'city:0') return 'CITY MAP';
  const building = /^building:(\d+)$/.exec(key);
  const floor = /^(\d+):(\d+)$/.exec(key);
  const id = building ? Number(building[1]) : floor ? Number(floor[1]) : null;
  if (id === null) return key;
  const loc = await get(db, 'SELECT name FROM locations WHERE id = ?', [id]).catch(() => null);
  const name = loc && loc.name ? String(loc.name).toUpperCase() : key;
  if (building) return name;
  const maps = await all(db, 'SELECT designation FROM battle_maps WHERE location_id = ? ORDER BY order_index', [id]).catch(() => []);
  const map = maps[Number(floor[2])];
  return map && map.designation ? `${name} — ${String(map.designation).toUpperCase()}` : name;
};

/** The scenes each combatant is in, by the tracker's id (8a9a2): where one is in two fights, the log says which. */
const scenesOfCombatants = async (db) => {
  const rows = await all(db, 'SELECT scene_key, combatants FROM initiative_scene').catch(() => []);
  const out = new Map();
  for (const r of rows) {
    let list = [];
    try { list = JSON.parse(r.combatants || '[]'); } catch { list = []; }
    for (const id of idsOf(list)) out.set(id, [...(out.get(id) || []), r.scene_key]);
  }
  return out;
};

/** The asks (8a9a2): one waiting per token, condition and effect, a newer one in its place. Made where missing. */
const ready = new WeakSet();
const asksTable = async (db) => {
  if (ready.has(db)) return;
  await run(db, `CREATE TABLE IF NOT EXISTS turn_asks (id INTEGER PRIMARY KEY AUTOINCREMENT, scene_key TEXT NOT NULL, location_id INTEGER NOT NULL,
    player TEXT, condition_id TEXT NOT NULL, effect INTEGER NOT NULL, moment TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  ready.add(db);
};

/**
 * What a token's turn did, written and told (shared by the table's rolls and an answered ask, 8a9a2): its HP and conditions
 * stored on every token of a player's, each line in the dice log, the map and the player's sheets told.
 */
const settle = async (db, { io, emitUpdate, runtime }, token, { pool, hpChanged, list, listChanged, lines }) => {
  if (hpChanged) {
    const sql = token.player
      ? ["UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE shape = 'rhombus' AND owner = ?", [pool.current, pool.max, pool.temp, token.player]]
      : ['UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE id = ?', [pool.current, pool.max, pool.temp, token.row.id]];
    await run(db, sql[0], sql[1]);
  }
  if (listChanged) {
    const json = JSON.stringify(list);
    const sql = token.player
      ? ["UPDATE locations SET conditions = ? WHERE shape = 'rhombus' AND owner = ?", [json, token.player]]
      : ['UPDATE locations SET conditions = ? WHERE id = ?', [json, token.row.id]];
    await run(db, sql[0], sql[1]);
  }
  const who = whoOf(token);
  for (const l of lines) {
    const results = {};
    for (const d of l.dice) results[d.sides] = [...(results[d.sides] || []), ...d.rolls];
    await run(db, 'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)', [token.player || who, l.value, JSON.stringify(results), LOG_COLOR, l.line]);
    io.emit('diceRollBroadcast', withThrow({
      userName: who, account: token.player || who, results, modifiers: [], color: LOG_COLOR, total: l.value, historyString: l.line,
      ...(l.board ? { board: boardOf(l.board) } : { quiet: true }),
    }));
  }
  if (hpChanged || listChanged) {
    emitUpdate();
    if (token.player) {
      io.emit('sheetUpdated', { username: token.player });
      if (listChanged) await require('../sheets/conditionsOnSheet').syncConditionsOnSheet(db, { username: token.player, io, runtime });
    }
  }
};

/** What a system's rolls read: its names, its health, its definition. */
const tableOf = (runtime, system) => {
  const definition = runtime.definitionOf(system);
  const labels = definition ? namesOf(definition) : new Map();
  const health = runtime.health(system);
  return {
    definition,
    names: { known: (n) => labels.has(n), refused: (n) => `@${n} isn't one of this system's names` },
    pooled: runtime.partIn(system, 'token_health') && (!health || health.model === 'pool'),
  };
};

/**
 * `moments` fired on a scene (8a9a): every combatant's conditions doing what they do, one after another, in the log. Rolled by
 * the table at once; rolled by the player (the GM for an NPC) asked of them, kept till rolled (8a9a2). `runtime` the running
 * systems (systemBuilder/runtime.js); `emitUpdate` redraws the map; `sceneKey` the scene the asks belong to. Resolves when
 * all are done.
 */
const fireTurnMoments = async (db, { io, emitUpdate = () => {}, runtime, system, sceneKey = null, moments, rng = cryptoRng }) => {
  if (!system || !Array.isArray(moments) || !moments.length) return;
  const offered = runtime.conditionsIn(system);
  if (!onTurns(offered)) return;
  const setting = await get(db, 'SELECT value FROM global_settings WHERE key = ?', [TURN_EFFECTS_SETTING]).catch(() => null);
  const rolls = !(setting && setting.value === '0');
  const { definition, names, pooled } = tableOf(runtime, system);
  const scenes = await scenesOfCombatants(db);
  let asked = false;

  for (const { when, ids } of moments) {
    for (const id of ids) {
      const token = await tokenOf(db, id);
      if (!token) continue;
      const who = whoOf(token);
      const where = (scenes.get(id) || []).length > 1 && sceneKey ? await sceneName(db, sceneKey) : null;
      let list = parseTokenConditions(token.row.conditions);
      let pool = pooled ? { current: token.row.hp_current, max: token.row.hp_max, temp: token.row.hp_temp } : null;
      let hpChanged = false;
      let listChanged = false;
      const lines = [];
      // The rolls first, then AT THE END OF ITS NEXT TURN, so a save rolled at the end of a turn is still rolled.
      if (rolls) {
        const values = definition ? effectiveData(definition, await sheetOf(db, token, system)) : {};
        for (const { condition, effect } of effectsAt(when, list, offered)) {
          if (!list.some((t) => t.id === condition.id)) continue;
          if (effect.rolled_by === 'player') {
            // Asked: of the player for their character's, of the GM for an NPC's; a newer ask in an older one's place.
            await asksTable(db);
            const index = condition.each_turn.indexOf(effect);
            await run(db, 'DELETE FROM turn_asks WHERE location_id = ? AND condition_id = ? AND effect = ?', [token.row.id, condition.id, index]);
            await run(db, 'INSERT INTO turn_asks (scene_key, location_id, player, condition_id, effect, moment) VALUES (?, ?, ?, ?, ?, ?)', [sceneKey, token.row.id, token.player, condition.id, index, when]);
            asked = true;
            lines.push({ line: `${who} · ${effectName(condition, effect)}, ${whenWords(effect, where)}: ${token.player ? `asked on ${who}'s sheet` : 'asked of the GM'}`, value: 0, dice: [] });
            continue;
          }
          const made = rollEffect({ condition, effect, values, names, pool, who, rng, where });
          if (made.error) continue;
          if (made.hp) { pool = made.hp; hpChanged = true; }
          if (made.ends) { list = list.filter((t) => t.id !== condition.id); listChanged = true; }
          lines.push({ line: made.line, value: made.value, dice: made.dice, board: condition.name.toUpperCase() });
        }
      }
      const step = nextTurnStep(when, list, offered);
      if (step.changed) { list = step.list; listChanged = true; }
      for (const ended of step.ended) {
        const c = offered.find((x) => x.id === ended);
        lines.push({ line: `${who} · ${String(c ? c.name : ended).toUpperCase()}: ENDED (the end of its next turn)`, value: 0, dice: [] });
      }
      await settle(db, { io, emitUpdate, runtime }, token, { pool, hpChanged, list, listChanged, lines });
    }
  }
  if (asked) io.emit('turnAsksChanged');
};

/**
 * The asks waiting (8a9a2), each with what it is: every one for the GM, a player's own for them. One whose token is gone, or
 * no longer has the condition or its EACH TURN, is let go.
 */
const asksFor = async (db, { runtime, system, username = null, gm = false }) => {
  await asksTable(db);
  const rows = await all(db, 'SELECT * FROM turn_asks ORDER BY id');
  const offered = new Map((system ? runtime.conditionsIn(system) : []).map((c) => [c.id, c]));
  const definition = system ? runtime.definitionOf(system) : null;
  const labels = definition ? namesOf(definition) : new Map();
  const out = [];
  for (const a of rows) {
    const token = await tokenById(db, a.location_id);
    const condition = offered.get(a.condition_id);
    const effect = condition && Array.isArray(condition.each_turn) ? condition.each_turn[a.effect] : null;
    if (!token || !effect || effect.rolled_by !== 'player' || !parseTokenConditions(token.row.conditions).some((t) => t.id === a.condition_id)) {
      await run(db, 'DELETE FROM turn_asks WHERE id = ?', [a.id]);
      continue;
    }
    if (!gm && a.player !== username) continue;
    out.push({
      id: a.id, sceneKey: a.scene_key, locationId: a.location_id, player: a.player, who: whoOf(token),
      condition: { id: condition.id, name: condition.name, short: condition.short, icon: condition.icon },
      // Its name as the log says it (POISONED SAVE): the tracker's ROLL and WAITING ON say it too (8a9c).
      named: effectName(condition, effect),
      // On the sheet (8a9c2): what it rolls in the asked one's words, and whether it is the asker's own (YOUR SAVE) or, for
      // the GM looking at a player's sheet, theirs (KES'S SAVE).
      yours: yourWords(effect, labels),
      mine: !!username && a.player === username,
      effect, moment: a.moment, says: `${effectName(condition, effect)}, ${WHEN_WORDS[effect.when]}: ${effect.roll}${effect.does === 'roll_to_end' ? `, ${effect.ends_on} or more ends it` : ''}`,
    });
  }
  return out;
};

/**
 * An ask rolled (8a9a2): by the player it was asked of, or the GM (for an NPC's, the GM alone), as the table would have rolled
 * it, written and said "rolled by KES" or "rolled by the GM". `{ ok: true, line }`, or `{ ok: false, error }` in words.
 */
const rollAsk = async (db, { io, emitUpdate = () => {}, runtime, system, id, username, gm = false, rng = cryptoRng }) => {
  await asksTable(db);
  const ask = await get(db, 'SELECT * FROM turn_asks WHERE id = ?', [id]);
  if (!ask) return { ok: false, error: 'That roll isn\'t waiting any more' };
  const token = await tokenById(db, ask.location_id);
  if (!gm && (!ask.player || ask.player !== username)) {
    return { ok: false, error: ask.player ? `Only ${token ? whoOf(token) : ask.player} or the GM rolls that` : 'The GM rolls for an NPC' };
  }
  const condition = (system ? runtime.conditionsIn(system) : []).find((c) => c.id === ask.condition_id);
  const effect = condition && Array.isArray(condition.each_turn) ? condition.each_turn[ask.effect] : null;
  let list = token ? parseTokenConditions(token.row.conditions) : [];
  if (!token || !effect || !list.some((t) => t.id === ask.condition_id)) {
    await run(db, 'DELETE FROM turn_asks WHERE id = ?', [id]);
    io.emit('turnAsksChanged');
    return { ok: false, error: token && condition ? `${condition.name.toUpperCase()} is no longer on ${whoOf(token)}` : 'That roll isn\'t waiting any more' };
  }
  // Taken first, so two clicks never roll it twice.
  const taken = await run(db, 'DELETE FROM turn_asks WHERE id = ?', [id]);
  if (!taken.changes) return { ok: false, error: 'That roll isn\'t waiting any more' };
  const { definition, names, pooled } = tableOf(runtime, system);
  const values = definition ? effectiveData(definition, await sheetOf(db, token, system)) : {};
  let pool = pooled ? { current: token.row.hp_current, max: token.row.hp_max, temp: token.row.hp_temp } : null;
  const scenes = await scenesOfCombatants(db);
  const combatant = token.player ? `player:${token.player}` : `npc:${token.row.id}`;
  const where = (scenes.get(combatant) || []).length > 1 ? await sceneName(db, ask.scene_key) : null;
  const made = rollEffect({ condition, effect, values, names, pool, who: whoOf(token), rng, by: gm ? 'the GM' : whoOf(token), where });
  if (made.error) { io.emit('turnAsksChanged'); return { ok: false, error: made.error }; }
  let hpChanged = false;
  let listChanged = false;
  if (made.hp) { pool = made.hp; hpChanged = true; }
  if (made.ends) { list = list.filter((t) => t.id !== condition.id); listChanged = true; }
  await settle(db, { io, emitUpdate, runtime }, token, { pool, hpChanged, list, listChanged, lines: [{ line: made.line, value: made.value, dice: made.dice, board: condition.name.toUpperCase() }] });
  io.emit('turnAsksChanged');
  return { ok: true, line: made.line };
};

/** A scene's asks let go when its fight ends (8a9a2). */
const dropAsks = async (db, sceneKeys) => {
  await asksTable(db);
  for (const key of sceneKeys) await run(db, 'DELETE FROM turn_asks WHERE scene_key = ?', [key]);
};

module.exports = { TURN_EFFECTS_SETTING, WHEN_WORDS, yourWords, momentsOfNext, momentsOfBegin, effectsAt, nextTurnStep, rollEffect, fireTurnMoments, asksFor, rollAsk, dropAsks, sceneName };
