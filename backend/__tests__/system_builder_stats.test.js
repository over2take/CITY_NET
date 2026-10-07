/**
 * A system's stats (4b2a): the numbers players fill in, in groups, shown on the starter sheet until
 * the system designs its own; names for derived values; the builder's sample character. Decided with
 * the user 2026-10-06 (mockup builder-stats-rules): stats get their own list, skills are a group,
 * formulas get display names, samples are saved with the draft.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { effectiveSheet } = require_('../systemBuilder/sheet');
const { statIdsOf, statSections, derivedLabel, rangeHint, LIMITS } = require_('../systemBuilder/stats');

const ABILITIES = { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'dex', label: 'Dexterity', min: 3, max: 18 }] };
const SKILLS = { id: 'skills', label: 'SKILLS', stats: [{ id: 'shoot', label: 'Shoot', min: 0, max: 4, tie: 'dex' }] };
const HEARTH = { format: 1, name: 'Hearth', stats: [ABILITIES, SKILLS] };
const problems = (def) => checkDefinition(def).problems.map((p) => `${p.where}: ${p.message}`);

describe('checking stats', () => {
  it('takes groups of stats, with ranges and ties', () => {
    expect(problems(HEARTH)).toEqual([]);
    expect(problems({ format: 1, name: 'H', stats: [] })).toEqual([]);
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'g', label: 'G', stats: [{ id: 'luck', label: 'Luck' }, { id: 'grit', label: 'Grit', min: 0 }] }] })).toEqual([]);
  });

  it('refuses a malformed list, group or stat, saying where', () => {
    expect(problems({ format: 1, name: 'H', stats: {} })).toEqual(['stats: Must be a list of groups']);
    expect(problems({ format: 1, name: 'H', stats: ['x'] })).toEqual(['stats group 1: Must be a group of stats']);
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'Bad', label: '', stats: 'no', extra: 1 }] })).toEqual([
      'stats Bad, extra: Not part of a group',
      'stats Bad: Ids use lowercase letters, digits and _, starting with a letter',
      'stats Bad, label: Must be some text',
      'stats Bad, stats: Must be a list of stats',
    ]);
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'g', stats: [7, { id: 's', label: 'S', min: 1.5, max: 'x', color: 'red' }] }] })).toEqual([
      'stats g, label: Required',
      'stats g, stat 1: Must be a stat',
      'stat s, color: Not part of a stat',
      'stat s, min: Must be a whole number',
      'stat s, max: Must be a whole number',
    ]);
  });

  it('needs every stat named, and takes a range of one value', () => {
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'g', label: 'G', stats: [{ id: 'nameless' }, { id: 'fixed', label: 'Fixed', min: 5, max: 5 }] }] }))
      .toEqual(['stat nameless, label: Required']);
  });

  it('refuses a range upside down, and a tie to nothing or to itself', () => {
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'g', label: 'G', stats: [
      { id: 'a', label: 'A', min: 5, max: 2 }, { id: 'b', label: 'B', tie: 'b' }, { id: 'c', label: 'C', tie: 'zzz' }, { id: 'd', label: 'D', tie: 4 },
    ] }] })).toEqual([
      'stat a: The lowest is above the highest',
      'stat b, tie: Cannot be tied to itself',
      'stat c, tie: Not one of this system\'s stats',
      'stat d, tie: Not one of this system\'s stats',
    ]);
  });

  it('refuses an id used twice, or one a formula, the starter sheet or the health section has', () => {
    const dup = { format: 1, name: 'H', stats: [ABILITIES, { id: 'abilities', label: 'X', stats: [{ id: 'str', label: 'Again' }] }] };
    expect(problems(dup)).toEqual(['stats abilities: Defined twice', 'stat str: Defined twice']);
    expect(problems({ ...HEARTH, derived: [{ id: 'str', formula: '1' }] })).toEqual(['stat str: A formula has this id']);
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'g', label: 'G', stats: [{ id: 'notes', label: 'Notes' }, { id: 'hp', label: 'HP' }] }] }))
      .toEqual(['stat notes: The starter sheet already has a field with this id', 'stat hp: The health section already has a field with this id']);
    expect(problems({ format: 1, name: 'H', core: { health: { model: 'wounds', count: 3 } }, stats: [{ id: 'g', label: 'G', stats: [{ id: 'hp', label: 'HP' }, { id: 'wounds', label: 'W' }] }] }))
      .toEqual(['stat wounds: The health section already has a field with this id']);
  });

  it('caps groups and stats', () => {
    const many = Array.from({ length: LIMITS.stats + 1 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }));
    expect(problems({ format: 1, name: 'H', stats: [{ id: 'g', label: 'G', stats: many }] })).toEqual([`stats g, stats: At most ${LIMITS.stats} stats`]);
    const groups = Array.from({ length: LIMITS.groups + 1 }, (_, i) => ({ id: `g${i}`, label: 'G', stats: [] }));
    expect(problems({ format: 1, name: 'H', stats: groups })).toEqual([`stats: At most ${LIMITS.groups} groups`]);
  });
});

describe('formula names and samples', () => {
  it('takes a name for a derived value, as text', () => {
    expect(problems({ ...HEARTH, derived: [{ id: 'save', label: 'Physical save', formula: '16 - @str' }] })).toEqual([]);
    expect(problems({ ...HEARTH, derived: [{ id: 'save', label: '', formula: '1' }, { id: 'b', label: 'x'.repeat(41), formula: '1' }] }))
      .toEqual(['derived save, label: Must be some text', 'derived b, label: Longer than 40 characters']);
  });

  it('takes sample numbers for the system\'s own stats', () => {
    expect(problems({ ...HEARTH, samples: { str: 16, shoot: 1 } })).toEqual([]);
    expect(problems({ ...HEARTH, samples: { str: 'high', luck: 3 } })).toEqual(['samples str: Must be a number', 'samples luck: Not one of this system\'s stats']);
    expect(problems({ ...HEARTH, samples: [] })).toEqual(['samples: Must be a set of stat values']);
  });
});

describe('the starter sheet', () => {
  it('shows each group as a section, after health and before the formulas, with names and ranges', () => {
    const sheet = effectiveSheet({ ...HEARTH, derived: [{ id: 'save_physical', label: 'Physical save', formula: '16 - @str' }, { id: 'str_mod', formula: '1' }] });
    expect(sheet.sections.map((s) => s.id)).toEqual(['identity', 'health', 'stats_abilities', 'stats_skills', 'derived', 'inventory', 'money', 'notes']);
    expect(sheet.sections[2]).toEqual({ id: 'stats_abilities', label: 'ABILITIES', layout: 'grid', tab: 'STATS', columns: 3, fields: [
      { id: 'str', label: 'Strength', type: 'number', hint: '3 to 18' }, { id: 'dex', label: 'Dexterity', type: 'number', hint: '3 to 18' },
    ] });
    expect(sheet.sections[4].fields).toEqual([{ id: 'save_physical', label: 'Physical save', type: 'number' }, { id: 'str_mod', label: 'STR MOD', type: 'number' }]);
  });

  it('is unchanged for a system with no stats', () => {
    expect(effectiveSheet({ format: 1, name: 'H' }).sections.map((s) => s.id)).toEqual(['identity', 'health', 'inventory', 'money', 'notes']);
  });

  it('a designed sheet is the system\'s own, stats or not', () => {
    const own = { tabs: ['ONE'], sections: [{ id: 'x', label: 'X', layout: 'list', tab: 'ONE', fields: [] }] };
    expect(effectiveSheet({ ...HEARTH, sheet: own }).sections.map((s) => s.id)).toEqual(['x']);
  });
});

describe('helpers', () => {
  it('reads ranges, names and ids, ignoring what it cannot read', () => {
    expect([rangeHint({ min: 0, max: 4 }), rangeHint({ min: 1 }), rangeHint({ max: 9 }), rangeHint({})]).toEqual(['0 to 4', 'At least 1', 'At most 9', null]);
    expect(derivedLabel({ id: 'save_physical' })).toBe('SAVE PHYSICAL');
    expect(derivedLabel({ id: 'a', label: '  ' })).toBe('A');
    expect([...statIdsOf(HEARTH)]).toEqual(['str', 'dex', 'shoot']);
    expect([...statIdsOf({ stats: ['x', { id: 'g', stats: [3, { id: 'ok' }] }] })]).toEqual(['ok']);
    expect(statSections({ stats: [{ id: 'g', label: ' ', stats: [{ id: 'a' }, 'x'] }, { label: 'no id' }] }))
      .toEqual([{ id: 'stats_g', label: 'G', layout: 'grid', tab: 'STATS', columns: 3, fields: [{ id: 'a', label: 'A', type: 'number' }] }]);
  });
});
