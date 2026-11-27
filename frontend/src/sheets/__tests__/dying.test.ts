import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  dyingOn, dyingOf, withDyingOn, withPreset, presetNow, withDying, withSave, withNpcs, wholeTyped, withNaturalAdded, withNatural, withoutNatural,
  asks, startsWhen, START, LIMITS, PRESETS, WAYS, HURTS, NATURAL_THENS,
} from '../dying';
import type { Definition } from '../systemsApi';

/**
 * The RULE LIBRARY's dying card as logic (8c2; approved mockup docs/mockups/rule-library.html, 2026-11-26): the switch shared
 * with PARTS, the four presets, each number changed, held to the server's checks (backend/systemBuilder/dying.js) and read as
 * the server reads it.
 */

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const server = req('../../../../backend/systemBuilder/dying.js');

const H: Definition = { format: 1, name: 'Hearth', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'body', label: 'Body' }] }] };
const BARE: Definition = { format: 1, name: 'Bare' };
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const on = (def: Definition = H) => withDyingOn(def, true);

describe('as the server has it', () => {
  it('the same start, limits and choices as the server', () => {
    expect(START).toEqual(server.START);
    expect(LIMITS).toEqual(server.LIMITS);
    expect(WAYS.map((w) => w.id)).toEqual(server.WAYS);
    expect(HURTS.map((h) => h.id)).toEqual(server.HURT);
    expect(NATURAL_THENS.map((n) => n.id)).toEqual(server.NATURALS);
    expect(NATURAL_THENS.map((n) => n.label)).toEqual(server.NATURALS.map((n: string) => server.NATURAL_WORDS[n]));
  });

  it('each preset passes its checks, with BODY or without, and reads back as itself', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['D&D 5E', 'CYBERPUNK RED', 'CITIES WITHOUT NUMBER', 'NO ROLL (PBTA, BLADES)']);
    for (const def of [H, BARE]) {
      for (const p of PRESETS) {
        const made = withPreset(on(def), p.id);
        expect(problems(made), p.id).toEqual([]);
        expect(presetNow(made), p.id).toBe(p.id);
        const rule = server.dyingRuleOf(made);
        expect(rule.way).toBe(p.dying.way);
        expect(rule.word).toBe(p.dying.word);
      }
    }
  });

  it('Cyberpunk RED rolls under BODY where the system has it, 10 where not', () => {
    expect(dyingOf(withPreset(on(H), 'cpr')).save).toEqual({ dice: '1d10', way: 'under', target: '@body' });
    expect(dyingOf(withPreset(on(BARE), 'cpr')).save.target).toBe('10');
    // The others keep their own number, BODY or not.
    expect(dyingOf(withPreset(on(H), 'dnd')).save.target).toBe('10');
  });
});

describe('the switch, which is DEATH SAVES on PARTS', () => {
  it('off until the rule is written; on the first time is D&D 5E with no NPCs', () => {
    expect(dyingOn(H)).toBe(false);
    const made = on();
    expect(dyingOn(made)).toBe(true);
    expect(presetNow(made)).toBe('dnd');
    expect(dyingOf(made).npcs).toEqual({ friendly: false, enemy: false });
    expect(made.parts ?? {}).toEqual({});
  });

  it('off keeps the rule; back on finds it as it was', () => {
    const changed = withDying(on(), { word: 'Bleeding' });
    const off = withDyingOn(changed, false);
    expect(dyingOn(off)).toBe(false);
    expect(off.parts).toEqual({ death: { on: false } });
    expect(dyingOf(off).word).toBe('Bleeding');
    const again = withDyingOn(off, true);
    expect(dyingOn(again)).toBe(true);
    expect(dyingOf(again).word).toBe('Bleeding');
    // DEATH SAVES off on PARTS turns the card off too.
    expect(dyingOn({ ...changed, parts: { death: { on: false } } })).toBe(false);
  });
});

