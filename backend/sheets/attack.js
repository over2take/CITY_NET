// CP:R attack + death-save resolution - pure functions, no I/O.
//
// Attack flow (Cyberpunk RED):
//   to-hit: 1d10 (exploding check die) + STAT + skill level, -8 if aimed.
//   Hit if total >= target DV (matches the app-wide >= convention).
//   Damage: weapon dice (e.g. 3d6). Target SP soaks; only damage that gets
//   through armor counts, and a penetrated location ablates -1 SP.
//   Aimed shots strike the head: soak vs SP HEAD, damage through is doubled.
//
// Death saves:
//   At 0 HP or less, roll 1d10 + penalty; survive if the total is <= BODY.
//   A natural 10 always fails. The penalty starts at 0 and rises +1 per
//   attempt until the character is stabilized/healed above 0 HP.

const rollEngine = require('./rollEngine');
const { CPR_SKILLS } = require('./rolls');

const AIMED_PENALTY = 8;

// Weapon skills allowed on the structured weapon rows, split by attack type.
const MELEE_SKILLS = ['brawling', 'martial_arts', 'melee_weapon'];
const RANGED_SKILLS = ['handgun', 'shoulder_arms', 'heavy_weapons', 'autofire', 'archery'];
const WEAPON_SKILLS = [...MELEE_SKILLS, ...RANGED_SKILLS];

const WEAPON_ROWS = 4;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Read and validate one structured weapon row off a sheet's data.
// Returns { name, dmg, skill, attackType } or null if the row is unusable.
const getWeapon = (data, index) => {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 1 || i > WEAPON_ROWS) return null;
  const skill = String(data[`weapon${i}_skill`] || '');
  if (!WEAPON_SKILLS.includes(skill)) return null;
  const dmg = String(data[`weapon${i}_dmg`] || '').trim();
  // Damage must be pure dice (no @field or flat sneak-ins from the client).
  if (!/^\d+d\d+$/i.test(dmg)) return null;
  return {
    name: String(data[`weapon${i}_name`] || '').trim() || `WEAPON ${i}`,
    dmg,
    skill,
    attackType: MELEE_SKILLS.includes(skill) ? 'melee' : 'ranged',
  };
};

// Situational check modifiers, applied server-side to every CP:R check:
//  - armor penalty: heavy armor's stat penalty hits REF/DEX-keyed checks
//  - wounded: -2 while Seriously Wounded (0 < HP <= threshold), -4 at 0 HP
// Returns [{ label, value }] entries ready for a resolved formula.
const checkPenalties = (data, stat, hp) => {
  const mods = [];
  const armor = num(data.armor_penalty);
  if (armor > 0 && (stat === 'ref' || stat === 'dex')) {
    mods.push({ label: 'armor', value: -armor });
  }
  const threshold = num(data.seriously_wounded);
  if (hp !== null && hp !== undefined) {
    if (hp <= 0) mods.push({ label: 'mortally wounded', value: -4 });
    else if (threshold > 0 && hp <= threshold) mods.push({ label: 'wounded', value: -2 });
  }
  return mods;
};

// Roll the to-hit check. Returns rollEngine outcome plus the aimed modifier
// already folded into total/modTotal.
// opts: { luck: declared LUCK bonus (flat +luck),
//         noFumble: nat-1 is not a critical failure (dedicated 1-LUCK burn,
//                   or the house-rule that any LUCK spend negates fumbles),
//         hp: attacker's current token HP (wound penalties) }
const rollToHit = (data, weapon, aimed, rng = Math.random, opts = {}) => {
  const stat = (CPR_SKILLS[weapon.skill] || [null, 'ref'])[1];
  let formula = `1d10 + @${stat} + @${weapon.skill}`;
  if (aimed) formula += ` - ${AIMED_PENALTY}`;
  const resolved = rollEngine.resolveFormula(formula, data);
  const luck = Math.max(0, num(opts.luck));
  if (luck > 0) resolved.modifiers.push({ label: 'luck', value: luck });
  resolved.modifiers.push(...checkPenalties(data, stat, opts.hp));
  return rollEngine.executeRoll(resolved, 'explode10', rng, { noFumble: !!opts.noFumble });
};

// How much LUCK a declared spend actually costs, honoring the pool:
// the fumble-shield burn (1 pip, no bonus) is paid first, the flat bonus is
// clamped to what remains. Returns { bonus, negate, total }.
const resolveLuckSpend = (pool, wantBonus, wantNegate) => {
  const cur = Math.max(0, num(pool));
  const negate = !!wantNegate && cur >= 1;
  const bonus = Math.max(0, Math.min(num(wantBonus), cur - (negate ? 1 : 0)));
  return { bonus, negate, total: bonus + (negate ? 1 : 0) };
};

// Roll weapon damage (plain sum, no explosion).
const rollDamage = (weapon, rng = Math.random) => {
  const resolved = rollEngine.resolveFormula(weapon.dmg, {});
  return rollEngine.executeRoll(resolved, 'sum', rng);
};

// Soak damage with armor. Only damage that beats SP gets through; a
// penetrated location ablates 1 SP. Head hits double the damage through.
const applyArmor = (damage, sp, aimed) => {
  const soaked = Math.max(0, num(sp));
  const raw = Math.max(0, damage - soaked);
  const through = aimed ? raw * 2 : raw;
  return { through, ablated: raw > 0 };
};

// Shield intercepts first: its points absorb the roll, overflow passes on to
// normal SP soak. Returns the shield's new value and the overflow damage.
const applyShield = (damage, shield) => {
  const points = Math.max(0, num(shield));
  if (points <= 0) return { absorbed: 0, remaining: damage, newShield: 0, destroyed: false };
  const absorbed = Math.min(points, damage);
  return {
    absorbed,
    remaining: damage - absorbed,
    newShield: points - absorbed,
    destroyed: absorbed >= points,
  };
};

// CP:R critical injury: two or more damage dice landing on their maximum
// face. Deals bonus damage that ignores armor; the GM rolls the actual
// injury on the book's table (never embedded here - licensing).
const CRIT_BONUS_DAMAGE = 5;
const isCriticalInjury = (rolls) =>
  Object.entries(rolls || {}).reduce(
    (n, [sides, values]) => n + values.filter(v => v === Number(sides)).length,
    0
  ) >= 2;

// Static melee DV from a sheet, stamped onto the token at sheet
// generation/attach; the GM can override it any time via EDIT_DV.
//   default:  6 + DEX + Evasion (average-roll equivalent of the RAW opposed
//             Evasion contest)
//   take-10: 10 + DEX + Evasion (harder melee defense - the 'take 10'
//             variant, toggled in ADMIN > TTRPG_SYSTEM)
const staticMeleeDv = (data, takeTen = false) =>
  (takeTen ? 10 : 6) + num(data.dex) + num(data.evasion);

// Death save: 1d10 + penalty vs BODY, natural 10 always fails.
const rollDeathSave = (body, penalty, rng = Math.random) => {
  const die = Math.floor(rng() * 10) + 1;
  const total = die + Math.max(0, num(penalty));
  const success = die !== 10 && total <= num(body);
  return { die, penalty: Math.max(0, num(penalty)), total, success };
};

module.exports = {
  AIMED_PENALTY, WEAPON_ROWS, MELEE_SKILLS, RANGED_SKILLS, WEAPON_SKILLS, CRIT_BONUS_DAMAGE,
  getWeapon, rollToHit, rollDamage, applyArmor, applyShield, isCriticalInjury, rollDeathSave,
  staticMeleeDv, checkPenalties, resolveLuckSpend,
};
