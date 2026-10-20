import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * A system's own rolls as a section of it (6a2a; approved mockup docs/mockups/builder-rolls.html,
 * 2026-10-19): a list of rolls checked as strictly as the rest of an untrusted file, each rolled by
 * stats, stats groups and formulas the system has, its tables callable in its formula text; and
 * carried in a .citysys file beside the system, so a builder from before rolls still installs it.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { PRESETS, LIMITS } = require_('../systemBuilder/rollStyles');
const citysys = require_('../systemBuilder/citysys');
const { randomSystem } = require_('./helpers/randomSystem');

const HEARTH = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }, { id: 'wit', label: 'Wits' }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight', tie: 'str' }] },
  ],
  lookups: { mod: { bands: [{ upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [{ id: 'save', label: 'Save', formula: '16 - mod(@str)' }],
};
const skill = { id: 'skill', label: 'Skill check', ...PRESETS.pbta.roll, by: ['skills'] };
const withRolls = (rolls) => ({ ...HEARTH, rolls });
const said = (def) => checkDefinition(def).problems.filter((p) => p.where.startsWith('roll')).map((p) => `${p.where}: ${p.message}`);

describe('the rolls section', () => {
  it('takes rolls rolled by a stats group, a stat, a formula, or nothing yet', () => {
    expect(said(withRolls([
      skill,
      { id: 'check', label: 'Ability check', ...PRESETS.dnd.roll, by: ['str', 'wit'] },
      { id: 'saving', label: 'Save', ...PRESETS.cwn_save.roll, by: ['save'] },
      { id: 'spare', label: 'Spare', ...PRESETS.fate.roll },
    ]))).toEqual([]);
    expect(checkDefinition(withRolls([skill])).problems).toEqual([]);
  });

  it('lets a roll call the system\'s own tables, and no others', () => {
    expect(said(withRolls([{ ...skill, add: '@this + mod(@tie)' }]))).toEqual([]);
    expect(said(withRolls([{ ...skill, add: '@this + bonus(@tie)' }]))[0]).toMatch(/^roll skill, add: /);
  });

  it('refuses what it rolls by when the system has no such stat, group or formula', () => {
    expect(said(withRolls([{ ...skill, by: ['skills', 'charm'] }]))).toEqual(["roll skill, by: charm is not one of this system's stats, stats groups or formulas"]);
    expect(said(withRolls([{ ...skill, by: [3] }]))).toEqual(["roll skill, by: That is not one of this system's stats, stats groups or formulas"]);
    expect(said(withRolls([{ ...skill, by: 'skills' }]))).toEqual(['roll skill, by: A list of stats, stats groups and formulas']);
    expect(said(withRolls([{ ...skill, by: ['constructor', '__proto__'] }]))).toHaveLength(2);
  });

  it('says where a roll is wrong, by its id or its place in the list', () => {
    expect(said(withRolls([{ ...skill, read: 'average' }]))).toEqual(['roll skill, read: Sum, highest, lowest or count']);
    expect(said(withRolls([{ ...skill, id: 'Bad Id' }]))).toEqual(['roll 1: Ids use lowercase letters, digits and _, starting with a letter']);
    expect(said(withRolls([skill, { ...skill }]))).toEqual(['roll skill: Defined twice']);
    expect(said(withRolls([null]))).toEqual(['roll 1: Must be a roll']);
  });

  it('is a list, of at most the rolls a system may have', () => {
    expect(said(withRolls({ skill }))).toEqual(['rolls: Must be a list of rolls']);
    const many = Array.from({ length: LIMITS.rolls + 1 }, (_, i) => ({ ...skill, id: `r${i}` }));
    expect(said(withRolls(many))).toEqual([`rolls: At most ${LIMITS.rolls} rolls`]);
  });

  it('every random system\'s rolls pass, and a system without any is as it was', () => {
    let seen = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const def = randomSystem(seed);
      if (def.rolls) seen += 1;
      expect(said(def), `seed ${seed}`).toEqual([]);
    }
    expect(seen).toBeGreaterThan(20);
    expect(checkDefinition(HEARTH).problems).toEqual([]);
  });
});

describe('rolls in a .citysys file', () => {
  const file = (definition) => citysys.buildFile({ definition, version: 2, origin: 'sys_abcdefabcdefabcd' });

  it('travel beside the system, so a builder from before rolls reads a system it knows', () => {
    const built = file(withRolls([skill]));
    expect(built.rolls).toEqual([skill]);
    expect('rolls' in built.definition).toBe(false);
    // What an older builder checks is the definition alone: nothing in it it doesn't know.
    expect(checkDefinition(built.definition).problems).toEqual([]);
  });

  it('go back into the system when installed here, checked with the rest', () => {
    const read = citysys.readFile(JSON.stringify(file(withRolls([skill]))));
    expect(read.file.definition.rolls).toEqual([skill]);
    expect(read.problems).toEqual([]);
    const broken = citysys.readFile(JSON.stringify(file(withRolls([{ ...skill, by: ['charm'] }]))));
    expect(broken.problems.map((p) => p.where)).toEqual(['roll skill, by']);
  });

  it('read from inside the definition too, which wins where a file has both', () => {
    const inside = { ...file(HEARTH), definition: withRolls([skill]) };
    expect(citysys.readFile(JSON.stringify(inside)).file.definition.rolls).toEqual([skill]);
    const both = { ...file(withRolls([{ ...skill, label: 'Beside' }])), definition: withRolls([{ ...skill, label: 'Inside' }]) };
    expect(citysys.readFile(JSON.stringify(both)).file.definition.rolls[0].label).toBe('Inside');
  });

  it('a system without rolls has none in its file, and the map\'s layout still travels as before', () => {
    const built = file({ ...HEARTH, graph: { notes: [{ id: 'n1', text: 'x' }] } });
    expect('rolls' in built).toBe(false);
    expect(built.graph).toEqual({ notes: [{ id: 'n1', text: 'x' }] });
    expect(citysys.readFile(JSON.stringify(built)).file.definition.graph).toEqual({ notes: [{ id: 'n1', text: 'x' }] });
  });

  it('every random system comes back from its file as it went in', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const def = randomSystem(seed);
      const read = citysys.readFile(JSON.stringify(file(def)));
      expect(read.file.definition, `seed ${seed}`).toEqual(def);
    }
  });
});
