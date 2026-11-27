import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  luckOn, luckOf, withLuckOn, withLuckPreset, luckPresetNow, withLuck, withLuckRoll, withLuckRefill, luckRolls, luckRests,
  START, LIMITS, PRESETS, EACHES,
} from '../luck';
import type { Definition } from '../systemsApi';

/**
 * The RULE LIBRARY's LUCK card as logic (8c5b; approved mockup docs/mockups/rule-library.html, the LUCK card): the switch shared
 * with PARTS, the two presets (THE MOST from the system's own stat of that name), each part changed, held to the server's
 * checks (backend/systemBuilder/luck.js) and read as the server reads it.
 */

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const server = req('../../../../backend/systemBuilder/luck.js');

const H: Definition = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'aim', label: 'Aim' }, { id: 'luck', label: 'Luck' }] }],
  rolls: [
    { id: 'shoot', label: 'Shoot', dice: [{ count: '2', sides: 6 }], add: '@this', by: ['aim'] },
    { id: 'dodge', label: 'Dodge', dice: [{ count: '1', sides: 20 }], add: '@this', by: ['aim'] },
  ],
};
const BARE: Definition = { format: 1, name: 'Bare' };
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const on = (def: Definition = H) => withLuckOn(def, true);

describe('as the server has it', () => {
  it('the same start and limits; each point +1 or a die', () => {
    expect(START).toEqual(server.START);
    expect(LIMITS).toEqual(server.LIMITS);
    expect(EACHES.map((e) => e.id)).toEqual(server.EACH);
  });

  it('each preset passes its checks, with the stat or without, and reads back as itself', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['CYBERPUNK RED', 'A DICE POOL GAME']);
    for (const def of [H, BARE]) {
      for (const p of PRESETS) {
        const made = withLuckPreset(on(def), p.id);
        expect(problems(made), p.id).toEqual([]);
        expect(luckPresetNow(made), p.id).toBe(p.id);
        expect(server.luckRuleOf(made)).toMatchObject({ name: p.luck.name, each: p.luck.each });
      }
    }
    expect(luckOf(withLuckPreset(on(H), 'cpr')).most).toBe('@luck');
    expect(luckOf(withLuckPreset(on(BARE), 'cpr')).most).toBe('3');
    expect(luckOf(withLuckPreset(on(H), 'pool'))).toEqual({ name: 'EDGE', most: '3', each: 'die', on: 'all', refills: ['end_of_scene'] });
  });
});

describe('the switch, which is LUCK on PARTS', () => {
  it('off until written; on the first time is CYBERPUNK RED; off keeps it; LUCK off on PARTS is off', () => {
    expect(luckOn(H)).toBe(false);
    const made = on();
    expect(luckOn(made)).toBe(true);
    expect(luckPresetNow(made)).toBe('cpr');
    const changed = withLuck(made, { name: 'Fate' });
    const off = withLuckOn(changed, false);
    expect(luckOn(off)).toBe(false);
    expect(off.parts).toEqual({ luck: { on: false } });
    expect(luckOf(withLuckOn(off, true)).name).toBe('Fate');
    expect(luckOn({ ...changed, parts: { luck: { on: false } } })).toBe(false);
  });
});

describe('each part', () => {
  it('read as a game starts where the section doesn\'t say', () => {
    expect(luckOf({ ...H, luck: {} })).toEqual(START);
    expect(luckOf({ ...H, luck: { most: 5, each: 'x', on: 'x', refills: ['long_rest', 3] } })).toEqual({ ...START, most: '5', refills: ['long_rest'] });
  });

  it('changed and written as the server reads it; a change makes it the GM\'s own', () => {
    const made = withLuck(on(), { name: 'Fate', most: '@luck + 1', each: 'die' });
    expect(problems(made)).toEqual([]);
    expect(server.luckRuleOf(made)).toMatchObject({ name: 'FATE', most: '@luck + 1', each: 'die' });
    expect(luckPresetNow(made)).toBeNull();
    // What the card doesn't draw is kept.
    expect((withLuck({ ...on(), luck: { ...(on().luck as object), extra: 1 } }, { name: 'X' }).luck as Record<string, unknown>).extra).toBe(1);
  });

  it('ONLY THESE ROLLS: ticked in the system\'s order; EVERY ROLL again clears them', () => {
    let def = withLuck(on(), { on: [] });
    def = withLuckRoll(def, 'dodge', true);
    def = withLuckRoll(def, 'shoot', true);
    expect(luckOf(def).on).toEqual(['shoot', 'dodge']);
    expect(problems(def)).toEqual([]);
    def = withLuckRoll(def, 'shoot', false);
    expect(luckOf(def).on).toEqual(['dodge']);
    expect(luckOf(withLuckRoll(on(), 'dodge', true)).on).toEqual(['dodge']);
    expect(luckOf(withLuck(def, { on: 'all' })).on).toBe('all');
    expect(luckRolls(H)).toEqual([{ id: 'shoot', label: 'SHOOT' }, { id: 'dodge', label: 'DODGE' }]);
  });

  it('REFILLED BY: ticked in the system\'s order; a rest turned off shown while named', () => {
    let def = withLuckRefill(on(), 'short_rest', true);
    expect(luckOf(def).refills).toEqual(['short_rest', 'end_of_session']);
    def = withLuckRefill(def, 'end_of_session', false);
    expect(luckOf(def).refills).toEqual(['short_rest']);
    expect(problems(def)).toEqual([]);
    const offRest = { ...def, rests: { short_rest: { on: false } } };
    expect(luckRests(offRest).find((r) => r.id === 'short_rest')).toEqual({ id: 'short_rest', label: 'SHORT REST', on: false });
    expect(luckRests(withLuckRefill(offRest, 'short_rest', false)).some((r) => r.id === 'short_rest')).toBe(false);
  });
});
