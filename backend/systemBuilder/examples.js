// Built-in systems as examples (4d1, Cyberpunk RED 4d2): Cities Without Number, Cyberpunk RED and
// Shadowrun 6E as whole system definitions, for a GM to read and to copy as the start of their own.
// Generic has a data version too (definitions.js), but no example: it works nothing out, so a
// copy of it would be BLANK.
//
// Their formulas are the ones in definitions.js, word for word, which the parity test
// (__tests__/system_builder_parity.test.js) holds to the hand-written recompute functions. Only
// the names players see, the stats those formulas read, a sample character, the setup answers and
// a rest doing what the built-in game's own rest button does (4f6b) are added here. Mechanics and structure only, never a book's wording or item lists (the plan,
// "Built-in systems as examples").
//
// NOT what the built-in games run. A game running CWN keeps running CWN's code; these are copies
// to change, and a copy has no link back.

const { CITIES_WITHOUT_NUMBER, SHADOWRUN_6E, CYBERPUNK_RED } = require('./definitions');

/** A derived list with the names players see, formulas untouched. */
const labelled = (derived, labels) => derived.map((d) => (labels[d.id] ? { ...d, label: labels[d.id] } : { ...d }));

const group = (id, label, stats) => ({ id, label, stats });
const stat = (id, label, min, max, tie) => ({ id, label, min, max, ...(tie ? { tie } : {}) });

const CWN = {
  format: 1,
  name: 'Cities Without Number',
  description: 'The built-in Cities Without Number rules as data: attribute modifiers from a table, '
    + 'saves from level and the better modifier, system strain from CON, and the Deluxe effort pools. '
    + 'Copy it to change anything.',
  license: 'Mechanics from the Cities Without Number Quick Reference v2.2, CC BY-NC 4.0',
  stats: [
    group('attributes', 'ATTRIBUTES', [
      stat('str', 'Strength', 3, 18), stat('dex', 'Dexterity', 3, 18), stat('con', 'Constitution', 3, 18),
      stat('int', 'Intelligence', 3, 18), stat('wis', 'Wisdom', 3, 18), stat('cha', 'Charisma', 3, 18),
    ]),
    group('character', 'CHARACTER', [stat('level', 'Level', 1, 10)]),
    group('armor', 'ARMOR', [stat('armor_soak', 'Damage soak', 0, 99), stat('armor_trauma_mod', 'Trauma target mod', -10, 10)]),
    group('magic', 'MAGIC', [stat('cast_skill', 'Cast skill', 0, 4), stat('summon_skill', 'Summon skill', 0, 4)]),
    group('adjustments', 'TABLE ADJUSTMENTS', [stat('strain_mod', 'Strain adjustment', -10, 10), stat('move_mod', 'Move adjustment', -99, 99)]),
    group('resources', 'RESOURCES', [stat('system_strain', 'System strain', 0, 20)]),
  ],
  samples: {
    str: 14, dex: 12, con: 13, int: 10, wis: 9, cha: 11, level: 3,
    armor_soak: 0, armor_trauma_mod: 0, cast_skill: 0, summon_skill: 0, strain_mod: 0, move_mod: 0, system_strain: 2,
  },
  lookups: CITIES_WITHOUT_NUMBER.lookups,
  derived: labelled(CITIES_WITHOUT_NUMBER.derived, {
    str_mod: 'Strength mod', dex_mod: 'Dexterity mod', con_mod: 'Constitution mod',
    int_mod: 'Intelligence mod', wis_mod: 'Wisdom mod', cha_mod: 'Charisma mod',
    save_physical: 'Physical save', save_evasion: 'Evasion save', save_mental: 'Mental save', save_luck: 'Luck save',
    system_strain_max: 'System strain max', trauma_target: 'Trauma target', armor_soak_total: 'Soak',
    move: 'Move', mage_effort_max: 'Mage effort', spells_prepared_max: 'Spells prepared', summoner_effort_max: 'Summoner effort',
  }),
  npc: { tiers: [{ id: 'by_hit_dice', label: 'BY HIT DICE', hp: '@level d8', values: { level: '@level' } }] },
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20', '2d6'], distance: 'meters' },
  // As the built-in LONG_REST button: 1 System Strain off, never below 0.
  rests: { long_rest: { refills: [{ what: 'system_strain', how: 'by', amount: '-1' }] } },
};

