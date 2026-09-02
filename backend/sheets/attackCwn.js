const { cryptoRng } = require('../utils/random');

// CWN attack + stabilization resolution - pure functions, no I/O.
// Rules from the CWN Quick Reference Documents v2.2 (CC BY-NC 4.0, by 0frames).
//
// Attack flow (Cities Without Number):
//   to-hit: 1d20 + base hit bonus + combat skill + attribute mod + weapon atk.
//   Hit if total >= target AC (app-wide >= convention). Nothing explodes.
//   Damage: weapon dice (+flat) + attribute mod, then the target's armor Damage Soak
//   takes the first points of it. Soak is a pool of temporary hit points that refills
//   each scene, not a reduction and not part of AC - this used to say AC had already
//   priced the armor in, which is a different rule and meant armored characters were
//   over-damaged on every hit.
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
const vehicleSeats = require('./vehicleSeats');

const WEAPON_ROWS = 4;

/**
 * Vehicles a character sheet can carry, and weapon mounts on each.
 *
 * Mounts are named per vehicle — `vehicle1_weapon1_dmg` — so a mount belongs to its
 * vehicle rather than to a shared pool. That is what lets one resolver read both:
 * `getWeapon` takes the prefix, and `vehicle1_weapon` is as valid a prefix as `weapon`.
 *
 * VEHICLE_ROWS must match CWN_VEHICLE_ROWS in the frontend template: the sheet declares
 * that many vehicles and this decides how many can have their mounts fired. A test pins
 * the pair, because the sheet showing a vehicle whose guns do not work would look like
 * a broken weapon rather than a mismatched constant.
 */
const VEHICLE_ROWS = 6;
const VEHICLE_WEAPON_ROWS = 3;

/** Field prefix for the weapon mounts of vehicle `i`. */
const vehicleWeaponPrefix = (i) => `vehicle${Number(i)}_weapon`;
const MORTAL_WOUND_ROUNDS = 6;
const STABILIZE_BASE_DC = 8;
const NO_TOOLS_PENALTY = 2;

// Attack skills and the attribute mod each falls back to.
//
// This is a default, not the rule. The book gives every weapon its own Attr. column
// (p54: "Attr is the attribute that modifies the weapon's hit and damage roll") and it
// does not always follow from the skill - a Mortar is a Shoot weapon that fires off Wis,
// and a Knife is a Stab weapon the book lets you swing with Dex. A weapon that names its
// attribute uses that; one that names none keeps the skill's, which is what every sheet
// written before the column existed relies on.
const WEAPON_SKILLS = { shoot: 'dex_mod', stab: 'str_mod', punch: 'str_mod' };

/**
 * The Attr. column, as the fields it can resolve to.
 *
 * A pair means "use whichever one has the better modifier" (p54), which is a choice the
 * player would make every time and so is not worth asking them for. An empty list is the
 * book's dash: a demo charge or a land mine has no attribute behind it.
 */
const WEAPON_ATTRS = {
  str: ['str_mod'],
  dex: ['dex_mod'],
  str_dex: ['str_mod', 'dex_mod'],
  wis: ['wis_mod'],
  none: [],
};

/**
 * Which attribute field a weapon actually rolls with, or null for none at all.
 *
 * Resolved against the sheet rather than stored, so a character whose Str overtakes their
 * Dex starts swinging their knife with it without anyone editing the weapon.
 */
