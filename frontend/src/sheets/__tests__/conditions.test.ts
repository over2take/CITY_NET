import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  STANDARD, LIMITS, conditionList, conditionsOf, conditionCount, withCondition, withNewCondition, withoutCondition,
  modifierTargets, shortFrom,
} from '../conditions';
import type { Definition } from '../systemsApi';

/**
 * The CONDITIONS page as logic (4e1b). Approved mockup builder-conditions (2026-10-09): the standard
 * set edited or turned off, a system's own added and deleted, only changes stored. Every step is held
 * to the server's own module (backend/systemBuilder/conditions.js) and its checks.
 */

const require_ = createRequire(import.meta.url);
const server = require_('../../../../backend/systemBuilder/conditions.js');
const { checkDefinition } = require_('../../../../backend/systemBuilder/definition.js');

const H: Definition = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'save', label: 'Physical save', formula: '16 - @str' }, { id: 'move', formula: '10' }],
};
const problems = (def: Definition) => checkDefinition(def).problems;
const stored = (def: Definition) => def.conditions as Record<string, Record<string, unknown>> | undefined;

describe('the standard set and what the game offers', () => {
  it('is the server\'s, condition for condition', () => {
    expect(STANDARD).toEqual(server.STANDARD);
    expect(LIMITS).toEqual(server.LIMITS);
  });

  it('gives what the server gives, on every kind of definition', () => {
    const cases: Definition[] = [
      H,
      { ...H, conditions: { blinded: { on: false }, poisoned: { name: 'Toxed', ends: 'rounds', rounds: 3, modifiers: [{ target: 'str', amount: -1 }] } } },
      { ...H, conditions: { glitch: { name: 'Glitching', icon: `/uploads/condition_icons/${'a'.repeat(64)}.png` }, frozen: { name: 'frozen solid', icon: 'snow' } } },
      { ...H, conditions: { nameless: { icon: 'bolt' }, prone: { name: '  ', short: 'down' }, stunned: { rounds: 2 } } },
    ];
    for (const def of cases) expect(conditionsOf(def)).toEqual(server.conditionsOf(def));
  });

  it('lists every standard one with its switch, then the system\'s own, a nameless one by its id', () => {
    const list = conditionList({ ...H, conditions: { blinded: { on: false }, hex: { name: 'Hexed' }, blank: { icon: 'bolt' } } });
    expect(list.map((c) => [c.id, c.on, c.standard])).toEqual([
      ...STANDARD.map((s) => [s.id, s.id !== 'blinded', true]),
      ['hex', true, false], ['blank', true, false],
    ]);
    expect(list.find((c) => c.id === 'blank')!.name).toBe('');
  });

  it('labels a chip from the first word of a name', () => {
    expect(shortFrom('  frozen solid ')).toBe('FROZEN');
    expect(shortFrom('Overclocked')).toBe('OVERCLOC');
  });
});

describe('changing a standard condition stores only what differs', () => {
  it('turns one off and back on, leaving nothing when back as it was', () => {
    const off = withCondition(H, 'prone', { on: false });
    expect(stored(off)).toEqual({ prone: { on: false } });
    expect(problems(off)).toEqual([]);
    expect(withCondition(off, 'prone', { on: true })).toEqual(H);
  });

  it('keeps a rename, and forgets it when blank or put back', () => {
    const renamed = withCondition(H, 'prone', { name: 'Knocked down' });
    expect(stored(renamed)).toEqual({ prone: { name: 'Knocked down' } });
    expect(withCondition(renamed, 'prone', { name: '' })).toEqual(H);
    expect(withCondition(renamed, 'prone', { name: 'Prone' })).toEqual(H);
    expect(withCondition(H, 'prone', { short: 'prone' })).toEqual(H);
    expect(withCondition(H, 'prone', { icon: 'down', description: 'On the ground.' })).toEqual(H);
  });

  it('keeps a description emptied on purpose, since it differs from the standard', () => {
    expect(stored(withCondition(H, 'prone', { description: '' }))).toEqual({ prone: { description: '' } });
  });

  it('ends after rounds starting at 1, and drops the rounds again when it ends when removed', () => {
    const rounds = withCondition(H, 'stunned', { ends: 'rounds' });
    expect(stored(rounds)).toEqual({ stunned: { ends: 'rounds', rounds: 1 } });
    expect(stored(withCondition(rounds, 'stunned', { rounds: 3 }))).toEqual({ stunned: { ends: 'rounds', rounds: 3 } });
    expect(withCondition(rounds, 'stunned', { ends: 'removed' })).toEqual(H);
  });

  it('keeps modifiers, and nothing once the last is removed', () => {
    const mods = withCondition(H, 'poisoned', { modifiers: [{ target: 'all_rolls', amount: -1 }, { target: 'save', amount: -2 }] });
    expect(problems(mods)).toEqual([]);
    expect(withCondition(mods, 'poisoned', { modifiers: [] })).toEqual(H);
  });
});

describe('a system\'s own conditions', () => {
  it('adds one named to be renamed, picked by an id of its own, and counts it', () => {
    const made = withNewCondition(H)!;
    expect(made.id).toBe('new_condition');
    expect(stored(made.definition)).toEqual({ new_condition: { name: 'New condition' } });
    expect(problems(made.definition)).toEqual([]);
    expect(conditionCount(made.definition)).toBe(STANDARD.length + 1);
    expect(withNewCondition(made.definition)!.id).toBe('new_condition_2');
  });

  it('keeps a name as typed, even blank, so the problem shows rather than the condition vanishing', () => {
    const made = withNewCondition(H)!;
    const blank = withCondition(made.definition, made.id, { name: '' });
    expect(stored(blank)).toEqual({ new_condition: { name: '' } });
    expect(problems(blank)).toEqual([{ where: 'condition new_condition, name', message: 'Cannot be blank' }]);
  });

  it('stores nothing for an empty description or chip label, and never a switch', () => {
    const made = withNewCondition(H)!;
    expect(stored(withCondition(made.definition, made.id, { description: '', short: ' ', on: false }))).toEqual({ new_condition: { name: 'New condition' } });
  });

  it('deletes one of its own, and only turns a standard one off', () => {
    const made = withNewCondition(H)!;
    expect(withoutCondition(made.definition, made.id)).toEqual(H);
    expect(withoutCondition(H, 'prone')).toBe(H);
  });

  it('stops at sixty in all, the standard ones included', () => {
    let def = H;
    for (let n = STANDARD.length; n < LIMITS.conditions; n += 1) def = withNewCondition(def)!.definition;
    expect(conditionCount(def)).toBe(LIMITS.conditions);
    expect(problems(def)).toEqual([]);
    expect(withNewCondition(def)).toBeNull();
  });
});

describe('what a modifier may name', () => {
  it('is all rolls, then the stats and formulas by the names players see', () => {
    expect(modifierTargets(H)).toEqual([
      { id: 'all_rolls', label: 'ALL ROLLS' },
      { id: 'str', label: 'Strength' },
      { id: 'save', label: 'Physical save' },
      { id: 'move', label: 'MOVE' },
    ]);
    expect(modifierTargets({ format: 1, name: 'Bare' })).toEqual([{ id: 'all_rolls', label: 'ALL ROLLS' }]);
  });
});
