/**
 * How a system's characters rest (R1a; approved mockup docs/mockups/rest-on-sheet.html,
 * 2026-10-30): a levelled option's die, the recovery dice (name, how many, what one heals, where
 * they're spent, what gives them back) and who finishes a called rest; the checks, the defaults, and
 * the system file carrying them.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { restingOf, diceOptionsOf, LIMITS } = require_('../systemBuilder/recovery');
const citysys = require_('../systemBuilder/citysys');

const FORGE = {
  format: 1, name: 'Forge',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'floor((@con - 10) / 2)' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }, { id: 'wizard', label: 'Wizard', die: 6 }, { id: 'rogue', label: 'Rogue' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough' }] },
  ],
  resting: {
    finish: 'sheet',
    recovery: { name: 'Hit Dice', plus: '@con_mod', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }] },
  },
};
const problems = (def) => checkDefinition(def).problems.map((p) => `${p.where}: ${p.message}`);
const withRecovery = (patch) => ({ ...FORGE, resting: { ...FORGE.resting, recovery: { ...FORGE.resting.recovery, ...patch } } });

describe('the checks', () => {
  it('takes D&D\'s hit dice and 13th Age\'s recoveries, made from the same tools', () => {
    expect(problems(FORGE)).toEqual([]);
    expect(problems(withRecovery({ name: 'Recoveries', count: '8', per_level: true, spent_at: 'any', back: [{ rest: 'long_rest', how: 'half' }, { rest: 'end_of_session', how: 'by', amount: '@con_mod + 1' }] }))).toEqual([]);
    expect(problems({ ...FORGE, resting: { finish: 'call' } })).toEqual([]);
    // One per level, written out.
    expect(problems(withRecovery({ count: 'levels' }))).toEqual([]);
  });

  it('a die only on a levelled list\'s option, of 2 to 100 sides', () => {
    // The first option's die changed; the others keep theirs (the wizard's d6 is still there to roll).
    const die = (list, value) => problems({ ...FORGE, choices: FORGE.choices.map((c) => (c.id === list ? { ...c, options: c.options.map((o, i) => (i ? o : { ...o, die: value })) } : c)) });
    expect(die('feats', 6)).toEqual([`list feats, option tough, die: Only an option of a levelled list has a die`]);
    for (const bad of [1, 101, 2.5, '10']) expect(die('classes', bad), String(bad)).toEqual([`list classes, option fighter, die: A die of ${2} to ${100} sides`]);
    for (const good of [2, 100]) expect(die('classes', good)).toEqual([]);
  });

  it('says what is wrong with each part of the recovery dice', () => {
    expect(problems({ ...FORGE, resting: 'sheet' })).toEqual(['resting: Must say how rests are finished and the recovery dice']);
    expect(problems({ ...FORGE, resting: { finish: 'player', nap: true } })).toEqual(['resting, nap: Not part of resting', 'resting, finish: call (at the GM\'s call) or sheet (on each sheet)']);
    expect(problems(withRecovery({ name: ' ' }))).toEqual(['resting, recovery, name: Required']);
    expect(problems(withRecovery({ name: 'x'.repeat(LIMITS.name + 1) }))).toEqual([`resting, recovery, name: Longer than ${LIMITS.name} characters`]);
    expect(problems(withRecovery({ count: '@lvl' }))).toEqual(['resting, recovery, count: levels, or a formula: @lvl isn\'t one of this system\'s names']);
    expect(problems(withRecovery({ per_level: 'yes' }))).toEqual(['resting, recovery, per_level: true or false']);
    expect(problems(withRecovery({ plus: '@con_md' }))).toEqual(['resting, recovery, plus: @con_md isn\'t one of this system\'s names']);
    expect(problems(withRecovery({ plus: '@con_mod +' }))[0]).toMatch(/^resting, recovery, plus: /);
    expect(problems(withRecovery({ dice: 3 }))).toEqual(['resting, recovery, dice: Not part of the recovery dice']);
  });

  it('spent at rests the system has, named once, or any time', () => {
    expect(problems(withRecovery({ spent_at: [] }))).toEqual(['resting, recovery, spent_at: any, or a list of the rests they are spent at']);
    expect(problems(withRecovery({ spent_at: undefined }))).toEqual(['resting, recovery, spent_at: any, or a list of the rests they are spent at']);
    expect(problems(withRecovery({ spent_at: ['short_rest', 'nap'] }))).toEqual(['resting, recovery, spent_at 2: Not one of this system\'s rests']);
    expect(problems(withRecovery({ spent_at: ['short_rest', 'short_rest'] }))).toEqual(['resting, recovery, spent_at: A rest is named twice']);
  });

  it('given back by rests the system has, each once: all, half, or by an amount', () => {
    const back = (b) => problems(withRecovery({ back: b }));
    expect(back('all')).toEqual(['resting, recovery, back: A list of the rests that give them back']);
    expect(back([{ rest: 'nap', how: 'all' }])).toEqual(['resting, recovery, back 1, rest: Not one of this system\'s rests']);
    expect(back([{ rest: 'long_rest', how: 'all' }, { rest: 'long_rest', how: 'half' }])).toEqual(['resting, recovery, back 2, rest: That rest already gives them back']);
    expect(back([{ rest: 'long_rest', how: 'some' }])).toEqual(['resting, recovery, back 1, how: all, half (at least 1), or by an amount']);
    expect(back([{ rest: 'long_rest', how: 'by' }])).toEqual(['resting, recovery, back 1, amount: Must be formula text']);
    expect(back([{ rest: 'long_rest', how: 'all', amount: '2' }])).toEqual(['resting, recovery, back 1, amount: Only by an amount has an amount']);
    expect(back([{ rest: 'long_rest', how: 'all', when: 'dawn' }])).toEqual(['resting, recovery, back 1, when: Not part of a rest giving them back']);
    expect(back(Array.from({ length: LIMITS.back + 1 }, (_, i) => ({ rest: i ? `r${i}` : 'long_rest', how: 'all' })))).toContain(`resting, recovery, back: At most ${LIMITS.back}`);
  });

  it('needs an option with a die to roll', () => {
    const none = { ...FORGE, choices: FORGE.choices.map((c) => ({ ...c, options: c.options.map(({ die, ...o }) => o) })) };
    expect(problems(none)).toEqual(['resting, recovery: No option has a die to roll: give a levelled list\'s options a die on CHOICES']);
    // Without recovery dice, no die is needed.
    expect(problems({ ...none, resting: { finish: 'sheet' } })).toEqual([]);
  });
});

describe('what a system says, filled in', () => {
  it('rests at the GM\'s call with no recovery dice when it says nothing', () => {
    expect(restingOf({})).toEqual({ finish: 'call', recovery: null });
    expect(restingOf({ resting: { finish: 'nap' } })).toEqual({ finish: 'call', recovery: null });
  });

  it('one per level, the die once, nothing added, unless it says', () => {
    expect(restingOf({ resting: { recovery: { name: 'Hit Dice', spent_at: ['short_rest'] } } }).recovery)
      .toEqual({ name: 'Hit Dice', count: 'levels', perLevel: false, plus: null, spentAt: ['short_rest'], back: [] });
    expect(restingOf(withRecovery({ count: '8', per_level: true, spent_at: 'any', back: [{ rest: 'long_rest', how: 'by', amount: '2' }] })))
      .toEqual({ finish: 'sheet', recovery: { name: 'Hit Dice', count: '8', perLevel: true, plus: '@con_mod', spentAt: 'any', back: [{ rest: 'long_rest', how: 'by', amount: '2' }] } });
  });

  it('the options with a die are a levelled list\'s', () => {
    expect(diceOptionsOf(FORGE).map((d) => [d.option.id, d.die])).toEqual([['fighter', 10], ['wizard', 6]]);
    // A die on a list without levels (refused by the checks) is never one to roll.
    const stray = { ...FORGE, choices: FORGE.choices.map((c) => (c.id === 'feats' ? { ...c, options: [{ id: 'tough', label: 'Tough', die: 6 }] } : c)) };
    expect(diceOptionsOf(stray).map((d) => d.option.id)).toEqual(['fighter', 'wizard']);
  });

  it('takes only true as healing once per level', () => {
    expect(restingOf(withRecovery({ per_level: 'yes' })).recovery.perLevel).toBe(false);
  });
});

describe('the system file', () => {
  it('carries the dice and how characters rest, installed with no problems', () => {
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: FORGE, version: 1, origin: 'forge' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.resting).toEqual(FORGE.resting);
    expect(read.file.definition.choices[0].options.map((o) => o.die)).toEqual([10, 6, undefined]);
  });
});