const weaponAttr = (data, choice, skill) => {
  const key = String(choice || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(WEAPON_ATTRS, key)) return WEAPON_SKILLS[skill] || null;
  const fields = WEAPON_ATTRS[key];
  if (fields.length === 0) return null;
  // Ties keep the first, which is the order the book prints the pair in.
  return fields.reduce((best, f) => (num(data[f]) > num(data[best]) ? f : best), fields[0]);
};
const MELEE_SKILLS = ['stab', 'punch'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 'd8/x3' or 'd8/3' -> { die: 8, rating: 3 }; blank/invalid -> null.
//
// A trailing '!' is the book's marker for a weapon whose Trauma Die can inflict Traumatic
// Hits on vehicles and drones. Without it the die still works on people and does nothing
// to a car, so it is carried through rather than discarded.
const parseTrauma = (s) => {
  const m = String(s || '').trim().match(/^d(\d{1,3})\s*\/\s*x?(\d{1,2})\s*(!?)$/i);
  if (!m) return null;
  const die = parseInt(m[1], 10);
  const rating = parseInt(m[2], 10);
  if (die < 2 || rating < 2) return null;
  return { die, rating, vsVehicles: m[3] === '!' };
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
 * Vehicle combat.
 *
 * Encoded here rather than left to the table because it is arithmetic, and because the AC
 * rule in particular is easy to get backwards: the moving bonus scales with the driver
 * while the stationary penalty is flat.
 */

/** A stationary vehicle is easier to hit than its own base AC suggests. */
const VEHICLE_STATIONARY_AC_PENALTY = -4;

/** Firing a personal weapon out of a moving vehicle. */
const MOVING_FIRE_PENALTY = -4;

/**
 * The AC an attacker must beat to hit a vehicle.
 *
 * Moving, it adds the Drive skill of whoever is driving — a vehicle is only as hard to
 * hit as its driver is good. Stationary, it takes a flat penalty instead. Note the two
 * are not symmetric: the bonus scales with the driver and the penalty does not.
 */
const vehicleAc = (baseAc, opts = {}) => {
  const base = num(baseAc);
  if (!opts.moving) return base + VEHICLE_STATIONARY_AC_PENALTY;
  return base + num(opts.driveSkill);
};

/**
 * Damage a vehicle actually takes after its Armour Rating.
 *
 * AR is *subtraction*, which is the thing that makes vehicle armour different in kind
 * from personal armour: AC decides whether the hit lands at all, AR decides how much of
 * a landed hit gets through. Applying one where the other belongs is the likeliest
 * mistake in this whole subsystem.
 *
 * Floors at zero — armour can absorb a hit entirely.
 */
const applyArmorRating = (damage, armorRating) => Math.max(0, num(damage) - num(armorRating));

/**
 * Damage Soak: the armour spends its own hit points before the wearer does.
 *
 * Not armour reduction and not part of AC. AC decides whether a blow lands; soak is a pool
 * that takes the first points of what lands, and it refills at the start of a scene rather
 * than per hit. This file used to say the opposite - that AC had already priced the armour
 * in - which meant an armoured character was over-damaged on every hit, by up to fifteen
 * points a scene in a heavy suit.
 *
 * Vehicle Armour Rating above is the other thing entirely: that subtracts from every hit
 * and never runs out. A pool that empties and a reduction that does not are easy to confuse
 * and behave nothing alike, which is why they are separate functions rather than one with
 * a flag.
 */
const applySoak = (damage, soak) => {
  const dmg = Math.max(0, num(damage));
  const pool = Math.max(0, num(soak));
  const absorbed = Math.min(pool, dmg);
  return { absorbed, through: dmg - absorbed, soakLeft: pool - absorbed };
};

/** True once a vehicle has taken enough to be destroyed. */
const vehicleDestroyed = (hpCurrent) => num(hpCurrent) <= 0;

/**
 * Where a character is: on foot, in one of their own vehicles, or riding in someone
 * else's.
 *
 * `null` means on foot, and every unreadable state resolves to it — an out-of-range
 * index, a ride with no owner named, a reference to a player who has since gone. That
 * direction matters: falling back to on foot means the character is attacked exactly as
 * they were before any of this existed, so a broken reference costs them cover rather
 * than making them unhittable.
 */
const readOccupancy = (data) => {
  const raw = String(data?.in_vehicle ?? '').trim();
  if (!raw) return null;
  const seat = String(data?.vehicle_seat ?? '').trim().toLowerCase();
  const inRange = (i) => Number.isInteger(i) && i >= 1 && i <= VEHICLE_ROWS;

  if (raw === 'ride') {
    const owner = String(data?.ride_owner ?? '').trim();
    const index = Number(data?.ride_vehicle);
    if (!owner || !inRange(index)) return null;
    return { owner, vehicleIndex: index, seat };
  }
  const own = /^own:(\d+)$/.exec(raw);
  if (!own) return null;
  const index = Number(own[1]);
  if (!inRange(index)) return null;
  // No owner: the vehicle is on this same sheet, so the caller needs no second lookup.
  return { owner: null, vehicleIndex: index, seat };
};

/**
 * The vehicle a character is riding in, read off whichever sheet holds it.
 *
 * Whether it is moving is read from the vehicle too, so everyone aboard agrees.
 *
 * A vehicle with no HP maximum is not a vehicle yet — a half-filled row should not start
 * soaking damage on its owner's behalf, so it resolves to `null` and the occupant is
 * attacked normally.
 */
const getVehicle = (ownerData, index) => {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 1 || i > VEHICLE_ROWS) return null;
  const hpMax = num(ownerData?.[`vehicle${i}_hp_max`]);
  if (hpMax <= 0) return null;
  // Movement belongs to the vehicle, not to each person in it: two occupants declaring
  // it separately could disagree, and it is an eight point swing in the vehicle's AC.
  const moving = !!num(ownerData?.[`vehicle${i}_moving`]);
  const raw = ownerData?.[`vehicle${i}_hp`];
  // Blank current HP means undamaged, matching how token HP is read.
  const hp = raw === undefined || raw === null || raw === '' ? hpMax : num(raw);
  return {
    index: i,
    name: String(ownerData?.[`vehicle${i}_name`] ?? '').trim() || `VEHICLE ${i}`,
    hp,
    hpMax,
    hpField: `vehicle${i}_hp`,
    armorRating: num(ownerData?.[`vehicle${i}_armor`]),
    // The vehicle's own Trauma Target, not that of whoever is sitting in it.
    traumaTarget: num(ownerData?.[`vehicle${i}_tt`]) || DEFAULT_TRAUMA_TARGET,
    ac: vehicleAc(ownerData?.[`vehicle${i}_ac`], {
      moving,
      // Drive is the driver's skill; the owner is presumed to be driving, which is who
      // the AC is read from anyway.
      driveSkill: num(ownerData?.drive),
    }),
    moving,
    // Already wrecked: it stops being cover rather than absorbing forever.
    destroyed: vehicleDestroyed(hp),
  };
};

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
    mod: weaponAttr(data, data[`${prefix}${i}_attr`], skill),
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
  // Hardpoints are how many Heavy weapons the vehicle mounts in its factory
  // configuration, so they bound the mounts rather than the sheet's row count doing it: a
  // motorcycle has none and must not be offered a gun it cannot carry.
  const hardpoints = Math.min(vehicleSeats.hardpointsOf(data, v), VEHICLE_WEAPON_ROWS);
  if (hardpoints <= 0) return null;
  return getWeapon(data, weaponIndex, {
    prefix: vehicleWeaponPrefix(v),
    rows: hardpoints,
  });
};

