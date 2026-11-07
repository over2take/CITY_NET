/**
 * How a system's characters go up (7d1; approved mockup docs/mockups/level-up.html, 2026-11-07): the highest
 * level and the XP table, as running totals, filled from what level 2 costs and a multiplier per range, any
 * level typed over. Checked, and carried by the system file.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { levelTable, levelsOf, LIMITS, DEFAULTS } = require_('../systemBuilder/levels');
const { checkDefinition } = require_('../systemBuilder/definition');
const { OTHER } = require_('../systemBuilder/versionDiff');
const citysys = require_('../systemBuilder/citysys');

const def = (levels) => ({ format: 1, name: 'L', levels });
const problems = (levels) => checkDefinition(def(levels)).problems.map((p) => `${p.where}: ${p.message}`);

describe('the table', () => {
  it('is running totals, each level costing its range\'s multiple of the last', () => {
    expect(levelTable(def({ top: 5, first: 100, ranges: [{ to: 5, x: 2 }] }))).toEqual({ 2: 100, 3: 300, 4: 700, 5: 1500 });
  });

  it('a multiplier first counts at level 3: level 2 costs what was said', () => {
    expect(levelTable(def({ top: 3, first: 300, ranges: [{ to: 3, x: 3 }] }))).toEqual({ 2: 300, 3: 1200 });
  });

  it('each range its own multiplier, from the level after the last one ends', () => {
    const table = levelTable(def({ top: 6, first: 100, ranges: [{ to: 3, x: 2 }, { to: 6, x: 1.5 }] }));
    // 100, then x2 = 200 (L3), then x1.5 = 300, 450, 675.
    expect(table).toEqual({ 2: 100, 3: 300, 4: 600, 5: 1050, 6: 1725 });
  });

  it('a level typed over takes that number, and the sums carry on as they were', () => {
    expect(levelTable(def({ top: 4, first: 100, ranges: [{ to: 4, x: 2 }], typed: { 3: 999 } }))).toEqual({ 2: 100, 3: 999, 4: 700 });
  });

  it('saying nothing has the defaults', () => {
    expect(levelsOf(def(undefined))).toEqual({ ...DEFAULTS, typed: {} });
    expect(Object.keys(levelTable(def(undefined)))).toHaveLength(DEFAULTS.top - 1);
    expect(levelTable(def(undefined))[2]).toBe(DEFAULTS.first);
  });

  it('what doesn\'t read falls back, and a level past the last range uses the last', () => {
    expect(levelsOf(def({ top: 99, first: 0, ranges: 'x', typed: 'y' }))).toEqual({ ...DEFAULTS, typed: {} });
    expect(levelsOf(def({ ranges: [] })).ranges).toEqual(DEFAULTS.ranges);
    expect(levelsOf(def({ top: 1 })).top).toBe(DEFAULTS.top);
    expect(levelTable(def({ top: 4, first: 100, ranges: [{ to: 2, x: 2 }] }))).toEqual({ 2: 100, 3: 300, 4: 700 });
  });

  it('never passes the most a number holds', () => {
    const table = levelTable(def({ top: 30, first: 1000000000, ranges: [{ to: 30, x: 100 }] }));
    expect(table[30]).toBe(LIMITS.xp);
  });
});

describe('the checks', () => {
  const good = { top: 10, first: 300, ranges: [{ to: 5, x: 2 }, { to: 10, x: 1.5 }], typed: { 7: 15000 } };

  it('takes a good one, and none at all', () => {
    expect(problems(good).filter((p) => p.startsWith('levels'))).toEqual([]);
    expect(problems(undefined).filter((p) => p.startsWith('levels'))).toEqual([]);
  });

  it('the section, and what is part of it', () => {
    expect(problems('x')).toContain('levels: Must say how levels work');
    expect(problems({ odd: 1 })).toContain('levels, odd: Not part of levels');
    expect(problems({ ranges: [{ to: 10, x: 2, odd: 1 }] })).toContain('levels, range 1, odd: Not part of a range');
  });

  it('the highest level, from 2 to 30', () => {
    for (const bad of [1, 31, 2.5, 'x']) expect(problems({ top: bad }), String(bad)).toContain('levels, top: The highest level is from 2 to 30');
    for (const fine of [2, 30]) expect(problems({ top: fine, ranges: [{ to: fine, x: 2 }] }).filter((p) => p.startsWith('levels'))).toEqual([]);
  });

  it('what level 2 costs', () => {
    for (const bad of [0, -5, 1.5, 'x', LIMITS.xp + 1]) expect(problems({ first: bad }), String(bad)).toContain('levels, first: Level 2 costs a whole amount, 1 or more');
    expect(problems({ first: 1 }).filter((p) => p.startsWith('levels, first'))).toEqual([]);
    expect(problems({ first: LIMITS.xp }).filter((p) => p.startsWith('levels, first'))).toEqual([]);
  });

  it('the ranges: a list, climbing, reaching the top, with a multiple from 1 to 100', () => {
    expect(problems({ ranges: 'x' })).toContain('levels, ranges: Must be a list of ranges');
    expect(problems({ ranges: [] })).toContain('levels, ranges: Must be a list of ranges');
    expect(problems({ ranges: ['x', { to: 10, x: 2 }] })).toContain('levels, range 1: Must be a range');
    expect(problems({ ranges: [{ to: 5, x: 2 }, { to: 5, x: 2 }, { to: 10, x: 2 }] })).toContain('levels, range 2: Must end after the range before it');
    expect(problems({ ranges: [{ to: 1.5, x: 2 }, { to: 10, x: 2 }] })).toContain('levels, range 1: Must end after the range before it');
    expect(problems({ top: 10, ranges: [{ to: 5, x: 2 }] })).toContain('levels, ranges: The last range must reach the highest level, 10');
    for (const bad of [0.5, 101, 'x', Infinity]) expect(problems({ ranges: [{ to: 10, x: bad }] }), String(bad)).toContain('levels, range 1: Each level costs from 1 to 100 times the last');
    for (const fine of [1, 100, 1.5]) expect(problems({ ranges: [{ to: 10, x: fine }] }).filter((p) => p.startsWith('levels'))).toEqual([]);
  });

  it('at most 30 ranges', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ to: i + 1, x: 2 }));
    expect(problems({ top: 30, ranges: many })).toContain('levels, ranges: At most 30 ranges');
  });

  it('what is typed over: a level, a whole amount, and climbing where it was touched', () => {
    expect(problems({ typed: 'x' })).toContain('levels, typed: Must say the total for each level typed over');
    expect(problems({ typed: { abc: 5 } })).toContain('levels, typed, abc: Must be a level');
    for (const bad of [-1, 1.5, 'x', LIMITS.xp + 1]) expect(problems({ typed: { 3: bad } }), String(bad)).toContain('levels, level 3: A whole amount, 0 or more');
    expect(problems({ first: 100, typed: { 3: 50 } })).toContain('levels, level 3: Level 3 needs more than level 2, 100');
    expect(problems({ first: 100, typed: { 3: 100 } })).toContain('levels, level 3: Level 3 needs more than level 2, 100');
    // Typed high, the one after it hasn't caught up: said against that one.
    expect(problems({ first: 100, typed: { 3: 99999 } })).toContain('levels, level 4: Level 4 needs more than level 3, 99999');
    expect(problems({ first: 100, typed: { 3: 101 } }).filter((p) => p.startsWith('levels'))).toEqual([]);
  });

  it('the sums reaching the most a number holds isn\'t a problem, with something typed elsewhere or not', () => {
    const huge = { top: 30, first: 1000000000, ranges: [{ to: 30, x: 100 }] };
    expect(problems(huge).filter((p) => p.startsWith('levels'))).toEqual([]);
    expect(problems({ ...huge, typed: { 2: 5 } }).filter((p) => p.startsWith('levels'))).toEqual([]);
  });

  it('changes nothing on any character, said in one line of a version\'s changes', () => {
    expect(OTHER).toContain('levels');
  });
});

describe('the system file', () => {
  it('carries them, unchanged', () => {
    const levels = { top: 8, first: 500, ranges: [{ to: 4, x: 2 }, { to: 8, x: 1.5 }], typed: { 6: 9000 } };
    const definition = { format: 1, name: 'Carried', core: { advancement: ['levels'] }, levels };
    const file = citysys.buildFile({ definition, version: 1, origin: 'sys_abcdefabcdefabcd' });
    const read = citysys.readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.levels).toEqual(levels);
    expect(read.file.definition.core.advancement).toEqual(['levels']);
  });
});
