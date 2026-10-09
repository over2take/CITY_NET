// A token's conditions (4e2a; approved mockup docs/mockups/builder-conditions.html, 2026-10-09).
//
//   locations.conditions = '[{"id":"prone"},{"id":"poisoned","left":2}]'
//
// Each entry names one of the conditions the running system offers (systemBuilder/runtime.js
// conditionsIn), with the rounds it has left when it ends after rounds. Kept per game system like
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

/** What everyone but the GM and a granted editor sees of a token's conditions: which, not for how long. */
const publicTokenConditions = (text) => JSON.stringify(parseTokenConditions(text).map(({ id }) => ({ id })));

module.exports = { LIMITS, parseTokenConditions, checkTokenConditions, publicTokenConditions };
