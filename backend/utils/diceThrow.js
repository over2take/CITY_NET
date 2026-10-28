const crypto = require('crypto');

// The tray's throw (6c4b1; approved mockup docs/mockups/builder-dice.html, decision 9), sent with
// every roll: the 3D dice land on the faces the server rolled, and tumble alike for everyone
// watching. `seed` starts each watcher's tumble the same; `dice` says, kind by kind as `results`
// keys them, how many faces the die has, what they show where they aren't 1 to n, and which face
// each die landed on (from 0). A system's own dice bring their faces and symbols' looks with them.

/** Fate dice as the log writes them, two faces of each. */
const FATE = ['+1', '+1', '0', '0', '-1', '-1'];
const FATE_FACE = new Map([[1, 0], [0, 2], [-1, 4]]);

/** A results key's die size: given, or a key that is one ('6'), or a d6 as the tray falls back to. */
const sidesOf = (key, diceSides) => {
  const n = Number.isInteger(diceSides?.[key]) ? diceSides[key] : parseInt(key, 10);
  return Number.isInteger(n) && n >= 2 ? Math.min(n, 1000) : 6;
};

/** One kind of dice: its faces, given or 1 to n, and the face each landed on, kept to the die's. */
const kindOf = (key, values, diceSides, given) => {
  if (given) {
    return {
      key, sides: given.faces.length, faces: given.faces,
      landed: values.map((_, i) => (Number.isInteger(given.landed[i]) ? given.landed[i] : 0)),
      ...(given.color === 'danger' ? { color: 'danger' } : {}),
    };
  }
  if (key === 'dF') return { key, sides: 6, faces: FATE.map((text) => ({ text })), landed: values.map((v) => FATE_FACE.get(Number(v)) ?? 2) };
  const sides = sidesOf(key, diceSides);
  // A score with no dice behind it (an initiative fallback) can be past the die's top face.
  return { key, sides, landed: values.map((v) => Math.max(0, Math.min(sides - 1, (Math.round(Number(v)) || 1) - 1))) };
};

/**
 * The throw for a roll's `results` (and `diceSides`). `given` holds what the results can't say:
 * `kinds` by key, each `{ faces: [{ text, n?, s? }], landed, color? }`, and the `symbols` their
 * faces show, each `{ id, mark, drawn?, icon? }`.
 */
const throwOf = ({ results, diceSides } = {}, { kinds = {}, symbols = [] } = {}) => ({
  seed: crypto.randomInt(0, 0x7fffffff),
  dice: Object.entries(results && typeof results === 'object' ? results : {})
    .map(([key, v]) => kindOf(key, Array.isArray(v) ? v : [v], diceSides, kinds[key])),
  ...(symbols.length ? { symbols } : {}),
});

/**
 * Rolls that land in one throw (6c4c): one person's rolls sent within GROUP_MS of each other, such
 * as an attack's to-hit and its damage, which the server sends a few milliseconds apart. Decided
 * here, by the server's clock, so every screen groups them alike; a tray throws a group's dice
 * together, and a roll of another group cuts in.
 */
const GROUP_MS = 400;
const groups = new Map();

/** The group of a roll by `account` at `now`: the one it continues, or a new one. */
const groupOf = (account, now) => {
  const last = groups.get(account);
  if (last && now - last.at <= GROUP_MS) { last.at = now; return last.id; }
  const id = crypto.randomBytes(6).toString('hex');
  groups.set(account, { id, at: now });
  // Forget anyone quiet for a minute, so the list stays as long as the table is.
  for (const [who, g] of groups) if (now - g.at > 60000) groups.delete(who);
  return id;
};

/**
 * What the tray's board says of a roll (6c4d2): what it was for (TO HIT, DAMAGE, DEATH SAVE), and
 * what it came to where the server decided (HIT, MISS, DOWN), in the log's own words. A group's
 * rolls each name theirs, so the board can show an attack as TO HIT 15 / DAMAGE 7.
 */
const boardOf = (label, outcome = null) => ({ label, ...(outcome ? { outcome } : {}) });

/** A roll's broadcast with its throw and its group: every diceRollBroadcast goes out through this. */
const withThrow = (data, given, now = Date.now()) => ({
  ...data,
  throw: throwOf(data, given),
  group: groupOf(String(data.account ?? data.userName ?? data.username ?? ''), now),
});

module.exports = { throwOf, withThrow, groupOf, boardOf, GROUP_MS, FATE };
