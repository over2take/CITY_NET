import { describe, it, expect } from 'vitest';
import { pickColumnsOf, withPick, pickedIn } from '../shelfPicks';

// A type's quick filters in the shop (8a7c3): its PICK ONE columns as buttons, ALL first.

describe('the quick filters of a type', () => {
  it('each PICK ONE column with words, in its order, its name in capitals; nothing else', () => {
    expect(pickColumnsOf({ columns: [
      { id: 'dmg', label: 'DAMAGE', kind: 'damage' },
      // Words on a column of another kind are not its buttons.
      { id: 'ammo', label: 'AMMO', kind: 'count', options: ['FULL'] },
      { id: 'grade', label: 'Grade', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
      { id: 'empty', label: 'EMPTY', kind: 'pick', options: [] },
      { id: 'odd', label: 'ODD', kind: 'pick', options: ['', 3, 'ONE'] },
      { id: 'finish', label: '', kind: 'pick', options: ['MATTE'] },
    ] })).toEqual([
      { id: 'grade', label: 'GRADE', options: ['LIGHT', 'HEAVY'] },
      { id: 'odd', label: 'ODD', options: ['ONE'] },
      { id: 'finish', label: 'FINISH', options: ['MATTE'] },
    ]);
    expect(pickColumnsOf(undefined)).toEqual([]);
    expect(pickColumnsOf({})).toEqual([]);
    expect(pickColumnsOf({ columns: [{ id: 'grade', label: 'GRADE', kind: 'pick' }] })).toEqual([]);
  });

  it('a word picked per column; none puts the column back to ALL; the picks before are left as they were', () => {
    const before = { grade: 'LIGHT' };
    expect(withPick(before, 'finish', 'CHROME')).toEqual({ grade: 'LIGHT', finish: 'CHROME' });
    expect(withPick(before, 'grade', 'HEAVY')).toEqual({ grade: 'HEAVY' });
    expect(withPick(before, 'grade', '')).toEqual({});
    expect(before).toEqual({ grade: 'LIGHT' });
  });

  it('a line shows when it has every word picked, exactly; nothing picked, every line', () => {
    expect(pickedIn({ grade: 'HEAVY', finish: 'CHROME' }, { grade: 'HEAVY', finish: 'CHROME' })).toBe(true);
    expect(pickedIn({ grade: 'HEAVY', finish: 'MATTE' }, { grade: 'HEAVY', finish: 'CHROME' })).toBe(false);
    expect(pickedIn({ grade: 'heavy' }, { grade: 'HEAVY' })).toBe(false);
    expect(pickedIn({}, { grade: 'HEAVY' })).toBe(false);
    expect(pickedIn(undefined, {})).toBe(true);
    expect(pickedIn({ grade: 'LIGHT' }, {})).toBe(true);
  });
});
