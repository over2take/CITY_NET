// SR6 attack resolution - pure functions, no I/O.
//
// Attack flow (Shadowrun 6E, slimmed):
//   Attack pool: attribute (AGI) + weapon skill + weapon atk bonus, rolled
//   as a d6 pool - 5s and 6s are hits, glitch when half+ show 1.
//   The defender's dodge pool (REA+INT) is NOT auto-rolled; the GM applies
//   net hits at the table. A pool result with 0 hits is always a miss.
//   AR vs Defense Rating: weapon Attack Rating compared to the defender's
//   Armor Rating (stored in the token's melee_ac slot):
//     AR > armor -> +1 DV;  AR < armor -> -1 DV;  equal -> +0.
//   Damage: weapon DV (number part) + the AR modifier. Net hits and the
//   soak roll (BOD + armor) are adjudicated manually - the broadcast shows
//   the potential DV so the GM can apply soak.

const rollEngine = require('./rollEngine');

const WEAPON_ROWS = 4;

// Attack skills and the attribute each pool is built on.
const WEAPON_SKILLS = { firearms: 'agility', close_combat: 'agility', exotic_weapons: 'agility' };
const MELEE_SKILLS = ['close_combat'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// '3P', '5S', or plain '4' -> { value: 3, track: 'P' | 'S' }; invalid -> null.
const parseDv = (s) => {
  const m = String(s || '').trim().match(/^(\d{1,2})\s*([PS])?$/i);
  if (!m) return null;
  return { value: parseInt(m[1], 10), track: (m[2] || 'P').toUpperCase() };
};

// Read and validate one structured weapon row off a sheet's data.
// Returns { name, dv, ar, skill, attr, atk, attackType } or null.
const getWeapon = (data, index) => {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 1 || i > WEAPON_ROWS) return null;
  const skill = String(data[`weapon${i}_skill`] || '');
  if (!WEAPON_SKILLS[skill]) return null;
  const dv = parseDv(data[`weapon${i}_dv`]);
  if (!dv) return null;
  return {
    name: String(data[`weapon${i}_name`] || '').trim() || `WEAPON ${i}`,
    dv,
    ar: num(data[`weapon${i}_ar`]),
    skill,
    attr: WEAPON_SKILLS[skill],
    atk: num(data[`weapon${i}_atk`]),
    attackType: MELEE_SKILLS.includes(skill) ? 'melee' : 'ranged',
  };
};

// Roll the attack pool: attribute + skill (+flat weapon dice).
const rollAttack = (data, weapon, rng = Math.random) => {
  let formula = `pool:@${weapon.attr}+@${weapon.skill}`;
  if (weapon.atk !== 0) formula += weapon.atk > 0 ? `+${weapon.atk}` : `-${Math.abs(weapon.atk)}`;
  const resolved = rollEngine.resolveFormula(formula, data, { allowNoDice: true });
  return rollEngine.executeRoll(resolved, 'pool', rng);
};

// Defense pool: REA + INT (SR6 dodge). Rolled automatically when the
// defender has a sheet; tokens without one don't defend (0 hits).
// Returns null when the sheet has neither attribute set - a bare NPC sheet
// shouldn't roll a 1-die floor pool it was never given.
const rollDefense = (data, rng = Math.random) => {
  const rea = Number(data.reaction);
  const int = Number(data.intuition);
  if (!Number.isFinite(rea) && !Number.isFinite(int)) return null;
  const resolved = rollEngine.resolveFormula('pool:@reaction+@intuition', data, { allowNoDice: true });
  return rollEngine.executeRoll(resolved, 'pool', rng);
};

// AR vs the defender's Armor Rating -> DV modifier.
const arDvMod = (weapon, targetArmorRating) => {
  const armor = num(targetArmorRating);
  if (weapon.ar > armor) return 1;
  if (weapon.ar < armor) return -1;
  return 0;
};

// Potential damage on a hit: weapon DV + AR modifier + net hits over the
// defense (SR6: net hits amp the DV). Soak stays manual.
const finalDamage = (weapon, dvMod, netHits = 0) =>
  Math.max(0, weapon.dv.value + dvMod + Math.max(0, netHits));

module.exports = {
  WEAPON_ROWS, WEAPON_SKILLS, MELEE_SKILLS,
  parseDv, getWeapon, rollAttack, rollDefense, arDvMod, finalDamage,
};
