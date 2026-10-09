import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  restList, restsOf, restCount, withRest, withNewRest, withoutRest, countedAs, makesLoop,
  refillTargets, describeRefill, newRefill, fitRefill, withRefill, withNewRefill, withoutRefill,
  wearsOff, withWearsOff, STANDARD, LIMITS, type Refill,
} from '../rests';
import { conditionList, withCondition, conditionsOf as frontConditionsOf } from '../conditions';
import type { Definition } from '../systemsApi';
import type { CustomRenderSheet } from '../customTemplates';

/**
 * The builder's RESTS page as logic (4f3). Approved mockup builder-rests (2026-10-09). Every rule is
 * held to the server's own (systemBuilder/rests.js, definition.js, conditions.js): what is listed,
 * what is stored, what a rest can refill, and that every edit the page makes is one the server takes.
 */

const req = createRequire(import.meta.url);
const backRests = req('../../../../backend/systemBuilder/rests.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { conditionsOf } = req('../../../../backend/systemBuilder/conditions.js');
const { effectiveSheet } = req('../../../../backend/systemBuilder/sheet.js');
const { restOrder } = req('../../../../backend/systemBuilder/resting.js');

const HEARTH: Definition = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  derived: [{ id: 'ward', label: 'Ward', formula: '@fatigue + 10' }],
  sheet: {
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }] },
      { id: 'body', label: 'BODY', layout: 'grid', fields: [
        { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
        { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
        { id: 'fatigue', label: 'Fatigue', type: 'number' },
        { id: 'ward', label: 'Ward', type: 'number' },
        { id: 'armor', label: 'Armor', type: 'number', source: 'token_ac' },
      ] },
      { id: 'magic', label: 'MAGIC', layout: 'grid', fields: [
        { id: 'slots', label: 'Spell slots', type: 'number', maxField: 'slots_max' },
        { id: 'slots_max', label: 'Slots max', type: 'number' },
      ] },
    ],
  },
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
    long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }, { what: 'fatigue', how: 'by', amount: '-1' }, { what: 'section:magic', how: 'max' }] },
    end_of_scene: { on: false },
    downtime: { name: 'Downtime', counts_as: ['long_rest'], refills: [{ what: 'fatigue', how: 'to', amount: '0' }] },
  },
  conditions: { exhausted: { ends: 'rest', at: ['long_rest'] }, stunned: { ends: 'rounds', rounds: 1 } },
};
const SHEET = effectiveSheet(HEARTH) as CustomRenderSheet;
const TARGETS = refillTargets(HEARTH, SHEET);
const publishes = (def: Definition) => expect(checkDefinition(def).problems).toEqual([]);

describe('the rests a system has', () => {
  it('are the standard four in order, with edits and switches, then its own', () => {
    expect(STANDARD).toEqual(backRests.STANDARD);
    expect(LIMITS).toEqual(backRests.LIMITS);
    expect(restList(HEARTH).map((r) => [r.id, r.name, r.standard, r.on])).toEqual([
      ['short_rest', 'Short rest', true, true], ['long_rest', 'Long rest', true, true], ['end_of_scene', 'End of scene', true, false],
      ['end_of_session', 'End of session', true, true], ['downtime', 'Downtime', false, true],
    ]);
    expect(restList({ format: 1, name: 'X', rests: { nameless: {} } }).at(-1)).toMatchObject({ id: 'nameless', name: '', standard: false });
    expect(restCount(HEARTH)).toBe(5);
  });

  it('are offered as the server offers them', () => {
    const defs: Definition[] = [HEARTH, { format: 1, name: 'Bare' }, { format: 1, name: 'Odd', rests: { long_rest: { name: '  Sleep ', counts_as: ['end_of_scene', 'long_rest', 'short_rest'] }, end_of_scene: { on: false }, nameless: {}, x: 'no' } }];
    for (const def of defs) expect(restsOf(def), def.name).toEqual(backRests.restsOf(def).map(({ standard: _s, ...r }: { standard: boolean }) => ({ ...r, standard: _s })));
  });

  it('count what each counts as, deepest first, as the server runs them', () => {
    expect(countedAs(HEARTH, 'downtime')).toEqual(['short_rest', 'long_rest']);
    expect(countedAs(HEARTH, 'downtime')).toEqual(restOrder(backRests.restsOf(HEARTH), 'downtime').slice(0, -1));
    expect(countedAs(HEARTH, 'short_rest')).toEqual([]);
    expect(makesLoop(HEARTH, 'short_rest', 'downtime')).toBe(true);
    expect(makesLoop(HEARTH, 'short_rest', 'short_rest')).toBe(true);
    expect(makesLoop(HEARTH, 'end_of_session', 'downtime')).toBe(false);
    const looped: Definition = { format: 1, name: 'L', rests: { short_rest: { counts_as: ['long_rest'] }, long_rest: { counts_as: ['short_rest'] } } };
    expect(countedAs(looped, 'short_rest')).toEqual(['long_rest']);
  });
});

