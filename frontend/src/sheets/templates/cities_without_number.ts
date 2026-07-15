import type { SheetTemplate, SheetField } from '../types';

// Cities Without Number template.
//
// Licensing note: unlike CP:R, the CWN Quick Reference Documents are
// CC BY-NC 4.0 (by 0frames) - QRD-derived content may be embedded with
// attribution. Field labels and dice math below follow that license.
//
// Attribute mods (str_mod...) and saves (save_physical...) are DERIVED
// fields: the server recomputes them from the raw stats on every write
// (backend/sheets/templates.js recompute hook). Editing them by hand is
// pointless - the next stat write overwrites them.

// Skill check: 2d6 + skill level + attribute mod, plain sum (nothing
// explodes in CWN). Each skill is pinned to its primary attribute; for the
// rare "better of two attributes" case, players adjust manually.
const skill = (id: string, label: string, mod: string): SheetField => ({
  id, label, type: 'number', stat: mod,
  hint: 'Skill level: -1 untrained, 0 basic, 1-4 expert.',
  roll: { formula: `2d6 + @${id} + @${mod}`, label },
});

/** Skills a weapon can attack with (id must match a skill field). */
export const CWN_WEAPON_SKILLS: { value: string; label: string }[] = [
  { value: 'shoot', label: 'Shoot' },
  { value: 'stab', label: 'Stab' },
  { value: 'punch', label: 'Punch' },
];

/** Number of structured weapon rows on the sheet. */
export const CWN_WEAPON_ROWS = 4;

/** Fields per weapon row (drives the renderer's row chunking). */
export const CWN_WEAPON_COLUMNS = 6;

const weaponRow = (i: number): SheetField[] => [
  { id: `weapon${i}_name`, label: 'NAME', type: 'text', placeholder: 'Heavy Pistol' },
  { id: `weapon${i}_dmg`, label: 'DMG', type: 'text', placeholder: '1d8+1', hint: 'Damage dice, flat bonus allowed: 1d8 or 1d8+1. Rolled by the server on a hit; attribute mod is added automatically.' },
  { id: `weapon${i}_skill`, label: 'SKILL', type: 'select', options: CWN_WEAPON_SKILLS, hint: 'Attack skill used with this weapon.' },
  { id: `weapon${i}_trauma`, label: 'TRAUMA', type: 'text', placeholder: 'd8/x3', hint: 'Trauma die / rating, e.g. d8/x3: on a hit the trauma die rolls; at or above the target\'s trauma target the damage is multiplied by the rating. Blank = no trauma. Only used when the GRITTY COMBAT house rule is on.' },
  { id: `weapon${i}_shock`, label: 'SHOCK', type: 'text', placeholder: '2/13', hint: 'Shock damage / max AC, e.g. 2/13: on a miss, targets of AC 13 or less still take 2 + attribute mod damage. Blank = no shock.' },
  { id: `weapon${i}_atk`, label: 'ATK', type: 'number', placeholder: '0', hint: 'Flat weapon attack bonus (smartlink, quality), added to the to-hit roll.' },
];

