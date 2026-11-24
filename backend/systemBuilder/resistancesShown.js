// What a token's HEALTH shows of its character's resistances (8b3c2a; the user, 2026-11-24: below CONDITIONS, two rows,
// RESISTANCES and VULNERABILITIES, every source): the game's damage types that are on, with their pictures, for the chips
// and the pickers; what RESIST, IMMUNE and VULNERABLE mean in this game; what the character has by type, worked out from
// the sheet and the token's conditions, each source named; the rows added by hand, with who added them; and what the one
// looking may add: the GM any, a player RESIST and IMMUNE on their own character or an NPC given them, never VULNERABLE.
//
// Pure: the route hands in the sheet, the token's conditions and who is asking.

const { resistancesOf } = require('./choices');
const { damageTypesOf, meaningsOf } = require('./damageTypes');
const { HAND_KEY, handIn } = require('./resistances');

/**
 * `data` the sheet behind the token (null where it has none, so nothing can be added by hand), `conditionIds` the token's,
 * `who` a player's name or null for the GM.
 */
const resistancesShown = (definition, data, conditionIds, who) => ({
  types: damageTypesOf(definition).map(({ id, name, icon, drawn }) => ({ id, name, ...(drawn ? { drawn } : { icon }) })),
  means: meaningsOf(definition),
  worked: resistancesOf(definition, data || {}, conditionIds),
  hand: data ? handIn(data[HAND_KEY]) : [],
  // Who is asking, a player by name, for the rows of theirs they may take off.
  may: { add: !!data, vulnerable: !!data && !who, ...(who ? { by: who } : {}) },
});

module.exports = { resistancesShown };
