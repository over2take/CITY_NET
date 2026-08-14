const { cryptoRng } = require('../utils/random');

// CWN attack + stabilization resolution - pure functions, no I/O.
// Rules from the CWN Quick Reference Documents v2.2 (CC BY-NC 4.0, by 0frames).
//
// Attack flow (Cities Without Number):
//   to-hit: 1d20 + base hit bonus + combat skill + attribute mod + weapon atk.
//   Hit if total >= target AC (app-wide >= convention). Nothing explodes.
//   Damage: weapon dice (+flat) + attribute mod. No armor soak - AC already
//   priced the armor into the to-hit.
//   Trauma (optional rule, cwn_trauma setting): on a hit, roll the weapon's
//   trauma die; at or above the trauma rating the total damage is multiplied
//   by the rating.
//   Shock: on a MISS, a weapon with shock still deals its shock damage
//   (+attribute mod) if the target's AC is at or below the weapon's shock AC.
//
// Stabilization:
//   At 0 HP a PC is Mortally Wounded and dies after 6 rounds. An ally's Main
//   Action rolls Heal (2d6 + Heal + INT mod) vs DC 8 + rounds down (+2
//   without tools). Success: 1 HP and the Frail condition - while Frail,
//   hitting 0 HP again is instant death.

const rollEngine = require('./rollEngine');

const WEAPON_ROWS = 4;

/**
 * Vehicles a character sheet can carry, and weapon mounts on each.
 *
 * Mounts are named per vehicle — `vehicle1_weapon1_dmg` — so a mount belongs to its
 * vehicle rather than to a shared pool. That is what lets one resolver read both:
 * `getWeapon` takes the prefix, and `vehicle1_weapon` is as valid a prefix as `weapon`.
 */
const VEHICLE_ROWS = 3;
const VEHICLE_WEAPON_ROWS = 2;

/** Field prefix for the weapon mounts of vehicle `i`. */
const vehicleWeaponPrefix = (i) => `vehicle${Number(i)}_weapon`;
const MORTAL_WOUND_ROUNDS = 6;
const STABILIZE_BASE_DC = 8;
const NO_TOOLS_PENALTY = 2;

// Attack skills and the attribute mod each is pinned to.
const WEAPON_SKILLS = { shoot: 'dex_mod', stab: 'str_mod', punch: 'str_mod' };
const MELEE_SKILLS = ['stab', 'punch'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 'd8/x3' or 'd8/3' -> { die: 8, rating: 3 }; blank/invalid -> null.
const parseTrauma = (s) => {
  const m = String(s || '').trim().match(/^d(\d{1,3})\s*\/\s*x?(\d{1,2})$/i);
  if (!m) return null;
  const die = parseInt(m[1], 10);
  const rating = parseInt(m[2], 10);
  if (die < 2 || rating < 2) return null;
  return { die, rating };
};

// '2/13' or '2/AC13' -> { dmg: 2, ac: 13 }; blank/invalid -> null.
const parseShock = (s) => {
  const m = String(s || '').trim().match(/^(\d{1,2})\s*\/\s*(?:ac\s*)?(\d{1,2})$/i);
  if (!m) return null;
  return { dmg: parseInt(m[1], 10), ac: parseInt(m[2], 10) };
};

// Read and validate one structured weapon row off a sheet's data.
// Returns { name, dmg, skill, mod, atk, trauma, shock, attackType } or null.
/**
 * Read one weapon row off a sheet.
 *
 * `prefix` and `rows` exist so vehicle mounts resolve through this same function rather
 * than a copy of it. Personal weapons are `weapon1_*` out of four rows; a vehicle's
 * mounts are `vehicle1_weapon1_*` out of two. Nothing else about resolution differs, and
 * a second implementation would be free to drift from this one.
 */
const getWeapon = (data, index, opts = {}) => {
  const prefix = opts.prefix || 'weapon';
  const rows = opts.rows || WEAPON_ROWS;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 1 || i > rows) return null;
  const skill = String(data[`${prefix}${i}_skill`] || '');
  if (!WEAPON_SKILLS[skill]) return null;
  const dmg = String(data[`${prefix}${i}_dmg`] || '').trim();
  // Dice with an optional flat modifier (1d8, 1d8+1, 2d6-1). No @field
  // sneak-ins from the client.
  if (!/^\d+d\d+([+-]\d+)?$/i.test(dmg)) return null;
  return {
    name: String(data[`${prefix}${i}_name`] || '').trim() || `WEAPON ${i}`,
    dmg,
    skill,
    mod: WEAPON_SKILLS[skill],
    atk: num(data[`${prefix}${i}_atk`]),
    trauma: parseTrauma(data[`${prefix}${i}_trauma`]),
    shock: parseShock(data[`${prefix}${i}_shock`]),
    attackType: MELEE_SKILLS.includes(skill) ? 'melee' : 'ranged',
  };
};

