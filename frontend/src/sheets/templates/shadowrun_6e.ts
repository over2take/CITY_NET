import type { SheetTemplate, SheetField } from '../types';

// Shadowrun 6E (slimmed) template.
//
// Dice: everything is a POOL roll — attribute + skill d6s, 5s and 6s are
// hits, glitch when half or more of the pool shows 1 (critical glitch when
// there are also zero hits). The server rolls pools via the 'pool' shape in
// backend/sheets/rollEngine.js.
//
// Two damage tracks: the Physical monitor lives on the token (hp/hp_max,
// like every other system); the Stun monitor is a pair of sheet fields
// (stun_current / stun_monitor) — stun overflow rolls into Physical
// server-side. Monitors, initiative and composure are DERIVED fields:
// recomputed from attributes on every save (backend recompute hook).
//
// Edge is a manual pip resource (same UX as CP:R LUCK — click to spend).

// Pool skill: attribute + skill rating d6s. Pinned to the skill's default
// attribute; for alternate-attribute rolls players adjust with the tray.
const skill = (id: string, label: string, attr: string): SheetField => ({
  id, label, type: 'number', stat: attr,
  hint: 'Skill rating 0-9. Rolls rating + linked attribute as a d6 pool.',
  roll: { formula: `pool:@${attr}+@${id}`, label },
});

/** SR6 attributes available as roll bases in ability_list sections. */
export const SR6_ATTRS = [
  { value: 'body',      label: 'BOD' },
  { value: 'agility',   label: 'AGI' },
  { value: 'reaction',  label: 'REA' },
  { value: 'strength',  label: 'STR' },
  { value: 'willpower', label: 'WIL' },
  { value: 'logic',     label: 'LOG' },
  { value: 'intuition', label: 'INT' },
  { value: 'charisma',  label: 'CHA' },
  { value: 'magic',     label: 'MAG' },
  { value: 'resonance', label: 'RES' },
];

/** Skills a weapon can attack with (id must match a skill field). */
export const SR6_WEAPON_SKILLS: { value: string; label: string }[] = [
  { value: 'firearms', label: 'Firearms' },
  { value: 'close_combat', label: 'Close Combat' },
  { value: 'exotic_weapons', label: 'Exotic Weapons' },
];

/** Number of structured weapon rows on the sheet. */
export const SR6_WEAPON_ROWS = 4;

/** Fields per weapon row (drives the renderer's row chunking). */
export const SR6_WEAPON_COLUMNS = 6;

const weaponRow = (i: number): SheetField[] => [
  { id: `weapon${i}_name`, label: 'NAME', type: 'text', placeholder: 'Ares Predator VI' },
  { id: `weapon${i}_dv`, label: 'DV', type: 'text', placeholder: '3P', hint: 'Damage Value, e.g. 3P (Physical) or 2S (Stun). The number is the base damage applied on a hit.' },
  { id: `weapon${i}_ar`, label: 'AR', type: 'number', placeholder: '10', hint: 'Attack Rating. Compared to the defender\'s Armor Rating: higher = +1 DV, lower = -1 DV.' },
  { id: `weapon${i}_skill`, label: 'SKILL', type: 'select', options: SR6_WEAPON_SKILLS, hint: 'Attack skill used with this weapon.' },
  { id: `weapon${i}_mode`, label: 'MODE', type: 'text', placeholder: 'SA/BF', hint: 'Firing modes (cosmetic — mode effects are applied manually).' },
  { id: `weapon${i}_atk`, label: 'ATK', type: 'number', placeholder: '0', hint: 'Flat dice added to the attack pool (smartlink, quality).' },
];

