import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { ALL, LIMIT, typeChoices, resistancesIn, withRow, withNewRow, withoutRow, rowWords, type Resistance } from '../resistances';
import type { Definition } from '../systemsApi';

/**
 * A RESISTANCE row in the builder (8b3b): RESIST, IMMUNE or VULNERABLE to a damage type or ALL, no type twice, at most
 * LIMIT, a type switched off kept and said so; as the server's resistances.js has them.
 */

const { LIMIT: SERVER_LIMIT, ALL: SERVER_ALL } = createRequire(import.meta.url)('../../../../backend/systemBuilder/resistances.js');
const DEF = { format: 1, name: 'Stonehold', damage: { types: { necrotic: { on: false }, fire: { name: 'Flame' }, sonic: { name: 'Sonic' } } } } as unknown as Definition;
const types = (def: Definition, named?: string[]) => typeChoices(def, named).map((t) => `${t.name}${t.off ? '*' : ''}`);

describe('what a row may name', () => {
  it('ALL first, then each type that is on, by name; one switched off only where a row names it, marked', () => {
    expect(types(DEF)).toEqual(['ALL', 'FLAME', 'COLD', 'LIGHTNING', 'ACID', 'POISON', 'RADIANT', 'PSYCHIC', 'FORCE', 'THUNDER', 'BLUDGEONING', 'PIERCING', 'SLASHING', 'SONIC']);
    expect(types(DEF, ['necrotic'])).toContain('NECROTIC*');
    expect(types(DEF, ['necrotic']).indexOf('NECROTIC*')).toBe(types(DEF).indexOf('POISON') + 1);
  });

  it('the server\'s limit and its word for every type', () => {
    expect(LIMIT).toBe(SERVER_LIMIT);
    expect(ALL).toBe(SERVER_ALL);
  });
});

describe('the rows', () => {
  const rows: Resistance[] = [{ kind: 'resist', type: 'fire' }, { kind: 'immune', type: 'poison' }];

  it('read as written, the ill-formed passed over', () => {
    expect(resistancesIn([...rows, { kind: 'shrug', type: 'x' }, { kind: 'resist' }, null, { kind: 'vulnerable', type: 'all', extra: 1 }]))
      .toEqual([...rows, { kind: 'vulnerable', type: 'all' }]);
    expect(resistancesIn('fire')).toEqual([]);
    expect(resistancesIn(Array.from({ length: LIMIT + 3 }, () => ({ kind: 'resist', type: 'fire' })))).toHaveLength(LIMIT);
  });

  it('a row changed; never to a type another names', () => {
    expect(withRow(rows, 0, { kind: 'vulnerable' })).toEqual([{ kind: 'vulnerable', type: 'fire' }, rows[1]]);
    expect(withRow(rows, 0, { type: 'cold' })).toEqual([{ kind: 'resist', type: 'cold' }, rows[1]]);
    expect(withRow(rows, 0, { type: 'poison' })).toBe(rows);
    expect(withRow(rows, 0, { type: 'fire' })).toEqual(rows);
  });

  it('+ RESISTANCE: RESIST to the first type on that no row names; ALL once each is named; none past the limit', () => {
    expect(withNewRow(DEF, [])).toEqual([{ kind: 'resist', type: 'fire' }]);
    expect(withNewRow(DEF, rows).at(-1)).toEqual({ kind: 'resist', type: 'cold' });
    // Few types on, so the limit isn't what stops it: a game of one type on, then ALL, then nothing more.
    const two = { damage: { types: Object.fromEntries(['cold', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'psychic', 'force', 'thunder', 'bludgeoning', 'piercing', 'slashing'].map((id) => [id, { on: false }])) } } as unknown as Definition;
    const both = withNewRow(two, withNewRow(two, []));
    expect(both).toEqual([{ kind: 'resist', type: 'fire' }, { kind: 'resist', type: ALL }]);
    expect(withNewRow(two, both)).toBe(both);
    // ALL named first: the type still offered.
    expect(withNewRow(two, [{ kind: 'immune', type: ALL }])).toEqual([{ kind: 'immune', type: ALL }, { kind: 'resist', type: 'fire' }]);
    const ten = Array.from({ length: LIMIT }, (_, i) => ({ kind: 'resist' as const, type: typeChoices(DEF)[i + 1].id }));
    expect(withNewRow(DEF, ten)).toBe(ten);
  });

  it('× takes one away', () => {
    expect(withoutRow(rows, 0)).toEqual([rows[1]]);
  });

  it('in words: RESIST FLAME, IMMUNE TO ALL, a type not there by its id', () => {
    expect(rowWords(DEF, { kind: 'resist', type: 'fire' })).toBe('RESIST FLAME');
    expect(rowWords(DEF, { kind: 'immune', type: ALL })).toBe('IMMUNE TO ALL');
    expect(rowWords(DEF, { kind: 'vulnerable', type: 'lava' })).toBe('VULNERABLE LAVA');
  });
});
