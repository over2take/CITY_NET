// Server-side roll definitions per system: fieldId -> { formula, label, shape }.
//
// The server is authoritative: a client sends only { fieldId } and the
// formula resolves against the STORED sheet - clients cannot inflate rolls.
// The frontend templates carry the same formulas for display; a drift test
// (frontend CharacterSheet tests) cross-checks the two so they can't diverge.

// CP:R stats roll 1d10 + stat, skills roll 1d10 + stat + skill level.
// All CP:R checks use the exploding check die (nat 10 adds a d10, nat 1
// subtracts one).
const CPR_STATS = ['int', 'ref', 'dex', 'tech', 'cool', 'will', 'emp'];

const CPR_SKILLS = {
  // AWARENESS
  concentration: ['Concentration', 'will'],
  conceal_reveal: ['Conceal/Reveal Object', 'int'],
  lip_reading: ['Lip Reading', 'int'],
  perception: ['Perception', 'int'],
  tracking: ['Tracking', 'int'],
  // BODY
  athletics: ['Athletics', 'dex'],
  contortionist: ['Contortionist', 'dex'],
  dance: ['Dance', 'dex'],
  endurance: ['Endurance', 'will'],
  resist_torture: ['Resist Torture/Drugs', 'will'],
  stealth: ['Stealth', 'dex'],
  // CONTROL
  drive_land: ['Drive Land Vehicle', 'ref'],
  pilot_air: ['Pilot Air Vehicle (x2)', 'ref'],
  pilot_sea: ['Pilot Sea Vehicle', 'ref'],
  riding: ['Riding', 'ref'],
  // EDUCATION
  accounting: ['Accounting', 'int'],
  animal_handling: ['Animal Handling', 'int'],
  bureaucracy: ['Bureaucracy', 'int'],
  business: ['Business', 'int'],
  composition: ['Composition', 'int'],
  criminology: ['Criminology', 'int'],
  cryptography: ['Cryptography', 'int'],
  deduction: ['Deduction', 'int'],
  education: ['Education', 'int'],
  gamble: ['Gamble', 'int'],
  language_streetslang: ['Language (Streetslang)', 'int'],
  language_other: ['Language (Other)', 'int'],
  library_search: ['Library Search', 'int'],
  local_expert: ['Local Expert (Your Home)', 'int'],
  science: ['Science', 'int'],
  tactics: ['Tactics', 'int'],
  wilderness_survival: ['Wilderness Survival', 'int'],
  // FIGHTING
  brawling: ['Brawling', 'dex'],
  evasion: ['Evasion', 'dex'],
  martial_arts: ['Martial Arts (x2)', 'dex'],
  melee_weapon: ['Melee Weapon', 'dex'],
  // PERFORMANCE
  acting: ['Acting', 'cool'],
  play_instrument: ['Play Instrument', 'tech'],
  // RANGED WEAPONS
  archery: ['Archery', 'ref'],
  autofire: ['Autofire (x2)', 'ref'],
  handgun: ['Handgun', 'ref'],
  heavy_weapons: ['Heavy Weapons (x2)', 'ref'],
  shoulder_arms: ['Shoulder Arms', 'ref'],
  // SOCIAL
  bribery: ['Bribery', 'cool'],
  conversation: ['Conversation', 'emp'],
  human_perception: ['Human Perception', 'emp'],
  interrogation: ['Interrogation', 'cool'],
  persuasion: ['Persuasion', 'cool'],
  personal_grooming: ['Personal Grooming', 'cool'],
  streetwise: ['Streetwise', 'cool'],
  trading: ['Trading', 'cool'],
  wardrobe_style: ['Wardrobe & Style', 'cool'],
  // TECHNIQUE
  air_vehicle_tech: ['Air Vehicle Tech', 'tech'],
  basic_tech: ['Basic Tech', 'tech'],
  cybertech: ['Cybertech', 'tech'],
  demolitions: ['Demolitions (x2)', 'tech'],
  electronics_security: ['Electronics/Security Tech (x2)', 'tech'],
  first_aid: ['First Aid', 'tech'],
  forgery: ['Forgery', 'tech'],
  land_vehicle_tech: ['Land Vehicle Tech', 'tech'],
  paint_draw_sculpt: ['Paint/Draw/Sculpt', 'tech'],
  paramedic: ['Paramedic (x2)', 'tech'],
  photography_film: ['Photography/Film', 'tech'],
  pick_lock: ['Pick Lock', 'tech'],
  pick_pocket: ['Pick Pocket', 'tech'],
  sea_vehicle_tech: ['Sea Vehicle Tech', 'tech'],
  weaponstech: ['Weaponstech', 'tech'],
};

const cprRolls = () => {
  const rolls = {};
  CPR_STATS.forEach((stat) => {
    rolls[stat] = { formula: `1d10 + @${stat}`, label: stat.toUpperCase(), shape: 'explode10' };
  });
  Object.entries(CPR_SKILLS).forEach(([id, [label, stat]]) => {
    rolls[id] = { formula: `1d10 + @${stat} + @${id}`, label, shape: 'explode10' };
  });
  return rolls;
};

// CWN skills roll 2d6 + skill level + attribute mod, plain sum (nothing
// explodes). Mods (str_mod...) are derived fields kept fresh by the
// templates.js recompute hook. Saves roll a bare d20 - meet or beat the
// sheet's save target (the client shows the target next to the result).
const CWN_SKILLS = {
  administer: ['Administer', 'int_mod'],
  connect: ['Connect', 'cha_mod'],
  drive: ['Drive', 'dex_mod'],
  exert: ['Exert', 'str_mod'],
  fix: ['Fix', 'int_mod'],
  heal: ['Heal', 'int_mod'],
  know: ['Know', 'int_mod'],
  lead: ['Lead', 'cha_mod'],
  notice: ['Notice', 'wis_mod'],
  perform: ['Perform', 'cha_mod'],
  program: ['Program', 'int_mod'],
  punch: ['Punch', 'str_mod'],
  shoot: ['Shoot', 'dex_mod'],
  sneak: ['Sneak', 'dex_mod'],
  stab: ['Stab', 'str_mod'],
  survive: ['Survive', 'wis_mod'],
  talk: ['Talk', 'cha_mod'],
  trade: ['Trade', 'cha_mod'],
  work: ['Work', 'int_mod'],
  // Deluxe edition
  cast_skill: ['Cast', 'int_mod'],
  summon_skill: ['Summon', 'cha_mod'],
};

const CWN_SAVES = {
  save_physical: 'Physical Save',
  save_evasion: 'Evasion Save',
  save_mental: 'Mental Save',
  save_luck: 'Luck Save',
};

const cwnRolls = () => {
  const rolls = {};
  Object.entries(CWN_SKILLS).forEach(([id, [label, mod]]) => {
    rolls[id] = { formula: `2d6 + @${id} + @${mod}`, label, shape: 'sum' };
  });
  Object.entries(CWN_SAVES).forEach(([id, label]) => {
    rolls[id] = { formula: '1d20', label, shape: 'sum' };
  });
  return rolls;
};

const ROLLS = {
  generic: {},
  cyberpunk_red: cprRolls(),
  cities_without_number: cwnRolls(),
};

const getRoll = (system, fieldId) => (ROLLS[system] || {})[fieldId] || null;

module.exports = { ROLLS, getRoll, CPR_SKILLS, CWN_SKILLS };
