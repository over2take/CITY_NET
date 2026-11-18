/**
 * Encumbrance, the server's side (8a5a; approved mockup item-types, 2026-11-14, decision 7; shown, never enforced): what is
 * carried, counted by the column it is pointed at, one of each times how many, over the lines READIED or STOWED; an
 * installed item weighing only where its install says; CAN CARRY a formula among the others, read as @capacity, what is
 * carried read as @carried; bands as words at a share of it; and the checks.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { carriedOf, bandOf, carryingOf, encumbranceOf } = require_('../systemBuilder/encumbrance');
const { checkDefinition } = require_('../systemBuilder/definition');
const { metaOf } = require_('../systemBuilder/runtime');
const { namesOf, valueOn } = require_('../systemBuilder/choices');
const { formulaValueOf } = require_('../systemBuilder/healthFormula');
const { WORN_KEY } = require_('../systemBuilder/items');
const { buildFile, readFile } = require_('../systemBuilder/citysys');
const { versionChanges, characterChanges } = require_('../systemBuilder/versionDiff');

const PACKED = {
  format: 1, name: 'Packed', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  derived: [
    { id: 'might_mod', label: 'Might mod', formula: 'floor((@might - 10) / 2)' },
    { id: 'speed', label: 'Speed', formula: 'if(@carried > @capacity, 20, 30)' },
  ],
  items: {
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      { id: 'gear', label: 'GEAR', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'note', label: 'NOTE', kind: 'text' }] },
      // A WEIGHT that is words here: nothing to count.
      { id: 'spells', label: 'SPELLS', columns: [{ id: 'range', label: 'RANGE', kind: 'text' }, { id: 'weight', label: 'WEIGHT', kind: 'text' }] },
    ],
    installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'might', limit: '10' }, { id: 'heavyware', label: 'HEAVYWARE', against: 'might', limit: '10', weighs: true }],
    list: [
      { id: 'sword', label: 'Longsword', type: 'weapons', values: { damage: '1d8', weight: 3 } },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05 } },
      { id: 'tent', label: 'Tent', type: 'gear', values: { weight: 20 } },
      { id: 'arm', label: 'Cyberarm', type: 'gear', needs: 'cyberware', cost: 1, values: { weight: 8 } },
      { id: 'plate', label: 'Dermal Plate', type: 'gear', needs: 'heavyware', cost: 1, values: { weight: 6 } },
      { id: 'bolt', label: 'Firebolt', type: 'spells', values: { range: '120 ft', weight: 'none' } },
    ],
    encumbrance: { column: 'weight', unit: 'LB', capacity: '@might * 10', bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }], past: 'OVERLOADED' },
  },
};
const line = (name, more = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });
const gear = (...rows) => ({ inventory: JSON.stringify(rows) });

describe('the checks', () => {
  const problems = (encumbrance, more = {}) => checkDefinition({ ...PACKED, ...more, items: { ...PACKED.items, ...(more.items || {}), encumbrance } }).problems;

  it('a well formed one, an install WEIGHS, and one with only what it counts', () => {
    expect(checkDefinition(PACKED).problems).toEqual([]);
    expect(problems({ column: 'weight' })).toEqual([]);
    expect(problems({ column: 'weight', unit: 'SLOTS', capacity: '12' })).toEqual([]);
  });

  it('what it counts: a NUMBER column some type has, by its id', () => {
    expect(problems({ column: 'range' })).toEqual([{ where: 'items, encumbrance, column', message: 'No item type has a NUMBER column called range' }]);
    expect(problems({ column: 'bulk' })).toEqual([{ where: 'items, encumbrance, column', message: 'No item type has a NUMBER column called bulk' }]);
    expect(problems({ column: 'Weight' })).toEqual([{ where: 'items, encumbrance, column', message: 'The column it counts, by its id' }]);
    expect(problems({ unit: 'LB' })).toEqual([{ where: 'items, encumbrance, column', message: 'The column it counts, by its id' }]);
    expect(problems('heavy')).toEqual([{ where: 'items, encumbrance', message: 'Must say what it counts and what can be carried' }]);
    // A system with no types of its own counts GEAR's WEIGHT.
    expect(checkDefinition({ ...PACKED, items: { list: [], encumbrance: { column: 'weight' } } }).problems).toEqual([]);
  });

  it('its unit, CAN CARRY as formula text, nothing it doesn\'t know', () => {
    expect(problems({ column: 'weight', unit: 'KILOGRAMMES!' })).toEqual([]);
    expect(problems({ column: 'weight', unit: 'KILOGRAMMES!!' })).toEqual([{ where: 'items, encumbrance, unit', message: 'Longer than 12 characters' }]);
    expect(problems({ column: 'weight', capacity: '@might *' }).map((p) => p.where)).toEqual(['items, encumbrance, capacity']);
    expect(problems({ column: 'weight', capacity: ' ' })).toEqual([{ where: 'items, encumbrance, capacity', message: 'Must be formula text' }]);
    expect(problems({ column: 'weight', heavy: true }).map((p) => p.where)).toEqual(['items, encumbrance, heavy']);
  });

  it('bands: words at a share of CAN CARRY, each further than the last, a word past them; none without CAN CARRY', () => {
    const base = { column: 'weight', capacity: '@might * 10' };
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 50 }, { word: 'HEAVY', upto: 50 }], past: 'OVER' }))
      .toEqual([{ where: 'items, encumbrance, band 2, upto', message: 'Each band goes further than the one before' }]);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 0 }], past: 'OVER' }))
      .toEqual([{ where: 'items, encumbrance, band 1, upto', message: 'Up to what share of CAN CARRY: 1 to 1000%' }]);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 1001 }], past: 'OVER' }).map((p) => p.where)).toEqual(['items, encumbrance, band 1, upto']);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 12.5 }], past: 'OVER' }).map((p) => p.where)).toEqual(['items, encumbrance, band 1, upto']);
    expect(problems({ ...base, bands: [{ upto: 50 }], past: 'OVER' })).toEqual([{ where: 'items, encumbrance, band 1, word', message: 'Required' }]);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 50, color: 'green' }], past: 'OVER' }).map((p) => p.where)).toEqual(['items, encumbrance, band 1, color']);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 50 }] })).toEqual([{ where: 'items, encumbrance, past', message: 'Required' }]);
    expect(problems({ ...base, past: 'OVER' })).toEqual([{ where: 'items, encumbrance, past', message: 'The word past the last band, with bands to be past' }]);
    expect(problems({ column: 'weight', bands: [{ word: 'LIGHT', upto: 50 }], past: 'OVER' }))
      .toEqual([{ where: 'items, encumbrance, bands', message: 'A band is a share of CAN CARRY: say what can be carried' }]);
    expect(problems({ ...base, bands: Array.from({ length: 6 }, (_, i) => ({ word: `B${i}`, upto: (i + 1) * 10 })), past: 'OVER' }))
      .toEqual([{ where: 'items, encumbrance, bands', message: 'At most 5 bands' }]);
    expect(problems({ ...base, bands: 'LIGHT' })).toEqual([{ where: 'items, encumbrance, bands', message: 'Must be a list of bands' }]);
    expect(problems({ ...base, bands: ['LIGHT'], past: 'OVER' })).toEqual([{ where: 'items, encumbrance, band 1', message: 'Must be a band' }]);
    // No bands at all: the number alone.
    expect(problems({ ...base, bands: [] })).toEqual([]);
  });

  it('@carried and @capacity are encumbrance\'s: a stat or formula of either name is refused', () => {
    const clash = { ...PACKED, derived: [...PACKED.derived, { id: 'carried', label: 'Carried', formula: '1' }] };
    expect(checkDefinition(clash).problems).toContainEqual({ where: 'items, encumbrance', message: '@carried is what encumbrance reads: a stat or formula is called carried' });
    const stat = { ...PACKED, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'capacity', label: 'Capacity' }] }] };
    expect(checkDefinition(stat).problems).toContainEqual({ where: 'items, encumbrance', message: '@capacity is what encumbrance reads: a stat or formula is called capacity' });
    // Without encumbrance the names are anybody's.
    expect(checkDefinition({ ...clash, items: { ...PACKED.items, encumbrance: undefined } }).problems).toEqual([]);
  });

  it('CAN CARRY among the formulas: one reading itself round is a loop, said as one', () => {
    const loop = { ...PACKED, derived: [...PACKED.derived, { id: 'strong', label: 'Strong', formula: '@capacity + 1' }], items: { ...PACKED.items, encumbrance: { ...PACKED.items.encumbrance, capacity: '@strong * 2' } } };
    expect(checkDefinition(loop).problems.map((p) => p.message)).toContainEqual(expect.stringMatching(/^Depends on itself: .*capacity/));
  });

  it('an install\'s WEIGHS is true or false', () => {
    const installs = [{ id: 'cyberware', label: 'CYBERWARE', against: 'might', limit: '10', weighs: 'yes' }, { id: 'heavyware', label: 'HEAVYWARE', against: 'might', limit: '10', weighs: 1 }];
    expect(checkDefinition({ ...PACKED, items: { ...PACKED.items, installs } }).problems).toEqual([
      { where: 'install cyberware, weighs', message: 'Whether it weighs while installed: true or false' },
      { where: 'install heavyware, weighs', message: 'Whether it weighs while installed: true or false' },
    ]);
  });
});

describe('what is carried', () => {
  it('its column, one of each times how many, READIED or STOWED; stashed, or a type without the column, nothing', () => {
    expect(carriedOf(PACKED, gear(line('Longsword', { carry: 'readied' }), line('Tent'), line('Firebolt'), line('Rope', { type: 'gear', values: { weight: 10 }, carry: 'stash' })))).toBe(23);
    // Twenty rounds at 0.05: 1, as people say it; the line's own weight over its item's.
    expect(carriedOf(PACKED, gear(line('Pistol Rounds', { qty: 20 }), line('Longsword', { values: { weight: 4 } }), line('A stick', { type: 'weapons', values: { weight: 1.5 }, qty: 2 })))).toBe(8);
    // Carried however it is written; a quantity as the sheet reads it.
    expect(carriedOf(PACKED, gear(line('Tent', { carry: ' Readied ' }), line('Tent', { carry: 'pocket' }), line('Longsword', { qty: '2' })))).toBe(26);
    expect(carriedOf(PACKED, { inventory: 'not json' })).toBe(0);
    // Three rounds at 0.05: 0.15, not 0.15000000000000002.
    expect(carriedOf(PACKED, gear(line('Pistol Rounds', { qty: 3 })))).toBe(0.15);
    expect(carriedOf({ ...PACKED, items: { ...PACKED.items, encumbrance: undefined } }, gear(line('Tent')))).toBe(0);
  });

  it('installed: only where its install WEIGHS, wherever its line is; one line installed, another of its name carried as any', () => {
    const installed = { [WORN_KEY]: { arm: { installed: true }, plate: { installed: true } } };
    expect(carriedOf(PACKED, { ...gear(line('Cyberarm'), line('Dermal Plate', { carry: 'stash' })), ...installed })).toBe(6);
    expect(carriedOf(PACKED, { ...gear(line('Cyberarm'), line('Cyberarm')), ...installed })).toBe(8);
    // Not installed: carried as anything is.
    expect(carriedOf(PACKED, gear(line('Cyberarm'), line('Dermal Plate', { carry: 'stash' })))).toBe(8);
  });

  it('a band at a share of what can be carried; past them, the word past; nothing to carry against, past once anything is', () => {
    expect(bandOf(PACKED, 25, 50)).toBe('LIGHT');
    expect(bandOf(PACKED, 26, 50)).toBe('ENCUMBERED');
    expect(bandOf(PACKED, 50, 50)).toBe('ENCUMBERED');
    expect(bandOf(PACKED, 51, 50)).toBe('OVERLOADED');
    expect(bandOf(PACKED, 0, 0)).toBe('LIGHT');
    expect(bandOf(PACKED, 1, 0)).toBe('OVERLOADED');
    expect(bandOf({ ...PACKED, items: { ...PACKED.items, encumbrance: { column: 'weight', capacity: '10' } } }, 5, 10)).toBeNull();
  });
});

describe('read by formulas, on every save', () => {
  const save = (data, def = PACKED) => { metaOf(def).recompute(data); return data; };

  it('@capacity worked out among the formulas, @carried read by them; what the sheet is told, with its band', () => {
    const light = save({ might: 5, ...gear(line('Longsword')) });
    expect(light.capacity).toBe(50);
    expect(light.speed).toBe(30);
    expect(light._worked.carrying).toEqual({ carried: 3, capacity: 50, unit: 'LB', band: 'LIGHT' });
    const over = save({ might: 5, ...gear(line('Tent', { qty: 3 })) });
    expect(over.speed).toBe(20);
    expect(over._worked.carrying).toEqual({ carried: 60, capacity: 50, unit: 'LB', band: 'OVERLOADED' });
  });

  it('CAN CARRY reading a formula; without one, the number alone; with no encumbrance, nothing said', () => {
    const modded = { ...PACKED, items: { ...PACKED.items, encumbrance: { ...PACKED.items.encumbrance, capacity: '50 + @might_mod * 10' } } };
    expect(save({ might: 14, ...gear(line('Tent')) }, modded)._worked.carrying).toEqual({ carried: 20, capacity: 70, unit: 'LB', band: 'LIGHT' });
    const bare = { ...PACKED, derived: PACKED.derived.slice(0, 1), items: { ...PACKED.items, encumbrance: { column: 'weight' } } };
    const worked = save({ might: 14, ...gear(line('Tent')) }, bare);
    expect(worked._worked.carrying).toEqual({ carried: 20, capacity: null, unit: '', band: null });
    expect(worked).not.toHaveProperty('capacity');
    // A CAN CARRY taken away in a new version: what the sheet kept of it is never said.
    expect(save({ might: 14, capacity: 140, ...gear(line('Tent')) }, bare)._worked.carrying.capacity).toBeNull();
    const none = { ...PACKED, derived: PACKED.derived.slice(0, 1), items: { ...PACKED.items, encumbrance: undefined } };
    expect(save({ might: 14, ...gear(line('Tent')) }, none)._worked?.carrying).toBeUndefined();
  });

  it('rolls and health formulas read them too; the names said where formulas are written', () => {
    const data = save({ might: 5, ...gear(line('Tent')) });
    expect(valueOn(PACKED, data, '@carried + @capacity')).toBe(70);
    expect(formulaValueOf(PACKED, { might: 5, ...gear(line('Tent')) }, '@capacity - @carried')).toBe(30);
    expect([...namesOf(PACKED)]).toEqual(expect.arrayContaining([['carried', 'Carried'], ['capacity', 'Can carry']]));
    const bare = { ...PACKED, derived: PACKED.derived.slice(0, 1), items: { ...PACKED.items, encumbrance: { column: 'weight' } } };
    expect(namesOf(bare).has('carried')).toBe(true);
    expect(namesOf(bare).has('capacity')).toBe(false);
    expect(namesOf({ ...bare, items: { ...PACKED.items, encumbrance: undefined } }).has('carried')).toBe(false);
    expect(encumbranceOf({ items: { encumbrance: { unit: 'LB' } } })).toBeNull();
    expect(carryingOf({ ...PACKED, items: { ...PACKED.items, encumbrance: undefined } }, {})).toBeNull();
  });
});

describe('the system file, and a new version', () => {
  it('carries encumbrance with the items, and back unchanged', () => {
    const file = buildFile({ definition: PACKED, version: 1, origin: 'sys_packedpackedpack' });
    expect(file.items.encumbrance).toEqual(PACKED.items.encumbrance);
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.items.encumbrance).toEqual(PACKED.items.encumbrance);
    expect(read.file.definition.items.installs).toEqual(PACKED.items.installs);
  });

  it('CAN CARRY changed is said as a formula, and what it changes for a character', () => {
    const stronger = { ...PACKED, items: { ...PACKED.items, encumbrance: { ...PACKED.items.encumbrance, capacity: '@might * 15' } } };
    expect(versionChanges(PACKED, stronger)).toEqual([{ kind: 'formula', change: 'changed', id: 'capacity', label: 'Can carry', from: '@might * 10', to: '@might * 15' }]);
    expect(characterChanges(PACKED, stronger, { might: 5, ...gear(line('Tent', { qty: 3 })) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'formula', change: 'value', id: 'capacity', from: 50, to: 75 }), expect.objectContaining({ id: 'speed', from: 20, to: 30 })]));
    const none = { ...PACKED, derived: PACKED.derived.slice(0, 1), items: { ...PACKED.items, encumbrance: undefined } };
    expect(versionChanges(none, { ...none, items: PACKED.items, derived: PACKED.derived })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'formula', change: 'added', id: 'capacity' })]));
  });
});
