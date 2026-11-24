// What a token's HEALTH shows of its character's resistances (8b3c2a; the user, 2026-11-24: below CONDITIONS, two rows,
// RESISTANCES and VULNERABILITIES, every source): the game's damage types that are on, with their pictures, for the chips
// and the pickers; what RESIST, IMMUNE and VULNERABLE mean in this game; what the character has by type, worked out from
// the sheet and the token's conditions, each source named; the rows added by hand, with who added them; and what the one
// looking may add: the GM any, a player RESIST and IMMUNE on their own character or an NPC given them, never VULNERABLE.
//
// Who sees how much (8b4a; the user, 2026-11-24): the GM, and a player on their own character or an NPC given them, all of
// it (`look: 'full'`), the GM with which of an NPC's are revealed; a player looking at another player's character all of
// it too, to read (`'watch'`); a player looking at an NPC only what the GM has REVEALED, each type's kind as its revealed
// parts come to and never where it comes from (`'revealed'`), and nothing until something is.
//
// Pure: the route hands in the sheet, the token's conditions, who is asking and how much they see.

const { resistancesOf } = require('./choices');
const { damageTypesOf, meaningsOf } = require('./damageTypes');
const { HAND_KEY, REVEALED_KEY, ALL, handIn, revealedIn, kindOf } = require('./resistances');

/** What a player sees of an NPC (8b4a): the types revealed, ALL's parts where ALL is; each kind as those parts come to. */
const revealedOnly = (worked, revealed) => {
  const shown = new Set(revealed);
  const out = {};
  for (const [type, w] of Object.entries(worked)) {
    const parts = w.from.filter((s) => shown.has(type) ? !s.all || shown.has(ALL) : s.all && shown.has(ALL));
    if (parts.length) out[type] = { kind: kindOf(parts.map((s) => s.kind)), from: parts.map((s) => ({ kind: s.kind, ...(s.all ? { all: true } : {}) })) };
  }
  return out;
};

/**
 * `data` the sheet behind the token (null where it has none, so nothing can be added by hand), `conditionIds` the token's,
 * `who` a player's name or null for the GM, `look` how much they see, `npc` whether the token is an NPC's.
 */
const resistancesShown = (definition, data, conditionIds, who, { look = 'full', npc = false } = {}) => {
  const worked = resistancesOf(definition, data || {}, conditionIds);
  const base = {
    types: damageTypesOf(definition).map(({ id, name, icon, drawn }) => ({ id, name, ...(drawn ? { drawn } : { icon }) })),
    means: meaningsOf(definition),
  };
  if (look === 'revealed') return { ...base, worked: revealedOnly(worked, revealedIn(data && data[REVEALED_KEY])), hand: [], may: { add: false, vulnerable: false }, revealedOnly: true };
  if (look === 'watch') return { ...base, worked, hand: data ? handIn(data[HAND_KEY]) : [], may: { add: false, vulnerable: false } };
  return {
    ...base, worked,
    hand: data ? handIn(data[HAND_KEY]) : [],
    // Who is asking, a player by name, for the rows of theirs they may take off.
    may: { add: !!data, vulnerable: !!data && !who, ...(who ? { by: who } : {}) },
    // The GM's view of an NPC (8b4a): which are revealed, for REVEAL beside the rest. None kept without a sheet.
    ...(npc && !who ? { npc: true, revealed: data ? revealedIn(data[REVEALED_KEY]) : [] } : {}),
  };
};

module.exports = { resistancesShown, revealedOnly };
