// Pharmaceuticals and street drugs (CWN p60-61).
//
// The whole table, sixteen entries, because the shop stocks it and a character can be
// carrying any of them. Only three change a number this app works out, and the honesty
// about which is the point - same split the cyberware mods take next door.
//
// **What is modelled**, because the server computes it on every roll:
//
//   Boneshaker   +2 hit, damage and Shock; +2 to every Trauma Die rolled AGAINST you
//   Olympus      +2 hit
//   Avalanche    +10 current hit points, allowed above maximum
//
// **What is carried, not modelled.** Psycho and Window are genuinely running states, but
// Psycho's +2 is a Morale bonus and Morale is an NPC stat this app does not roll, and
// Window trades a Move action for a cyberspace Main Action, which is a turn structure
// rather than a number. Lurch, Panacea and Trauma Patch are instants that change a healing
// action, not states a character is in. Hellbender, Chokeout, Pillow and Reset are aimed at
// a victim and resolve as saving throws - a different feature, and a hostile one. Sand,
// Madeleine, Control-Delete and a medical prescription do nothing the sheet has a number
// for. Each carries its text so the table can rule; none of them invents a mechanic.
//
// **Applied on read, never written back**, like the chrome and the gear mods: a drug that
// wears off has to give back exactly what it gave, and the only way to be sure of that is
// never to have stored it.

/** The sheet field holding what is currently running: a JSON array of ids. */
const FIELD = 'pharma_active';

/**
 * How long a dose lasts.
 *
 * 'scene' is the only one the app acts on - END SCENE clears those and bills their Strain.
 * 'hour' outlasts a scene, so it survives that button and is cleared by hand. 'instant'
 * never sits on a sheet at all; it is a thing you do, not a state you are in. 'extended'
 * is a day or more, or until something in the fiction ends it.
 */
const DURATIONS = ['scene', 'hour', 'instant', 'extended'];

/**
 * The book's table, in its own order (alphabetical, as printed).
 *
 * `heal` is the minimum Heal skill needed to administer it, null for the book's "None" -
 * user-friendly enough that anyone can shoot it up. `strain` is System Strain billed when
 * a scene-length dose ends. `rare` is the book's @ marker: needs a Contact to obtain.
 */
const PHARMACEUTICALS = [
  {
    id: 'avalanche', label: 'AVALANCHE', cost: 100, heal: 0, duration: 'hour',
    effect: 'Numbs pain for an hour: +10 current hit points, even above maximum. -1 on the d12 for any Major Injury taken while it lasts.',
    // The only drug that grants hit points, and the only one whose grant is a real write
    // rather than an overlay: hit points are spent and lost as play goes on, so a number
    // recomputed on read would hand them back every time it was read.
    grantsHp: 10,
    // Major Injuries are a d12 table the app does not roll, so the -1 is carried for the
    // table to apply rather than modelled as a bonus that would never be consulted.
    majorInjury: -1,
  },
  {
    id: 'boneshaker', label: 'BONESHAKER', cost: 10, heal: null, duration: 'scene',
    effect: 'Blind aggression: +2 Morale, +2 to hit, damage and Shock. All attacks against you add +2 to any Trauma Die. 2 System Strain when the scene ends.',
    hit: 2, damage: 2, shock: 2,
    // The recklessness. Not a bonus, so it is not what the "highest bonus" rule caps -
    // see `activeEffects`.
    incomingTrauma: 2,
    strain: 2,
  },
  {
    id: 'chokeout', label: 'CHOKEOUT', cost: 50, heal: null, duration: 'extended',
    effect: 'Hostile. Consumed in food or drink; Physical save or strangled unconscious for an hour, waking at 1 hit point. On a success, 1d10 non-lethal damage. A natural 1 kills. Degrades after twelve hours.',
    hostile: true,
  },
  {
    id: 'control_delete', label: 'CONTROL-DELETE', cost: 25, heal: null, duration: 'extended',
    effect: 'Hostile. No saving throw, but toxin-filtering cyber stops it. The target acts normally and forgets everything between the dose and their next sleep.',
    hostile: true,
  },
  {
    id: 'hellbender', label: 'HELLBENDER', cost: 100, heal: null, duration: 'instant',
    effect: 'Hostile. Physical save or convulse helplessly for 1d6 rounds, taking 1d10 damage each round unless restrained by two or more. This can kill.',
    hostile: true,
  },
  {
    id: 'lurch', label: 'LURCH', cost: 25, heal: 0, duration: 'instant',
    effect: 'Heals 1d10 plus the physician\'s Heal skill, and adds 1 System Strain. Each dose after the first in a day raises the Heal needed by one. Conscious, stabilized targets only - it kills the Mortally Wounded.',
  },
  {
    id: 'madeleine', label: 'MADELEINE', cost: 100, heal: null, duration: 'hour',
    effect: 'Relive a chosen memory with perfect fidelity for 1d6 hours, oblivious to your surroundings. Psychologically addictive.',
  },
  {
    id: 'medical_prescription', label: 'MEDICAL PRESCRIPTION', cost: 20, heal: null, duration: 'extended',
    effect: 'Treats a chronic condition. Some need a dose a few times a week; others need one daily or risk lethal complications.',
  },
  {
    id: 'olympus', label: 'OLYMPUS', cost: 100, heal: 0, duration: 'scene',
    effect: 'Numbs pain and sharpens focus: +2 to hit, and reroll your first failed Morale check in a fight. 1 System Strain when the scene ends.',
    hit: 2,
    strain: 1,
  },
  {
    id: 'panacea', label: 'PANACEA', cost: 200, heal: 1, duration: 'instant',
    effect: 'Used as part of a first aid attempt, doubles the hit points recovered, minimum 6.',
  },
  {
    id: 'pillow', label: 'PILLOW', cost: 10, heal: 0, duration: 'extended',
    effect: 'A sedative for a restrained or helpless subject: 24 hours of torpor indistinguishable from death. A second dose inside 24 hours means a Physical save or die.',
  },
  {
    id: 'psycho', label: 'PSYCHO', cost: 10, heal: null, duration: 'hour',
    effect: 'About an hour of flattened emotion and raised aggression: +2 to Morale checks, and no immediate emotional trauma from anything you do.',
    // Morale is an NPC stat in this game and the app never rolls it for a character, so
    // the +2 is text. Listed as a running state anyway, because whether it is running is
    // a fact about the character that the table cares about.
  },
  {
    id: 'reset', label: 'RESET', cost: 1000, heal: null, duration: 'instant', rare: true,
    effect: 'A drug of desperation, for a subject with a Body or Nerve system. Sheds all System Strain above the permanent minimum; five minutes later Strain maxes and a Physical save is made at a penalty equal to the Strain gained since. Success drops you to 1 hit point, failure is Mortally Wounded, and 1 or less means a second save or die. More than once a week is fatal.',
  },
  {
    id: 'sand', label: 'SAND', cost: 2, heal: null, duration: 'hour',
    effect: 'A euphoric haze for up to an hour, then shooting pains and light sensitivity. Heavy users usually die within six to twelve months.',
  },
  {
    id: 'trauma_patch', label: 'TRAUMA PATCH', cost: 50, heal: null, duration: 'instant',
    effect: 'Stabilizes a Mortally Wounded ally on an Int or Dex/Heal check against difficulty 6, +1 for each full round since they went down. Useless after six rounds, and never against poison, disease or dismemberment.',
  },
  {
    id: 'window', label: 'WINDOW', cost: 200, heal: 1, duration: 'scene',
    effect: 'Trade your Move action for a bonus Main Action usable only on cyberspace actions. Each time you do, gain 1 System Strain. One dose lasts a scene.',
    // The Strain is per use rather than billed at the end, so it is not `strain` - END
    // SCENE must not charge for a dose nobody spent an action on.
  },
];

