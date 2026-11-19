import { describe, it, expect } from 'vitest';
import { carryingOf, meterOf, legendOf, conditionLine, amount, type Carrying } from '../carrying';

// CARRYING on GEAR, as logic (8a6a; approved mockup docs/mockups/carrying-on-sheet.html).

const BANDS = [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }];
const base: Carrying = {
  carried: 38, capacity: 50, unit: 'LB', band: 'ENCUMBERED', says: 'Speed -10 ft.', condition: 'slowed', conditionName: 'Slowed',
  bands: BANDS, past: 'OVERLOADED',
};
const at = (c: Partial<Carrying>): Carrying => ({ ...base, ...c });

describe('carryingOf', () => {
  it('reads what the server worked out', () => {
    expect(carryingOf({ _worked: { carrying: { ...base } } })).toEqual(base);
  });
  it('null where the system counts nothing: no _worked, no carrying, no number carried', () => {
    expect(carryingOf({})).toBeNull();
    expect(carryingOf(null)).toBeNull();
    expect(carryingOf({ _worked: [] })).toBeNull();
    expect(carryingOf({ _worked: {} })).toBeNull();
    expect(carryingOf({ _worked: { carrying: [] } })).toBeNull();
    expect(carryingOf({ _worked: { carrying: { carried: '38' } } })).toBeNull();
    expect(carryingOf({ _worked: { carrying: { carried: NaN } } })).toBeNull();
  });
  it('anything odd read as nothing: no capacity, no unit, no words, broken bands dropped', () => {
    expect(carryingOf({ _worked: { carrying: { carried: 20, capacity: 'x', unit: 5, band: '', says: 3, condition: null, conditionName: {},
      bands: [{ word: 'LIGHT', upto: 50 }, { word: 7, upto: 60 }, { word: 'X', upto: 'y' }, null, ['a']], past: '' } } }))
      .toEqual({ carried: 20, capacity: null, unit: '', band: null, says: null, condition: null, conditionName: null, bands: [{ word: 'LIGHT', upto: 50 }], past: null });
    expect(carryingOf({ _worked: { carrying: { carried: 20, bands: 'LIGHT' } } })!.bands).toEqual([]);
  });
});

describe('amount', () => {
  it('two places at most, and none where none are needed', () => {
    expect(amount(0.1 + 0.2)).toBe('0.3');
    expect(amount(12.345)).toBe('12.35');
    expect(amount(40)).toBe('40');
  });
});

describe('meterOf', () => {
  it('filled to what is carried against the last band\'s end, a tick where each other band ends', () => {
    expect(meterOf(base)).toEqual({ fill: 76, ticks: [50], tone: 'warning' });
  });
  it('the last band past CAN CARRY: the meter reaches it, the ticks in its share', () => {
    expect(meterOf(at({ carried: 60, bands: [{ word: 'LIGHT', upto: 100 }, { word: 'HEAVY', upto: 200 }], band: 'LIGHT' })))
      .toEqual({ fill: 60, ticks: [50], tone: 'green' });
  });
  it('green in the first band, the warning color past it, danger past every band', () => {
    expect(meterOf(at({ carried: 10, band: 'LIGHT' }))!.tone).toBe('green');
    expect(meterOf(at({ carried: 30, band: 'ENCUMBERED' }))!.tone).toBe('warning');
    expect(meterOf(at({ carried: 70, band: 'OVERLOADED' }))).toEqual({ fill: 100, ticks: [50], tone: 'danger' });
  });
  it('no bands: CAN CARRY is the whole meter, danger only past it', () => {
    expect(meterOf(at({ bands: [], band: null, carried: 25 }))).toEqual({ fill: 50, ticks: [], tone: 'green' });
    expect(meterOf(at({ bands: [], band: null, carried: 50 }))!.tone).toBe('green');
    expect(meterOf(at({ bands: [], band: null, carried: 51 }))!.tone).toBe('danger');
  });
  it('bands in any order: the meter is the largest, the first band the smallest', () => {
    const shuffled = [{ word: 'ENCUMBERED', upto: 100 }, { word: 'LIGHT', upto: 50 }];
    expect(meterOf(at({ bands: shuffled, band: 'LIGHT', carried: 10 }))).toEqual({ fill: 20, ticks: [50], tone: 'green' });
    expect(meterOf(at({ bands: shuffled, band: 'ENCUMBERED', carried: 30 }))!.tone).toBe('warning');
  });
  it('never under 0 or past 100; CAN CARRY 0 is full with anything on', () => {
    expect(meterOf(at({ carried: -5, band: 'LIGHT' }))!.fill).toBe(0);
    expect(meterOf(at({ capacity: 0, carried: 3, band: 'OVERLOADED' }))!.fill).toBe(100);
    expect(meterOf(at({ capacity: 0, carried: 0, band: 'LIGHT' }))!.fill).toBe(0);
  });
  it('none without CAN CARRY', () => {
    expect(meterOf(at({ capacity: null }))).toBeNull();
  });
});

describe('legendOf', () => {
  it('each band with where it ends, in the sheet\'s own numbers, then past them', () => {
    expect(legendOf(base)).toBe('LIGHT ≤ 25 · ENCUMBERED ≤ 50 · OVERLOADED');
    expect(legendOf(at({ capacity: 33 }))).toBe('LIGHT ≤ 16.5 · ENCUMBERED ≤ 33 · OVERLOADED');
  });
  it('no word past them: the bands alone', () => {
    expect(legendOf(at({ past: null }))).toBe('LIGHT ≤ 25 · ENCUMBERED ≤ 50');
  });
  it('empty with no bands, or no CAN CARRY', () => {
    expect(legendOf(at({ bands: [] }))).toBe('');
    expect(legendOf(at({ capacity: null }))).toBe('');
  });
});

describe('conditionLine', () => {
  it('said where the band has put it on', () => {
    expect(conditionLine(base, 'slowed', false)).toBe('SLOWED ON WHILE ENCUMBERED');
  });
  it('the id where the condition has no name', () => {
    expect(conditionLine(at({ conditionName: null }), 'slowed', false)).toBe('SLOWED ON WHILE ENCUMBERED');
  });
  it('nothing where the band hasn\'t put it on, or names none', () => {
    expect(conditionLine(base, undefined, false)).toBeNull();
    expect(conditionLine(base, 'prone', false)).toBeNull();
    expect(conditionLine(at({ condition: null }), 'slowed', false)).toBeNull();
    expect(conditionLine(at({ condition: null }), undefined, true)).toBeNull();
  });
  it('no token: nothing to put it on, said', () => {
    expect(conditionLine(base, undefined, true)).toBe('SLOWED · no token on the map');
  });
});