describe('changing a rest', () => {
  it('stores only what differs from the standard, as the server reads it back', () => {
    const renamed = withRest(HEARTH, 'end_of_session', { name: 'Session over' });
    expect((renamed.rests as Record<string, unknown>).end_of_session).toEqual({ name: 'Session over' });
    publishes(renamed);
    const back = withRest(renamed, 'end_of_session', { name: ' End of session ' });
    expect((back.rests as Record<string, unknown>).end_of_session).toBeUndefined();
    expect(withRest(renamed, 'end_of_session', { name: '' }).rests).not.toHaveProperty('end_of_session');
    const on = withRest(HEARTH, 'end_of_scene', { on: true });
    expect(on.rests).not.toHaveProperty('end_of_scene');
    expect((withRest(HEARTH, 'short_rest', { refills: [] }).rests as Record<string, unknown>).short_rest).toBeUndefined();
    expect(withRest({ format: 1, name: 'B', rests: { short_rest: { refills: [] } } }, 'short_rest', {})).not.toHaveProperty('rests');
  });

  it('keeps one of the system\'s own as typed, even blank, and never stores it as on', () => {
    const blank = withRest(HEARTH, 'downtime', { name: '', on: false, counts_as: [] });
    expect((blank.rests as Record<string, unknown>).downtime).toEqual({ name: '', refills: [{ what: 'fatigue', how: 'to', amount: '0' }] });
    expect(checkDefinition(blank).problems).toEqual([{ where: 'rest downtime, name', message: 'Cannot be blank' }]);
  });

  it('adds one of its own, named to be renamed, up to twelve', () => {
    const made = withNewRest(HEARTH)!;
    expect(made.id).toBe('new_rest');
    expect(restList(made.definition).at(-1)).toMatchObject({ id: 'new_rest', name: 'New rest', standard: false });
    publishes(made.definition);
    expect(withNewRest(made.definition)!.id).toBe('new_rest_2');
    let full: Definition = HEARTH;
    while (restCount(full) < LIMITS.rests) full = withNewRest(full)!.definition;
    publishes(full);
    expect(withNewRest(full)).toBeNull();
  });

  it('deletes one of its own, leaving nothing pointing at it; a standard one stays', () => {
    const def = withWearsOff(withWearsOff(HEARTH, 'poisoned', 'downtime', true), 'exhausted', 'downtime', true);
    const end = withRest(def, 'end_of_session', { counts_as: ['downtime'] });
    const gone = withoutRest(end, 'downtime');
    expect(restList(gone).map((r) => r.id)).not.toContain('downtime');
    expect(restList(gone).find((r) => r.id === 'end_of_session')!.counts_as).toEqual([]);
    expect(conditionList(gone).find((c) => c.id === 'poisoned')).toMatchObject({ ends: 'removed' });
    expect(conditionList(gone).find((c) => c.id === 'exhausted')).toMatchObject({ ends: 'rest', at: ['long_rest'] });
    publishes(gone);
    expect(withoutRest(HEARTH, 'short_rest')).toBe(HEARTH);
  });
});

