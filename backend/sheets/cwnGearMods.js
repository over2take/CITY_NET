// Armor and weapon mods (CWN p58-59).
//
// A third modifier system, parallel to cyberware and separate from it: cyberware modifies
// the body, these modify the gear. The book keeps them in their own tables with their own
// install rules, and so do we.
//
// **Applied, not printed.** Vehicle fittings next door are deliberately printed-only,
// because several of them rewrite stored stat-block numbers (Extra Durability is +25% max
// HP) and stripping one back out would have nothing to restore from. Gear mods are the
// other case: every mechanical effect here lands on something the server computes fresh
// on every roll - a to-hit total, a damage roll, an effective AC, a soak pool. So these
// follow the cyberware precedent instead, overlaid on read and never written back, which
// is what makes uninstalling one actually undo it.
//
// Mods with no numbers here are carried for the record rather than modelled. That is not
// an omission: Quickchange changes what your coat looks like and Reel Wires bring a thrown
// knife back to your hand, and neither is a number the app has any business inventing.
// The chip says what the mod does; the table says what the app does about it.

/**
 * What a mod can change.
 *
 * Weapon: `hit`, `damage` and `shock` are flat bonuses; `vsVehicles` lets the weapon's
 * trauma die bite machines (the book's ! marker, which we already model); `noTrauma`
 * strips the die entirely.
 *
 * Armor: `soak`, `traumaTarget`, `rangedAc` and `meleeAc` land on the fields the last
 * three commits gave them somewhere to land.
 */

/** The book caps how far mods can push a weapon. */
const WEAPON_BONUS_CAP = 3;

const ARMOR_MODS = [
  {
    id: 'absorption_pads', label: 'ABSORPTION PADS', skill: 'Fix-2', cost: 2000, tech: 0,
    effect: 'The armor gains +5 HP of soak per fight',
    soak: 5,
  },
  {
    id: 'active_response', label: 'ACTIVE RESPONSE', skill: 'Fix-3', cost: 20000, tech: 2,
    effect: 'The armor increases a Trauma Target by +1',
    traumaTarget: 1,
  },
  {
    id: 'biostabilizing', label: 'BIOSTABILIZING', skill: 'Fix-1', cost: 2500, tech: 0,
    effect: 'Roll 2d6+2 vs 8 to stabilize at zero hit points',
    // Its own roll on its own trigger, once before the suit needs an hour to recalibrate.
    // The app's stabilize roll is an ally's Heal check, which this does not modify - it is
    // a different roll made by a different person, so it stays a note.
  },
  {
    id: 'customized_armor', label: 'CUSTOMIZED', skill: 'Fix-1', cost: 1000, tech: 0,
    effect: 'A specific user gains +1 ranged/melee AC',
    rangedAc: 1, meleeAc: 1,
  },
  {
    id: 'discreet_design', label: 'DISCREET DESIGN', skill: 'Fix-2', cost: 5000, tech: 1,
    effect: 'Make Obvious armor Subtle, at -2 ranged and melee AC',
    // The only mod in either table that is a straight trade rather than a gain.
    rangedAc: -2, meleeAc: -2,
  },
  {
    id: 'flexible', label: 'FLEXIBLE', skill: 'Fix-2', cost: 10000, tech: 1,
    effect: 'Remove the Heavy penalty from armor',
    // Heavy is a -1 on Sneak and Exert checks. The app does not model armor as carrying
    // qualities, so there is nothing here to remove.
  },
  {
    id: 'quickchange', label: 'QUICKCHANGE', skill: 'Fix-1', cost: 1000, tech: 0,
    effect: 'Change armor appearance as a Main Action',
  },
  {
    id: 'sealed', label: 'SEALED', skill: 'Fix-1', cost: 2500, tech: 0,
    effect: 'Environmentally seal armor for 30 minutes',
  },
  {
    id: 'tailored_rig', label: 'TAILORED RIG', skill: 'Fix-1', cost: 2000, tech: 0,
    effect: '+1 Readied and +2 Stowed unconcealed items',
    // Encumbrance is not tracked.
  },
  {
    id: 'trauma_dampers', label: 'TRAUMA DAMPERS', skill: 'Fix-3', cost: 10000, tech: 1,
    effect: 'The armor gains +5 HP of soak per fight',
    soak: 5,
    // The book installs this on top of Absorption Pads rather than instead of it.
    requires: 'absorption_pads',
  },
  {
    id: 'whisperlight', label: 'WHISPERLIGHT', skill: 'Fix-2', cost: 10000, tech: 1,
    effect: "The armor's Encumbrance decreases by 1",
  },
];

