// Spending recovery dice at the table (R2a; approved mockup docs/mockups/rest-on-sheet.html,
// 2026-10-30): a player rolls some of a pool from their sheet, any time (the user: "any time, trust
// the table"); the GM may for any player. The dice are spent and rolled inside the sheet's write
// queue (systemBuilder/recovery.js spendFrom), so a player typing then loses nothing; what they heal
// goes through the system's health model as the health window's HEAL does, onto every token of the
// player's; and the roll is a dice-log line for everyone, opening the tray as any roll does.

const crypto = require('crypto');
const { mutateSheetForUser } = require('./mutate');
const { applyDerived } = require('./templates');
const { spendFrom, restingOf, RECOVERY_KEY, ALL_POOL } = require('../systemBuilder/recovery');
const { reachOf } = require('../systemBuilder/rests');
const { applyHealthAction } = require('../systemBuilder/health');
const { withThrow, boardOf } = require('../utils/diceThrow');

const LOG_COLOR = '#00ff00';

const all = (db, sql, params) => new Promise((ok, no) => db.all(sql, params, (e, rows) => (e ? no(e) : ok(rows || []))));
const run = (db, sql, params) => new Promise((ok, no) => db.run(sql, params, (e) => (e ? no(e) : ok())));
const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * The dice-log line: "HIT DICE · Rook: spent 2 Fighter d10, 5 + 3 + 4 = 12 · HP 21 → 33". `health`
 * is { label, from, to } when a token was healed.
 */
const spendLine = (name, who, spent, health) => {
  const pool = spent.pool;
  const what = `${spent.count} ${pool.id === ALL_POOL ? '' : `${pool.label} `}d${pool.die}`;
  const sum = `${spent.rolls.join(' + ')}${spent.plus ? ` ${spent.plus > 0 ? '+' : '-'} ${Math.abs(spent.plus)}` : ''} = ${spent.heal}`;
  return `${String(name).toUpperCase()} · ${who}: spent ${what}, ${sum}${health ? ` · ${health.label} ${health.from} → ${health.to}` : ''}`;
};

/**
 * Spend `count` of one pool of `username`'s character in the running system and roll them. Answers
 * { ok: true, heal, line } or { ok: false, error } in words for the one who asked.
 */
const spendRecovery = async (db, io, { system, definition, username, pool, count, rng = cryptoRng }) => {
  const recovery = restingOf(definition).recovery;
  if (!recovery) return { ok: false, error: 'This game has no recovery dice' };
  const [token] = await all(db, `SELECT hp_current, hp_max, hp_temp, color FROM locations WHERE shape = 'rhombus' AND owner = ? ORDER BY id LIMIT 1`, [username]);
  const reach = reachOf(definition);
  let spent = null;
  let healed = null;
  let who = username;
  const stored = await new Promise((ok, no) => mutateSheetForUser(db, { username, system }, (data) => {
    const worked = { ...data };
    applyDerived(system, worked);
    spent = spendFrom(definition, worked, pool, count, rng);
    if (!spent.ok) return undefined;
    if (typeof data.name === 'string' && data.name.trim()) who = data.name.trim();
    let next = { ...data, [RECOVERY_KEY]: spent.data[RECOVERY_KEY] };
    const health = reach.health;
    if (token && health && health.model !== 'none' && spent.heal > 0) {
      const t = { current: num(token.hp_current), max: num(token.hp_max), temp: num(token.hp_temp) };
      const h = applyHealthAction(health, t, worked, { kind: 'heal', amount: spent.heal });
      if (h.ok) {
        healed = { label: health.label || 'HP', from: t.current, to: num(h.token.current), token: h.token };
        next = { ...next, ...h.sheetPatch };
      }
    }
    applyDerived(system, next);
    return next;
  }, (err, saved) => (err ? no(err) : ok(saved)))).catch(() => null);
  if (spent && !spent.ok) return { ok: false, error: spent.error };
  if (!stored || !spent) return { ok: false, error: 'That character has no sheet yet' };

  if (healed) {
    const t = healed.token;
    await run(db, `UPDATE locations SET hp_current = ?, hp_max = ?, hp_temp = ? WHERE shape = 'rhombus' AND owner = ?`, [t.current, t.max, t.temp, username]);
  }
  const line = spendLine(recovery.name, who, spent, healed);
  const results = { [spent.pool.die]: spent.rolls };
  const modifiers = spent.plus ? [spent.plus] : [];
  const color = (token && typeof token.color === 'string' && token.color) || LOG_COLOR;
  // The tray's total is its dice and what is added, as any roll's; the heal is never below 0.
  const total = spent.rolls.reduce((a, b) => a + b, 0) + spent.plus;
  // The dice are spent and the token healed by now: a log line that fails to save is said in the
  // server's log, and the roll still goes out.
  await run(db, 'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)', [username, total, JSON.stringify(results), color, line])
    .catch((e) => console.error('[recovery] roll not logged:', e.message));
  io.emit('diceRollBroadcast', withThrow({ userName: who, account: username, results, modifiers, color, total, historyString: line, board: boardOf(String(recovery.name).toUpperCase()) }));
  io.emit('sheetUpdated', { username, system });
  if (healed) io.emit('dataUpdated', { isRhombusOnly: true });
  return { ok: true, heal: spent.heal, line };
};

module.exports = { spendRecovery, spendLine };