describe('what a rest can refill', () => {
  it('is what the server says it can reach, with the ways each allows', () => {
    const reach = backRests.reachOf(HEARTH);
    expect(TARGETS.filter((t) => t.kind === 'field').map((t) => t.id)).toEqual([...reach.numbers.keys()]);
    for (const t of TARGETS.filter((x) => x.kind === 'field')) {
      expect(t.hows, t.id).toEqual(reach.numbers.get(t.id) ? ['max', 'by', 'to'] : ['by', 'to']);
    }
    expect(TARGETS.filter((t) => t.kind === 'section').map((t) => t.id)).toEqual([...reach.sections.keys()].map((id) => `section:${id}`));
    expect(TARGETS[0]).toEqual({ id: 'health', label: 'HEALTH', kind: 'health', hows: ['full', 'by'] });
    expect(TARGETS.find((t) => t.id === 'section:magic')).toEqual({ id: 'section:magic', label: 'SECTION · MAGIC', kind: 'section', hows: ['max'] });
  });

  it('follows the health model: to full only for harm, tracks named, nothing for none or with token health off', () => {
    const withHealth = (health: unknown, extra = {}): Definition => ({ format: 1, name: 'H', core: { health }, ...extra });
    const tracks = withHealth({ model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }] });
    expect(refillTargets(tracks, effectiveSheet(tracks))[0]).toEqual({ id: 'health', label: 'HEALTH', kind: 'health', hows: ['full', 'by'], tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }] });
    // The second track counts damage: it is refilled through health, never as a number.
    expect(refillTargets(tracks, effectiveSheet(tracks)).map((t) => t.id)).toEqual(['health']);
    const harm = withHealth({ model: 'harm', levels: [{ id: 'lesser', label: 'LESSER', slots: 2 }] });
    expect(refillTargets(harm, effectiveSheet(harm))[0].hows).toEqual(['full']);
    expect(refillTargets(withHealth({ model: 'pool', label: 'Grit' }), null)[0].label).toBe('GRIT');
    expect(refillTargets(withHealth({ model: 'none' }), null)).toEqual([]);
    expect(refillTargets({ format: 1, name: 'Off', parts: { token_health: { on: false } } }, null)).toEqual([]);
    // No answer is one pool, as the server reads it.
    expect(refillTargets({ format: 1, name: 'Bare' }, null)).toEqual([{ id: 'health', label: 'HEALTH', kind: 'health', hows: ['full', 'by'] }]);
  });

  it('reads as the page lists it', () => {
    const say = (r: Refill) => describeRefill(r, TARGETS);
    expect(say({ what: 'health', how: 'full' })).toBe('HEALTH to full');
    expect(say({ what: 'health', how: 'by', amount: '1d8 + @con_mod' })).toBe('HEALTH up by 1d8 + @con_mod');
    expect(say({ what: 'fatigue', how: 'by', amount: '-1' })).toBe('Fatigue down by 1');
    expect(say({ what: 'fatigue', how: 'by', amount: '- 2' })).toBe('Fatigue down by 2');
    expect(say({ what: 'fatigue', how: 'to', amount: '' })).toBe('Fatigue set to 0');
    expect(say({ what: 'slots', how: 'max' })).toBe('Spell slots to its maximum');
    expect(say({ what: 'section:magic', how: 'max' })).toBe('every number in MAGIC to its maximum');
    expect(say({ what: 'gone', how: 'to', amount: '3' })).toBe('gone set to 3');
    const tracks = [{ id: 'health', label: 'HEALTH', kind: 'health' as const, hows: ['full', 'by'] as Refill['how'][], tracks: [{ id: 'stun', label: 'STUN' }] }];
    expect(describeRefill({ what: 'health', how: 'by', amount: '2', track: 'stun' }, tracks)).toBe('HEALTH (STUN) up by 2');
  });
});

