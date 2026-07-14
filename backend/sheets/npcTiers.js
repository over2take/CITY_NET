// Per-system NPC power tiers for GENERATE_SHEET.
//
// Every system defines its own tier vocabulary (CP:R uses Mook → Elite;
// a D&D template would use CR bands, CY_BORG something else). A tier is a
// complete seed package: sheet fields, token HP, and token DV/AC values.
// Numbers here are original tuning for this app, not book stat blocks.

const cprTier = ({ stats, combatSkills, utilitySkills, sp, hp, dv, weapons }) => {
  const data = {
    int: stats, ref: stats, dex: stats, tech: Math.max(2, stats - 2),
    cool: stats, will: stats, move: 4, body: stats,
    luck: 0, luck_max: 0,
    emp: Math.max(2, stats - 2), emp_max: Math.max(2, stats - 2),
    humanity: Math.max(2, stats - 2) * 10, humanity_max: Math.max(2, stats - 2) * 10,
    sp_head: sp.head, sp_head_max: sp.head,
    sp_body: sp.body, sp_body_max: sp.body,
    seriously_wounded: Math.ceil(hp / 2),
    death_save: stats,
  };
  ['handgun', 'brawling', 'evasion'].forEach((s) => { data[s] = combatSkills; });
  ['perception', 'athletics', 'stealth'].forEach((s) => { data[s] = utilitySkills; });
  if (combatSkills >= 4) {
    data.shoulder_arms = combatSkills;
    data.autofire = combatSkills - 1;
    data.melee_weapon = combatSkills - 1;
  }
  weapons.forEach((w, i) => {
    data[`weapon${i + 1}_name`] = w.name;
    data[`weapon${i + 1}_dmg`] = w.dmg;
    data[`weapon${i + 1}_skill`] = w.skill;
    data[`weapon${i + 1}_rof`] = w.rof ?? 2;
  });
  return { data, hp, dv };
};

const TIERS = {
  cyberpunk_red: {
    default: 'mook',
    options: [
      { id: 'mook', label: 'MOOK' },
      { id: 'skilled', label: 'SKILLED' },
      { id: 'pro', label: 'PRO' },
      { id: 'elite', label: 'ELITE' },
    ],
    build: {
      mook: () => cprTier({
        stats: 4, combatSkills: 2, utilitySkills: 2,
        sp: { head: 0, body: 4 }, hp: 20, dv: { melee: 10, ranged: 10 },
        weapons: [{ name: 'Pistol', dmg: '2d6', skill: 'handgun' }],
      }),
      skilled: () => cprTier({
        stats: 5, combatSkills: 3, utilitySkills: 2,
        sp: { head: 4, body: 7 }, hp: 30, dv: { melee: 12, ranged: 12 },
        weapons: [
          { name: 'Heavy Pistol', dmg: '3d6', skill: 'handgun' },
          { name: 'Knife', dmg: '1d6', skill: 'melee_weapon' },
        ],
      }),
      pro: () => cprTier({
        stats: 6, combatSkills: 4, utilitySkills: 3,
        sp: { head: 7, body: 11 }, hp: 35, dv: { melee: 13, ranged: 13 },
        weapons: [
          { name: 'Assault Rifle', dmg: '5d6', skill: 'shoulder_arms', rof: 1 },
          { name: 'Heavy Pistol', dmg: '3d6', skill: 'handgun' },
        ],
      }),
      elite: () => cprTier({
        stats: 8, combatSkills: 6, utilitySkills: 4,
        sp: { head: 11, body: 12 }, hp: 45, dv: { melee: 15, ranged: 15 },
        weapons: [
          { name: 'Assault Rifle', dmg: '5d6', skill: 'shoulder_arms', rof: 1 },
          { name: 'Monokatana', dmg: '3d6', skill: 'melee_weapon' },
        ],
      }),
    },
  },
};

const getTierOptions = (system) => TIERS[system]?.options ?? [];

// Returns { data, hp, dv } or null when the system has no tiers / unknown id.
const buildTier = (system, tierId) => {
  const t = TIERS[system];
  if (!t) return null;
  const id = t.build[tierId] ? tierId : t.default;
  return t.build[id] ? { tierId: id, ...t.build[id]() } : null;
};

module.exports = { TIERS, getTierOptions, buildTier };
