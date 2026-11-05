/**
 * A system's NEW CHARACTER flow, the server's side (7c1; approved mockup new-character, 2026-11-03):
 * off unless a GM turns it on; steps read from what the system has, in the GM's order; only the
 * switch, the order and what's off stored, so a list made later joins by itself and a deleted one
 * leaves; and it travels in the system file.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { creationOf, stepIdsOf, LIMITS, stepsAsked, creationShown, creatingNow, creationAction, withUpload, CREATING_KEY } = require_('../systemBuilder/creation');
const { pickAction } = require_('../systemBuilder/picking');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { playerMayEdit } = require_('../sheets/templates');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const { OTHER } = require_('../systemBuilder/versionDiff');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'spec', label: 'Spec', choice: 'specs' }] }] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [{ id: 'dockhand', label: 'Dockhand' }] },
    { id: 'specs', one: 'Spec', many: 'Specs', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picked: 'both', options: [{ id: 'tough', label: 'Tough' }] },
    { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [{ id: 'breath', label: 'Breath' }] },
  ],
};
const problems = (creation, def = HEARTH) => checkDefinition({ ...def, creation }).problems.map((p) => `${p.where}: ${p.message}`);
const ids = (def) => creationOf(def).steps.map((s) => s.id);

describe('the steps a system has', () => {
  const ALL = ['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits', 'money'];

  it('who they are, the stats, each list picked on its own or both ways, kits and money', () => {
    expect(stepIdsOf(HEARTH)).toEqual(ALL);
  });

  it('no stats, no step for them: nor a group with none; a list only under features or everyone\'s has none', () => {
    expect(stepIdsOf({ format: 1, name: 'B' })).toEqual(['who', 'kits', 'money']);
    expect(stepIdsOf({ format: 1, name: 'B', stats: [{ id: 'g', label: 'G', stats: [] }] })).toEqual(['who', 'kits', 'money']);
  });

  it('no money with the bank part off', () => {
    expect(stepIdsOf({ ...HEARTH, parts: { bank: { on: false } } })).not.toContain('money');
  });

  it('off unless turned on, in the order they come; nothing says nothing', () => {
    expect(creationOf(HEARTH)).toEqual({ on: false, steps: ALL.map((id) => ({ id, off: false })) });
    expect(creationOf({ ...HEARTH, creation: { on: true } }).on).toBe(true);
    expect(creationOf({ ...HEARTH, creation: 'on' }).on).toBe(false);
    expect(creationOf({ ...HEARTH, creation: { on: 'yes' } }).on).toBe(false);
    expect(creationOf(undefined).steps.map((s) => s.id)).toContain('who');
  });

  it('in the GM\'s order, what they switched off said, WHO THEY ARE never off', () => {
    const c = creationOf({ ...HEARTH, creation: { on: true, order: ['money', 'who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits'], off: ['kits', 'who'] } });
    expect(c.steps.map((s) => s.id)).toEqual(['money', 'who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits']);
    expect(c.steps.filter((s) => s.off).map((s) => s.id)).toEqual(['kits']);
  });

  it('an order naming what has gone is no problem, and a step twice counts once', () => {
    const creation = { order: ['list:gone', 'kits', 'kits', 'who'] };
    expect(ids({ ...HEARTH, creation })).not.toContain('list:gone');
    expect(ids({ ...HEARTH, creation }).filter((x) => x === 'kits')).toHaveLength(1);
    expect(problems(creation)).toEqual([]);
  });

  it('a list made later joins the lists, before kits and money; anything else goes on the end', () => {
    const creation = { order: ['who', 'stats', 'kits', 'money'] };
    expect(ids({ ...HEARTH, creation })).toEqual(['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits', 'money']);
    expect(ids({ ...HEARTH, creation: { order: ['who', 'list:classes'] } })).toEqual(['who', 'list:classes', 'stats', 'list:backgrounds', 'list:feats', 'kits', 'money']);
  });
});

describe('the checks', () => {
  it('take what the page writes', () => {
    expect(problems({ on: true, order: ['who', 'stats', 'list:classes', 'kits', 'money'], off: ['money', 'list:classes'] })).toEqual([]);
    expect(problems({ on: false })).toEqual([]);
  });

  it('say what is wrong', () => {
    expect(problems('on')).toEqual(['creation: Must say how a new character is made']);
    expect(problems({ steps: [] })).toEqual(['creation, steps: Not part of the new character flow']);
    expect(problems({ on: 'yes' })).toEqual(['creation, on: Must say on: true or on: false']);
    expect(problems({ order: 'who' })).toEqual(['creation, order: Must be a list of steps']);
    expect(problems({ off: 'kits' })).toEqual(['creation, off: Must be a list of steps']);
    const steps = 'creation, order: Steps are who, stats, kits, money, or list: and a list\'s id';
    for (const bad of [['nope'], [3], ['list:'], ['list:Bad Name']]) expect(problems({ order: bad }), JSON.stringify(bad)).toEqual([steps]);
    expect(problems({ off: ['who'] })).toEqual(['creation, off: WHO THEY ARE is always asked: a character needs a name']);
    expect(problems({ order: Array(LIMITS.steps + 1).fill('who') })).toEqual([`creation, order: At most ${LIMITS.steps} steps`]);
  });
});

describe('the system file', () => {
  it('carries it, unchanged, and the version preview names it', () => {
    const creation = { on: true, order: ['who', 'list:classes', 'stats', 'list:backgrounds', 'list:feats', 'kits', 'money'], off: ['money'] };
    const file = citysys.buildFile({ definition: { ...HEARTH, creation }, version: 1, origin: 'sys_abcdefabcdefabcd' });
    const read = citysys.readFile(JSON.stringify(file));
    expect([read.file.definition.creation, read.problems]).toEqual([creation, []]);
    expect(OTHER).toContain('creation');
  });
});

describe('walking through it (7c2)', () => {
  const ON = { ...HEARTH, creation: { on: true } };
  const fresh = { [CREATING_KEY]: {} };

  it('asks the steps that are on, in order; KITS and MONEY wait for 7c4', () => {
    expect(stepsAsked(ON)).toEqual(['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats']);
    expect(stepsAsked({ ...HEARTH, creation: { on: true, off: ['stats'], order: ['list:feats', 'who'] } }))
      .toEqual(['list:feats', 'who', 'list:classes', 'list:backgrounds']);
  });

  it('tells the browser the steps and stats while it is on, and nothing while it is off', () => {
    expect(creationShown(HEARTH)).toBeNull();
    expect(creationShown({ ...HEARTH, creation: { on: false } })).toBeNull();
    const withRange = { ...ON, stats: [{ id: 'a', label: 'A', stats: [{ id: 'x', label: 'X', min: 3, max: 18 }, { id: 'y' }] }, { id: 'none', label: 'N', stats: [] }] };
    expect(creationShown(withRange)).toEqual({
      steps: ['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats'],
      stats: [{ id: 'a', label: 'A', stats: [{ id: 'x', label: 'X', min: 3, max: 18 }, { id: 'y', label: 'y' }] }],
    });
  });

  it('opens once: a second open changes nothing, so a place is never lost', () => {
    expect(creationAction(ON, {}, { kind: 'open' })).toEqual({ ok: true, data: fresh });
    const going = { name: 'W', [CREATING_KEY]: { at: 'stats' } };
    expect(creationAction(ON, going, { kind: 'open' })).toEqual({ ok: true });
    expect(creationAction(ON, { [CREATING_KEY]: { done: true } }, { kind: 'open' })).toEqual({ ok: true });
  });

  it('keeps the step, keeping what else is on the sheet; only a step this game asks', () => {
    expect(creationAction(ON, { name: 'W', ...fresh }, { kind: 'at', step: 'stats' })).toEqual({ ok: true, data: { name: 'W', [CREATING_KEY]: { at: 'stats' } } });
    expect(creationAction(ON, fresh, { kind: 'at', step: 'kits' }).error).toBe('Not one of this game\'s steps');
    expect(creationAction(ON, fresh, { kind: 'at', step: 'list:nope' }).ok).toBe(false);
    expect(creationAction(ON, fresh, { kind: 'at' }).ok).toBe(false);
  });

  it('finishes, and nothing moves it after that', () => {
    const done = creationAction(ON, { [CREATING_KEY]: { at: 'stats' } }, { kind: 'finish' }).data;
    expect(done).toEqual({ [CREATING_KEY]: { done: true } });
    for (const action of [{ kind: 'at', step: 'stats' }, { kind: 'finish' }]) {
      expect(creationAction(ON, done, action)).toEqual({ ok: false, error: 'This character isn\'t being made' });
    }
  });

  it('a step or a finish needs it opened first', () => {
    expect(creationAction(ON, {}, { kind: 'finish' }).ok).toBe(false);
    expect(creationAction(ON, {}, { kind: 'at', step: 'stats' }).ok).toBe(false);
  });

  it('refuses it all with the flow off, and anything else it is asked', () => {
    expect(creationAction(HEARTH, {}, { kind: 'open' })).toEqual({ ok: false, error: 'This game has no guided new character' });
    expect(creationAction(ON, fresh, { kind: 'nope' })).toEqual({ ok: false, error: 'Nothing to do' });
    expect(creationAction(ON, fresh, null).ok).toBe(false);
  });

  it('under way only while it is opened, not finished, and on', () => {
    expect(creatingNow(ON, fresh)).toBe(true);
    expect(creatingNow(ON, {})).toBe(false);
    expect(creatingNow(ON, { [CREATING_KEY]: { done: true } })).toBe(false);
    expect(creatingNow(HEARTH, fresh)).toBe(false);
  });

  it('an upload is the end of it, opened or not; with the flow off nothing is written', () => {
    expect(withUpload(ON, { name: 'W' })).toEqual({ name: 'W', [CREATING_KEY]: { done: true, uploaded: true } });
    expect(withUpload(ON, { [CREATING_KEY]: { at: 'stats' } })).toEqual({ [CREATING_KEY]: { done: true, uploaded: true } });
    expect(withUpload(ON, { [CREATING_KEY]: { done: true } })).toEqual({ [CREATING_KEY]: { done: true } });
    expect(withUpload(HEARTH, { name: 'W' })).toEqual({ name: 'W' });
    expect(withUpload(null, { name: 'W' })).toEqual({ name: 'W' });
  });

  it('the place can\'t be written as a field', () => {
    expect(playerMayEdit('generic', CREATING_KEY)).toBe(false);
  });
});

describe('taking a pick back while making the character (7c2)', () => {
  const ROLLED = { ...HEARTH, creation: { on: true }, choices: [
    { id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'soldier', label: 'Soldier' }] },
    { id: 'omens', one: 'Omen', many: 'Omens', table: 'd6', players: 'roll', options: [{ id: 'storm', label: 'Storm', roll: '1-6' }] },
  ] };
  const held = (place) => ({ [PICKS_KEY]: { classes: [{ option: 'soldier' }], omens: [{ option: 'storm' }] }, ...(place ? { [CREATING_KEY]: place } : {}) });
  const drop = (data, list, option) => pickAction(ROLLED, data, { kind: 'drop', list, option });

  it('a player may, on their own picks', () => {
    const done = drop(held({ at: 'list:classes' }), 'classes', 'soldier');
    expect(done.ok).toBe(true);
    expect(done.data[PICKS_KEY].classes).toEqual([]);
  });

  it('not on a list rolled only: that would be a second roll', () => {
    expect(drop(held({}), 'omens', 'storm')).toEqual({ ok: false, error: 'Only the GM takes a pick away' });
  });

  it('not before it is opened, nor once it is finished, nor with the flow off', () => {
    for (const data of [held(null), held({ done: true })]) expect(drop(data, 'classes', 'soldier').ok).toBe(false);
    const off = { ...ROLLED, creation: { on: false } };
    expect(pickAction(off, held({}), { kind: 'drop', list: 'classes', option: 'soldier' }).ok).toBe(false);
  });

  it('the GM still may, on any list, at any time', () => {
    expect(pickAction(ROLLED, held(null), { kind: 'drop', list: 'omens', option: 'storm' }, { gm: true }).ok).toBe(true);
  });
});