/** The ten stats at one level, as the built-in NPC generator sets them (sheets/npcTiers.js cprTier). */
const CPR_STATS = ['int', 'ref', 'dex', 'tech', 'cool', 'will', 'luck', 'move', 'body', 'emp_max'];
const cprTier = (id, label, hp, defense, stats) => ({ id, label, hp, defense, values: Object.fromEntries(CPR_STATS.map((s) => [s, stats])) });

const CPR = {
  format: 1,
  name: 'Cyberpunk RED',
  description: 'The built-in Cyberpunk RED rules as data: ten stats, current EMP worked out from Humanity, '
    + 'one pool of HP, and the generator\'s four NPC tiers. Copy it to change anything.',
  stats: [
    group('stats', 'STATS', [
      stat('int', 'INT', 1, 10), stat('ref', 'REF', 1, 10), stat('dex', 'DEX', 1, 10), stat('tech', 'TECH', 1, 10),
      stat('cool', 'COOL', 1, 10), stat('will', 'WILL', 1, 10), stat('luck', 'LUCK', 1, 10), stat('move', 'MOVE', 1, 10),
      stat('body', 'BODY', 1, 10), stat('emp_max', 'EMP', 1, 10),
    ]),
    group('humanity', 'HUMANITY', [stat('humanity', 'Humanity', 0, 120)]),
    group('resources', 'RESOURCES', [stat('luck_points', 'LUCK points', 0, 10)]),
  ],
  samples: { int: 6, ref: 7, dex: 6, tech: 5, cool: 6, will: 6, luck: 5, move: 6, body: 6, emp_max: 5, humanity: 50, luck_points: 2 },
  derived: labelled(CYBERPUNK_RED.derived, { emp: 'Current EMP' }),
  words: {
    money: { singular: 'EURODOLLAR', plural: 'EURODOLLARS', short: 'eb' },
    xp: { singular: 'IMPROVEMENT POINT', plural: 'IMPROVEMENT POINTS', short: 'IP' },
  },
  npc: {
    tiers: [
      cprTier('mook', 'MOOK', 20, 10, 4),
      cprTier('skilled', 'SKILLED', 30, 12, 5),
      cprTier('pro', 'PRO', 35, 13, 6),
      cprTier('elite', 'ELITE', 45, 15, 8),
    ],
  },
  core: { health: { model: 'pool' }, advancement: ['spend'], dice: ['d10', 'd6'], distance: 'meters' },
  // As the built-in RESET_ALL_LUCK button: LUCK points back to the LUCK stat.
  rests: { end_of_session: { refills: [{ what: 'luck_points', how: 'to', amount: '@luck' }] } },
};

const SR6 = {
  format: 1,
  name: 'Shadowrun 6E',
  description: 'The built-in Shadowrun rules as data: physical and stun monitors from Body and Willpower, '
    + 'initiative and composure from attribute pairs, and an adept\'s power points. Copy it to change anything.',
  stats: [
    group('attributes', 'ATTRIBUTES', [
      stat('body', 'Body', 1, 9), stat('agility', 'Agility', 1, 9), stat('reaction', 'Reaction', 1, 9), stat('strength', 'Strength', 1, 9),
      stat('willpower', 'Willpower', 1, 9), stat('logic', 'Logic', 1, 9), stat('intuition', 'Intuition', 1, 9), stat('charisma', 'Charisma', 1, 9),
    ]),
    group('special', 'SPECIAL', [stat('edge', 'Edge', 1, 7), stat('magic', 'Magic', 0, 9)]),
    group('resources', 'RESOURCES', [stat('edge_points', 'Edge points', 0, 7)]),
  ],
  samples: { body: 4, agility: 5, reaction: 4, strength: 3, willpower: 3, logic: 3, intuition: 4, charisma: 2, edge: 3, magic: 0, edge_points: 1 },
  derived: labelled(SHADOWRUN_6E.derived, {
    physical_monitor: 'Physical monitor', stun_monitor: 'Stun monitor', initiative_score: 'Initiative',
    composure: 'Composure', power_points_spent: 'Power points spent', power_points_remaining: 'Power points left',
  }),
  words: { xp: { singular: 'KARMA', plural: 'KARMA', short: 'KARMA' }, money: { singular: 'NUYEN', plural: 'NUYEN', short: 'NY' } },
  core: {
    health: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true },
    advancement: ['spend'],
    dice: ['d6'],
    distance: 'meters',
  },
  // As the built-in REPLENISH ALL EDGE button: Edge points back to Edge.
  rests: { end_of_session: { refills: [{ what: 'edge_points', how: 'to', amount: '@edge' }] } },
};