export const shadowrun6e: SheetTemplate = {
  id: 'shadowrun_6e',
  name: 'Shadowrun 6E',
  // Token defense slot stores the Armor Rating (AR comparison for attacks)
  tokenDefense: { editOnToken: true, label: 'ARMOR' },
  // No CWN-style stabilize; SR6 overflow damage is handled manually
  stabilize: false,
  allowFumbleShield: false,
  npcTiers: [
    { id: 'ganger', label: 'GANGER' },
    { id: 'street_tough', label: 'STREET TOUGH' },
    { id: 'shadowrunner', label: 'SHADOWRUNNER' },
    { id: 'prime_runner', label: 'PRIME RUNNER' },
  ],
  header: {
    nameField: 'name',
    subtitleFields: ['metatype', 'role'],
    hpField: 'hp',
    hpMaxField: 'hp_max',
    chips: [
      { field: 'initiative_score', label: 'INIT' },
      { field: 'essence', label: 'ESS' },
    ],
    luckField: 'edge',
    luckMaxField: 'edge_max',
    luckLabel: 'EDGE',
  },
  tabs: ['CORE', 'SKILLS', 'GEAR', 'AWAKENED', 'EMERGED', 'NOTES'],
  sections: [
    {
      id: 'identity',
      label: 'IDENTITY',
      layout: 'list',
      tab: 'CORE',
      fields: [
        { id: 'name', label: 'Name', type: 'text', visibility: 'public', placeholder: 'Shade' },
        { id: 'metatype', label: 'Metatype', type: 'text', visibility: 'public', placeholder: 'Ork' },
        { id: 'role', label: 'Role', type: 'text', visibility: 'public', placeholder: 'Street Samurai' },
        { id: 'description', label: 'Description', type: 'textarea', visibility: 'public', placeholder: 'Chrome arm, dead eyes, smells of cordite' },
        { id: 'aliases', label: 'Aliases', type: 'text', placeholder: 'The Whisper of Redmond' },
      ],
    },
    {
      id: 'attributes',
      label: 'ATTRIBUTES',
      layout: 'grid',
      tab: 'CORE',
      columns: 4,
      fields: [
        { id: 'body', label: 'BOD', type: 'number', placeholder: '3' },
        { id: 'agility', label: 'AGI', type: 'number', placeholder: '3' },
        { id: 'reaction', label: 'REA', type: 'number', placeholder: '3' },
        { id: 'strength', label: 'STR', type: 'number', placeholder: '3' },
        { id: 'willpower', label: 'WIL', type: 'number', placeholder: '3' },
        { id: 'logic', label: 'LOG', type: 'number', placeholder: '3' },
        { id: 'intuition', label: 'INT', type: 'number', placeholder: '3' },
        { id: 'charisma', label: 'CHA', type: 'number', placeholder: '3' },
      ],
    },
    {
      id: 'special',
      label: 'SPECIAL',
      layout: 'grid',
      tab: 'CORE',
      columns: 4,
      fields: [
        { id: 'edge', label: 'EDGE', type: 'number', maxField: 'edge_max', hint: 'Current Edge points. Spend manually (click the pips in the header); named Edge effects are adjudicated at the table.' },
        { id: 'edge_max', label: 'EDGE MAX', type: 'number', placeholder: '3', hint: 'Your EDG attribute — the Edge pool cap.' },
        { id: 'essence', label: 'ESSENCE', type: 'number', placeholder: '6', hint: 'Starts at 6, reduced by cyberware. Track manually.' },
        { id: 'magic', label: 'MAGIC', type: 'number', hint: 'Awakened only (AWAKENED house rule unlocks the tab).' },
        { id: 'resonance', label: 'RESONANCE', type: 'number', hint: 'Emerged only (EMERGED house rule unlocks the tab).' },
      ],
    },
    {
      id: 'derived',
      label: 'DERIVED',
      layout: 'grid',
      tab: 'CORE',
      columns: 4,
      fields: [
        { id: 'physical_monitor', label: 'PHYS MON', type: 'number', hint: 'Derived: 8 + ceil(BOD/2). Your token HP max mirrors this.' },
        { id: 'stun_monitor', label: 'STUN MON', type: 'number', hint: 'Derived: 8 + ceil(WIL/2). Stun track maximum.' },
        { id: 'stun_current', label: 'STUN DMG', type: 'number', maxField: 'stun_monitor', placeholder: '0', hint: 'Stun damage taken. Overflow past the monitor rolls into Physical damage.' },
        { id: 'initiative_score', label: 'INITIATIVE', type: 'number', roll: { formula: '1d6 + @initiative_score', label: 'Initiative' }, hint: 'Derived: REA + INT. Roll adds 1d6.' },
        { id: 'composure', label: 'COMPOSURE', type: 'number', roll: { formula: 'pool:@composure', label: 'Composure' }, hint: 'Derived: WIL + CHA, rolled as a pool.' },
        { id: 'armor_rating', label: 'ARMOR', type: 'number', sensitivity: 'combat', source: 'token_ac', sourceWritable: true, hint: 'Defense Rating from armor. Linked to your token: attacks compare their AR against this for the DV modifier.' },
      ],
    },
    {
      id: 'skills',
      label: 'SKILLS',
      layout: 'skills',
      tab: 'SKILLS',
      fields: [
        skill('athletics', 'Athletics', 'agility'),
        skill('biotech', 'Biotech', 'logic'),
        skill('close_combat', 'Close Combat', 'agility'),
        skill('con', 'Con', 'charisma'),
        skill('cracking', 'Cracking', 'logic'),
        skill('electronics', 'Electronics', 'logic'),
        skill('engineering', 'Engineering', 'logic'),
        skill('exotic_weapons', 'Exotic Weapons', 'agility'),
        skill('firearms', 'Firearms', 'agility'),
        skill('influence', 'Influence', 'charisma'),
        skill('outdoors', 'Outdoors', 'intuition'),
        skill('perception', 'Perception', 'intuition'),
        skill('piloting', 'Piloting', 'reaction'),
        skill('sorcery', 'Sorcery', 'magic'),
        skill('stealth', 'Stealth', 'agility'),
        skill('tasking', 'Tasking', 'resonance'),
      ],
    },
    {
      id: 'weapons',
      label: 'WEAPONS',
      layout: 'weapons',
      tab: 'GEAR',
      columns: SR6_WEAPON_COLUMNS,
      fields: Array.from({ length: SR6_WEAPON_ROWS }, (_, i) => weaponRow(i + 1)).flat(),
    },
    {
      id: 'armor',
      label: 'ARMOR & CLOTHING',
      layout: 'notes',
      tab: 'GEAR',
      fields: [
        { id: 'armor_notes', label: 'Armor worn', type: 'textarea', placeholder: 'Armor jacket (DR +4), ballistic mask' },
      ],
    },
    {
      id: 'gear',
      label: 'GEAR & NUYEN',
      layout: 'list',
      tab: 'GEAR',
      fields: [
        { id: 'cash', label: 'Nuyen', type: 'number', source: 'bank_balance' },
        { id: 'gear_notes', label: 'Gear', type: 'textarea', placeholder: 'Commlink, medkit rating 3, grapple gun' },
      ],
    },
    {
      id: 'augmentations',
      label: 'AUGMENTATIONS',
      layout: 'notes',
      tab: 'GEAR',
      fields: [
        { id: 'cyberware_notes', label: 'Cyberware / bioware', type: 'textarea', placeholder: 'Wired reflexes 1, cybereyes (smartlink), bone lacing' },
      ],
    },
    // AWAKENED tab — gated by the sr6_awakened house rule
    //
    // Mages: dynamic spell list (DRAIN cost, attribute + dice pool, free-text
    // effect). One list for all spells; add/remove rows at will.
    {
      id: 'spells',
      label: 'SPELLS',
      layout: 'ability_list',
      tab: 'AWAKENED',
      listConfig: { costLabel: 'DRAIN', attrs: SR6_ATTRS, rollLabel: 'CAST' },
      fields: [{ id: 'mage_spells', label: 'Spells', type: 'text' }],
    },
    {
      id: 'awakened_notes',
      label: 'TRADITION & FOCI',
      layout: 'notes',
      tab: 'AWAKENED',
      fields: [
        { id: 'tradition', label: 'Tradition', type: 'text', placeholder: 'Hermetic' },
        { id: 'foci_notes', label: 'Foci, spirits, notes', type: 'textarea', placeholder: 'Power focus 2; bound fire spirit (2 services)' },
      ],
    },
    // Adepts: dynamic power list. PP cost per power is summed by the backend
    // recompute into power_points_spent / power_points_remaining.
    {
      id: 'power_points',
      label: 'POWER POINTS  (max = MAG on CORE tab)',
      layout: 'grid',
      tab: 'AWAKENED',
      columns: 2,
      fields: [
        { id: 'power_points_spent', label: 'PP SPENT', type: 'number', hint: 'Auto-summed from adept power costs below. Recalculated on save.' },
        { id: 'power_points_remaining', label: 'PP LEFT', type: 'number', hint: 'Derived: MAGIC − PP spent.' },
      ],
    },
    {
      id: 'adept_powers',
      label: 'ADEPT POWERS',
      layout: 'ability_list',
      tab: 'AWAKENED',
      listConfig: { costLabel: 'PP', attrs: SR6_ATTRS },
      fields: [{ id: 'adept_powers', label: 'Adept Powers', type: 'text' }],
    },
    // EMERGED tab — gated by the sr6_emerged house rule
    {
      id: 'complex_forms',
      label: 'COMPLEX FORMS',
      layout: 'notes',
      tab: 'EMERGED',
      fields: [
        { id: 'complex_forms_notes', label: 'Complex forms', type: 'textarea', placeholder: 'Cleaner, Puppeteer, Resonance Spike' },
        { id: 'sprites_notes', label: 'Sprites', type: 'textarea', placeholder: 'Machine sprite level 3 (2 tasks)' },
      ],
    },
    {
      id: 'contacts',
      label: 'CONTACTS & SINS',
      layout: 'notes',
      tab: 'NOTES',
      fields: [
        { id: 'contacts_notes', label: 'Contacts, favors', type: 'textarea', placeholder: 'Fixer: Sable (C4/L2), owes the Yakuza a job' },
        { id: 'sins_notes', label: 'SINs & licenses', type: 'textarea', placeholder: 'Fake SIN rating 4 "Bob Smith"' },
      ],
    },
    {
      id: 'qualities',
      label: 'QUALITIES & NOTES',
      layout: 'notes',
      tab: 'NOTES',
      fields: [
        { id: 'qualities_notes', label: 'Qualities', type: 'textarea', placeholder: 'Low-light vision, Impaired (hearing)' },
        { id: 'general_notes', label: 'Notes', type: 'textarea', placeholder: 'Karma 12; run debrief notes' },
      ],
    },
  ],
};
