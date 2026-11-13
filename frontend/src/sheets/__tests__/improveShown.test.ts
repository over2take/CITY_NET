import { describe, it, expect } from 'vitest';
import { markStates, markTitle, markAction, type ImproveShown } from '../improveShown';

/** IMPROVE BY USE on the sheet, as logic (7f3b): which stats carry a mark, whether each is on, and what it says. */

const IMPROVE: ImproveShown = { stats: [{ id: 'lore', label: 'Lore' }, { id: 'spot', label: 'Spot' }], marked: 'success', at: { id: 'long_rest', name: 'Long rest' } };

describe('the marks', () => {
  it('each stat that improves, marked only by a mark that is one', () => {
    expect([...markStates(IMPROVE, { _marks: { lore: true, spot: 'yes', str: true } })]).toEqual([['lore', true], ['spot', false]]);
    expect([...markStates(IMPROVE, {})]).toEqual([['lore', false], ['spot', false]]);
    expect([...markStates(IMPROVE, { _marks: 'x' })]).toEqual([['lore', false], ['spot', false]]);
    expect([...markStates(null, { _marks: { lore: true } })]).toEqual([]);
    expect([...markStates(IMPROVE, null)]).toEqual([['lore', false], ['spot', false]]);
  });

  it('what each says, marked or not, by what marks it; a click ticks it or clears it', () => {
    expect(markTitle(IMPROVE, true, true)).toBe('MARKED: it rolls to improve at LONG REST. Click to clear.');
    expect(markTitle(IMPROVE, false, true)).toBe('Not marked. A successful roll of it marks it, and a marked stat rolls to improve at LONG REST. Click to mark it.');
    expect(markTitle({ ...IMPROVE, marked: 'any' }, false, false)).toBe('Not marked. Rolling it marks it, and a marked stat rolls to improve at LONG REST.');
    expect(markTitle({ ...IMPROVE, marked: 'hand' }, false, true)).toBe('Not marked. It is marked by hand, and a marked stat rolls to improve at LONG REST. Click to mark it.');
    expect(markAction('lore', true)).toEqual({ kind: 'mark', stat: 'lore', on: false });
    expect(markAction('lore', false)).toEqual({ kind: 'mark', stat: 'lore', on: true });
  });
});