describe('editing refills', () => {
  it('fits each to what it names: a way it allows, an amount only where needed, a track only for health up by', () => {
    expect(fitRefill({ what: 'section:magic', how: 'by', amount: '2' }, TARGETS)).toEqual({ what: 'section:magic', how: 'max' });
    expect(fitRefill({ what: 'fatigue', how: 'max' }, TARGETS)).toEqual({ what: 'fatigue', how: 'by', amount: '1' });
    expect(fitRefill({ what: 'fatigue', how: 'to' }, TARGETS)).toEqual({ what: 'fatigue', how: 'to', amount: '0' });
    expect(fitRefill({ what: 'fatigue', how: 'by', amount: ' ' }, TARGETS)).toEqual({ what: 'fatigue', how: 'by', amount: '1' });
    expect(fitRefill({ what: 'health', how: 'full', amount: '3', track: 'stun' }, TARGETS)).toEqual({ what: 'health', how: 'full' });
    expect(fitRefill({ what: 'health', how: 'by', amount: '3', track: 'stun' }, TARGETS)).toEqual({ what: 'health', how: 'by', amount: '3' });
    const tracks = [{ id: 'health', label: 'H', kind: 'health' as const, hows: ['full', 'by'] as Refill['how'][], tracks: [{ id: 'stun', label: 'STUN' }] }];
    expect(fitRefill({ what: 'health', how: 'by', amount: '3', track: 'stun' }, tracks)).toEqual({ what: 'health', how: 'by', amount: '3', track: 'stun' });
    expect(newRefill(TARGETS)).toEqual({ what: 'health', how: 'full' });
    expect(newRefill([])).toBeNull();
  });

  it('adds, changes and removes them, every result one the server takes', () => {
    let def = withNewRefill(HEARTH, 'end_of_session', TARGETS);
    expect(restList(def).find((r) => r.id === 'end_of_session')!.refills).toEqual([{ what: 'health', how: 'full' }]);
    def = withRefill(def, 'end_of_session', 0, { what: 'slots' }, TARGETS);
    expect(restList(def).find((r) => r.id === 'end_of_session')!.refills).toEqual([{ what: 'slots', how: 'max' }]);
    def = withRefill(def, 'end_of_session', 0, { how: 'by', amount: '@con_mod' }, TARGETS);
    publishes(def);
    def = withRefill(def, 'end_of_session', 0, { what: 'section:magic' }, TARGETS);
    expect(restList(def).find((r) => r.id === 'end_of_session')!.refills).toEqual([{ what: 'section:magic', how: 'max' }]);
    publishes(def);
    def = withoutRefill(def, 'end_of_session', 0);
    expect((def.rests as Record<string, unknown>).end_of_session).toBeUndefined();
    expect(withRefill(HEARTH, 'end_of_session', 3, { how: 'to' }, TARGETS)).toBe(HEARTH);
    expect(withRefill(HEARTH, 'nope', 0, { how: 'to' }, TARGETS)).toBe(HEARTH);
    expect(withoutRefill(HEARTH, 'nope', 0)).toBe(HEARTH);
  });

  it('stops at twenty, and adds nothing with nothing to refill', () => {
    let def: Definition = HEARTH;
    for (let i = 0; i < LIMITS.refills + 2; i += 1) def = withNewRefill(def, 'end_of_session', TARGETS);
    expect(restList(def).find((r) => r.id === 'end_of_session')!.refills).toHaveLength(LIMITS.refills);
    publishes(def);
    expect(withNewRefill(HEARTH, 'end_of_session', [])).toBe(HEARTH);
    expect(withNewRefill(HEARTH, 'nope', TARGETS)).toBe(HEARTH);
  });
});

describe('what wears off', () => {
  it('is the conditions ending at the rest itself, set from either side as the server reads them', () => {
    expect(wearsOff(HEARTH, 'long_rest')).toEqual(['exhausted']);
    expect(wearsOff(HEARTH, 'downtime')).toEqual([]);
    const both = withWearsOff(HEARTH, 'exhausted', 'end_of_session', true);
    expect(conditionList(both).find((c) => c.id === 'exhausted')).toMatchObject({ ends: 'rest', at: ['long_rest', 'end_of_session'] });
    expect(withWearsOff(both, 'exhausted', 'end_of_session', true)).toEqual(both);
    publishes(both);
    const fresh = withWearsOff(HEARTH, 'poisoned', 'short_rest', true);
    expect((fresh.conditions as Record<string, unknown>).poisoned).toEqual({ ends: 'rest', at: ['short_rest'] });
    publishes(fresh);
    // The last rest unticked: back to ending when removed, storing nothing.
    expect((withWearsOff(HEARTH, 'exhausted', 'long_rest', false).conditions as Record<string, unknown>).exhausted).toBeUndefined();
    // One that ends after rounds ends one way; an unknown one is left alone.
    expect(withWearsOff(HEARTH, 'stunned', 'long_rest', true)).toBe(HEARTH);
    expect(withWearsOff(HEARTH, 'nope', 'long_rest', true)).toBe(HEARTH);
  });

  it('forgets the rests when a condition is switched to ending after rounds, as the server needs', () => {
    const rounds = withCondition(HEARTH, 'exhausted', { ends: 'rounds' });
    expect((rounds.conditions as Record<string, unknown>).exhausted).toEqual({ ends: 'rounds', rounds: 1 });
    publishes(rounds);
  });

  it('reads a condition that ends at a rest as the server offers it', () => {
    const def: Definition = { format: 1, name: 'C', conditions: { exhausted: { ends: 'rest', at: ['long_rest', 3] }, glitching: { name: 'Glitching', ends: 'rest' } } };
    expect(frontConditionsOf(def)).toEqual(conditionsOf(def));
    expect(conditionList(def).find((c) => c.id === 'glitching')).toMatchObject({ ends: 'rest', at: [] });
  });
});
