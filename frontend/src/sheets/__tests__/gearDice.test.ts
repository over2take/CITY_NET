import { describe, it, expect } from 'vitest';
import { diceWords, shapeText, insertName, type GearDiceRead } from '../gearDice';

// A gear line's DAMAGE or DICE in words, and the box's eˣ (8a3c2; approved mockup gear-compact.html, decision 4).

const NAMES = [{ token: '@might', label: 'MIGHT' }, { token: '@might_mod', label: 'MIGHT MOD' }];

describe('what a box says under it', () => {
  it('on this character: each name by its label with its value, and the least to the most', () => {
    const read: GearDiceRead = { ok: true, low: 3, high: 10, used: [{ token: '@might_mod', label: 'Might mod', value: 2 }], names: NAMES };
    expect(diceWords('1d8 + @might_mod', read, 'Damage')).toEqual({ words: 'ON THIS CHARACTER: 1d8 + Might mod (2): 3 to 10', bad: false });
    // One number, said once.
    expect(diceWords('3', { ok: true, low: 3, high: 3, used: [], names: NAMES }, 'DAMAGE').words).toBe('ON THIS CHARACTER: 3: 3');
    // A name used twice, said each time.
    expect(diceWords('@might + @might', { ok: true, low: 28, high: 28, used: [{ token: '@might', label: 'Might', value: 14 }], names: NAMES }, 'DAMAGE').words)
      .toBe('ON THIS CHARACTER: Might (14) + Might (14): 28');
  });

  it('what is wrong, in the danger color; none typed, what an empty box means; not yet read, reading', () => {
    expect(diceWords('1d6 + @strength', { ok: false, error: "@strength isn't one of this system's names" }, 'DAMAGE'))
      .toEqual({ words: "@STRENGTH ISN'T ONE OF THIS SYSTEM'S NAMES: IT WON'T ROLL", bad: true });
    expect(diceWords('  ', null, 'heals')).toEqual({ words: 'NONE: THIS LINE HAS NO HEALS', bad: false });
    expect(diceWords('1d6', { ok: true, blank: true, names: [] }, 'DAMAGE').words).toBe('NONE: THIS LINE HAS NO DAMAGE');
    expect(diceWords('1d6', null, 'DAMAGE')).toEqual({ words: 'READING IT…', bad: false });
  });
});

describe('eˣ', () => {
  it('SHAPE writes a number, a die, or a die and the system\'s first name', () => {
    expect(shapeText('A NUMBER', NAMES)).toBe('3');
    expect(shapeText('DICE', NAMES)).toBe('1d6');
    expect(shapeText('DICE AND A STAT', NAMES)).toBe('1d8 + @might');
    expect(shapeText('DICE AND A STAT', [])).toBe('1d8 + @level');
  });

  it('INSERT puts a name in at the cursor, joined with " + ", or after a sign as it is', () => {
    expect(insertName('1d8', 3, '@might_mod')).toEqual({ text: '1d8 + @might_mod', cursor: 16 });
    expect(insertName('', 0, '@might')).toEqual({ text: '@might', cursor: 6 });
    expect(insertName('1d8 - ', 6, '@might')).toEqual({ text: '1d8 - @might', cursor: 12 });
    // In the middle: what follows it kept after it.
    expect(insertName('1d8 + 2', 3, '@might')).toEqual({ text: '1d8 + @might + 2', cursor: 12 });
  });
});
