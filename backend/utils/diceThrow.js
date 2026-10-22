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

/** A roll's broadcast with its throw: every diceRollBroadcast goes out through this. */
const withThrow = (data, given) => ({ ...data, throw: throwOf(data, given) });

module.exports = { throwOf, withThrow, FATE };
