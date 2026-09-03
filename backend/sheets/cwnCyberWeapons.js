// Cyberware you attack with (CWN p70).
//
// Some implants are weapons. Body Blades give a character an unarmed attack with its own
// damage, Shock and Trauma Die, and until now the sheet carried them as a name and a
// strain cost with no stats at all - so a character who had paid $25,000 and two points of
// System Strain for them attacked exactly as if they had not.
//
// They are resolved from the installed cyberware rather than copied into a weapon row.
// A weapon row is something a player types and can edit; this is a property of the chrome,
// so it appears when the piece is installed and goes when it is removed, and there is no
// second copy to fall out of step. It also means the four weapon rows stay the player's.
//
// Matched by name, which is how `strainCeiling` already finds the implants that change the
// System Strain maximum. Rows do not carry the catalogue id they came from; when they do,
// this and that should both move over to it.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The implants that are weapons, by the name the catalogue writes.
 *
 * `skills` is what the book allows the attack to be rolled with - Body Blades say "either
 * Stab or Punch", so the better of the two is used, the same way the Str/Dex weapons pick
 * the better attribute. `attr` follows the weapons table, where an unarmed attack is
 * Str/Dex.
 *
 * The book adds one rule worth stating: "The Punch skill does not add damage to Body
 * Blades attacks." Nothing to enforce - CWN damage is dice plus the attribute modifier and
 * the skill was never part of it - but it is the sort of line that invites a special case,
 * so it is written down as already true.
 */
const CYBER_WEAPONS = {
  'body blades i': {
    label: 'Body Blades I',
    dmg: '1d8',
    shock: { dmg: 2, ac: 15 },
    trauma: { die: 8, rating: 3, vsVehicles: false },
    skills: ['stab', 'punch'],
    attr: 'str_dex',
  },
  'body blades ii': {
    label: 'Body Blades II',
    dmg: '2d6',
    shock: { dmg: 4, ac: 15 },
    trauma: { die: 10, rating: 3, vsVehicles: false },
    skills: ['stab', 'punch'],
    attr: 'str_dex',
  },
};

/** Rows as stored on a sheet, defensively - the field is free-form JSON. */
const rowsOf = (data) => {
  const value = data && data.cyberware;
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object');
};

/** Installed, placed, and a weapon. Anything else is not something you can swing. */
const isArmed = (row) => Boolean(
  row && row.equipped && row.placed
  && Object.prototype.hasOwnProperty.call(CYBER_WEAPONS, String(row.name || '').trim().toLowerCase()),
);

/**
 * Which of the allowed skills this character is actually best with.
 *
 * The book offers a choice and a player would take the better one every time, so it is
 * resolved against the sheet rather than asked for - the same call the Str/Dex weapons
 * make. Ties keep the book's print order.
 */
const bestSkill = (data, skills) =>
  skills.reduce((best, s) => (num(data[s]) > num(data[best]) ? s : best), skills[0]);

/** Every cyber weapon a character currently has, in sheet order. */
const list = (data) => rowsOf(data).filter(isArmed);

/**
 * One cyber weapon, in the shape the attack resolver expects.
 *
 * `index` is 1-based over the installed cyber weapons, not over the cyberware list, so it
 * does not shift when unrelated chrome is added above it.
 */
const getCyberWeapon = (data, index, attackCwn) => {
  const i = Number(index);
  const armed = list(data);
  if (!Number.isInteger(i) || i < 1 || i > armed.length) return null;
  const row = armed[i - 1];
  const spec = CYBER_WEAPONS[String(row.name).trim().toLowerCase()];
  const skill = bestSkill(data, spec.skills);
  return {
    name: spec.label,
    dmg: spec.dmg,
    skill,
    mod: attackCwn.weaponAttr(data, spec.attr, skill),
    atk: 0,
    trauma: { ...spec.trauma },
    shock: { ...spec.shock },
    dmgBonus: 0,
    mods: [],
    // Body weaponry is melee, whichever of the two skills it is rolled with.
    attackType: 'melee',
    // Marks it as chrome rather than a weapon row, for anything that needs to tell them
    // apart - the attack history says so, and mods for gear must not apply to it.
    cyber: true,
  };
};

module.exports = { CYBER_WEAPONS, list, getCyberWeapon, isArmed, bestSkill };
