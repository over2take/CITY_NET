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
const { rollAmount } = require('../systemBuilder/tierRolls');
const { namesOf, effectiveData } = require('../systemBuilder/choices');

/** The table's switch on the GAME tab: '0' stops a condition's EACH TURN rolls. */
const TURN_EFFECTS_SETTING = 'condition_turn_effects';
const LOG_COLOR = '#00ff00';
const WHEN_WORDS = { turn_start: 'START OF ITS TURN', turn_end: 'END OF ITS TURN', round_start: 'START OF ROUND', round_end: 'END OF ROUND' };

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

/**
 * An effect rolled and what it did, in words (pure but for the dice): `{ value, dice, hp?, ends?, line }`. `values` are the
 * sheet's, `pool` the token's HP or null where the game has none to change, `who` its name as the log says it.
 */
const rollEffect = ({ condition, effect, values, names, pool, who, rng }) => {
  const rolled = rollAmount(effect.roll, values, names, rng);
  if ('error' in rolled || 'blank' in rolled) return { error: rolled.error || 'Nothing to roll' };
  const head = `${who} · ${condition.name.toUpperCase()}${effect.does === 'roll_to_end' ? ' SAVE' : ''}, ${WHEN_WORDS[effect.when]} · rolled by the table: ${effect.roll} → ${rolled.value}`;
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
const run = (db, sql, args = []) => new Promise((ok, no) => db.run(sql, args, (e) => (e ? no(e) : ok())));

/** A combatant's token and the sheet it reads from, by the tracker's id; null for one with none. */
const tokenOf = async (db, id) => {
  const m = /^(npc|player):(.+)$/.exec(String(id));
  if (!m) return null;
  if (m[1] === 'player') {
    const row = await get(db, "SELECT id, name, shape, owner, hp_current, hp_max, hp_temp, conditions FROM locations WHERE shape = 'rhombus' AND owner = ? LIMIT 1", [m[2]]);
    return row ? { row, player: m[2] } : null;
  }
  if (!/^\d+$/.test(m[2])) return null;
  const row = await get(db, "SELECT id, name, shape, owner, hp_current, hp_max, hp_temp, conditions FROM locations WHERE id = ? AND shape IN ('enemy_rhombus', 'friendly_rhombus')", [Number(m[2])]);
  return row ? { row, player: null } : null;
};

/** The sheet a token's rolls read: the player's own in this game, or the NPC's linked one. */
const sheetOf = async (db, token, system) => {
  const row = token.player
    ? await get(db, 'SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [token.player, system])
    : await get(db, 'SELECT cs.data FROM npc_sheet_links l JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ?', [token.row.id]).catch(() => null);
  try { return row ? JSON.parse(row.data || '{}') : {}; } catch { return {}; }
};

/**
 * `moments` fired on a scene (8a9a): every combatant's conditions doing what they do, one after another, in the log.
 * `runtime` the running systems (systemBuilder/runtime.js); `emitUpdate` redraws the map. Resolves when all are done.
 */
const fireTurnMoments = async (db, { io, emitUpdate = () => {}, runtime, system, moments, rng = cryptoRng }) => {
  if (!system || !Array.isArray(moments) || !moments.length) return;
  const offered = runtime.conditionsIn(system);
  if (!offered.some((c) => c.ends === 'next_turn' || (Array.isArray(c.each_turn) && c.each_turn.length))) return;
  const setting = await get(db, 'SELECT value FROM global_settings WHERE key = ?', [TURN_EFFECTS_SETTING]).catch(() => null);
  const rolls = !(setting && setting.value === '0');
  const definition = runtime.definitionOf(system);
  const labels = definition ? namesOf(definition) : new Map();
  const names = { known: (n) => labels.has(n), refused: (n) => `@${n} isn't one of this system's names` };
  const health = runtime.health(system);
  const pooled = runtime.partIn(system, 'token_health') && (!health || health.model === 'pool');
  const { syncConditionsOnSheet } = require('../sheets/conditionsOnSheet');

  for (const { when, ids } of moments) {
    for (const id of ids) {
      const token = await tokenOf(db, id);
      if (!token) continue;
      const who = `${String(token.row.name || token.player || 'TOKEN').toUpperCase()}${token.player ? '' : ' (NPC)'}`;
      let list = parseTokenConditions(token.row.conditions);
      let pool = pooled ? { current: token.row.hp_current, max: token.row.hp_max, temp: token.row.hp_temp } : null;
      let hpChanged = false;
      let listChanged = false;
      const lines = [];
      // The rolls first, then AT THE END OF ITS NEXT TURN, so a save rolled at the end of a turn is still rolled.
      if (rolls) {
        const values = definition ? effectiveData(definition, await sheetOf(db, token, system)) : {};
        for (const { condition, effect } of effectsAt(when, list, offered)) {
          if (effect.rolled_by !== 'table') continue;
          if (!list.some((t) => t.id === condition.id)) continue;
          const made = rollEffect({ condition, effect, values, names, pool, who, rng });
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
          if (listChanged) await syncConditionsOnSheet(db, { username: token.player, io, runtime });
        }
      }
    }
  }
};

module.exports = { TURN_EFFECTS_SETTING, WHEN_WORDS, momentsOfNext, momentsOfBegin, effectsAt, nextTurnStep, rollEffect, fireTurnMoments };
