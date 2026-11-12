import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

/**
 * Ranks with names, on the server (7f1a; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): shared lists of named
 * ranks, each worth a number or a formula; a stat held as one keeps its step in `<id>_rank`, and the stat itself is the
 * step's worth, so formulas, rolls and requirements reading it read its worth. A bonus or INCREASE moves the step.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { compileSystem } = require_('../systemBuilder/derived');
const { rankedOf, rankedStatsOf, stepFieldsOf, rankNameAt, rankListsOf } = require_('../systemBuilder/ranks');
const { overlayOf, valueOn } = require_('../systemBuilder/choices');
const { buildFile, readFile } = require_('../systemBuilder/citysys');
const runtime = require_('../systemBuilder/runtime');
const templates = require_('../sheets/templates');

const PROFICIENCY = { id: 'proficiency', label: 'PROFICIENCY', list: [
  { name: 'UNTRAINED', worth: '0' }, { name: 'TRAINED', worth: '2 + @level' }, { name: 'EXPERT', worth: '4 + @level' }, { name: 'MASTER', worth: '6 + @level' },
] };
const RANKED = {
  format: 1, name: 'Ranked', core: { health: { model: 'pool' } },
  stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'level', label: 'Level', min: 1, max: 20 }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', rank: 'proficiency', atStart: 1 }, { id: 'stealth', label: 'Stealth', rank: 'proficiency' }] },
  ],
  ranks: [PROFICIENCY],
  derived: [{ id: 'climb', label: 'Climb', formula: '@athletics + 1' }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
    { id: 'skilled', label: 'Skilled', features: [{ id: 'skilled_f', label: 'Skilled', modifiers: [{ target: 'athletics', amount: '1' }] }] },
  ] }],
};
const problemsOf = (over) => checkDefinition({ ...RANKED, ...over }).problems.map((p) => `${p.where}: ${p.message}`);

describe('the checks', () => {
  it('a system with ranks is sound', () => {
    expect(problemsOf({})).toEqual([]);
  });

  it('a list: its own id, a name, ranks lowest first each with a name of its own and a worth that reads', () => {
    const said = problemsOf({ ranks: [
      PROFICIENCY, { ...PROFICIENCY, extra: 1 },
      { id: 'Bad', label: ' ', list: [] },
      { id: 'dots', label: 'DOTS', list: [{ name: 'ONE', worth: '1' }, { name: 'One ', worth: '2' }, { name: '', worth: '3' }, { name: 'X'.repeat(31), worth: '4' }, { name: 'FIVE', worth: '  ' }, { name: 'SIX', worth: '@ +' }, { name: 'SEVEN', worth: '7', also: 1 }, 'eight'] },
      'nine',
    ] });
    expect(said).toContain('ranks proficiency: Another rank list has this id');
    expect(said).toContain('ranks proficiency, extra: Not part of a rank list');
    expect(said).toContain('ranks Bad: Ids use lowercase letters, digits and _, starting with a letter');
    expect(said).toContain('ranks Bad, label: Cannot be blank');
    expect(said).toContain('ranks Bad, list: At least one rank, lowest first');
    expect(said).toContain('ranks dots, rank 2, name: Another rank in this list has this name');
    expect(said).toContain('ranks dots, rank 3, name: Cannot be blank');
    expect(said).toContain('ranks dots, rank 4, name: Longer than 30 characters');
    expect(said).toContain('ranks dots, rank 5, worth: What it is worth: a number or a formula');
    expect(said.some((s) => s.startsWith('ranks dots, rank 6, worth: '))).toBe(true);
    expect(said).toContain('ranks dots, rank 7, also: Not part of a rank');
    expect(said).toContain('ranks dots, rank 8: Must be a rank: a name and what it is worth');
    expect(said).toContain('rank list 5: Must be a rank list');
    expect(problemsOf({ ranks: {} })).toContain('ranks: Must be a list of rank lists');
    expect(problemsOf({ ranks: Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, label: 'R', list: [{ name: 'A', worth: '0' }] })) })).toContain('ranks: At most 20 rank lists');
    expect(problemsOf({ ranks: [{ ...PROFICIENCY, list: Array.from({ length: 21 }, (_, i) => ({ name: `R${i}`, worth: '0' })) }] })).toContain('ranks proficiency, list: At most 20 ranks');
    expect(problemsOf({ ranks: [{ ...PROFICIENCY, label: 'P'.repeat(41) }] })).toContain('ranks proficiency, label: Longer than 40 characters');
    expect(problemsOf({ ranks: [{ ...PROFICIENCY, list: [{ name: 'A', worth: '1'.repeat(201) }] }] })).toContain('ranks proficiency, rank 1, worth: Longer than 200 characters');
  });

  it('a stat held as a rank: a list there is, a highest at the start within it, no range, its step field free', () => {
    const skills = (stats) => problemsOf({ stats: [RANKED.stats[0], { id: 'skills', label: 'SKILLS', stats }], choices: undefined, derived: [] });
    expect(skills([{ id: 'a', label: 'A', rank: 'nope' }])).toContain('stat a, rank: One of this system\'s rank lists');
    expect(skills([{ id: 'a', label: 'A', rank: 'proficiency', atStart: 4 }])).toContain('stat a, atStart: A rank of its list: 0 to 3');
    expect(skills([{ id: 'a', label: 'A', rank: 'proficiency', atStart: 1.5 }])).toContain('stat a, atStart: A rank of its list: 0 to 3');
    expect(skills([{ id: 'a', label: 'A', rank: 'proficiency', atStart: 3 }])).toEqual([]);
    expect(skills([{ id: 'a', label: 'A', rank: 'proficiency', max: 3 }])).toContain('stat a: A stat held as a rank has its list for a range, not a lowest or highest');
    expect(skills([{ id: 'a', label: 'A', atStart: 1 }])).toContain('stat a, atStart: Only a stat held as a rank has a highest at the start');
    expect(skills([{ id: 'a', label: 'A', rank: 'proficiency' }, { id: 'a_rank', label: 'B' }])).toContain('stat a: a_rank, where its rank is kept, is another stat\'s or formula\'s id');
  });
});

describe('a ranked stat\'s worth', () => {
  const compiled = compileSystem({ derived: RANKED.derived, ranked: rankedOf(RANKED) });

  it('the worth of the rank its step is at, read by formulas; a step past either end the end', () => {
    expect(compiled.ok).toBe(true);
    const at = (step, level = 3) => compiled.system.evaluate({ level, athletics_rank: step });
    expect(at(0)).toMatchObject({ athletics: 0, climb: 1 });
    expect(at(2)).toMatchObject({ athletics: 7, climb: 8 });
    expect(at(2, 5).athletics).toBe(9);
    expect(at(9).athletics).toBe(9);
    expect(at(-2).athletics).toBe(0);
    expect(at(1.6).athletics).toBe(7);
    expect(compiled.system.evaluate({ level: 3 }).athletics).toBe(0);
    // Written onto the sheet as a formula's is.
    const data = { level: 3, athletics_rank: 1 };
    expect(compiled.system.apply(data)).toEqual(expect.arrayContaining(['athletics', 'climb']));
    expect(data).toMatchObject({ athletics: 5, climb: 6 });
  });

  it('a worth reading a formula listed after it waits for it; a worth reading back through a formula is a loop', () => {
    const ordered = compileSystem({ derived: [{ id: 'climb', formula: '@athletics + 1' }, { id: 'edge', formula: '@level * 2' }], ranked: [{ id: 'athletics', step: 'athletics_rank', worths: ['@edge'] }] });
    expect(ordered.system.evaluate({ level: 3 })).toMatchObject({ edge: 6, athletics: 6, climb: 7 });
    expect(problemsOf({ ranks: [{ ...PROFICIENCY, list: [{ name: 'A', worth: '@climb' }] }] })).toContain('derived climb: Depends on itself: climb → athletics → climb');
  });

  it('a worth that won\'t read, or a formula with the stat\'s id, is said', () => {
    const bad = compileSystem({ derived: [], ranked: [{ id: 'a', step: 'a_rank', worths: ['1', '@ +'] }] });
    expect(bad.ok).toBe(false);
    expect(bad.problems[0].where).toBe('stat a, rank 2');
    const twice = compileSystem({ derived: [{ id: 'a', formula: '1' }], ranked: [{ id: 'a', step: 'a_rank', worths: ['1'] }] });
    expect(twice.problems).toEqual([{ where: 'stat a', message: 'A formula has this id' }]);
  });

  it('read: each ranked stat, its step field, its worths; a stat naming no list there is passed over', () => {
    expect(rankedOf(RANKED)).toEqual([
      { id: 'athletics', step: 'athletics_rank', worths: ['0', '2 + @level', '4 + @level', '6 + @level'] },
      { id: 'stealth', step: 'stealth_rank', worths: ['0', '2 + @level', '4 + @level', '6 + @level'] },
    ]);
    expect(rankedStatsOf({ ...RANKED, ranks: [] })).toEqual([]);
    expect([...stepFieldsOf(RANKED)]).toEqual([['athletics', 'athletics_rank'], ['stealth', 'stealth_rank']]);
    expect(rankListsOf({ ranks: [null, { id: 'x', list: [null, { name: 'A' }] }] })).toEqual([{ id: 'x', list: [{ name: 'A' }] }]);
    // A blank worth reads as 0.
    expect(rankedOf({ ...RANKED, ranks: [{ ...PROFICIENCY, list: [{ name: 'A', worth: ' ' }] }] })[0].worths).toEqual(['0']);
  });

  it('a rank\'s name at a step, the ends holding', () => {
    expect(rankNameAt(PROFICIENCY, 2)).toBe('EXPERT');
    // A list with no ranks is no rank at all, never a stat to work out.
    expect(rankedOf({ ...RANKED, ranks: [{ id: 'proficiency', label: 'P', list: [] }] })).toEqual([]);
    expect(rankNameAt(PROFICIENCY, 9)).toBe('MASTER');
    expect(rankNameAt(PROFICIENCY, -1)).toBe('UNTRAINED');
    expect(rankNameAt(PROFICIENCY, 'x')).toBe('UNTRAINED');
    expect(rankNameAt({ list: [] }, 1)).toBeNull();
  });
});

describe('a bonus moves the step', () => {
  it('a feature\'s +1 on a ranked stat is a rank up, and formulas read the worth there', () => {
    const data = { level: 3, athletics_rank: 1, _choices: { feats: ['skilled'] } };
    const overlay = overlayOf(RANKED, data);
    expect(overlay.sheet.athletics_rank).toBe(2);
    expect(overlay.from.athletics_rank).toEqual([{ feature: 'Skilled', amount: 1 }]);
    const compiled = compileSystem({ derived: RANKED.derived, ranked: rankedOf(RANKED) });
    expect(compiled.system.evaluate(data, overlay)).toMatchObject({ athletics: 7, climb: 8 });
  });
});

describe('the system file, and a sheet saved', () => {
  it('carries the ranks beside the definition, and back unchanged', () => {
    const file = buildFile({ definition: RANKED, version: 1, origin: 'sys_rankedrankedrank' });
    expect(file.ranks).toEqual(RANKED.ranks);
    expect(file.definition).not.toHaveProperty('ranks');
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.ranks).toEqual(RANKED.ranks);
  });

  it('a sheet saved works out each ranked stat\'s worth, and a formula reading it', async () => {
    const db = await makeTestDb();
    const ID = 'sys_rankedrankedrank';
    const def = JSON.stringify(RANKED);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Ranked', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const data = { level: 4, athletics_rank: 2, stealth_rank: 0 };
    templates.applyDerived(ID, data);
    expect(data).toMatchObject({ athletics: 8, stealth: 0, climb: 9 });
    expect(valueOn(RANKED, data, '@athletics >= 8')).toBe(1);
  });
});
