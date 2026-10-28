/**
 * Modifiers on wires (5b3). Approved mockup builder-graph (2026-10-17), decision 4: where a formula
 * does something simple to one name on its way in (×6, ÷2, halved rounded down or up), a diamond
 * shows it on that name's wire, and its number is changed by rewriting the formula's text, read
 * back by the server's own engine the same.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { modifierOn, modifiersIn, withModifierNumber } from '../modifiers';

const req = createRequire(import.meta.url);
const { parse, evaluate } = req('../../../../backend/systemBuilder/expression.js');
const worked = (text: string, values: Record<string, number>) => evaluate(parse(text, () => true), { field: (n: string) => values[n] ?? 0, rule: () => 0, table: () => 0 });

describe('a modifier read', () => {
  it('in each of its shapes', () => {
    expect(modifierOn('@lvl * 6 + @hrt', 'lvl')).toMatchObject({ kind: 'times', n: 6, label: '×6', words: 'times' });
    expect(modifierOn('6 * @lvl', 'lvl')).toMatchObject({ kind: 'times', n: 6, label: '×6' });
    expect(modifierOn('@lvl / 2', 'lvl')).toMatchObject({ kind: 'divided', n: 2, label: '÷2' });
    expect(modifierOn('@str_mod + floor(@lvl / 2)', 'lvl')).toMatchObject({ kind: 'down', n: 2, label: '÷2↓', words: 'divided by, rounded down' });
    expect(modifierOn('ceil(@lvl / 3)', 'lvl')).toMatchObject({ kind: 'up', n: 3, label: '÷3↑' });
    expect(modifierOn('@lvl * 1.5', 'lvl')).toMatchObject({ n: 1.5, label: '×1.5' });
  });

  it('only where it is plainly that name\'s own', () => {
    expect(modifierOn('@lvl + @hrt', 'lvl')).toBeNull();
    expect(modifierOn('@lvl * 2 + @lvl', 'lvl')).toBeNull();
    expect(modifierOn('6 / @lvl * 2', 'lvl')).toBeNull();
    expect(modifierOn('12 * @lvl', 'lvl')).toMatchObject({ n: 12 });
    expect(modifierOn('@lvl * @hrt', 'lvl')).toBeNull();
    expect(modifierOn('@lvl / 0', 'lvl')).toBeNull();
    expect(modifierOn('@lvl2 * 3', 'lvl')).toBeNull();
    expect(modifierOn('max(@lvl / 2, 1)', 'lvl')).toMatchObject({ kind: 'divided', n: 2 });
  });

  it('every one in a formula, in the order its names are read', () => {
    expect(modifiersIn('floor(@lvl / 2) + @str * 3 + @hrt').map((m) => `${m.name} ${m.label}`)).toEqual(['lvl ÷2↓', 'str ×3']);
  });
});

describe('a modifier\'s number changed', () => {
  it('rewrites that number alone, and the server works it out the new way', () => {
    const next = withModifierNumber('@str_mod + floor(@lvl / 2)', 'lvl', 3)!;
    expect(next).toBe('@str_mod + floor(@lvl / 3)');
    expect(worked(next, { str_mod: 1, lvl: 6 })).toBe(3);
    expect(withModifierNumber('2 * @x2 + 2', 'x2', 5)).toBe('5 * @x2 + 2');
    expect(withModifierNumber('@x2 * 2 + 2', 'x2', 5)).toBe('@x2 * 5 + 2');
    expect(withModifierNumber('@lvl * 6 + 6', 'lvl', 8)).toBe('@lvl * 8 + 6');
  });

  it('changes nothing where there is no modifier, or the number won\'t do', () => {
    expect(withModifierNumber('@lvl + 2', 'lvl', 3)).toBeNull();
    expect(withModifierNumber('@lvl / 2', 'lvl', 0)).toBeNull();
    expect(withModifierNumber('@lvl / 2', 'lvl', Number.NaN)).toBeNull();
  });
});