/**
 * `opts.penalty` is a flat situational modifier — firing out of a moving vehicle is the
 * only one so far. It sits outside the weapon because it belongs to the circumstance
 * rather than to the gun: the same weapon fired from a parked car takes none of it.
 */
const rollToHit = (data, weapon, rng = cryptoRng, opts = {}) => {
  // A weapon with no attribute behind it (a land mine, a demo charge) adds no term at
  // all rather than adding a zero, so the breakdown does not claim a modifier it has not
  // got.
  let formula = `1d20 + @base_hit_bonus + @${weapon.skill}`;
  if (weapon.mod) formula += ` + @${weapon.mod}`;
  if (weapon.atk !== 0) formula += weapon.atk > 0 ? ` + ${weapon.atk}` : ` - ${Math.abs(weapon.atk)}`;
  const penalty = num(opts.penalty);
  if (penalty !== 0) formula += penalty > 0 ? ` + ${penalty}` : ` - ${Math.abs(penalty)}`;
  const resolved = rollEngine.resolveFormula(formula, data);
  return rollEngine.executeRoll(resolved, 'sum', rng);
};

// Roll weapon damage: dice (+flat from the dmg string) + attribute mod.
const rollDamage = (data, weapon, rng = cryptoRng) => {
  const formula = weapon.mod ? `${weapon.dmg} + @${weapon.mod}` : weapon.dmg;
  const resolved = rollEngine.resolveFormula(formula, data);
  return rollEngine.executeRoll(resolved, 'sum', rng);
};

// Trauma die (optional gritty rule). The die rolls against the DEFENDER's
// Trauma Target (default 6; cyber/armor can raise it) - the weapon's rating
// is the damage MULTIPLIER on a traumatic hit, not the threshold.
// Returns null when the weapon has no trauma or the rule is off; otherwise
// { die, rating, roll, tt, traumatic }.
const DEFAULT_TRAUMA_TARGET = 6;
const rollTrauma = (weapon, traumaEnabled, targetTT = DEFAULT_TRAUMA_TARGET, rng = cryptoRng, opts = {}) => {
  if (!traumaEnabled || !weapon.trauma) return null;
  // Only weapons the book marks with ! can traumatise a machine. A pistol's trauma die is
  // devastating to a person and does nothing at all to a car.
  if (opts.vsVehicle && !weapon.trauma.vsVehicles) return null;
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
  // p54: Shock is modified by the weapon's attribute too, not only hit and damage.
  return Math.max(0, weapon.shock.dmg + (weapon.mod ? num(data[weapon.mod]) : 0));
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
  applySoak,
  WEAPON_ROWS, WEAPON_SKILLS, MELEE_SKILLS, WEAPON_ATTRS, weaponAttr,
  MORTAL_WOUND_ROUNDS, STABILIZE_BASE_DC, NO_TOOLS_PENALTY, DEFAULT_TRAUMA_TARGET,
  VEHICLE_ROWS, VEHICLE_WEAPON_ROWS, vehicleWeaponPrefix,
  VEHICLE_STATIONARY_AC_PENALTY, MOVING_FIRE_PENALTY,
  vehicleAc, applyArmorRating, vehicleDestroyed,
  readOccupancy, getVehicle,
  parseTrauma, parseShock, getWeapon, getVehicleWeapon,
  rollToHit, rollDamage, rollTrauma, shockDamage, rollStabilize,
};
