/**
 * Built-in dice that ship with a game system.
 *
 * These live in code rather than the database on purpose: they are part of the
 * application, not GM data. Shipping a new version updates the definitions for
 * every install with no migration or reconciliation, and they cannot be edited
 * or deleted through the API by construction — there is no row to mutate.
 *
 * GM-authored dice live in the `custom_dice` table and are served by
 * routes/custom_dice.js instead.
 *
 * Ids are namespaced with `builtin:` so the roll handler can tell at a glance
 * which store to resolve them from.
 *
 * Faces are plain strings. A die whose every face parses as a number is summed
 * when rolled; anything else reports its faces verbatim with no total. Note
 * that '+1' and '-1' both parse numerically, so signed dice still total
 * correctly while displaying their sign.
 */

/** @type {Record<string, Array<{id: string, name: string, sides: number, faces: {value: string}[]}>>} */
const SYSTEM_DICE = {
  // Fate / Fudge dice: four of these are rolled and summed to give -4..+4.
  // Mechanic from the Fate SRD (Creative Commons Attribution 3.0).
  fate_core: [
    {
      id: 'builtin:fate_df',
      name: 'dF',
      sides: 6,
      faces: [
        { value: '+1' }, { value: '+1' },
        { value: '-1' }, { value: '-1' },
        { value: '0' }, { value: '0' },
      ],
    },
  ],
};

/** Dice for one system, or [] when that system ships none. */
const forSystem = (system) => SYSTEM_DICE[system] ?? [];

/** Look up a single built-in by its namespaced id, across all systems. */
const byId = (id) => {
  for (const dice of Object.values(SYSTEM_DICE)) {
    const found = dice.find(d => d.id === id);
    if (found) return found;
  }
  return null;
};

/** True when an id refers to a built-in rather than a `custom_dice` row. */
const isBuiltinId = (id) => typeof id === 'string' && id.startsWith('builtin:');

module.exports = { SYSTEM_DICE, forSystem, byId, isBuiltinId };
