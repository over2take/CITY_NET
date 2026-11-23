import { describe, it, expect } from 'vitest';
import { findWords, hasEvery, textHasEvery } from '../findWords';

// How every FIND box matches (8a7c2): GEAR's FIND, the shop's QUICK FIND, GIVE.EXE's search.

describe('a FIND box\'s words', () => {
  it('what is typed, split at spaces, any case, blanks gone', () => {
    expect(findWords('  Heavy   PISTOL ')).toEqual(['heavy', 'pistol']);
    expect(findWords('')).toEqual([]);
    expect(findWords('   ')).toEqual([]);
  });

  it('every word, anywhere, in any order; none typed, everything', () => {
    expect(textHasEvery('Heavy Pistol · DAMAGE 2d6', findWords('2d6 pistol'))).toBe(true);
    expect(textHasEvery('Heavy Pistol · DAMAGE 2d6', findWords('pistol heavy'))).toBe(true);
    expect(textHasEvery('Heavy Pistol · DAMAGE 2d6', findWords('pistol rifle'))).toBe(false);
    expect(textHasEvery('anything', [])).toBe(true);
    expect(hasEvery(['a', 'b'], (w) => w === 'a')).toBe(false);
    expect(hasEvery(['a', 'b'], () => true)).toBe(true);
  });
});
