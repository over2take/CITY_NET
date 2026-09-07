import { describe, it, expect } from 'vitest';
import { xpForLevel, xpProgress, describeXp, CWN_MAX_LEVEL, SLOW_ADVANCEMENT_RULE } from '../cwnAdvancement';
import { getTemplate } from '../index';

/**
 * Experience and levelling (CWN p44-45).
 *
 * The book prints two columns and tells the table to pick one, so the sheet asks rather
 * than choosing. Nothing here advances anybody: levelling grants three skill points and
 * sometimes a Focus, both of which are decisions, so the bar says "ready" and leaves the
 * level field to the person who made them.
 */

/** The rate is a house rule, so it travels beside the sheet rather than in it. */
const at = (over = {}) => ({ level: 1, xp: 0, ...over });
const prog = (data, rate = 'fast') => xpProgress(data, rate);

describe('the thresholds the book prints', () => {
  it('carries the fast column', () => {
    const fast = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => xpForLevel(l, 'fast'));
    expect(fast).toEqual([3, 6, 12, 18, 27, 39, 54, 72, 93]);
  });

  it('carries the slow column', () => {
    const slow = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => xpForLevel(l, 'slow'));
    expect(slow).toEqual([6, 15, 24, 36, 51, 69, 87, 105, 139]);
  });

  it('costs nothing to be level 1, and stops at 10', () => {
    expect(xpForLevel(1, 'fast')).toBe(0);
    expect(CWN_MAX_LEVEL).toBe(10);
    expect(xpForLevel(11, 'fast')).toBeNull();
  });

  it('names the house rule that picks the column', () => {
    // Not a field on the sheet: the whole table advances on one column, so a GM sets it
    // once. As a field it would have to be set per character and could disagree between
    // them, which is not a state the rules have a meaning for.
    expect(SLOW_ADVANCEMENT_RULE).toBe('cwn_slow_advancement');
  });
});

describe('where a character is between levels', () => {
  it('names the next level and what it needs', () => {
    const p = prog(at({ level: 3, xp: 8 }));
    expect(p.nextLevel).toBe(4);
    expect(p.nextAt).toBe(12);
    expect(p.remaining).toBe(4);
    expect(p.ready).toBe(false);
  });

  it('measures the bar from this level, not from zero', () => {
    // Level 3 costs 6 and level 4 costs 12, so 9 XP is halfway through level 3. Measured
    // from zero it would read 75% and barely move for the whole of a late level.
    expect(prog(at({ level: 3, xp: 9 })).fraction).toBeCloseTo(0.5);
    expect(prog(at({ level: 3, xp: 6 })).fraction).toBe(0);
  });

  it('says ready rather than levelling anyone up', () => {
    // Advancing grants skill points and sometimes a Focus. Both are choices.
    const p = prog(at({ level: 3, xp: 12 }));
    expect(p.ready).toBe(true);
    expect(p.level).toBe(3);
    expect(describeXp(p)).toBe('LEVEL 3 · READY FOR 4');
  });

  it('follows the slow column when the table picked it', () => {
    const p = prog(at({ level: 3, xp: 12 }), 'slow');
    expect(p.nextAt).toBe(24);
    expect(p.ready).toBe(false);
  });

  it('stops at the top of the table', () => {
    const p = prog(at({ level: 10, xp: 400 }));
    expect(p.capped).toBe(true);
    expect(p.nextLevel).toBeNull();
    expect(p.fraction).toBe(1);
    expect(describeXp(p)).toBe('LEVEL 10 · MAX');
  });
});

describe('sheets that are not filled in yet', () => {
  it('reads a blank level as 1, which is where the book starts operators', () => {
    expect(prog({}).level).toBe(1);
    expect(prog({ level: 0 }).level).toBe(1);
    expect(prog(null).level).toBe(1);
  });

  it('defaults to the fast column rather than refusing to draw', () => {
    // A table that has not picked still gets a bar; the field says which column it is.
    expect(xpProgress({ level: 2 }).nextAt).toBe(6);
    expect(xpProgress({ level: 2 }, 'nonsense').nextAt).toBe(6);
  });

  it('never reads negative XP or a level past the cap', () => {
    expect(prog(at({ xp: -50 })).xp).toBe(0);
    expect(prog(at({ level: 99 })).level).toBe(10);
  });
});

describe('what the header says', () => {
  it('says only the level while there is climbing left', () => {
    // The numbers on the end of the bar already say how far - "4/6" sits right there -
    // so repeating it underneath was the same fact twice.
    expect(describeXp(prog(at({ level: 2, xp: 4 })))).toBe('LEVEL 2');
  });

  it('still uses words for the two things a bar cannot show', () => {
    // A full bar does not distinguish "you may advance" from "this is as far as it goes".
    expect(describeXp(prog(at({ level: 2, xp: 6 })))).toBe('LEVEL 2 · READY FOR 3');
    expect(describeXp(prog(at({ level: 10, xp: 200 })))).toBe('LEVEL 10 · MAX');
  });
});

describe('where the fields live', () => {
  const CWN = getTemplate('cities_without_number');

  it('drops the LVL chip, since the bar states the level', () => {
    expect((CWN.header?.chips ?? []).map((c) => c.field)).toEqual(['base_hit_bonus']);
  });

  it('wires the bar to the fields it reads', () => {
    expect(CWN.header?.xpBar).toEqual({ xpField: 'xp', levelField: 'level' });
  });

  it('keeps the rate off the sheet, since the whole table shares one', () => {
    const ids = CWN.sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
    expect(ids).not.toContain('xp_rate');
  });

  it('keeps level editable, because advancing is a choice', () => {
    const level = CWN.sections.flatMap((s) => s.fields ?? []).find((f) => f.id === 'level')!;
    expect(level.derived).toBeUndefined();
  });

  it('is on no other system', () => {
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const t = getTemplate(id);
      expect(t.header?.xpBar, id).toBeUndefined();
      const ids = t.sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
      expect(ids, id).not.toContain('xp');
    }
  });
});
