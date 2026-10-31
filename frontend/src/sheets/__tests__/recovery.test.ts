import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import {
  LIMITS, restingOf, withFinish, withRecovery, withRecoveryOn, withBack, withBackAmount, withSpentAt, withoutRestInResting, diceOptions, healsText,
} from '../recovery';
import { withOption, withList } from '../choices';
import { withNewRest, withoutRest, restList } from '../rests';
import type { Definition } from '../systemsApi';

/**
 * The builder's recovery dice and how rests are finished, as logic (R1b; approved mockup
 * rest-on-sheet, 2026-10-30): each result held to the server's own checks
 * (backend/systemBuilder/recovery.js), so what the page writes is what the server takes.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/recovery.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const FORGE = {
  format: 1, name: 'Forge',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'floor((@con - 10) / 2)' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }, { id: 'wizard', label: 'Wizard', die: 6 }, { id: 'rogue', label: 'Rogue' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough' }] },
  ],
} as unknown as Definition;
const ALL = ['short_rest', 'long_rest', 'end_of_scene', 'end_of_session'];
const problems = (def: Definition) => (checkDefinition(def).problems as { where: string; message: string }[]).map((p) => `${p.where}: ${p.message}`);
const on = (def: Definition = FORGE) => withRecoveryOn(def, ALL);

describe('reading what a system says', () => {
  it('at the GM\'s call with no recovery dice when it says nothing, as the server reads it', () => {
    expect(restingOf(FORGE)).toEqual({ finish: 'call', recovery: null });
    expect(restingOf({ ...FORGE, resting: { finish: 'nap', recovery: 'yes' } } as Definition)).toEqual({ finish: 'call', recovery: null });
    expect(backend.restingOf(FORGE)).toEqual(restingOf(FORGE));
  });

  it('fills in the defaults, the same as the server', () => {
    const def = { ...FORGE, resting: { finish: 'sheet', recovery: { name: 'Hit Dice', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'by', amount: '2' }, { rest: 'end_of_session', how: 'half' }] } } } as unknown as Definition;
    expect(restingOf(def)).toEqual(backend.restingOf(def));
    expect(restingOf(def).recovery).toEqual({ name: 'Hit Dice', count: 'levels', perLevel: false, plus: null, spentAt: ['short_rest'], back: [{ rest: 'long_rest', how: 'by', amount: '2' }, { rest: 'end_of_session', how: 'half' }] });
    const any = { ...FORGE, resting: { recovery: { name: 'Recoveries', count: '8', per_level: true, plus: '@con_mod', spent_at: 'any' } } } as unknown as Definition;
    expect(restingOf(any)).toEqual(backend.restingOf(any));
    // Only true heals once per level.
    const yes = { ...FORGE, resting: { recovery: { name: 'Recoveries', per_level: 'yes', spent_at: 'any' } } } as unknown as Definition;
    expect(restingOf(yes).recovery!.perLevel).toBe(false);
    expect(restingOf(yes)).toEqual(backend.restingOf(yes));
  });

  it('keeps the limits equal to the server\'s', () => {
    expect(LIMITS).toEqual(backend.LIMITS);
  });

  it('the dice are a levelled list\'s options with one, named or by id', () => {
    expect(diceOptions(FORGE)).toEqual([{ id: 'fighter', label: 'Fighter', die: 10 }, { id: 'wizard', label: 'Wizard', die: 6 }]);
    // One not yet named shows by its id.
    expect(diceOptions(withOption(FORGE, 'classes', 'wizard', { label: ' ' }))[1].label).toBe('wizard');
    expect(diceOptions(FORGE).map((d) => d.id)).toEqual(backend.diceOptionsOf(FORGE).map((d: { option: { id: string } }) => d.option.id));
    const stray = { ...FORGE, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough', die: 6 }] }] } as unknown as Definition;
    expect(diceOptions(stray)).toEqual([]);
  });
});

describe('writing it', () => {
  it('turning them on starts at a short rest, all back at a long rest, which the server takes', () => {
    const def = on();
    expect(def.resting).toEqual({ recovery: { name: 'Recovery dice', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }] } });
    expect(problems(def)).toEqual([]);
    // With neither rest on: any time, nothing back.
    expect(withRecoveryOn(FORGE, ['end_of_scene']).resting).toEqual({ recovery: { name: 'Recovery dice', spent_at: 'any' } });
    expect(problems(withRecoveryOn(FORGE, []))).toEqual([]);
  });

  it('stores only what differs from the defaults, and nothing once they are off at the GM\'s call', () => {
    let def = withRecovery(on(), { name: 'Recoveries', count: '8', perLevel: true, plus: '@con_mod' });
    expect(def.resting).toEqual({ recovery: { name: 'Recoveries', count: '8', per_level: true, plus: '@con_mod', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }] } });
    expect(problems(def)).toEqual([]);
    def = withRecovery(def, { count: 'levels', perLevel: false, plus: '  ' });
    expect(def.resting).toEqual({ recovery: { name: 'Recoveries', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }] } });
    expect('resting' in withRecovery(def, null)).toBe(false);
    // Changing dice that aren't on does nothing.
    expect(withRecovery(FORGE, { name: 'Hit Dice' })).toEqual(FORGE);
  });

  it('keeps a blank name as typed, a problem the server names', () => {
    expect(problems(withRecovery(on(), { name: ' ' }))).toEqual(['resting, recovery, name: Required']);
  });

  it('finished on each sheet stores sheet; at the call stores nothing', () => {
    const sheet = withFinish(FORGE, 'sheet');
    expect(sheet.resting).toEqual({ finish: 'sheet' });
    expect(problems(sheet)).toEqual([]);
    expect('resting' in withFinish(sheet, 'call')).toBe(false);
    // Each keeps the other.
    expect(withFinish(on(), 'sheet').resting).toEqual({ finish: 'sheet', recovery: on().resting!.recovery });
    expect(withRecovery(withFinish(on(), 'sheet'), null).resting).toEqual({ finish: 'sheet' });
    expect(restingOf(withRecoveryOn(sheet, ALL)).finish).toBe('sheet');
  });

  it('spent at rests ticked on and off, from any time too', () => {
    let def = withSpentAt(on(), 'long_rest', true);
    expect(restingOf(def).recovery!.spentAt).toEqual(['short_rest', 'long_rest']);
    def = withSpentAt(def, 'long_rest', true);
    expect(restingOf(def).recovery!.spentAt).toEqual(['short_rest', 'long_rest']);
    def = withSpentAt(def, 'short_rest', false);
    expect(restingOf(def).recovery!.spentAt).toEqual(['long_rest']);
    expect(problems(def)).toEqual([]);
    const any = withRecovery(def, { spentAt: 'any' });
    expect(restingOf(withSpentAt(any, 'end_of_scene', true)).recovery!.spentAt).toEqual(['end_of_scene']);
    // None ticked is a problem the page and the server both name.
    expect(problems(withSpentAt(def, 'long_rest', false))).toEqual(['resting, recovery, spent_at: any, or a list of the rests they are spent at']);
    expect(withSpentAt(FORGE, 'short_rest', true)).toEqual(FORGE);
  });

  it('given back: nothing, all, half, or by an amount starting at 1, each rest once, in the order added', () => {
    let def = withBack(on(), 'end_of_session', 'half');
    expect(restingOf(def).recovery!.back).toEqual([{ rest: 'long_rest', how: 'all' }, { rest: 'end_of_session', how: 'half' }]);
    def = withBack(def, 'long_rest', 'by');
    expect(restingOf(def).recovery!.back).toEqual([{ rest: 'long_rest', how: 'by', amount: '1' }, { rest: 'end_of_session', how: 'half' }]);
    def = withBackAmount(def, 'long_rest', '@con_mod + 1');
    // Pressing BY again keeps the amount; another rest's amount is untouched.
    def = withBack(def, 'long_rest', 'by');
    expect((withBackAmount(def, 'end_of_session', '9').resting as { recovery: object }).recovery).toMatchObject({ back: [{ rest: 'long_rest', how: 'by', amount: '@con_mod + 1' }, { rest: 'end_of_session', how: 'half' }] });
    expect(JSON.stringify(withBackAmount(def, 'end_of_session', '9').resting)).not.toContain('"9"');
    expect(problems(def)).toEqual([]);
    def = withBack(def, 'long_rest', 'all');
    expect(def.resting).toEqual({ recovery: { name: 'Recovery dice', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }, { rest: 'end_of_session', how: 'half' }] } });
    def = withBack(withBack(def, 'long_rest', null), 'end_of_session', null);
    expect(def.resting).toEqual({ recovery: { name: 'Recovery dice', spent_at: ['short_rest'] } });
    expect(withBack(FORGE, 'long_rest', 'all')).toEqual(FORGE);
    expect(withBackAmount(FORGE, 'long_rest', '2')).toEqual(FORGE);
  });

  it('an empty amount is kept as typed, a problem the server names', () => {
    const def = withBackAmount(withBack(on(), 'long_rest', 'by'), 'long_rest', '');
    expect(problems(def)).toEqual(['resting, recovery, back 1, amount: Must be formula text']);
  });

  it('says what one heals in words', () => {
    const r = restingOf(on()).recovery!;
    expect(healsText(r)).toBe('its die');
    expect(healsText({ ...r, perLevel: true, plus: ' @con_mod ' })).toBe('its die once for each level + @con_mod');
    expect(healsText({ ...r, plus: ' ' })).toBe('its die');
  });
});

describe('a deleted rest, and dice without levels', () => {
  it('no recovery dice left spent at or given back by a deleted rest', () => {
    const made = withNewRest(FORGE)!;
    let def = withSpentAt(withBack(on(made.definition), made.id, 'all'), made.id, true);
    expect(problems(def)).toEqual([]);
    def = withoutRest(def, made.id);
    expect(restList(def).some((r) => r.id === made.id)).toBe(false);
    expect(restingOf(def).recovery).toEqual({ ...restingOf(on()).recovery! });
    expect(problems(def)).toEqual([]);
    // Spent any time stays any time; one not named changes nothing.
    const any = withRecovery(withBack(on(made.definition), made.id, 'half'), { spentAt: 'any' });
    expect(restingOf(withoutRestInResting(any, made.id)).recovery!).toMatchObject({ spentAt: 'any', back: [{ rest: 'long_rest', how: 'all' }] });
    expect(withoutRestInResting(on(), made.id)).toEqual(on());
    expect(withoutRestInResting(FORGE, made.id)).toBe(FORGE);
  });

  it('a die is set on a levelled list\'s option, kept to 2 to 100 sides, and taken away', () => {
    expect(diceOptions(withOption(FORGE, 'classes', 'rogue', { die: 8 })).map((d) => d.die)).toEqual([10, 6, 8]);
    expect(diceOptions(withOption(FORGE, 'classes', 'rogue', { die: 1 })).map((d) => d.die)).toEqual([10, 6, 2]);
    expect(diceOptions(withOption(FORGE, 'classes', 'rogue', { die: 500 })).map((d) => d.die)).toEqual([10, 6, 100]);
    expect(withOption(FORGE, 'classes', 'rogue', { die: 2.5 })).toEqual(FORGE);
    expect('die' in (withOption(FORGE, 'classes', 'fighter', { die: null }).choices as { options: object[] }[])[0].options[0]).toBe(false);
    // Another change keeps the die.
    expect(diceOptions(withOption(FORGE, 'classes', 'fighter', { label: 'Warrior' }))[0]).toEqual({ id: 'fighter', label: 'Warrior', die: 10 });
    // Never on a list without levels.
    const feats = withOption(FORGE, 'feats', 'tough', { die: 6 });
    expect(feats).toEqual(FORGE);
    expect(problems(withOption(on(), 'classes', 'rogue', { die: 12 }))).toEqual([]);
  });

  it('turning LEVELLED off takes the list\'s dice with it, so nothing is left for the server to refuse', () => {
    const off = withList(FORGE, 'classes', { levelled: false });
    expect(JSON.stringify(off.choices)).not.toContain('"die"');
    expect(problems(off)).toEqual([]);
    // As does making it a list everyone has.
    expect(JSON.stringify(withList(FORGE, 'classes', { picked: 'everyone' }).choices)).not.toContain('"die"');
    // Another change to a levelled list keeps them.
    expect(diceOptions(withList(FORGE, 'classes', { many: 'Callings' })).map((d) => d.die)).toEqual([10, 6]);
  });
});
