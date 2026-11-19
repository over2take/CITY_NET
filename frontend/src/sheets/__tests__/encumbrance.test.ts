import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  encumbranceOf, withEncumbrance, countable, typesWithout, started, countedBy, withNewBand, withBand, withoutBand, bandProblem,
  wornTokens, gearTokens, START_BANDS, START_PAST, type Encumbrance,
} from '../encumbrance';
import type { Definition } from '../systemsApi';

/**
 * The builder's ENCUMBRANCE as logic (8a5c; approved mockup item-types, 2026-11-14, decision 7): read and written back
 * tidy, what it can count, how it starts, the bands, and the names formulas read. What it writes is held to the server's
 * own check (backend systemBuilder/definition.js) on the same definition.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../../../../backend/systemBuilder/definition.js');

const TYPED: Definition = {
  format: 1, name: 'Typed', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      { id: 'spells', label: 'SPELLS', one: 'Spell', columns: [{ id: 'range', label: 'RANGE', kind: 'text' }, { id: 'slots', label: 'SLOTS', kind: 'number' }] },
    ],
    list: [{ id: 'sword', label: 'Longsword', type: 'weapons', values: { damage: '1d8', weight: 3 } }],
  },
} as Definition;

describe('read and written back', () => {
  it('none until it counts; written tidy, the rest of the items kept; taken away, gone', () => {
    expect(encumbranceOf(TYPED)).toBeNull();
    const on = withEncumbrance(TYPED, { column: 'weight', unit: ' ', capacity: '  ', bands: [], past: 'OVER' });
    expect((on.items as Record<string, unknown>).encumbrance).toEqual({ column: 'weight' });
    expect((on.items as Record<string, unknown>).types).toEqual((TYPED.items as Record<string, unknown>).types);
    expect((on.items as Record<string, unknown>).list).toEqual((TYPED.items as Record<string, unknown>).list);
    const full = withEncumbrance(TYPED, { column: 'weight', unit: 'KILOGRAMMES!!', capacity: '@might * 10', bands: [{ word: 'LIGHT', upto: 50 }] });
    expect(encumbranceOf(full)).toEqual({ column: 'weight', unit: 'KILOGRAMMES!', capacity: '@might * 10', bands: [{ word: 'LIGHT', upto: 50 }], past: '' });
    expect(withEncumbrance(full, null).items).toEqual(TYPED.items);
    // Items holding nothing else: none at all.
    expect(withEncumbrance(withEncumbrance({ format: 1, name: 'Bare' } as Definition, { column: 'weight' }), null)).toEqual({ format: 1, name: 'Bare' });
    expect(encumbranceOf({ ...TYPED, items: { encumbrance: { unit: 'LB' } } } as Definition)).toBeNull();
  });

  it('a band\'s words and condition, and past them, kept through every edit (8a5d1: their boxes come in 8a5d2)', () => {
    const said = withEncumbrance(TYPED, { column: 'weight', capacity: '10', bands: [{ word: 'LIGHT', upto: 50, says: 'Free.', condition: 'slowed' }], past: 'OVER', past_says: 'Slow.', past_condition: 'exhausted' });
    const e = encumbranceOf(said)!;
    expect(e.bands).toEqual([{ word: 'LIGHT', upto: 50, says: 'Free.', condition: 'slowed' }]);
    const moved = encumbranceOf(withEncumbrance(said, withBand(e, 0, { upto: 60 })))!;
    expect(moved).toEqual({ column: 'weight', capacity: '10', bands: [{ word: 'LIGHT', upto: 60, says: 'Free.', condition: 'slowed' }], past: 'OVER', past_says: 'Slow.', past_condition: 'exhausted' });
    // With the bands gone, nothing past them is kept either.
    expect(encumbranceOf(withEncumbrance(said, withoutBand(e, 0)))).toEqual({ column: 'weight', capacity: '10' });
  });
});

describe('what it can count', () => {
  it('each NUMBER column once by id, with the types that have it; the types without it', () => {
    expect(countable(TYPED)).toEqual([
      { id: 'weight', label: 'WEIGHT', unit: 'LB', types: ['WEAPONS', 'ARMOR'] },
      { id: 'defense', label: 'DEFENSE', types: ['ARMOR'] },
      { id: 'slots', label: 'SLOTS', types: ['SPELLS'] },
    ]);
    expect(typesWithout(TYPED, 'weight')).toEqual(['SPELLS']);
    expect(typesWithout(TYPED, 'slots')).toEqual(['WEAPONS', 'ARMOR']);
    // A system with no types of its own counts GEAR's.
    expect(countable({ format: 1, name: 'Bare' } as Definition).map((c) => c.id)).toEqual(['weight', 'price']);
  });

  it('starts on WEIGHT in its unit, CAN CARRY ten times the first stat, the starting bands: as the server takes it', () => {
    const e = started(TYPED, 'might')!;
    expect(e).toEqual({ column: 'weight', unit: 'LB', capacity: '@might * 10', bands: START_BANDS, past: START_PAST });
    expect(checkDefinition(withEncumbrance(TYPED, e)).problems).toEqual([]);
    // WEIGHT wherever it is, not the first NUMBER column met.
    const armorFirst = { ...TYPED, items: { types: [(TYPED.items as { types: unknown[] }).types[1]] } } as Definition;
    expect(started(armorFirst, 'might')!.column).toBe('weight');
    // No stat: a number; no WEIGHT: the first NUMBER column, without a unit it hasn't got.
    const spells = { ...TYPED, items: { types: [(TYPED.items as { types: unknown[] }).types[2]] } } as Definition;
    expect(started(spells, null)).toEqual({ column: 'slots', capacity: '100', bands: START_BANDS, past: START_PAST });
    expect(checkDefinition(withEncumbrance(spells, started(spells, null))).problems).toEqual([]);
    // Nothing to count: none.
    const words = { ...TYPED, items: { types: [{ id: 'notes', label: 'NOTES', columns: [{ id: 'text', label: 'TEXT', kind: 'text' }] }] } } as Definition;
    expect(started(words, 'might')).toBeNull();
    // The bands it starts with are its own, never the shared ones.
    e.bands![0].word = 'CHANGED';
    expect(START_BANDS[0].word).toBe('LIGHT');
  });

  it('COUNTED BY another: its unit comes with it where it has one, kept where it hasn\'t', () => {
    const e: Encumbrance = { column: 'weight', unit: 'LB' };
    expect(countedBy(TYPED, e, 'slots')).toEqual({ column: 'slots', unit: 'LB' });
    expect(countedBy(TYPED, { column: 'slots', unit: 'SLOTS' }, 'weight')).toEqual({ column: 'weight', unit: 'LB' });
  });
});

describe('the bands', () => {
  const e: Encumbrance = { column: 'weight', capacity: '100', bands: [{ word: 'LIGHT', upto: 50 }], past: 'OVER' };

  it('a new one further than the last, up to the most, five at most; the first at 50, the word past them said', () => {
    expect(withNewBand(e)!.bands).toEqual([{ word: 'LIGHT', upto: 50 }, { word: 'NEW BAND', upto: 100 }]);
    expect(withNewBand({ column: 'weight' })).toEqual({ column: 'weight', bands: [{ word: 'NEW BAND', upto: 50 }], past: START_PAST });
    expect(withNewBand({ ...e, bands: [{ word: 'A', upto: 700 }] })!.bands![1].upto).toBe(1000);
    const five = { ...e, bands: [10, 20, 30, 40, 50].map((upto) => ({ word: 'B', upto })) };
    expect(withNewBand(five)).toBeNull();
  });

  it('one changed or taken away; what is wrong with a share, as the server says it', () => {
    expect(withBand(e, 0, { word: 'EASY' }).bands).toEqual([{ word: 'EASY', upto: 50 }]);
    expect(withoutBand(e, 0).bands).toEqual([]);
    const bands = [{ word: 'A', upto: 50 }, { word: 'B', upto: 50 }, { word: 'C', upto: 0 }, { word: 'D', upto: 12.5 }, { word: 'E', upto: 1001 }];
    expect(bands.map((_, i) => bandProblem(bands, i))).toEqual([
      null, 'Each band goes further than the one before', 'Up to what share of CAN CARRY: 1 to 1000%', 'Up to what share of CAN CARRY: 1 to 1000%', 'Up to what share of CAN CARRY: 1 to 1000%',
    ]);
    // Taken away to none, it is the number alone: no word past them either.
    expect(encumbranceOf(withEncumbrance(TYPED, withoutBand(e, 0)))).toEqual({ column: 'weight', capacity: '100' });
  });
});

describe('the names formulas read', () => {
  it('@carried and @capacity where it counts and says CAN CARRY, then what is worn by column, as the server names them', () => {
    expect(gearTokens(TYPED).map((t) => t.token)).toEqual(['@weapons_weight', '@armor_defense', '@armor_weight', '@spells_slots']);
    expect(wornTokens(TYPED)[1]).toEqual({ token: '@armor_defense', label: 'ARMOR DEFENSE WORN' });
    const on = withEncumbrance(TYPED, { column: 'weight', capacity: '@might * 10' });
    expect(gearTokens(on).slice(0, 2)).toEqual([{ token: '@carried', label: 'CARRIED' }, { token: '@capacity', label: 'CAN CARRY' }]);
    expect(gearTokens(withEncumbrance(TYPED, { column: 'weight' })).map((t) => t.token)).toContain('@carried');
    expect(gearTokens(withEncumbrance(TYPED, { column: 'weight' })).map((t) => t.token)).not.toContain('@capacity');
    // No types of its own: nothing worn by column.
    expect(wornTokens({ format: 1, name: 'Bare' } as Definition)).toEqual([]);
    // Each a name the server knows.
    const { namesOf } = require_('../../../../backend/systemBuilder/choices.js');
    const names = namesOf(on);
    for (const t of gearTokens(on)) expect(names.has(t.token.slice(1)), t.token).toBe(true);
  });
});
