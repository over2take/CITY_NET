import type { SheetTemplate, SheetField } from '../types';
import { VEHICLE_TYPE_OPTIONS, DEFAULT_VEHICLE_TYPE, getPreset, presetFields, isPresetName } from '../vehiclePresets';
import { VEHICLE_WEAPON_OPTIONS, getVehicleWeapon, weaponMountFields } from '../vehicleWeapons';
import {
  FITTING_OPTIONS, describeFitting, getFitting, fittingFitsVehicle, budgetFor,
} from '../vehicleFittings';

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

/** Vehicles a sheet can carry, and weapon mounts on each. */
export const CWN_VEHICLE_ROWS = 6;
export const CWN_VEHICLE_WEAPON_ROWS = 3;
export const CWN_VEHICLE_COLUMNS = 6;

/**
 * One vehicle, then its weapon mounts.
 *
 * Mount ids are nested under the vehicle — `vehicle1_weapon1_dmg` — so a mount belongs to
 * its vehicle rather than to a shared pool, and the server reads them with the same
 * `getWeapon` as personal weapons by passing the prefix.
 *
 * Armour is Armour Rating and is subtracted from damage, unlike personal armour which is
 * AC and avoids the hit entirely. The two are not interchangeable and the hint says so.
 *
 * Five rows of six — two of stats, then one per mount — and a notes box spanning the grid
 * on a row of its own.
 *
 * Every mount is declared because field ids are static, but only as many as the vehicle
 * has hardpoints are drawn. A motorcycle carries none and shows none.
 */