// ─── Genre starters (4d3) ───────────────────────────────────────────────────
// Starting points for a genre rather than a game, approved by the user 2026-10-09. Each shows off
// a different part of the builder: formulas and NPC dice (fantasy), a lookup table and a wound
// count (sci-fi), harm levels with nothing worked out at all (narrative). Common mechanics under
// made-up names; nothing is taken from a published game's text.

const ABILITIES = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];

const FANTASY = {
  format: 1,
  name: 'Sword & Spell',
  description: 'A fantasy starter on a d20: six abilities with modifiers worked out from them, proficiency that grows '
    + 'with level, one pool of HP, and four NPC tiers whose HP is rolled for their level. Copy it to make it yours.',
  stats: [
    group('abilities', 'ABILITIES', ABILITIES.map(([id, label]) => stat(id, label, 1, 20))),
    group('character', 'CHARACTER', [stat('level', 'Level', 1, 20)]),
  ],
  samples: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8, level: 3 },
  derived: [
    ...ABILITIES.map(([id, label]) => ({ id: `${id}_mod`, label: `${label} mod`, formula: `floor((@${id} - 10) / 2)` })),
    { id: 'proficiency', label: 'Proficiency', formula: '2 + floor((@level - 1) / 4)' },
    { id: 'defense', label: 'Unarmored defense', formula: '10 + @dex_mod' },
    { id: 'initiative', label: 'Initiative', formula: '@dex_mod' },
    { id: 'passive_perception', label: 'Passive perception', formula: '10 + @wis_mod' },
  ],
  words: { money: { singular: 'GOLD PIECE', plural: 'GOLD PIECES', short: 'gp' } },
  parts: { vehicles: { on: false }, cyberware: { on: false } },
  npc: {
    tiers: [
      { id: 'minion', label: 'MINION', hp: '@level d6', defense: 11, values: { level: '@level' } },
      { id: 'soldier', label: 'SOLDIER', hp: '@level d8 + @level', defense: 14, values: { level: '@level' } },
      { id: 'champion', label: 'CHAMPION', hp: '@level d10 + @level * 2', defense: 16, values: { level: '@level' } },
      { id: 'boss', label: 'BOSS', hp: '@level d12 + @level * 3', defense: 18, values: { level: '@level' } },
    ],
  },
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20', 'd4', 'd6', 'd8', 'd10', 'd12'], distance: 'feet' },
  // A breather heals a die's worth; a night's sleep heals the rest and shakes off exhaustion.
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
    long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }] },
  },
  conditions: { exhausted: { ends: 'rest', at: ['long_rest'] } },
};

const CHARACTERISTICS = [['str', 'Strength'], ['dex', 'Dexterity'], ['end', 'Endurance'], ['int', 'Intellect'], ['edu', 'Education'], ['soc', 'Standing']];
const scifiTier = (id, label, hp, defense, stats) => ({
  id, label, hp, defense, values: Object.fromEntries(CHARACTERISTICS.map(([s]) => [s, stats])),
});

