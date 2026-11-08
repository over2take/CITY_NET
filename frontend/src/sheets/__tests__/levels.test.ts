import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { classDice, healthSet, withHealth, withHealthAdds, withHealthDie, withHealthDieOn, withHealthFormula, levelHomeNote,
  advancesBy, anyTyped, canAddRange, firstAsTyped, isTyped, levelNotes, levelTable, levelsSet, tidyRanges, topAsTyped, withAdvancement, withFilledAgain,
  withFirst, withRangeAdded, withRangeOff, withRangeTo, withRangeX, withTop, withTyped, xpWord,
} from '../levels';
import type { Definition } from '../systemsApi';

/**
 * The builder's LEVELS page as logic (7d1). Held to the server (backend systemBuilder/levels.js), so what the
 * page shows is what the table comes to, and what it writes the server takes.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/levels.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const def = (over: Record<string, unknown> = {}): Definition => ({ format: 1, name: 'L', ...over });
const levelsProblems = (d: Definition) => checkDefinition(d).problems.filter((p: { where: string }) => p.where.startsWith('levels'));
const ranges = (d: Definition) => levelsSet(d).ranges;

describe('where a level shows (7d2b)', () => {
  const on = (advancement: string[], rest: object = {}) => ({ format: 1, name: 'L', core: { advancement }, ...rest }) as never;
  it('says so when nothing on the sheet would show one, where they go up', () => {
    expect(levelHomeNote(on(['levels']))).toMatch(/Nothing on the sheet shows a level yet/);
    expect(levelHomeNote(on(['milestone']))).toMatch(/Nothing on the sheet/);
    expect(levelHomeNote(on(['levels'], { choices: [{ id: 'feats' }] }))).toMatch(/Nothing on the sheet/);
  });
  it('and not with a levelled list, a level stat or formula, or where they do not go up', () => {
    expect(levelHomeNote(on(['levels'], { choices: [{ id: 'c', levelled: true }] }))).toBeNull();
    expect(levelHomeNote(on(['levels'], { stats: [{ id: 'a', stats: [{ id: 'level' }] }] }))).toBeNull();
    expect(levelHomeNote(on(['levels'], { derived: [{ id: 'level' }] }))).toBeNull();
    expect(levelHomeNote(on(['spend']))).toBeNull();
  });
});

describe('held to the server', () => {
  const samples: Record<string, unknown>[] = [
    {},
    { top: 5, first: 100, ranges: [{ to: 5, x: 2 }] },
    { top: 10, first: 300, ranges: [{ to: 5, x: 2 }, { to: 10, x: 1.5 }] },
    { top: 12, first: 7, ranges: [{ to: 4, x: 3 }, { to: 8, x: 1.5 }, { to: 12, x: 2 }], typed: { 6: 5000 } },
    { top: 30, first: 1000000000, ranges: [{ to: 30, x: 3 }] },
  ];
  for (const levels of samples) {
    it(`the same table for ${JSON.stringify(levels)}`, () => {
      expect(levelTable(def({ levels }))).toEqual(backend.levelTable(def({ levels })));
    });
  }

  it('the same defaults', () => {
    expect(levelsSet(def())).toEqual({ ...backend.DEFAULTS, typed: {} });
  });

  it('the same words for a level that doesn\'t climb', () => {
    const d = def({ levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], typed: { 3: 50 } } });
    expect(levelNotes(d).map((n) => n)).toEqual(levelsProblems(d).map((p: { message: string }) => p.message));
  });

  it('everything the page writes, the server takes', () => {
    let d = def();
    d = withTop(d, 12);
    d = withFirst(d, 500);
    d = withRangeAdded(d);
    d = withRangeX(d, 1, 3);
    d = withRangeAdded(d);
    d = withRangeTo(d, 0, 4);
    d = withTyped(d, 12, 99999999);
    d = withAdvancement(d, 'levels');
    expect(levelsProblems(d)).toEqual([]);
    d = withRangeOff(d, 1);
    expect(levelsProblems(d)).toEqual([]);
    d = withTop(d, 3);
    expect(levelsProblems(d)).toEqual([]);
  });
});

describe('the ranges stay joined', () => {
  it('the last reaches the highest level, whatever it said', () => {
    expect(tidyRanges([{ to: 5, x: 2 }], 10)).toEqual([{ to: 10, x: 2 }]);
    expect(tidyRanges([{ to: 50, x: 2 }], 10)).toEqual([{ to: 10, x: 2 }]);
  });

  it('each ends at or after where it starts, and the first at 2 at the least', () => {
    expect(tidyRanges([{ to: 1, x: 2 }, { to: 10, x: 3 }], 10)).toEqual([{ to: 2, x: 2 }, { to: 10, x: 3 }]);
    expect(tidyRanges([{ to: 5, x: 2 }, { to: 3, x: 3 }, { to: 10, x: 1.5 }], 10)).toEqual([{ to: 5, x: 2 }, { to: 6, x: 3 }, { to: 10, x: 1.5 }]);
  });

  it('one pushed past the highest level drops those after it', () => {
    expect(tidyRanges([{ to: 12, x: 2 }, { to: 20, x: 3 }], 10)).toEqual([{ to: 10, x: 2 }]);
  });

  it('none is one range of 2', () => {
    expect(tidyRanges([], 8)).toEqual([{ to: 8, x: 2 }]);
  });

  it('a highest level lowered takes the ranges with it', () => {
    const d = withTop(def({ levels: { top: 10, ranges: [{ to: 5, x: 2 }, { to: 10, x: 3 }] } }), 4);
    expect(ranges(d)).toEqual([{ to: 4, x: 2 }]);
  });
});

describe('adding and taking off a range', () => {
  it('a new one takes the top half of the last, at its multiplier', () => {
    expect(ranges(withRangeAdded(def()))).toEqual([{ to: 5, x: 2 }, { to: 10, x: 2 }]);
    const two = withRangeX(withRangeAdded(def()), 1, 3);
    expect(ranges(withRangeAdded(two))).toEqual([{ to: 5, x: 2 }, { to: 7, x: 3 }, { to: 10, x: 3 }]);
  });

  it('only with room to split', () => {
    const tight = def({ levels: { top: 2, ranges: [{ to: 2, x: 2 }] } });
    expect(canAddRange(tight)).toBe(false);
    expect(withRangeAdded(tight)).toBe(tight);
    expect(canAddRange(def({ levels: { top: 3, ranges: [{ to: 3, x: 2 }] } }))).toBe(true);
    const full = def({ levels: { top: 7, ranges: [{ to: 5, x: 2 }, { to: 7, x: 2 }] } });
    expect(canAddRange(full)).toBe(true);
    expect(canAddRange(def({ levels: { top: 6, ranges: [{ to: 5, x: 2 }, { to: 6, x: 2 }] } }))).toBe(false);
  });

  it('taken off, its neighbor covers its levels', () => {
    const d = def({ levels: { top: 10, ranges: [{ to: 3, x: 2 }, { to: 6, x: 3 }, { to: 10, x: 1.5 }] } });
    expect(ranges(withRangeOff(d, 1))).toEqual([{ to: 3, x: 2 }, { to: 10, x: 1.5 }]);
    expect(ranges(withRangeOff(d, 2))).toEqual([{ to: 3, x: 2 }, { to: 10, x: 3 }]);
    expect(ranges(withRangeOff(d, 0))).toEqual([{ to: 6, x: 3 }, { to: 10, x: 1.5 }]);
  });

  it('moving an end and a multiplier touch that range only', () => {
    const d = def({ levels: { top: 10, ranges: [{ to: 5, x: 2 }, { to: 10, x: 3 }] } });
    expect(ranges(withRangeTo(d, 0, 7))).toEqual([{ to: 7, x: 2 }, { to: 10, x: 3 }]);
    expect(ranges(withRangeX(d, 0, 1.5))).toEqual([{ to: 5, x: 1.5 }, { to: 10, x: 3 }]);
  });
});

describe('typing over', () => {
  it('a level takes the number, the others keep theirs, and it says which were typed', () => {
    const d = withTyped(def({ levels: { top: 4, first: 100, ranges: [{ to: 4, x: 2 }] } }), 3, 999);
    expect(levelTable(d)).toEqual({ 2: 100, 3: 999, 4: 700 });
    expect(isTyped(d, 3)).toBe(true);
    expect(isTyped(d, 2)).toBe(false);
    expect(anyTyped(d)).toBe(true);
  });

  it('a second level typed keeps the first', () => {
    const d = withTyped(withTyped(def(), 3, 999), 4, 5000);
    expect(levelTable(d)).toMatchObject({ 3: 999, 4: 5000 });
  });

  it('survives the cost and ranges changing', () => {
    let d = withTyped(def(), 3, 999);
    d = withFirst(d, 50);
    d = withRangeAdded(d);
    expect(levelTable(d)[3]).toBe(999);
  });

  it('FILL IT AGAIN keeps nothing typed, and writes nothing empty', () => {
    const d = withFilledAgain(withTyped(def(), 3, 999));
    expect(anyTyped(d)).toBe(false);
    expect(levelTable(d)[3]).toBe(900);
    expect(d.levels).not.toHaveProperty('typed');
  });

  it('says a level that doesn\'t climb, only where it was touched', () => {
    const d = withTyped(def({ levels: { top: 4, first: 100, ranges: [{ to: 4, x: 2 }] } }), 3, 50);
    expect(levelNotes(d)).toEqual(['Level 3 needs more than level 2, 100']);
    expect(levelNotes(withTyped(d, 3, 101))).toEqual([]);
    expect(levelNotes(def({ levels: { top: 30, first: 1000000000, ranges: [{ to: 30, x: 100 }] } }))).toEqual([]);
  });
});

describe('what the boxes show', () => {
  it('what was typed, even while it doesn\'t read yet, with the table staying on what does', () => {
    const d = withTop(def(), 1);
    expect(topAsTyped(d)).toBe(1);
    expect(levelsSet(d).top).toBe(10);
    expect(Object.keys(levelTable(d))).toHaveLength(9);
    const f = withFirst(def(), 0);
    expect(firstAsTyped(f)).toBe(0);
    expect(levelsSet(f).first).toBe(300);
  });

  it('with nothing typed, the defaults', () => {
    expect(topAsTyped(def())).toBe(10);
    expect(firstAsTyped(def())).toBe(300);
  });
});

describe('how they advance', () => {
  it('is the setup question\'s answer, either or both or neither, leaving the rest of it', () => {
    const d = def({ core: { dice: ['d20'], advancement: ['spend'] } });
    expect(advancesBy(d, 'levels')).toBe(false);
    const on = withAdvancement(d, 'levels');
    expect(advancesBy(on, 'levels')).toBe(true);
    expect(advancesBy(on, 'spend')).toBe(true);
    expect(on.core).toMatchObject({ dice: ['d20'] });
    expect(advancesBy(withAdvancement(on, 'levels'), 'levels')).toBe(false);
  });

  it('with no answer yet, none', () => {
    expect(advancesBy(def(), 'levels')).toBe(false);
    expect((withAdvancement(def(), 'milestone').core as { advancement: string[] }).advancement).toEqual(['milestone']);
  });
});

describe('the word', () => {
  it('XP, until WORDS renames it', () => {
    expect(xpWord(def())).toBe('XP');
    expect(xpWord(def({ words: { xp: { short: 'KARMA' } } }))).toBe('KARMA');
    expect(xpWord(def({ words: { xp: { short: ' ' } } }))).toBe('XP');
  });
});

describe('MAX HEALTH (7d4)', () => {
  const base = { format: 1, name: 'L', levels: { top: 6, first: 100, ranges: [{ to: 6, x: 2 }] } } as never;
  it('AS IT IS until it says otherwise', () => {
    const none = { formula: '', dieOn: 'class', die: null, adds: '' };
    expect(healthSet(base)).toEqual({ how: 'as_is', ...none });
    expect(healthSet({ format: 1, name: 'L' } as never)).toEqual({ how: 'as_is', ...none });
    expect(healthSet({ format: 1, name: 'L', levels: { health: { how: 'dice', formula: 3, die: 'd8', adds: 2 } } } as never)).toEqual({ how: 'as_is', ...none });
  });
  it('A FORMULA set and typed; the formula kept going back to AS IT IS; nothing kept with nothing to keep', () => {
    const on = withHealthFormula(withHealth(base, 'formula'), '10 + @con');
    expect((on as { levels: { health: unknown } }).levels.health).toEqual({ how: 'formula', formula: '10 + @con' });
    expect(healthSet(on)).toEqual({ how: 'formula', formula: '10 + @con', dieOn: 'class', die: null, adds: '' });
    const back = withHealth(on, 'as_is');
    expect((back as { levels: { health: unknown } }).levels.health).toEqual({ how: 'as_is', formula: '10 + @con' });
    const none = withHealth(base, 'as_is');
    expect('health' in (none as { levels: object }).levels).toBe(false);
    expect((withHealth(base, 'formula') as { levels: { health: unknown } }).levels.health).toEqual({ how: 'formula' });
  });
  it('the table\'s own edits keep it', () => {
    const on = withHealthFormula(withHealth(base, 'formula'), '10 + @con');
    for (const next of [withTop(on, 8), withFirst(on, 200), withRangeX(on, 0, 3), withTyped(on, 3, 900)]) {
      expect((next as { levels: { health: unknown } }).levels.health, JSON.stringify(next)).toEqual({ how: 'formula', formula: '10 + @con' });
    }
  });
});

describe('MAX HEALTH: PER LEVEL (7d5a)', () => {
  const base = { format: 1, name: 'L', levels: { top: 6 }, choices: [
    { id: 'classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }, { id: 'monk', label: 'Monk' }] },
    { id: 'feats', options: [{ id: 'tough', label: 'Tough' }] },
  ] } as never;
  const health = (d: unknown) => (d as { levels: { health?: unknown } }).levels.health;
  it('PER LEVEL, on each class to start; ONE FOR ALL starts at a d8 and keeps what is picked', () => {
    const on = withHealth(base, 'level');
    expect(health(on)).toEqual({ how: 'level' });
    expect(healthSet(on)).toEqual({ how: 'level', formula: '', dieOn: 'class', die: null, adds: '' });
    const all = withHealthDieOn(on, 'all');
    expect(health(all)).toEqual({ how: 'level', die_on: 'all', die: 8 });
    expect(health(withHealthDieOn(withHealthDie(all, 12), 'all'))).toEqual({ how: 'level', die_on: 'all', die: 12 });
    expect(health(withHealthDieOn(withHealthDie(all, 12), 'class'))).toEqual({ how: 'level', die: 12 });
  });
  it('EACH LEVEL ADDS typed, and everything kept going to another way and back', () => {
    const typed = withHealthAdds(withHealthDieOn(withHealth(base, 'level'), 'all'), '@con_mod');
    expect(health(typed)).toEqual({ how: 'level', die_on: 'all', die: 8, adds: '@con_mod' });
    expect(health(withHealth(typed, 'as_is'))).toEqual({ how: 'as_is', die_on: 'all', die: 8, adds: '@con_mod' });
    expect(health(withHealthAdds(withHealth(base, 'level'), ''))).toEqual({ how: 'level' });
  });
  it('each class\'s HIT DIE, from the levelled lists only', () => {
    expect(classDice(base)).toEqual([{ name: 'Fighter', die: 10 }, { name: 'Monk', die: null }]);
    expect(classDice({ format: 1, name: 'L' } as never)).toEqual([]);
  });
});