const BY_ID = new Map(PHARMACEUTICALS.map((p) => [p.id, p]));

/** One drug by id, or null. */
const byId = (id) => BY_ID.get(String(id || '').trim().toLowerCase()) || null;

/**
 * What is running on this sheet, as catalogue entries.
 *
 * Deduplicated, because taking a second dose of the same thing changes nothing the rules
 * recognise - the bonus does not stack with itself any more than it stacks with another
 * drug's. Unknown ids are dropped rather than guessed at.
 */
const activeDrugs = (data) => {
  let value = data ? data[FIELD] : null;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const drug = byId(raw);
    if (!drug || seen.has(drug.id)) continue;
    seen.add(drug.id);
    out.push(drug);
  }
  return out;
};

const EMPTY = {
  hit: 0, damage: 0, shock: 0, incomingTrauma: 0, majorInjury: 0, sceneStrain: 0,
  active: [],
};

/**
 * The numbers currently on a character, with the book's stacking rule applied.
 *
 * "In the case that multiple drugs are taken at once, only the highest bonus applies"
 * (p60). So these are maxima, not sums: Boneshaker and Olympus together are +2 to hit,
 * not +4. Taken per channel, because the sentence is about bonuses rather than about
 * drugs - Boneshaker's +2 damage is the highest damage bonus going whether or not
 * something else is beating it on hit.
 *
 * The penalties are maxima too, and that is a reading rather than a quotation: the rule
 * names bonuses only. Summing them would mean two doses of recklessness make you twice as
 * easy to hurt, which the "only the highest" spirit argues against, and only one drug in
 * the book carries one - so the choice costs nothing today and errs kindly.
 */
const activeEffects = (data) => {
  const active = activeDrugs(data);
  if (!active.length) return EMPTY;

  const best = (key) => active.reduce((n, d) => Math.max(n, Number(d[key]) || 0), 0);
  return {
    hit: best('hit'),
    damage: best('damage'),
    shock: best('shock'),
    incomingTrauma: best('incomingTrauma'),
    // A penalty, so the worst of them: the most negative, not the largest.
    majorInjury: active.reduce((n, d) => Math.min(n, Number(d.majorInjury) || 0), 0),
    // What ending the scene will cost. Summed, unlike the bonuses - Strain is a price
    // each drug charges for itself, not a benefit being capped.
    sceneStrain: active
      .filter((d) => d.duration === 'scene')
      .reduce((n, d) => n + (Number(d.strain) || 0), 0),
    active,
  };
};

/**
 * What is left running once the scene ends, and what it cost.
 *
 * Scene-length doses end here and bill their Strain. Anything measured in hours outlasts a
 * scene and stays, which is why this is not simply "clear everything": Avalanche runs an
 * hour and a fight is not an hour.
 */
const endScene = (data) => {
  const active = activeDrugs(data);
  const ending = active.filter((d) => d.duration === 'scene');
  return {
    remaining: active.filter((d) => d.duration !== 'scene').map((d) => d.id),
    ended: ending.map((d) => d.id),
    strain: ending.reduce((n, d) => n + (Number(d.strain) || 0), 0),
  };
};

/** What the shop stocks: everything, cheapest first, the way a shelf reads. */
const shopStock = () => [...PHARMACEUTICALS].sort((a, b) => a.cost - b.cost);

module.exports = {
  FIELD, DURATIONS, PHARMACEUTICALS, byId, activeDrugs, activeEffects, endScene, shopStock,
};