const SCIFI = {
  format: 1,
  name: 'Starfarer',
  description: 'A sci-fi starter on 2d6: six characteristics, each modifier read from one table, a count of wounds '
    + 'instead of HP, and crews to fight. Copy it to make it yours.',
  stats: [group('characteristics', 'CHARACTERISTICS', CHARACTERISTICS.map(([id, label]) => stat(id, label, 2, 15)))],
  samples: { str: 7, dex: 9, end: 8, int: 10, edu: 6, soc: 5 },
  lookups: {
    characteristic_mod: {
      bands: [{ upTo: 2, value: -2 }, { upTo: 5, value: -1 }, { upTo: 8, value: 0 }, { upTo: 11, value: 1 }, { upTo: 14, value: 2 }, { value: 3 }],
    },
  },
  derived: CHARACTERISTICS.map(([id, label]) => ({ id: `${id}_mod`, label: `${label} mod`, formula: `characteristic_mod(@${id})` })),
  npc: {
    // A wound count is the token's own number, so each tier's HP is the wounds it takes.
    tiers: [scifiTier('crew', 'CREW', 1, 7, 6), scifiTier('veteran', 'VETERAN', 2, 8, 8), scifiTier('elite', 'ELITE', 3, 9, 10)],
  },
  core: { health: { model: 'wounds', count: 3, penalty: -1 }, advancement: ['spend'], dice: ['2d6', 'd6'], distance: 'meters' },
  // A wound back after a breather, all of them after proper rest.
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '1' }] },
    long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }] },
  },
};

const APPROACHES = [['forceful', 'Forceful'], ['careful', 'Careful'], ['clever', 'Clever'], ['quick', 'Quick'], ['flashy', 'Flashy'], ['sneaky', 'Sneaky']];

const NARRATIVE = {
  format: 1,
  name: 'Story First',
  description: 'A narrative starter: six approaches rated 0 to 3, harm levels instead of HP, milestones instead of XP, '
    + 'and nothing worked out by formula. Copy it to make it yours.',
  license: 'Approaches from Fate Accelerated Edition (faterpg.com) by Evil Hat Productions, LLC, used under CC BY 3.0',
  stats: [group('approaches', 'APPROACHES', APPROACHES.map(([id, label]) => stat(id, label, 0, 3)))],
  samples: { forceful: 1, careful: 2, clever: 3, quick: 1, flashy: 0, sneaky: 2 },
  parts: { vehicles: { on: false }, cyberware: { on: false } },
  core: {
    health: {
      model: 'harm',
      levels: [
        { id: 'lesser', label: 'LESSER', slots: 2, penalty: 'Less effect' },
        { id: 'moderate', label: 'MODERATE', slots: 2, penalty: '-1 die' },
        { id: 'severe', label: 'SEVERE', slots: 1, penalty: 'Needs help' },
      ],
    },
    advancement: ['milestone'],
    dice: ['d6'],
    distance: 'zones',
  },
  // No rests by the clock: harm clears in downtime, and fear passes when the scene does.
  rests: {
    short_rest: { on: false },
    long_rest: { on: false },
    downtime: { name: 'Downtime', refills: [{ what: 'health', how: 'full' }] },
  },
  conditions: { frightened: { ends: 'rest', at: ['end_of_scene'] }, exhausted: { ends: 'rest', at: ['downtime'] } },
};

/** The examples and starters, in the order the builder lists them. */
const EXAMPLES = [
  { id: 'cwn', kind: 'example', definition: CWN },
  { id: 'cpr', kind: 'example', definition: CPR },
  { id: 'sr6', kind: 'example', definition: SR6 },
  { id: 'fantasy', kind: 'starter', definition: FANTASY },
  { id: 'scifi', kind: 'starter', definition: SCIFI },
  { id: 'narrative', kind: 'starter', definition: NARRATIVE },
];

/** What the library can list: the built-in games, or the genre starters. */
const KINDS = ['example', 'starter'];

/** A fresh copy of one example's or starter's definition, or null for an id that isn't one. */
const exampleDefinition = (id) => {
  const found = EXAMPLES.find((e) => e.id === id);
  return found ? JSON.parse(JSON.stringify(found.definition)) : null;
};

/** Whether an id is a built-in game or a genre starter, or null for neither. */
const exampleKind = (id) => {
  const found = EXAMPLES.find((e) => e.id === id);
  return found ? found.kind : null;
};

/** What the library shows of each of one kind: no definitions, just enough to pick one. */
const exampleList = (kind = 'example') => EXAMPLES
  .filter((e) => e.kind === kind)
  .map(({ id, definition }) => ({ id, name: definition.name, description: definition.description }));

module.exports = { EXAMPLES, KINDS, exampleDefinition, exampleKind, exampleList };