const WEAPON_MODS = [
  {
    id: 'autotargeting', label: 'AUTOTARGETING', skill: 'Fix-1', cost: 5000, tech: 0,
    effect: 'Gain a +1 bonus to hit with the weapon',
    hit: 1,
  },
  {
    id: 'concealed', label: 'CONCEALED', skill: 'Fix-2', cost: 5000, tech: 1,
    effect: 'Makes a weapon much harder to recognize',
  },
  {
    id: 'customized_weapon', label: 'CUSTOMIZED', skill: 'Fix-1', cost: 1000, tech: 0,
    effect: 'Gain a +1 bonus to hit with the weapon',
    hit: 1,
  },
  {
    id: 'extended_mag', label: 'EXTENDED MAG', skill: 'Fix-1', cost: 1000, tech: 0,
    effect: 'Doubles weapon mag size',
    // Ammunition is not tracked.
  },
  {
    id: 'heavy_sabot', label: 'HEAVY SABOT', skill: 'Fix-1', cost: 2000, tech: 0,
    effect: 'Allows Traumatic Hits on drones/vehicles',
    // The book's ! marker, which the trauma die already understands.
    vsVehicles: true,
  },
  {
    id: 'integral_toxins', label: 'INTEGRAL TOXINS', skill: 'Fix-2', cost: 10000, tech: 1,
    effect: 'Gain a +2 poison bonus to damage and Shock',
    damage: 2, shock: 2,
  },
  {
    id: 'onboard_gunlink', label: 'ONBOARD GUNLINK', skill: 'Fix-2', cost: 10000, tech: 1,
    effect: 'A gun emulates the Gunlink cybersystem',
    // Whatever the Gunlink itself grants, granted by the gun instead. Installing the
    // implant is how that reaches a sheet today, so this does not double it.
  },
  {
    id: 'predictive_guidance', label: 'PREDICTIVE GUIDANCE', skill: 'Fix-3', cost: 15000, tech: 2,
    effect: 'Gain a +1 bonus to hit, damage, and Shock',
    hit: 1, damage: 1, shock: 1,
  },
  {
    id: 'reel_wires', label: 'REEL WIRES', skill: 'Fix-1', cost: 2500, tech: 0,
    effect: 'Retrieves a thrown weapon as an On Turn act',
  },
  {
    id: 'savage_impact', label: 'SAVAGE IMPACT', skill: 'Fix-1', cost: 5000, tech: 0,
    effect: 'Gain a +1 bonus to damage and Shock',
    damage: 1, shock: 1,
  },
  {
    id: 'shock_burst', label: 'SHOCK BURST', skill: 'Fix-2', cost: 5000, tech: 0,
    effect: 'Once/fight, +2d6 electric damage, +2 Shock',
    // Once per fight, on its own action, and the book exempts it from the +3 cap. A
    // passive bonus is the one thing it is not, so it stays a note rather than becoming
    // damage on every swing.
  },
  {
    id: 'stun_rounds', label: 'STUN ROUNDS', skill: 'Fix-2', cost: 5000, tech: 0,
    effect: '-2 damage, half range, but non-lethal damage',
    damage: -2, noTrauma: true,
  },
  {
    id: 'thermal_charge', label: 'THERMAL CHARGE', skill: 'Fix-2', cost: 7500, tech: 0,
    effect: '+2 heat damage and Shock for two fights',
    damage: 2, shock: 2,
  },
];

const byId = (list) => Object.fromEntries(list.map((m) => [m.id, m]));
const ARMOR_BY_ID = byId(ARMOR_MODS);
const WEAPON_BY_ID = byId(WEAPON_MODS);

/** Parse a tag_list field, which stores a JSON array of ids. Anything else reads empty. */
const parseIds = (value) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const out = JSON.parse(value);
    return Array.isArray(out) ? out.map(String) : [];
  } catch {
    return [];
  }
};

const sum = (mods, key) => mods.reduce((t, m) => t + (Number(m[key]) || 0), 0);

/**
 * What a weapon's installed mods add up to.
 *
 * The book caps hit and damage: "no combination of mods can improve a weapon's hit or
 * damage bonus by more than +3". Applied per bonus rather than to their total, and only
 * to the improving direction - Stun Rounds' -2 damage is a cost the player accepted, not
 * something to clamp back up. Unknown ids are ignored rather than guessed at.
 */
const weaponModEffects = (value) => {
  const mods = parseIds(value).map((id) => WEAPON_BY_ID[id]).filter(Boolean);
  const cap = (n) => (n > WEAPON_BONUS_CAP ? WEAPON_BONUS_CAP : n);
  return {
    hit: cap(sum(mods, 'hit')),
    damage: cap(sum(mods, 'damage')),
    shock: sum(mods, 'shock'),
    vsVehicles: mods.some((m) => m.vsVehicles === true),
    noTrauma: mods.some((m) => m.noTrauma === true),
    installed: mods,
  };
};

/** What a suit's installed mods add up to. No cap: the book puts one on weapons only. */
const armorModEffects = (value) => {
  const mods = parseIds(value).map((id) => ARMOR_BY_ID[id]).filter(Boolean);
  return {
    soak: sum(mods, 'soak'),
    traumaTarget: sum(mods, 'traumaTarget'),
    rangedAc: sum(mods, 'rangedAc'),
    meleeAc: sum(mods, 'meleeAc'),
    installed: mods,
  };
};

module.exports = {
  ARMOR_MODS, WEAPON_MODS, ARMOR_BY_ID, WEAPON_BY_ID,
  WEAPON_BONUS_CAP, parseIds, weaponModEffects, armorModEffects,
};