/**
 * A weapon mounted on one of the sheet's vehicles, or null.
 *
 * Kept as its own entry point rather than leaving callers to build prefixes, so the
 * naming convention lives in one place.
 */
const getVehicleWeapon = (data, vehicleIndex, weaponIndex) => {
  const v = Number(vehicleIndex);
  if (!Number.isInteger(v) || v < 1 || v > VEHICLE_ROWS) return null;
  return getWeapon(data, weaponIndex, {
    prefix: vehicleWeaponPrefix(v),
    rows: VEHICLE_WEAPON_ROWS,
  });
};

const rollToHit = (data, weapon, rng = cryptoRng) => {
  let formula = `1d20 + @base_hit_bonus + @${weapon.skill} + @${weapon.mod}`;
  if (weapon.atk !== 0) formula += weapon.atk > 0 ? ` + ${weapon.atk}` : ` - ${Math.abs(weapon.atk)}`;
  const resolved = rollEngine.resolveFormula(formula, data);
  return rollEngine.executeRoll(resolved, 'sum', rng);
};

// Roll weapon damage: dice (+flat from the dmg string) + attribute mod.
const rollDamage = (data, weapon, rng = cryptoRng) => {
  const resolved = rollEngine.resolveFormula(`${weapon.dmg} + @${weapon.mod}`, data);
  return rollEngine.executeRoll(resolved, 'sum', rng);
};

// Trauma die (optional gritty rule). The die rolls against the DEFENDER's
// Trauma Target (default 6; cyber/armor can raise it) - the weapon's rating
// is the damage MULTIPLIER on a traumatic hit, not the threshold.
// Returns null when the weapon has no trauma or the rule is off; otherwise
// { die, rating, roll, tt, traumatic }.
const DEFAULT_TRAUMA_TARGET = 6;
const rollTrauma = (weapon, traumaEnabled, targetTT = DEFAULT_TRAUMA_TARGET, rng = cryptoRng) => {
  if (!traumaEnabled || !weapon.trauma) return null;
  const tt = num(targetTT) > 0 ? num(targetTT) : DEFAULT_TRAUMA_TARGET;
  const roll = Math.floor(rng() * weapon.trauma.die) + 1;
  return {
    die: weapon.trauma.die,
    rating: weapon.trauma.rating,
    roll,
    tt,
    traumatic: roll >= tt,
  };
};

// Shock on a miss: damage dealt anyway when the weapon's shock AC covers the
// target. Returns the damage (>=0) or 0 when shock doesn't apply.
const shockDamage = (data, weapon, targetAc) => {
  if (!weapon.shock) return 0;
  if (num(targetAc) > weapon.shock.ac) return 0;
  return Math.max(0, weapon.shock.dmg + num(data[weapon.mod]));
};

// Stabilization check: 2d6 + Heal + INT mod vs 8 + rounds down (+2 no tools).
// healSkill / intMod come back separately so the broadcast can show the
// player exactly what the server read off their sheet.
const rollStabilize = (data, roundsDown, noTools, rng = cryptoRng) => {
  const dc = STABILIZE_BASE_DC + Math.max(0, num(roundsDown)) + (noTools ? NO_TOOLS_PENALTY : 0);
  const resolved = rollEngine.resolveFormula('2d6 + @heal + @int_mod', data);
  const outcome = rollEngine.executeRoll(resolved, 'sum', rng);
  return {
    ...outcome, dc, success: outcome.total >= dc,
    healSkill: num(data.heal), intMod: num(data.int_mod),
  };
};

module.exports = {
  WEAPON_ROWS, WEAPON_SKILLS, MELEE_SKILLS,
  MORTAL_WOUND_ROUNDS, STABILIZE_BASE_DC, NO_TOOLS_PENALTY, DEFAULT_TRAUMA_TARGET,
  VEHICLE_ROWS, VEHICLE_WEAPON_ROWS, vehicleWeaponPrefix,
  parseTrauma, parseShock, getWeapon, getVehicleWeapon,
  rollToHit, rollDamage, rollTrauma, shockDamage, rollStabilize,
};