describe('each number', () => {
  it('read as a game starts where the section doesn\'t say', () => {
    expect(dyingOf({ ...H, dying: {} })).toEqual(START);
    expect(dyingOf({ ...H, dying: { way: 'nope', to_live: 0, hurt: 7, save: { target: 12, way: 'sideways' }, npcs: { enemy: true }, naturals: [{ face: 'x', then: 'win' }, 3] } }))
      .toEqual({ ...START, save: { ...START.save, target: '12' }, npcs: { friendly: false, enemy: true }, naturals: [{ face: 0, then: 'dead' }] });
  });

  it('a preset keeps WHO GOES DOWN; changing anything makes it the GM\'s own', () => {
    const npcs = withNpcs(on(), { enemy: true });
    const cwn = withPreset(npcs, 'cwn');
    expect(dyingOf(cwn).npcs).toEqual({ friendly: false, enemy: true });
    expect(presetNow(cwn)).toBe('cwn');
    expect(presetNow(withDying(cwn, { turns: 5 }))).toBeNull();
    expect(presetNow(withSave(cwn, { dice: '1d12' }))).toBeNull();
    expect(problems(withNpcs(cwn, { friendly: true }))).toEqual([]);
    // One part of the save changed, the rest kept.
    expect(dyingOf(withSave(withPreset(on(H), 'cpr'), { way: 'at_least' })).save).toEqual({ dice: '1d10', way: 'at_least', target: '@body' });
    // Ticked only when written as ticked.
    expect(dyingOf({ ...H, dying: { npcs: { friendly: 'yes', enemy: 1 } } }).npcs).toEqual({ friendly: false, enemy: false });
  });

  it('the save, the count and the rest written as the server reads them', () => {
    const made = withSave(withDying(on(), { way: 'once', harder: 2, to_live: 4, turns: 9, hurt: 'dead', word: 'Down' }), { dice: '1d20 + 1', way: 'under', target: '@body' });
    expect(problems(made)).toEqual([]);
    expect(server.dyingRuleOf(made)).toMatchObject({ word: 'DOWN', way: 'once', harder: 2, to_live: 4, turns: 9, hurt: 'dead', save: { dice: '1d20 + 1', way: 'under', target: '@body' } });
    // Dice that can't show a natural kept from the preset: the server says so.
    expect(problems(withSave(made, { dice: '2d6' }))).toEqual(['dying, natural 1, face: 2d6 never shows 20']);
  });

  it('a whole number typed: held to its range, what it was for anything else', () => {
    expect(wholeTyped('4', 1, 10, 3)).toBe(4);
    expect(wholeTyped('0', 1, 10, 3)).toBe(1);
    expect(wholeTyped('99', 1, 10, 3)).toBe(10);
    expect(wholeTyped('-30', -20, 20, 0)).toBe(-20);
    expect(wholeTyped('', 1, 10, 3)).toBe(3);
    expect(wholeTyped('2.5', 1, 10, 3)).toBe(3);
    expect(wholeTyped(' 7 ', 1, 10, 3)).toBe(7);
  });

  it('naturals: one more at the top face, then 1, then 2; changed; taken off; six at most', () => {
    let def = withDying(on(), { naturals: [] });
    def = withNaturalAdded(def);
    expect(dyingOf(def).naturals).toEqual([{ face: 20, then: 'dead' }]);
    def = withNaturalAdded(def);
    expect(dyingOf(def).naturals[1]).toEqual({ face: 1, then: 'dead' });
    def = withNaturalAdded(def);
    expect(dyingOf(def).naturals[2].face).toBe(2);
    expect(dyingOf(withNaturalAdded(withSave(withDying(on(), { naturals: [] }), { dice: '1d10' }))).naturals).toEqual([{ face: 10, then: 'dead' }]);
    def = withNatural(def, 1, { then: 'two_failures' });
    expect(dyingOf(def).naturals[1]).toEqual({ face: 1, then: 'two_failures' });
    def = withoutNatural(def, 0);
    expect(dyingOf(def).naturals.map((n) => n.face)).toEqual([1, 2]);
    for (let i = 0; i < 10; i += 1) def = withNaturalAdded(def);
    expect(dyingOf(def).naturals).toHaveLength(LIMITS.naturals);
    // Each its own face: the server takes no two alike.
    expect(dyingOf(def).naturals.map((n) => n.face)).toEqual([1, 2, 20, 3, 4, 5]);
    expect(problems(def)).toEqual([]);
  });

  it('what each way asks', () => {
    expect(asks('count')).toEqual({ save: true, count: true, harder: false, turns: false });
    expect(asks('once')).toEqual({ save: true, count: false, harder: true, turns: false });
    expect(asks('turns')).toEqual({ save: false, count: false, harder: false, turns: true });
    expect(asks('none')).toEqual({ save: false, count: false, harder: false, turns: false });
  });

  it('what starts it, by the game\'s health model', () => {
    expect(startsWhen(H)).toBe('0 HP');
    expect(startsWhen({ ...H, core: { health: { model: 'typed' } } })).toBe('the heaviest damage fills the track');
    expect(startsWhen({ ...H, core: { health: { model: 'harm' } } })).toBe('harm goes past the top level');
    expect(startsWhen({ ...H, core: { health: { model: 'wounds' } } })).toBe('no wounds are left');
    expect(startsWhen({ ...H, core: { health: { model: 'tracks' } } })).toBe('the first track reaches 0');
    expect(startsWhen({ ...H, core: { health: { model: 'none' } } })).toBe('never: this game has no health (SETUP: NO HEALTH)');
  });
});

describe("what the card doesn't draw", () => {
  it('kept through every change: STABILIZE from a file stays as it was (8c4a)', () => {
    const stabilize = { field: 'body', vs: '10' };
    let def: Definition = { ...on(H), dying: { ...(on(H).dying as object), stabilize } };
    def = withDying(def, { word: 'Down' });
    def = withSave(def, { dice: '1d12' });
    def = withNpcs(def, { enemy: true });
    def = withPreset(def, 'cwn');
    def = withNaturalAdded(def);
    expect((def.dying as { stabilize: unknown }).stabilize).toEqual(stabilize);
  });
});
