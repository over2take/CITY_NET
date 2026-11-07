/**
 * What FINISH gave, taken back out of the inventory by the GM's START OVER (7c5; backend sheets/kitGiving.js).
 * As far as it can: an item sold is gone, and what else they carry stays.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { kitTakenBack } = require_('../sheets/kitGiving');

const line = (name, qty, carry = 'stowed') => ({ name, qty, enc: '', bundled: false, carry, location: '' });
const holding = (...lines) => ({ inventory: JSON.stringify(lines) });
const after = (items, data) => JSON.parse(kitTakenBack(items, data).inventory).map((l) => [l.name, l.qty, l.carry]);

describe('kitTakenBack', () => {
  it('takes the number given and leaves the rest of that stack', () => {
    expect(after([{ name: 'Rations', qty: 3 }], holding(line('Rations', 5)))).toEqual([['Rations', 2, 'stowed']]);
  });

  it('removes a line brought to nothing, and leaves every other', () => {
    expect(after([{ name: 'Rope', qty: 1 }], holding(line('Rope', 1), line('Sword', 1)))).toEqual([['Sword', 1, 'stowed']]);
  });

  it('goes as far as it can: one sold is simply gone', () => {
    expect(after([{ name: 'Rope', qty: 3 }], holding(line('Rope', 1), line('Sword', 1)))).toEqual([['Sword', 1, 'stowed']]);
    expect(after([{ name: 'Rope', qty: 3 }], holding(line('Sword', 1)))).toEqual([['Sword', 1, 'stowed']]);
  });

  it('reads a name as a catalogue\'s was matched: ignoring case and space', () => {
    expect(after([{ name: ' rope ', qty: 1 }], holding(line('Rope', 2)))).toEqual([['Rope', 1, 'stowed']]);
  });

  it('takes what is carried first, then what was stashed, across lines', () => {
    expect(after([{ name: 'Rope', qty: 1 }], holding(line('Rope', 1, 'stash'), line('Rope', 1, 'readied')))).toEqual([['Rope', 1, 'stash']]);
    expect(after([{ name: 'Rope', qty: 3 }], holding(line('Rope', 2, 'stash'), line('Rope', 2, 'readied')))).toEqual([['Rope', 1, 'stash']]);
  });

  it('takes each item against what the last left', () => {
    expect(after([{ name: 'Rope', qty: 1 }, { name: 'Rope', qty: 1 }], holding(line('Rope', 3)))).toEqual([['Rope', 1, 'stowed']]);
  });

  it('changes nothing with nothing to take', () => {
    expect(kitTakenBack([], holding(line('Rope', 1)))).toEqual({});
  });
});