export const citiesWithoutNumber: SheetTemplate = {
  id: 'cities_without_number',
  name: 'Cities Without Number',
  // CWN targets a single flat AC - safe to edit on the token directly.
  tokenDefense: { editOnToken: true, label: 'AC' },
  // CWN death flow: mortally wounded at 0 HP, stabilize via Heal check.
  stabilize: true,
  npcTiers: [
    { id: 'mook', label: 'MOOK' },
    { id: 'skilled', label: 'SKILLED' },
    { id: 'veteran', label: 'VETERAN' },
    { id: 'elite', label: 'ELITE' },
    { id: 'lesser_spirit', label: 'LESSER SPIRIT' },
    { id: 'spirit', label: 'SPIRIT' },
    { id: 'greater_spirit', label: 'GREATER SPIRIT' },
  ],
  header: {
    nameField: 'name',
    subtitleFields: ['background'],
    hpField: 'hp',
    hpMaxField: 'hp_max',
    chips: [
      { field: 'level', label: 'LVL' },
      { field: 'base_hit_bonus', label: 'BHB' },
    ],
  },
  tabs: ['STATS', 'SKILLS', 'GEAR', 'DELUXE', 'NOTES'],
  sections: [
    {
      id: 'identity',
      label: 'IDENTITY',
      layout: 'list',
      tab: 'STATS',
      fields: [
        { id: 'name', label: 'Name', type: 'text', visibility: 'public', placeholder: 'Jade' },
        { id: 'background', label: 'Background', type: 'text', visibility: 'public', placeholder: 'Ganger' },
        { id: 'class', label: 'Class', type: 'text', visibility: 'public', placeholder: 'Operator' },
        { id: 'level', label: 'Level', type: 'number', placeholder: '1' },
        { id: 'description', label: 'Description', type: 'textarea', visibility: 'public', placeholder: 'Chromed left arm, mirrorshades, never blinks' },
        { id: 'aliases', label: 'Aliases', type: 'text', placeholder: 'The Wraith' },
      ],
    },
    {
      id: 'attributes',
      label: 'ATTRIBUTES',
      layout: 'grid',
      tab: 'STATS',
      columns: 4,
      fields: [
        { id: 'str', label: 'STR', type: 'number', placeholder: '10' },
        { id: 'str_mod', label: 'STR MOD', type: 'number', hint: 'Derived: recomputed from STR on every save.' },
        { id: 'dex', label: 'DEX', type: 'number', placeholder: '10' },
        { id: 'dex_mod', label: 'DEX MOD', type: 'number', hint: 'Derived: recomputed from DEX on every save.' },
        { id: 'con', label: 'CON', type: 'number', placeholder: '10' },
        { id: 'con_mod', label: 'CON MOD', type: 'number', hint: 'Derived: recomputed from CON on every save.' },
        { id: 'int', label: 'INT', type: 'number', placeholder: '10' },
        { id: 'int_mod', label: 'INT MOD', type: 'number', hint: 'Derived: recomputed from INT on every save.' },
        { id: 'wis', label: 'WIS', type: 'number', placeholder: '10' },
        { id: 'wis_mod', label: 'WIS MOD', type: 'number', hint: 'Derived: recomputed from WIS on every save.' },
        { id: 'cha', label: 'CHA', type: 'number', placeholder: '10' },
        { id: 'cha_mod', label: 'CHA MOD', type: 'number', hint: 'Derived: recomputed from CHA on every save.' },
      ],
    },
    {
      id: 'combat',
      label: 'COMBAT',
      layout: 'grid',
      tab: 'STATS',
      columns: 4,
      fields: [
        { id: 'ac', label: 'AC', type: 'number', sensitivity: 'combat', hint: 'Armor Class - attacks hit at or above this. Also editable on your token.' },
        { id: 'base_hit_bonus', label: 'BHB', type: 'number', hint: 'Base hit bonus from class and level; added to every attack roll.' },
        { id: 'system_strain', label: 'STRAIN', type: 'number', maxField: 'system_strain_max', hint: 'System Strain from cyberware, drugs and rapid healing. Max equals your CON score; recovers 1 per full rest.' },
        { id: 'system_strain_max', label: 'STRAIN MAX', type: 'number', hint: 'Derived: equals CON score, recomputed on every save.' },
      ],
    },
    {
      id: 'saves',
      label: 'SAVING THROWS',
      layout: 'grid',
      tab: 'STATS',
      columns: 4,
      fields: [
        { id: 'save_physical', label: 'PHYSICAL', type: 'number', roll: { formula: '1d20', label: 'Physical Save' }, hint: 'Derived: 16 - (level + best of STR/CON mod). Roll 1d20; meet or beat this to save. 1 always fails, 20 always saves.' },
        { id: 'save_evasion', label: 'EVASION', type: 'number', roll: { formula: '1d20', label: 'Evasion Save' }, hint: 'Derived: 16 - (level + best of DEX/INT mod). Roll 1d20; meet or beat this to save.' },
        { id: 'save_mental', label: 'MENTAL', type: 'number', roll: { formula: '1d20', label: 'Mental Save' }, hint: 'Derived: 16 - (level + best of WIS/CHA mod). Roll 1d20; meet or beat this to save.' },
        { id: 'save_luck', label: 'LUCK', type: 'number', roll: { formula: '1d20', label: 'Luck Save' }, hint: 'Derived: 16 - level. Roll 1d20; meet or beat this to save.' },
      ],
    },
    {
      id: 'skills',
      label: 'SKILLS',
      layout: 'skills',
      tab: 'SKILLS',
      fields: [
        skill('administer', 'Administer', 'int_mod'),
        skill('connect', 'Connect', 'cha_mod'),
        skill('drive', 'Drive', 'dex_mod'),
        skill('exert', 'Exert', 'str_mod'),
        skill('fix', 'Fix', 'int_mod'),
        skill('heal', 'Heal', 'int_mod'),
        skill('know', 'Know', 'int_mod'),
        skill('lead', 'Lead', 'cha_mod'),
        skill('notice', 'Notice', 'wis_mod'),
        skill('perform', 'Perform', 'cha_mod'),
        skill('program', 'Program', 'int_mod'),
        skill('punch', 'Punch', 'str_mod'),
        skill('shoot', 'Shoot', 'dex_mod'),
        skill('sneak', 'Sneak', 'dex_mod'),
        skill('stab', 'Stab', 'str_mod'),
        skill('survive', 'Survive', 'wis_mod'),
        skill('talk', 'Talk', 'cha_mod'),
        skill('trade', 'Trade', 'cha_mod'),
        skill('work', 'Work', 'int_mod'),
      ],
    },
    {
      id: 'weapons',
      label: 'WEAPONS',
      layout: 'weapons',
      tab: 'GEAR',
      columns: CWN_WEAPON_COLUMNS,
      fields: Array.from({ length: CWN_WEAPON_ROWS }, (_, i) => weaponRow(i + 1)).flat(),
    },
    {
      id: 'weapon_notes',
      label: 'WEAPON NOTES',
      layout: 'notes',
      tab: 'GEAR',
      fields: [
        { id: 'weapons_notes', label: 'Ammo, mods, notes', type: 'textarea', placeholder: 'Smartlinked pistol; monoblade never leaves the boot' },
      ],
    },
    {
      id: 'gear',
      label: 'GEAR & CASH',
      layout: 'list',
      tab: 'GEAR',
      fields: [
        { id: 'cash', label: 'Cash', type: 'number', source: 'bank_balance' },
        { id: 'gear_notes', label: 'Gear', type: 'textarea', placeholder: 'Medkit, dataslab, grapnel line, 2x stim' },
      ],
    },
    {
      id: 'cyberware',
      label: 'CYBERWARE',
      layout: 'notes',
      tab: 'GEAR',
      fields: [
        { id: 'cyberware_notes', label: 'Cyberware', type: 'textarea', placeholder: 'Dermal armor, cranial jack, low-light eyes' },
      ],
    },
    // DELUXE tab: Spellcasting + Summoning (CWN Deluxe edition). Visibility is
    // gated by the cwn_deluxe house rule in Phase 7; field ids are fixed here.
    {
      id: 'spellcasting',
      label: 'SPELLCASTING',
      layout: 'grid',
      tab: 'DELUXE',
      columns: 4,
      fields: [
        { id: 'cast_skill', label: 'CAST', type: 'number', roll: { formula: '2d6 + @cast_skill + @int_mod', label: 'Cast' }, hint: 'Cast skill level (Deluxe edition).' },
        { id: 'mage_effort', label: 'EFFORT', type: 'number', maxField: 'mage_effort_max', hint: 'Mage Effort: spend to power spells. Max derived: best of INT/WIS mod + Cast skill, minimum 1.' },
        { id: 'mage_effort_max', label: 'EFFORT MAX', type: 'number', hint: 'Derived: recomputed on every save.' },
        { id: 'spells_prepared_max', label: 'PREPARED', type: 'number', hint: 'Derived: half level rounded up + Cast skill.' },
      ],
    },
    {
      id: 'spells',
      label: 'SPELLS',
      layout: 'notes',
      tab: 'DELUXE',
      fields: [
        { id: 'spells', label: 'Prepared spells', type: 'textarea', placeholder: 'The Unseen Hand, Glimpse the Unseen' },
      ],
    },
    {
      id: 'summoning',
      label: 'SUMMONING',
      layout: 'grid',
      tab: 'DELUXE',
      columns: 4,
      fields: [
        { id: 'summon_skill', label: 'SUMMON', type: 'number', roll: { formula: '2d6 + @summon_skill + @cha_mod', label: 'Summon' }, hint: 'Summon skill level (Deluxe edition).' },
        { id: 'summoner_effort', label: 'EFFORT', type: 'number', maxField: 'summoner_effort_max', hint: 'Summoner Effort: committed to bound spirits. Max derived: best of CON/CHA mod + Summon skill, minimum 1.' },
        { id: 'summoner_effort_max', label: 'EFFORT MAX', type: 'number', hint: 'Derived: recomputed on every save.' },
      ],
    },
    {
      id: 'spirits',
      label: 'SPIRITS',
      layout: 'notes',
      tab: 'DELUXE',
      fields: [
        { id: 'spirits', label: 'Bound spirits', type: 'textarea', placeholder: 'Lesser spirit of the wires (2 Effort committed)' },
      ],
    },
    {
      id: 'foci',
      label: 'FOCI & EDGES',
      layout: 'notes',
      tab: 'NOTES',
      fields: [
        { id: 'foci_notes', label: 'Foci, edges, class abilities', type: 'textarea', placeholder: 'Alert (auto initiative), Killing Blow' },
        { id: 'auto_initiative', label: 'Automatic initiative (from Foci/cyber)', type: 'number', hint: '1 = acts before the normal initiative order. Read by the future initiative tracker.' },
      ],
    },
    {
      id: 'contacts',
      label: 'CONTACTS & FACTION',
      layout: 'notes',
      tab: 'NOTES',
      fields: [
        { id: 'faction', label: 'Faction', type: 'text', placeholder: 'The Steel Syndicate' },
        { id: 'contacts_notes', label: 'Contacts, debts, favors', type: 'textarea', placeholder: 'Owes the fixer Marlowe two jobs' },
      ],
    },
    {
      id: 'injuries',
      label: 'CONDITIONS & INJURIES',
      layout: 'notes',
      tab: 'NOTES',
      fields: [
        { id: 'frail', label: 'Frail (1 = active)', type: 'number', hint: 'Set after stabilizing from 0 HP: while Frail, hitting 0 HP again is instant death. Cleared by a week of care or medical treatment.' },
        { id: 'injury_notes', label: 'Major injuries', type: 'textarea', placeholder: 'Shattered kneecap (-2 Move) - from the GM\'s injury table' },
      ],
    },
  ],
};
