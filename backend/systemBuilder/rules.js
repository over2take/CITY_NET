// Code-backed rule values: what a formula cannot say, given a name a formula can use.
//
// Most of a system is arithmetic on sheet fields, and that is data. A few values need to read
// something no formula can - a list of installed armor mods, the modifiers on every fitted
// implant, a JSON list of adept powers. Those are written once, here, in code that is reviewed
// like any other, and a system definition names the ones it uses: `$cwn_move_bonus` in a
// formula is the value of that entry.
//
// This is the start of the plan's Rule library. A GM picks from it; they never add to it. The
// list grows when a GM asks for something new and it gets written here.

const gearMods = require('../sheets/cwnGearMods');
const { cwnMoveBonus } = require('../sheets/templates');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const RULES = {
  /** CWN: what the suit's installed mods add to its Trauma Target (p58). */
  cwn_armor_trauma: {
    describe: "Trauma Target added by the armor's installed mods",
    value: (data) => gearMods.armorModEffects(data.armor_mods).traumaTarget,
  },
  /** CWN: what the suit's installed mods add to its Damage Soak (p58). */
  cwn_armor_soak: {
    describe: "Damage Soak added by the armor's installed mods",
    value: (data) => gearMods.armorModEffects(data.armor_mods).soak,
  },
  /** CWN: meters of Move granted by fitted, equipped chrome (Coordination Augment II). */
  cwn_move_bonus: {
    describe: 'Move added by installed cyberware',
    value: (data) => cwnMoveBonus(data),
  },
  /** SR6: Power Points spent on adept powers, to two decimal places. */
  sr6_power_points_spent: {
    describe: 'Power Points spent on adept powers',
    value: (data) => {
      let spent = 0;
      try {
        const powers = JSON.parse(data.adept_powers || '[]');
        if (Array.isArray(powers)) {
          spent = powers.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
          spent = Math.round(spent * 100) / 100;
        }
      } catch { /* an unreadable list spends nothing */ }
      return spent;
    },
  },
};

/** The value of rule `name` for this sheet, as a finite number. Unknown names are 0. */
const ruleValue = (name, data) => {
  const rule = Object.prototype.hasOwnProperty.call(RULES, name) ? RULES[name] : null;
  return rule ? num(rule.value(data || {})) : 0;
};

const hasRule = (name) => Object.prototype.hasOwnProperty.call(RULES, name);

module.exports = { RULES, ruleValue, hasRule };
