// A token's conditions (4e2a; approved mockup docs/mockups/builder-conditions.html, 2026-10-09).
//
//   locations.conditions = '[{"id":"prone"},{"id":"poisoned","left":2}]'
//
// Each entry names one of the conditions the running system offers (systemBuilder/runtime.js
// conditionsIn), with the rounds it has left when it ends after rounds. Each new round of a combat
// takes one off every condition with rounds left on its tokens, and one that reaches none comes off
// (tickCombat, from the initiative tracker). Kept per game system like
// the token's health (tokens/vitals.js), so each game keeps its own. Who may change them is who may
// change the token's health (tokens/tokenAccess.js). Everyone sees which conditions a token has, as
// with injuries; the rounds left go only to the GM and a granted editor in the public token list.
//
// Pure: the routes read and check through it.

const LIMITS = { conditions: 60, rounds: 99 };

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A token's stored conditions, whatever the column holds: a list of { id, left? }, never a throw. */
const parseTokenConditions = (text) => {
  let list;
  try { list = typeof text === 'string' ? JSON.parse(text) : text; } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => isPlainObject(c) && typeof c.id === 'string')
    .map((c) => (Number.isInteger(c.left) && c.left > 0 ? { id: c.id, left: c.left } : { id: c.id }));
};

/**
 * A token's conditions as asked for, checked against what the running system `offered`
 * (conditionsIn). Answers `{ ok: true, value }`, the list to store, or `{ ok: false, error }`
 * naming what is wrong. A condition that ends after rounds starts with its own rounds unless
 * `left` says otherwise; one that ends when removed carries no rounds whatever is sent.
 */
const checkTokenConditions = (asked, offered) => {
  if (!Array.isArray(asked)) return { ok: false, error: 'Conditions must be a list' };
  if (asked.length > LIMITS.conditions) return { ok: false, error: `At most ${LIMITS.conditions} conditions on a token` };
  const byId = new Map(offered.map((c) => [c.id, c]));
  const seen = new Set();
  const value = [];
  for (const entry of asked) {
    const c = isPlainObject(entry) && typeof entry.id === 'string' ? byId.get(entry.id) : null;
    if (!c) {
      const named = isPlainObject(entry) && typeof entry.id === 'string' ? `"${entry.id}" is` : 'That is';
      return { ok: false, error: `${named} not a condition this game has` };
    }
    if (seen.has(c.id)) return { ok: false, error: `${c.name} is on the list twice` };
    seen.add(c.id);
    if (entry.left !== undefined && entry.left !== null && (!Number.isInteger(entry.left) || entry.left < 1 || entry.left > LIMITS.rounds)) {
      return { ok: false, error: `Rounds left on ${c.name} must be a whole number from 1 to ${LIMITS.rounds}` };
    }
    if (c.ends === 'rounds') value.push({ id: c.id, left: Number.isInteger(entry.left) ? entry.left : c.rounds });
    else if (Number.isInteger(entry.left)) value.push({ id: c.id, left: entry.left });
    else value.push({ id: c.id });
  }
  return { ok: true, value };
};

/**
 * A token's conditions one round on (4e2a2): every one with rounds left loses one, and those that
 * reach none come off. Answers the list to store, the ids that ended, and whether anything changed.
 */
const tickRound = (list) => {
  const ended = [];
  let changed = false;
  const next = [];
  for (const c of list) {
    if (!Number.isInteger(c.left)) { next.push(c); continue; }
    changed = true;
    if (c.left <= 1) ended.push(c.id);
    else next.push({ ...c, left: c.left - 1 });
  }
  return { list: next, ended, changed };
};

/**
 * Who of a combat's combatants are tokens, from the tracker's ids (`npc:<location id>`,
 * `player:<username>`): the NPC tokens by id, and the players by name, since a player's
 * conditions follow them onto every token of theirs. Each once, however often listed.
 */
const combatTokens = (combatants) => {
  const npcs = new Set();
  const players = new Set();
  for (const c of Array.isArray(combatants) ? combatants : []) {
    const m = /^(npc|player):(.+)$/.exec(c && typeof c.id === 'string' ? c.id : '');
    if (!m) continue;
    if (m[1] === 'npc' && /^\d+$/.test(m[2])) npcs.add(Number(m[2]));
    else if (m[1] === 'player') players.add(m[2]);
  }
  return { npcs: [...npcs], players: [...players] };
};

/** What everyone but the GM and a granted editor sees of a token's conditions: which, not for how long. */
const publicTokenConditions = (text) => JSON.stringify(parseTokenConditions(text).map(({ id }) => ({ id })));

/**
 * A new round for a combat (4e2a2): its tokens' conditions with rounds left each lose one, and those
 * that reach none come off. Player tokens are counted once per player, every token of theirs
 * written alike. cb(err, { tokens }) with how many tokens were written.
 */
const tickCombat = (db, combatants, cb = () => {}) => {
  const { npcs, players } = combatTokens(combatants);
  const shapes = `'enemy_rhombus', 'friendly_rhombus'`;
  const reads = [
    ...npcs.map((id) => ({ sql: `SELECT conditions FROM locations WHERE id = ? AND shape IN (${shapes})`, arg: id,
      write: 'UPDATE locations SET conditions = ? WHERE id = ?' })),
    ...players.map((name) => ({ sql: `SELECT conditions FROM locations WHERE shape = 'rhombus' AND owner = ? LIMIT 1`, arg: name,
      write: `UPDATE locations SET conditions = ? WHERE shape = 'rhombus' AND owner = ?` })),
  ];
  let tokens = 0;
  let firstError = null;
  const step = (i) => {
    if (i >= reads.length) return cb(firstError, { tokens });
    const r = reads[i];
    db.get(r.sql, [r.arg], (err, row) => {
      if (err) { firstError = firstError || err; return step(i + 1); }
      if (!row) return step(i + 1);
      const ticked = tickRound(parseTokenConditions(row.conditions));
      if (!ticked.changed) return step(i + 1);
      db.run(r.write, [JSON.stringify(ticked.list), r.arg], function (err2) {
        if (err2) firstError = firstError || err2; else tokens += this.changes;
        step(i + 1);
      });
    });
  };
  step(0);
};

module.exports = { LIMITS, parseTokenConditions, checkTokenConditions, publicTokenConditions, tickRound, combatTokens, tickCombat };
