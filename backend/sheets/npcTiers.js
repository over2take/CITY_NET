// Per-system NPC power tiers for GENERATE_SHEET.
//
// Every system defines its own tier vocabulary (CP:R uses Mook to Elite;
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

// CWN NPC tier builder.
// attack_mod = hit dice (CWN rule). Skills = flat level applied to core combat
// skills. Weapon rows use the condensed 6-field shape (name/dmg/skill/trauma/
// shock/atk) matching CWN_WEAPON_COLUMNS in the frontend template.
const cwnTier = ({ hd, hp, ac, skills, weapons }) => {
  const data = {
    level: hd,
    base_hit_bonus: hd,
    ac,
    // Str 12 (mod 0) as baseline — most NPCs don't have meaningful social stats
    str: 12, str_mod: 0, dex: 12, dex_mod: 0, con: 12, con_mod: 0,
    int: 10, int_mod: 0, wis: 10, wis_mod: 0, cha: 10, cha_mod: 0,
    system_strain: 0, system_strain_max: 12,
    // Saves derived: 16 - (hd + 0 mod) by default
    save_physical: 16 - hd,
    save_evasion: 16 - hd,
    save_mental: 16 - hd,
    save_luck: 16 - hd,
    frail: 0, auto_initiative: 0,
    trauma_target: 6,
  };
  // Core combat skills at the tier's skill level
  ['punch', 'shoot', 'stab', 'notice', 'sneak', 'survive'].forEach((s) => { data[s] = skills; });
  // Weapon rows (6 fields each: name/dmg/skill/trauma/shock/atk)
  weapons.forEach((w, i) => {
    const n = i + 1;
    data[`weapon${n}_name`] = w.name;
    data[`weapon${n}_dmg`] = w.dmg;
    data[`weapon${n}_skill`] = w.skill;
    data[`weapon${n}_trauma`] = w.trauma ?? '';
    data[`weapon${n}_shock`] = w.shock ?? '';
    data[`weapon${n}_atk`] = w.atk ?? 0;
  });
  return { data, hp, dv: { melee: ac, ranged: ac } };
};

// Spirit tier builder (Deluxe edition). Spirits are NPCs; reusing cwnTier
// with spirit-appropriate stats means GENERATE_SHEET works for free.
const spiritTier = ({ hd, hp, ac }) =>
  cwnTier({
    hd, hp, ac, skills: Math.floor(hd / 3),
    weapons: [{ name: 'Spirit Strike', dmg: `${hd}d6`, skill: 'punch', trauma: '', shock: '' }],
  });

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
  cities_without_number: {
    default: 'mook',
    options: [
      { id: 'mook',          label: 'MOOK' },
      { id: 'skilled',       label: 'SKILLED' },
      { id: 'veteran',       label: 'VETERAN' },
      { id: 'elite',         label: 'ELITE' },
      { id: 'lesser_spirit', label: 'LESSER SPIRIT' },
      { id: 'spirit',        label: 'SPIRIT' },
      { id: 'greater_spirit',label: 'GREATER SPIRIT' },
    ],
    build: {
      mook: () => cwnTier({
        hd: 1, hp: 5, ac: 10, skills: 0,
        weapons: [{ name: 'Pistol', dmg: '1d6', skill: 'shoot', shock: '1/10', trauma: '' }],
      }),
      skilled: () => cwnTier({
        hd: 3, hp: 15, ac: 13, skills: 1,
        weapons: [
          { name: 'Rifle', dmg: '1d10', skill: 'shoot', trauma: 'd6/x2', shock: '' },
          { name: 'Knife', dmg: '1d6', skill: 'stab', shock: '1/13', trauma: '' },
        ],
      }),
      veteran: () => cwnTier({
        hd: 6, hp: 30, ac: 15, skills: 2,
        weapons: [
          { name: 'Assault Rifle', dmg: '1d10+1', skill: 'shoot', trauma: 'd8/x3', shock: '' },
          { name: 'Combat Blade', dmg: '1d8', skill: 'stab', shock: '3/15', trauma: '' },
        ],
      }),
      elite: () => cwnTier({
        hd: 10, hp: 50, ac: 18, skills: 3,
        weapons: [
          { name: 'Sniper Rifle', dmg: '2d8', skill: 'shoot', trauma: 'd10/x3', shock: '' },
          { name: 'Monoblade', dmg: '1d10', skill: 'stab', shock: '5/18', trauma: 'd6/x2' },
        ],
      }),
      lesser_spirit: () => spiritTier({ hd: 2, hp: 10, ac: 14 }),
      spirit:        () => spiritTier({ hd: 5, hp: 25, ac: 16 }),
      greater_spirit:() => spiritTier({ hd: 8, hp: 40, ac: 18 }),
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