const vehicleRow = (i: number): SheetField[] => [
  { id: `vehicle${i}_name`, label: 'VEHICLE', type: 'text', placeholder: 'Kestrel AV' },
  {
    id: `vehicle${i}_type`, label: 'TYPE', type: 'select', options: VEHICLE_TYPE_OPTIONS,
    hint: 'Book vehicle this is. Picking one fills the stat block, sets how many seats and mounts it has, and chooses its wireframe. CUSTOM leaves everything to you.',
    presetFill: (value, data) => {
      const preset = getPreset(value);
      if (!preset) return {};
      const out = presetFields(i, preset);
      // A vehicle someone has named is theirs. One still carrying a type label has not
      // been named at all, so it follows the type — otherwise a MOTORCYCLE changed to a
      // Tank stays called MOTORCYCLE.
      const current = String(data[`vehicle${i}_name`] ?? '').trim();
      if (current && !isPresetName(current)) delete out[`vehicle${i}_name`];
      // The * and ** vehicles carry an immunity rather than an Armour Rating, so the rule
      // goes where that vehicle can be read.
      if (preset.note) {
        // Into that vehicle's own notes, appended once and never over what a player wrote.
        const notes = String(data[`vehicle${i}_notes`] ?? '');
        if (!notes.includes(preset.note)) {
          out[`vehicle${i}_notes`] = notes ? `${notes}\n${preset.note}` : preset.note;
        }
      }
      return out;
    },
  },
  { id: `vehicle${i}_hp`, label: 'HP', type: 'number', maxField: `vehicle${i}_hp_max`, placeholder: '30' },
  { id: `vehicle${i}_hp_max`, label: 'HP MAX', type: 'number', placeholder: '30' },
  { id: `vehicle${i}_armor`, label: 'AR', type: 'number', placeholder: '6', hint: 'Armor Rating: subtracted from all damage the vehicle takes. Not the same as personal AC, which avoids the hit instead of reducing it. Blank on vehicles the book marks * or ** — those are immunities, not numbers, and the GM rules on them.' },
  { id: `vehicle${i}_ac`, label: 'AC', type: 'number', placeholder: '11', hint: 'Base AC. A moving vehicle adds the Drive skill of whoever is driving; a stationary one takes -4.' },
  { id: `vehicle${i}_spd`, label: 'SPD', type: 'number', placeholder: '0', hint: 'Speed rating, -1 to 3.' },
  { id: `vehicle${i}_tt`, label: 'TT', type: 'number', placeholder: '12', hint: 'Trauma Target for the vehicle itself. Hits on it roll against this, not against the trauma target of whoever is inside.' },
  { id: `vehicle${i}_crew`, label: 'CREW', type: 'number', placeholder: '5', hint: 'How many it seats, driver included. The VEHICLES window draws exactly this many places.' },
  { id: `vehicle${i}_hrdpt`, label: 'HRDPT', type: 'number', placeholder: '1', hint: 'Hardpoints: how many Heavy weapons it mounts. Mounts beyond this are ignored. Note this is not a gunner count — a Tank is crew 3 with 3 hardpoints and can never man every gun and drive at once.' },
  { id: `vehicle${i}_pow`, label: 'POW', type: 'number', placeholder: '3', hint: 'Power the hull has to spend on fittings and mounted weapons.' },
  { id: `vehicle${i}_mass`, label: 'MASS', type: 'number', placeholder: '7', hint: 'Mass the hull has to spend on fittings and mounted weapons.' },
  // Reference rather than combat, so they take the short row on their own.
  { id: `vehicle${i}_cost`, label: 'COST', type: 'number', placeholder: '5000', startsRow: true },
  { id: `vehicle${i}_size`, label: 'SIZE', type: 'text', placeholder: 'M', hint: 'S, M or L. Decides which fittings and weapons the hull can take.' },
  ...Array.from({ length: CWN_VEHICLE_WEAPON_ROWS }, (_, w) => {
    const j = w + 1;
    return [
      // Starts its own row: the stat block above is not a multiple of six, so without
      // this a mount would begin midway along a row and stop being recognisable as one.
      { id: `vehicle${i}_weapon${j}_name`, label: `MOUNT ${j}`, type: 'text', placeholder: 'Autocannon', startsRow: true },
      {
        // Replaces the old SHOCK column: no vehicle weapon in the book has shock, and a
        // picker earns the space more than a field that is always blank.
        id: `vehicle${i}_weapon${j}_type`, label: 'TYPE', type: 'select', options: VEHICLE_WEAPON_OPTIONS,
        hint: 'Book weapon on this hardpoint. Picking one fills its damage and trauma. CUSTOM leaves it to you.',
        presetFill: (value) => {
          const weapon = getVehicleWeapon(value);
          return weapon ? weaponMountFields(i, j, weapon) : {};
        },
      },
      { id: `vehicle${i}_weapon${j}_dmg`, label: 'DMG', type: 'text', placeholder: '2d8', hint: 'Damage dice, flat bonus allowed. Rolled by the server on a hit.' },
      { id: `vehicle${i}_weapon${j}_skill`, label: 'SKILL', type: 'select', options: CWN_WEAPON_SKILLS, hint: 'Attack skill the gunner fires with. Firing a mount costs that gunner their main action, so a crew can rarely work every gun at once.' },
      { id: `vehicle${i}_weapon${j}_atk`, label: 'ATK', type: 'number', placeholder: '0', hint: 'Flat attack bonus for this mount, added to the to-hit roll.' },
      { id: `vehicle${i}_weapon${j}_trauma`, label: 'TRAUMA', type: 'text', placeholder: 'd8/x3!', hint: 'Trauma die / rating. A trailing ! means it can inflict Traumatic Hits on vehicles and drones — without it, the die still works on people but does nothing to a car.' },
    ] as SheetField[];
  }).flat(),
  {
    // A list rather than fields, because a fitting can be stripped out again: a control
    // that wrote "+25% HP" into the stat block would have no way to take it back. The
    // effects are printed on the chips and the numbers stay yours to set.
    id: `vehicle${i}_fittings`, label: 'FITTINGS', type: 'tag_list', fullWidth: true, addLabel: '+ INSTALL…',
    hint: 'Installed fittings. Each spends Power and Mass, as mounted weapons do, and the hull has to be big enough. Effects are printed, not applied — several change the stat block and could not be undone if they were.',
    tagOptions: (data) => {
      const size = String(data[`vehicle${i}_size`] ?? '');
      return FITTING_OPTIONS.filter(o => {
        const fitting = getFitting(o.value);
        return !fitting || fittingFitsVehicle(fitting, size);
      });
    },
    tagHint: describeFitting,
    tagSummary: (values, data) => {
      const num = (v: unknown) => Number(v) || 0;
      // Mounted weapons draw on the same budget: the book is explicit that a hardpoint
      // costs Power and Mass just as a fitting does.
      let weaponPower = 0;
      let weaponMass = 0;
      for (let j = 1; j <= CWN_VEHICLE_WEAPON_ROWS; j++) {
        const weapon = getVehicleWeapon(String(data[`vehicle${i}_weapon${j}_type`] ?? ''));
        if (weapon) { weaponPower += weapon.power; weaponMass += weapon.mass; }
      }
      const b = budgetFor(values, weaponPower, weaponMass, num(data[`vehicle${i}_pow`]), num(data[`vehicle${i}_mass`]));
      // A Power System raises the pool, so it shows in the total rather than as a
      // negative spend.
      const power = `POWER ${b.spentPower}/${b.powerAvailable}${b.supplied ? ` (+${b.supplied})` : ''}`;
      const text = `${power} · MASS ${b.spentMass}/${num(data[`vehicle${i}_mass`])}`;
      return { text: b.over ? `${text} — OVER BUDGET` : text, warn: b.over };
    },
  },
  {
    // Belongs to this vehicle rather than to a box at the foot of the page: one shared
    // notes field for six vehicles cannot say which one it is describing.
    id: `vehicle${i}_notes`, label: 'NOTES', type: 'textarea', fullWidth: true,
    placeholder: 'Armoured glass, spoofed plates, damage taken',
  },
];

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
        { id: 'str_mod', label: 'STR MOD', type: 'number', derived: true, hint: 'Derived: recomputed from STR on every save.' },
        { id: 'dex', label: 'DEX', type: 'number', placeholder: '10' },
        { id: 'dex_mod', label: 'DEX MOD', type: 'number', derived: true, hint: 'Derived: recomputed from DEX on every save.' },
        { id: 'con', label: 'CON', type: 'number', placeholder: '10' },
        { id: 'con_mod', label: 'CON MOD', type: 'number', derived: true, hint: 'Derived: recomputed from CON on every save.' },
        { id: 'int', label: 'INT', type: 'number', placeholder: '10' },
        { id: 'int_mod', label: 'INT MOD', type: 'number', derived: true, hint: 'Derived: recomputed from INT on every save.' },
        { id: 'wis', label: 'WIS', type: 'number', placeholder: '10' },
        { id: 'wis_mod', label: 'WIS MOD', type: 'number', derived: true, hint: 'Derived: recomputed from WIS on every save.' },
        { id: 'cha', label: 'CHA', type: 'number', placeholder: '10' },
        { id: 'cha_mod', label: 'CHA MOD', type: 'number', derived: true, hint: 'Derived: recomputed from CHA on every save.' },
      ],
    },
    {
      id: 'combat',
      label: 'COMBAT',
      layout: 'grid',
      tab: 'STATS',
      columns: 4,
      fields: [
        { id: 'ac', label: 'AC', type: 'number', sensitivity: 'combat', source: 'token_ac', sourceWritable: true, hint: 'Armor Class - attacks hit at or above this. Linked to your token: editing here updates the token and vice versa.' },
        { id: 'base_hit_bonus', label: 'BHB', type: 'number', hint: 'Base hit bonus from class and level; added to every attack roll.' },
        { id: 'system_strain', label: 'STRAIN', type: 'number', maxField: 'system_strain_max', hint: 'System Strain from cyberware, drugs and rapid healing. Max equals your CON score; recovers 1 per full rest.' },
        { id: 'system_strain_max', label: 'STRAIN MAX', type: 'number', derived: true, hint: 'Derived: equals CON score, recomputed on every save.' },
        { id: 'trauma_target', label: 'TRAUMA TGT', type: 'number', placeholder: '6', hint: 'Trauma Target: enemy trauma dice at or above this multiply their damage. Default 6; certain cyberware and armor raise it. Only used when the GRITTY COMBAT house rule is on.' },
      ],
    },
    {
      id: 'saves',
      label: 'SAVING THROWS',
      layout: 'grid',
      tab: 'STATS',
      columns: 4,
      fields: [
        { id: 'save_physical', label: 'PHYSICAL', type: 'number', roll: { formula: '1d20', label: 'Physical Save' }, derived: true, hint: 'Derived: 16 - (level + best of STR/CON mod). Roll 1d20; meet or beat this to save. 1 always fails, 20 always saves.' },
        { id: 'save_evasion', label: 'EVASION', type: 'number', roll: { formula: '1d20', label: 'Evasion Save' }, derived: true, hint: 'Derived: 16 - (level + best of DEX/INT mod). Roll 1d20; meet or beat this to save.' },
        { id: 'save_mental', label: 'MENTAL', type: 'number', roll: { formula: '1d20', label: 'Mental Save' }, derived: true, hint: 'Derived: 16 - (level + best of WIS/CHA mod). Roll 1d20; meet or beat this to save.' },
        { id: 'save_luck', label: 'LUCK', type: 'number', roll: { formula: '1d20', label: 'Luck Save' }, derived: true, hint: 'Derived: 16 - level. Roll 1d20; meet or beat this to save.' },
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
      id: 'armor',
      label: 'ARMOR',
      layout: 'grid',
      tab: 'GEAR',
      columns: 4,
      fields: [
        { id: 'armor_name', label: 'ARMOR', type: 'text', placeholder: 'Armored Vest', hint: 'What you are wearing. Cosmetic - the numbers below do the work.' },
        { id: 'armor_ac', label: 'BASE AC', type: 'number', placeholder: '14', hint: 'The armor\'s base AC. When set, your token AC is computed automatically: base + DEX mod (capped) + shield. Leave blank to manage AC by hand on the STATS tab or token.' },
        { id: 'armor_dex_cap', label: 'MAX DEX', type: 'number', hint: 'Heavy armor caps the DEX bonus. Blank = uncapped, 0 = no DEX bonus.' },
        { id: 'shield_bonus', label: 'SHIELD', type: 'number', placeholder: '0', hint: 'Flat AC bonus from a carried shield.' },
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
      id: 'vehicles',
      // 'weapons' is the row-chunking layout, not a weapons-only one — the name is
      // historical. Reusing it avoids a new SectionLayout member and a renderer branch
      // that would do exactly the same thing.
      label: 'VEHICLES',
      // Who is sitting where is shared state, so the way to it belongs beside the
      // section rather than in it.
      headerAction: 'SEATING',
      layout: 'weapons',
      tab: 'GEAR',
      columns: CWN_VEHICLE_COLUMNS,
      // A new vehicle starts as the cheapest thing in the book rather than as a blank:
      // an unset type meant no crew, no hardpoints and no Trauma Target, which is a hole
      // rather than a choice. Change it to the one you meant.
      onAdd: (index) => presetFields(index, getPreset(DEFAULT_VEHICLE_TYPE)!),
      // Hardpoints are how many Heavy weapons the vehicle carries, so a motorcycle shows
      // no mount rows and a tank shows three. Drawing empty mounts on a vehicle that
      // cannot mount anything states something false about it.
      rowHidden: (row, data) => {
        const m = /^vehicle(\d+)_weapon(\d+)_name$/.exec(row[0]?.id ?? '');
        if (!m) return false;
        if (Number(m[2]) <= (Number(data[`vehicle${m[1]}_hrdpt`]) || 0)) return false;
        // Past the hardpoints, but never hide a mount someone has filled in: that reads
        // as data loss, and a GM may have deliberately overloaded a vehicle.
        return !row.some(f => String(data[f.id] ?? '').trim() !== '');
      },
      // 34 fields per vehicle: empty ones collapse, filled ones come back on reload.
      groupSize: CWN_VEHICLE_COLUMNS * 5 + 4,
      fields: Array.from({ length: CWN_VEHICLE_ROWS }, (_, i) => vehicleRow(i + 1)).flat(),
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
        { id: 'mage_effort_max', label: 'EFFORT MAX', type: 'number', derived: true, hint: 'Derived: recomputed on every save.' },
        { id: 'spells_prepared_max', label: 'PREPARED', type: 'number', derived: true, hint: 'Derived: half level rounded up + Cast skill.' },
      ],
    },
    {
      id: 'spells',
      label: 'PREPARED SPELLS',
      layout: 'spells',
      tab: 'DELUXE',
      columns: 4,
      fields: Array.from({ length: 4 }, (_, n) => {
        const i = n + 1;
        return [
          { id: `spell${i}_name`, label: 'NAME', type: 'text' as const, placeholder: 'The Unseen Hand' },
          { id: `spell${i}_effect`, label: 'EFFECT', type: 'text' as const, placeholder: 'Telekinesis, 20m, one scene', hint: 'Free-text effect, broadcast with the cast. The app does not know spell rules - you do.' },
          { id: `spell${i}_dmg`, label: 'DMG', type: 'text' as const, placeholder: '2d6', hint: 'Optional damage dice (e.g. 2d6 or 3d6+1), rolled by the server on cast. Blank for utility spells.' },
          { id: `spell${i}_cost`, label: 'EFFORT', type: 'number' as const, placeholder: '1', hint: 'Effort committed on cast, deducted from your pool. Casting with insufficient Effort is an OVERCAST - the GM rolls the consequence table.' },
        ];
      }).flat(),
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
        { id: 'summoner_effort_max', label: 'EFFORT MAX', type: 'number', derived: true, hint: 'Derived: recomputed on every save.' },
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
