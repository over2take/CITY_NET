// What a hit comes to on its target (8b5a; approved mockup docs/mockups/damage-pipeline.html, answers 2 and 3, 2026-11-23):
// each part of it resisted on its own ("1d8 SLASHING + 2d6 FIRE" on a fire-resistant target halves the fire only), by
// what the target's resistances come to for that part's type (choices.js resistancesOf: features, worn and installed
// things, conditions, the GM by hand, ALL counted on every type) and what that word WORKS OUT AS in the system: HALF
// rounded down, NONE, DOUBLE, or WORDS ONLY (taken as rolled, said). A part with no type, or two that cancel, is taken as
// rolled. WORK IT OUT off takes every part as rolled and still says what it would have met.
//
// Pure: the parts as rolled (gearRolls.js), the target's worked resistances, the system's WORKS OUT AS and the table's
// WORK IT OUT in, what each part and the whole come to out.

const HOW = { half: (n) => Math.floor(n / 2), none: () => 0, double: (n) => n * 2, words: (n) => n };
const VERB = { resist: 'RESISTS', immune: 'IMMUNE TO', vulnerable: 'VULNERABLE TO' };
const WORKS_WORDS = { half: 'HALF', none: 'NONE', double: 'DOUBLE', words: 'WORDS ONLY' };

/**
 * `parts` [{ value, type?, label? }], `worked` { [type]: { kind } } as resistancesOf gives it, `rules` { worksOut, workOut }.
 * Returns { parts: [{ value, type, label, kind, works?, taken }], rolled, taken }: `kind` what met the part (null none, or
 * two that cancel), `works` what that did where it was worked out.
 */
const damageTaken = (parts, worked, { worksOut, workOut }) => {
  const out = (Array.isArray(parts) ? parts : []).map((p) => {
    const value = Math.max(0, Math.floor(Number(p && p.value) || 0));
    const kind = (p && worked && worked[p.type] && worked[p.type].kind) || null;
    const works = kind && workOut ? worksOut[kind] : null;
    return {
      value, type: (p && p.type) || null, label: (p && p.label) || null, kind,
      ...(works ? { works } : {}),
      taken: works ? HOW[works](value) : value,
    };
  });
  return { parts: out, rolled: out.reduce((n, p) => n + p.value, 0), taken: out.reduce((n, p) => n + p.taken, 0) };
};

/**
 * What the log says a hit did, after the roll (8b5a): the target, each part a resistance met, "RESISTS FIRE: 4 → 2", or as
 * rolled where it is words only or not worked out, "RESISTS FIRE (TAKEN AS ROLLED)", then `notes`, then what it took last
 * (8b5c; the user, 2026-11-25: "the total damage at the end and highlighted"): "TAKES 7 OF 10", or "TAKES 10" where that is
 * all of it. `verb` WOULD TAKE where it isn't taken; `total` false leaves the number out, for players who aren't to know it.
 */
const takenWords = (targetName, taken, { verb = 'TAKES', total = true, notes = [] } = {}) => {
  const met = taken.parts.filter((p) => p.kind);
  const each = met.map((p) => {
    const what = `${VERB[p.kind]} ${String(p.label || p.type).toUpperCase()}`;
    return p.works && p.works !== 'words' ? `${what}: ${p.value} → ${p.taken}` : `${what} (TAKEN AS ROLLED)`;
  });
  const took = total ? [`${verb} ${taken.taken}${taken.taken !== taken.rolled ? ` OF ${taken.rolled}` : ''}`] : [];
  return [String(targetName).toUpperCase(), ...each, ...notes, ...took].join(' · ');
};

/**
 * A hit as the players may know it (8b5c; the user, 2026-11-25: an NPC's resistances hidden until the GM reveals them):
 * `shown` the target's resistances as players see them (resistancesShown.js revealedOnly), or null where they see all (a
 * player's character). A part met by what they don't know is said as a plain part, and where that changed its number the
 * total is theirs no more (`total: false`).
 */
const seenBy = (taken, shown) => {
  if (!shown) return { taken, total: true };
  let total = true;
  const parts = taken.parts.map((p) => {
    if (!p.kind || (shown[p.type] && shown[p.type].kind === p.kind)) return p;
    if (p.taken !== p.value) total = false;
    const { works, ...plain } = p;
    return { ...plain, kind: null };
  });
  return { taken: { ...taken, parts }, total };
};

module.exports = { damageTaken, takenWords, seenBy, WORKS_WORDS };
