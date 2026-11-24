import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { damageParts, rowsOf, textOf, withRow, withNewRow, withoutRow, type DamageRow } from '../damageRows';

/**
 * An item's DAMAGE as rows (8b2b): read as the server reads it (backend damageText.js), held to it here on every shape; the
 * rows written back as text the server checks and rolls into the same parts and types.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/damageText.js');
const { damageTypesOf } = req('../../../../backend/systemBuilder/damageTypes.js');

const TYPES = [{ id: 'fire', name: 'Fire' }, { id: 'slashing', name: 'Slashing' }, { id: 'cold', name: 'Cold' }, { id: 'hell', name: 'Hell  Fire' }];
const ANY = { known: () => true, refused: (n: string) => `@${n}` };
const SHAPES = [
  '1d8 + @might_mod', '2d6 FIRE DMG', '2d6 fire dmg', '1d8 DMG', '3d6 Hell  Fire', "2d4 Dragon's-Breath", '1d8 SLASHING + 2d6 FIRE DMG',
  '1d8 + 2d6 FIRE', '2d6 FIRE + 2', '2d6 FIRE - 1', '1d6 dmg + 1d4 cold', '@level d8 + @might_mod FIRE', 'max(1d4, @might_mod) COLD',
  'if(@might > 12 and @might_mod, 2d6, 1d6) ACID', 'd20 FORCE', 'floor (1d6 / 2)', '1d6 and', 'max(1d4, cold) FIRE', '2d6 fire-', 'FIRE', '',
];

describe('read as the server reads it', () => {
  it('every shape: the same parts, dice and words', () => {
    for (const s of SHAPES) expect(damageParts(s), s).toEqual(backend.damageParts(s));
  });
});

describe('the rows a DAMAGE is', () => {
  it('empty: one empty row; plain dice: one row of no type', () => {
    expect(rowsOf('', TYPES)).toEqual([{ dice: '', type: null }]);
    expect(rowsOf('  ', TYPES)).toEqual([{ dice: '', type: null }]);
    expect(rowsOf('1d8 + @might_mod', TYPES)).toEqual([{ dice: '1d8 + @might_mod', type: null }]);
  });

  it('each part its dice and its type, by name in any case and spacing', () => {
    expect(rowsOf('1d8 slashing + 2d6 FIRE DMG', TYPES)).toEqual([{ dice: '1d8', type: 'slashing' }, { dice: '2d6', type: 'fire' }]);
    expect(rowsOf('2d6 FIRE + 2', TYPES)).toEqual([{ dice: '2d6', type: 'fire' }, { dice: '2', type: null }]);
    expect(rowsOf('1d6 dmg + 1d4 cold', TYPES)).toEqual([{ dice: '1d6', type: null }, { dice: '1d4', type: 'cold' }]);
    expect(rowsOf('3d6 hell fire', TYPES)).toEqual([{ dice: '3d6', type: 'hell' }]);
  });

  it('none where the rows can\'t say it the same: a word that is no type, a type with no dice', () => {
    expect(rowsOf('2d6 sonic', TYPES)).toBeNull();
    expect(rowsOf('FIRE', TYPES)).toBeNull();
    expect(rowsOf('2d6 FIRE + COLD', TYPES)).toBeNull();
  });
});

describe('the rows as the text kept', () => {
  const said = (rows: DamageRow[]) => textOf(rows, TYPES);
  it('one plain part its dice alone; a type, then DMG; several, each its own', () => {
    expect(said([{ dice: '1d8 + @might_mod', type: null }])).toBe('1d8 + @might_mod');
    expect(said([{ dice: ' 2d6 ', type: 'fire' }])).toBe('2d6 FIRE DMG');
    expect(said([{ dice: '1d8', type: 'slashing' }, { dice: '2d6', type: 'fire' }])).toBe('1d8 SLASHING + 2d6 FIRE DMG');
    // A part with no type before a typed one stays its own; one at the end needs nothing.
    expect(said([{ dice: '1d6', type: null }, { dice: '1d4', type: 'cold' }])).toBe('1d6 DMG + 1d4 COLD DMG');
    expect(said([{ dice: '2d6', type: 'fire' }, { dice: '2', type: null }])).toBe('2d6 FIRE + 2');
    expect(said([{ dice: '2d6', type: 'fire' }, { dice: '- 1', type: null }])).toBe('2d6 FIRE - 1');
    expect(said([{ dice: '3d6', type: 'hell' }])).toBe('3d6 HELL  FIRE DMG');
  });

  it('a part with no dice yet left out; none at all, nothing', () => {
    expect(said([{ dice: '2d6', type: 'fire' }, { dice: '  ', type: 'cold' }])).toBe('2d6 FIRE DMG');
    expect(said([{ dice: '', type: 'fire' }])).toBe('');
    expect(said([{ dice: '2d6', type: 'gone' }])).toBe('2d6');
  });

  it('written and read again, the same rows; the server takes it and rolls it into the same parts and types', () => {
    const types = damageTypesOf({ format: 1, name: 'T', damage: { types: { hell: { name: 'Hell  Fire' } } } });
    const lists: DamageRow[][] = [
      [{ dice: '1d8 + @might_mod', type: null }],
      [{ dice: '2d6', type: 'fire' }],
      [{ dice: '1d8 + @might_mod', type: 'slashing' }, { dice: '2d6', type: 'fire' }],
      [{ dice: '1d6', type: null }, { dice: '1d4', type: 'cold' }, { dice: '2', type: null }],
      [{ dice: 'max(1d4, @might_mod)', type: 'cold' }, { dice: '- 1', type: null }],
      [{ dice: '3d6', type: 'hell' }, { dice: '1d4', type: 'slashing' }],
    ];
    for (const rows of lists) {
      const text = said(rows);
      expect(rowsOf(text, TYPES), text).toEqual(rows);
      expect(backend.damageProblem(text, ANY), text).toBeNull();
      const rolled = backend.rollDamage(text, {}, ANY, () => 0, types);
      expect(rolled.parts.map((p: { type: string | null }) => p.type), text).toEqual(rows.map((r) => r.type));
    }
  });
});

describe('a part changed, added, taken off', () => {
  const rows: DamageRow[] = [{ dice: '1d8', type: 'slashing' }, { dice: '2d6', type: 'fire' }];
  it('one changed, the rest as they were', () => {
    expect(withRow(rows, 1, { type: 'cold' })).toEqual([{ dice: '1d8', type: 'slashing' }, { dice: '2d6', type: 'cold' }]);
    expect(rows[1].type).toBe('fire');
  });
  it('+ PART: blank, the column\'s MOST LINES ARE, else the last part\'s type', () => {
    expect(withNewRow(rows, 'cold').at(-1)).toEqual({ dice: '', type: 'cold' });
    expect(withNewRow(rows).at(-1)).toEqual({ dice: '', type: 'fire' });
    expect(withNewRow([{ dice: '1d4', type: null }]).at(-1)).toEqual({ dice: '', type: null });
  });
  it('×: one taken off, never the last', () => {
    expect(withoutRow(rows, 0)).toEqual([{ dice: '2d6', type: 'fire' }]);
    expect(withoutRow([rows[0]], 0)).toEqual([rows[0]]);
  });
});
