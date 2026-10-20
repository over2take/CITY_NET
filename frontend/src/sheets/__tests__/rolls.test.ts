/**
 * The ROLLS tab as logic (6b1a; approved mockup docs/mockups/builder-rolls.html, 2026-10-19): a new
 * roll from a preset, named after it, its id kept; its five steps replaced by another preset's, its
 * name and ROLLED BY kept; renamed, rolled by stats, groups and formulas, removed. The presets and
 * the fields a roll is rolled by are the server's own, held equal here, and every change is taken
 * by the server's check.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  PRESETS, rollList, withNewRoll, withRollPreset, withRollLabel, withRolledBy, withoutRoll, rollables, fieldsRolledBy, stepsOf,
  withRollDice, withRollDiceAdded, withRollDiceRemoved, withRollRead, withRollAdd, withRollAgainst, withRollBands,
  withRollExplode, withRollList, withRollCancel, withRollGlitch, withRollZero, withRollChange, costables,
} from '../rolls';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const backend = req('../../../../backend/systemBuilder/rollStyles.js');
const tableRolls = req('../../../../backend/systemBuilder/tableRolls.js');
const { randomSystem } = req('../../../../backend/__tests__/helpers/randomSystem.js');

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight', tie: 'str' }, { id: 'lore', label: 'Lore' }] },
  ],
  derived: [{ id: 'save', label: 'Save', formula: '16' }],
};
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

describe('the presets', () => {
  it('are the server\'s own, every one', () => {
    expect(PRESETS).toEqual(backend.PRESETS);
  });
});

describe('a roll made and changed', () => {
  it('is new from a preset, named after it, its id from that name and never taken', () => {
    const one = withNewRoll(HEARTH, 'pbta')!;
    expect(one.id).toBe('pbta_move');
    expect(rollList(one.definition)).toEqual([{ id: 'pbta_move', label: 'PbtA move', ...PRESETS.pbta.roll }]);
    const two = withNewRoll(one.definition, 'pbta')!;
    expect(two.id).toBe('pbta_move_2');
    expect(withNewRoll(HEARTH, 'nope')).toBeNull();
    expect(problems(two.definition)).toEqual([]);
    // A copy: changing the system's roll leaves the preset as it was.
    (rollList(one.definition)[0].dice[0] as { count: string }).count = '9';
    expect(PRESETS.pbta.roll.dice[0].count).toBe('2');
  });

  it('takes another preset\'s five steps, keeping its id, name and ROLLED BY', () => {
    let def = withNewRoll(HEARTH, 'pbta')!.definition;
    def = withRolledBy(withRollLabel(def, 'pbta_move', 'Skill check'), 'pbta_move', 'skills', true);
    const swapped = withRollPreset(def, 'pbta_move', 'blades');
    expect(rollList(swapped)[0]).toEqual({ id: 'pbta_move', label: 'Skill check', ...PRESETS.blades.roll, by: ['skills'] });
    expect(problems(swapped)).toEqual([]);
    expect(withRollPreset(def, 'pbta_move', 'nope')).toEqual(def);
  });

  it('is renamed, a blank name leaving its id to show', () => {
    const def = withNewRoll(HEARTH, 'dnd')!.definition;
    expect(rollList(withRollLabel(def, 'd_d_check', 'Ability check'))[0].label).toBe('Ability check');
    expect('label' in rollList(withRollLabel(def, 'd_d_check', '  '))[0]).toBe(false);
    expect(rollList(withRollLabel(def, 'd_d_check', 'x'.repeat(60)))[0].label).toHaveLength(40);
  });

  it('is rolled by stats, groups and formulas, each once, none leaving no ROLLED BY', () => {
    let def = withNewRoll(HEARTH, 'cwn_save')!.definition;
    def = withRolledBy(withRolledBy(withRolledBy(def, 'cwn_save', 'save', true), 'cwn_save', 'skills', true), 'cwn_save', 'save', true);
    expect(rollList(def)[0].by).toEqual(['skills', 'save']);
    expect(problems(def)).toEqual([]);
    def = withRolledBy(withRolledBy(def, 'cwn_save', 'skills', false), 'cwn_save', 'save', false);
    expect('by' in rollList(def)[0]).toBe(false);
  });

  it('is removed, the last taking the section with it', () => {
    const def = withNewRoll(withNewRoll(HEARTH, 'dnd')!.definition, 'sr6')!.definition;
    expect(rollList(withoutRoll(def, 'd_d_check')).map((r) => r.id)).toEqual(['sr6_pool']);
    expect('rolls' in withoutRoll(withoutRoll(def, 'd_d_check'), 'sr6_pool')).toBe(false);
  });
});

describe('what a roll can be rolled by, and is', () => {
  it('the groups, then each stat, then the formulas, in players\' names', () => {
    expect(rollables(HEARTH)).toEqual([
      { id: 'abilities', label: 'ABILITIES', kind: 'group' }, { id: 'skills', label: 'SKILLS', kind: 'group' },
      { id: 'str', label: 'STRENGTH', kind: 'stat' }, { id: 'fight', label: 'FIGHT', kind: 'stat' }, { id: 'lore', label: 'LORE', kind: 'stat' },
      { id: 'save', label: 'SAVE', kind: 'formula' },
    ]);
  });

  it('the fields it rolls are the server\'s own, for every random system\'s every roll', () => {
    let seen = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const def = randomSystem(seed) as Definition;
      for (const r of rollList(def)) {
        expect(fieldsRolledBy(def, r), `seed ${seed} ${r.id}`).toEqual(tableRolls.fieldsRolledBy(def, r));
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(30);
    expect(fieldsRolledBy(HEARTH, { id: 'x', dice: [], by: ['skills', 'fight', 'save'] })).toEqual(['fight', 'lore', 'save']);
  });
});

describe('a roll\'s five steps in words', () => {
  it('as the mockup lays them out', () => {
    const vampire = stepsOf({ id: 'v', ...PRESETS.vampire.roll });
    expect(vampire.dice).toEqual(['max(0, @this + @tie - @hunger) × d10', 'min(@hunger, @this + @tie) × d10 · HUNGER']);
    expect(vampire.read).toBe('COUNT AT 6+');
    expect(vampire.special).toEqual(['2 × 10 · CRITICAL · +2', 'HUNGER 10 ON A CRITICAL · MESSY CRITICAL', 'HUNGER 1 ON A FAILURE · BESTIAL FAILURE']);
    const pbta = stepsOf({ id: 'p', ...PRESETS.pbta.roll });
    expect(pbta.bands).toEqual([['6−', 'MISS'], ['7–9', 'SUCCESS AT A COST'], ['10+', 'FULL SUCCESS']]);
    expect([pbta.add, pbta.against, pbta.changes]).toEqual(['@this', null, ['FORWARD +1 · + 1']]);
    const blades = stepsOf({ id: 'b', ...PRESETS.blades.roll });
    expect([blades.read, blades.special, blades.changes]).toEqual(['KEEP HIGHEST 1', ['2 × 6 · CRITICAL', 'NO DICE · ROLL 2, KEEP THE LOWEST'], ['PUSH YOURSELF · +1 DIE · COSTS 2 STRESS']]);
    expect(stepsOf({ id: 'c', ...PRESETS.cpr.roll }).special[0]).toBe('EXPLODES ON 10, ONCE · 1 TAKES ONE AWAY · FIRST DIE ONLY');
    expect(stepsOf({ id: 's', ...PRESETS.sr6.roll }).special).toEqual(['1s ON 50% OF THE DICE · GLITCH (CRITICAL GLITCH WITH NO SUCCESS)']);
    expect(stepsOf({ id: 'f', ...PRESETS.fate.roll }).bands.slice(0, 4)).toEqual([['−2 OR LESS', 'TERRIBLE'], ['−1', 'POOR'], ['0', 'MEDIOCRE'], ['1', 'AVERAGE']]);
    expect(stepsOf({ id: 'n', dice: [{ count: '1', sides: 6 }], bands: [{ upTo: -3, label: 'A' }, { upTo: 0, label: 'B' }, { upTo: 4, label: 'C' }, { label: 'D' }] }).bands.map((b) => b[0]))
      .toEqual(['−3 OR LESS', '−2 TO 0', '1–4', '5+']);
    expect(stepsOf({ id: 'n', dice: [{ count: '1', sides: 6 }], bands: [{ upTo: -3, label: 'A' }, { label: 'B' }] }).bands.map((b) => b[0])).toEqual(['−3 OR LESS', '−2 OR MORE']);
    expect(stepsOf({ id: 'n', dice: [{ count: '1', sides: 6 }], bands: [{ label: 'All' }] }).bands).toEqual([['ANY', 'ALL']]);
    const save = stepsOf({ id: 's', ...PRESETS.cwn_save.roll });
    expect(save.against).toBe('@this · AT OR OVER SUCCEEDS');
    expect(stepsOf({ id: 'u', dice: [{ count: '1', sides: 100 }], against: '@this', under: true }).against).toBe('@this · AT OR UNDER SUCCEEDS');
    expect(stepsOf({ id: 'd', ...PRESETS.dnd.roll }).changes).toEqual(['ADVANTAGE · +1 DIE, KEEP THE HIGHEST', 'DISADVANTAGE · +1 DIE, KEEP THE LOWEST']);
    expect(stepsOf({ id: 'f', dice: [{ count: '4', sides: 'F' }] }).dice).toEqual(['4 × dF']);
  });
});

describe('the steps changed one by one (6b1b1)', () => {
  const base = () => withNewRoll(HEARTH, 'pbta')!.definition;
  const only = (def: Definition) => rollList(def)[0];

  it('the dice: how many, the size, a name, another kind, one taken away (never the last)', () => {
    let def = withRollDice(base(), 'pbta_move', 0, { count: '@this', sides: 10, name: 'Hunger' });
    expect(only(def).dice).toEqual([{ count: '@this', sides: 10, name: 'Hunger' }]);
    def = withRollDice(def, 'pbta_move', 0, { name: '  ' });
    expect(only(def).dice).toEqual([{ count: '@this', sides: 10 }]);
    def = withRollDice(def, 'pbta_move', 0, { sides: 'F' });
    expect(only(def).dice[0].sides).toBe('F');
    def = withRollDiceAdded(def, 'pbta_move');
    expect(only(def).dice).toEqual([{ count: '@this', sides: 'F' }, { count: '1', sides: 6 }]);
    expect(problems(def)).toEqual([]);
    def = withRollDiceRemoved(def, 'pbta_move', 0);
    expect(only(def).dice).toEqual([{ count: '1', sides: 6 }]);
    expect(withRollDiceRemoved(def, 'pbta_move', 0)).toEqual(def);
    let full = def;
    for (let i = 0; i < 9; i += 1) full = withRollDiceAdded(full, 'pbta_move');
    expect(only(full).dice).toHaveLength(6);
  });

  it('a named kind taken away takes its effects with it', () => {
    const def = withNewRoll(HEARTH, 'vampire')!.definition;
    const gone = withRollDiceRemoved(def, 'vampire_pool', 1);
    expect('effects' in only(gone)).toBe(false);
    expect(problems(gone)).toEqual([]);
  });

  it('how the dice are read, dropping what only the old way used', () => {
    let def = withRollRead(base(), 'pbta_move', 'highest', { keep: '2' });
    expect([only(def).read, only(def).keep]).toEqual(['highest', '2']);
    def = withRollRead(def, 'pbta_move', 'lowest');
    expect([only(def).read, only(def).keep]).toEqual(['lowest', '2']);
    def = withRollRead(def, 'pbta_move', 'highest', { keep: '1' });
    expect('keep' in only(def)).toBe(false);
    def = withRollRead(def, 'pbta_move', 'count');
    expect([only(def).read, only(def).at, 'keep' in only(def)]).toEqual(['count', 5, false]);
    def = withRollRead(def, 'pbta_move', 'count', { at: 6 });
    expect(only(def).at).toBe(6);
    expect(problems(def)).toEqual([]);
    def = withRollRead(def, 'pbta_move', 'sum');
    expect(['read', 'at', 'keep'].map((k) => k in only(def))).toEqual([false, false, false]);
    // Cancelling and a die taken away only belong to counting and to a sum.
    const sr6 = withRollRead({ ...withNewRoll(HEARTH, 'sr6')!.definition }, 'sr6_pool', 'count');
    const withCancel: Definition = { ...sr6, rolls: [{ ...only(sr6), cancel: { face: 1 } }] };
    expect('cancel' in only(withRollRead(withCancel, 'sr6_pool', 'highest'))).toBe(false);
    const cpr = withRollRead(withNewRoll(HEARTH, 'cpr')!.definition, 'cp_r_check', 'highest');
    expect(only(cpr).explode).toEqual({ on: 10, once: true, first: true });
    expect(problems(cpr)).toEqual([]);
  });

  it('what is added, and a target met over or under, blank for none', () => {
    let def = withRollAdd(base(), 'pbta_move', '@this + 2');
    expect(only(def).add).toBe('@this + 2');
    def = withRollAdd(def, 'pbta_move', ' ');
    expect('add' in only(def)).toBe(false);
    def = withRollAgainst(def, 'pbta_move', '@this', true);
    expect([only(def).against, only(def).under]).toEqual(['@this', true]);
    expect(problems(def)).toEqual([]);
    def = withRollAgainst(def, 'pbta_move', '@this', false);
    expect('under' in only(def)).toBe(false);
    def = withRollAgainst(withRollAgainst(def, 'pbta_move', '13', true), 'pbta_move', '');
    expect(['against', 'under'].map((k) => k in only(def))).toEqual([false, false]);
  });

  it('the bands, as a table\'s: started, one added under the last, changed, taken away (never the last), none', () => {
    let def = withRollBands(base(), 'pbta_move', { none: true });
    expect('bands' in only(def)).toBe(false);
    def = withRollBands(def, 'pbta_move', { start: true });
    expect(only(def).bands).toEqual([{ upTo: 6, label: 'Miss' }, { label: 'Hit' }]);
    def = withRollBands(def, 'pbta_move', { add: true });
    expect(only(def).bands).toEqual([{ upTo: 6, label: 'Miss' }, { upTo: 7, label: 'New band' }, { label: 'Hit' }]);
    def = withRollBands(def, 'pbta_move', { set: 1, upTo: 9, label: 'Cost' });
    def = withRollBands(def, 'pbta_move', { set: 2, upTo: 99, label: 'Full' });
    expect(only(def).bands).toEqual([{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Cost' }, { label: 'Full' }]);
    expect(problems(def)).toEqual([]);
    expect(withRollBands(def, 'pbta_move', { remove: 2 })).toEqual(def);
    expect(only(withRollBands(def, 'pbta_move', { remove: 0 })).bands).toEqual([{ upTo: 9, label: 'Cost' }, { label: 'Full' }]);
    expect(only(withRollBands(def, 'pbta_move', { start: true }))).toEqual(only(def));
  });
});

describe('the special results changed (6b1b2)', () => {
  const base = (preset = 'pbta') => { const r = withNewRoll(HEARTH, preset)!; return { def: r.definition, id: r.id }; };
  const only = (def: Definition) => rollList(def)[0];

  it('exploding: on, on another face, once, first die only, a die taken away from a sum, off', () => {
    const { def: d0, id } = base();
    let def = withRollExplode(d0, id, {});
    expect(only(def).explode).toEqual({});
    def = withRollExplode(def, id, { on: 5, once: true, first: true, low: 1 });
    expect(only(def).explode).toEqual({ on: 5, low: 1, once: true, first: true });
    expect(problems(def)).toEqual([]);
    def = withRollExplode(def, id, { on: null, low: null, once: false });
    expect(only(def).explode).toEqual({ first: true });
    // Only a sum can take a die away.
    const kept = withRollRead(def, id, 'highest');
    expect(only(withRollExplode(kept, id, { low: 1 })).explode).toEqual({ first: true });
    expect('explode' in only(withRollExplode(def, id, null))).toBe(false);
  });

  it('naturals, matches and effects: added on the highest face, changed, taken away; ten at most', () => {
    const { def: d0, id } = base('dnd');
    let def = withRollList(d0, id, 'natural', { add: true });
    expect(only(def).natural![2]).toEqual({ face: 20, label: 'Critical', critical: 'success' });
    def = withRollList(def, id, 'natural', { set: 2, patch: { face: 19, label: 'Keen', critical: undefined } });
    expect(only(def).natural![2]).toEqual({ face: 19, label: 'Keen' });
    def = withRollList(def, id, 'matches', { add: true });
    expect(only(def).matches).toEqual([{ face: 20, count: 2, label: 'Critical', critical: 'success' }]);
    def = withRollList(def, id, 'matches', { set: 0, patch: { face: undefined, adds: 3 } });
    expect(only(def).matches).toEqual([{ count: 2, label: 'Critical', critical: 'success', adds: 3 }]);
    expect(problems(def)).toEqual([]);
    def = withRollList(def, id, 'matches', { remove: 0 });
    expect('matches' in only(def)).toBe(false);
    let full = def;
    for (let i = 0; i < 12; i += 1) full = withRollList(full, id, 'natural', { add: true });
    expect(only(full).natural).toHaveLength(10);
    expect(only(withRollList(def, id, 'natural', { set: 0, patch: { label: 'x'.repeat(60) } })).natural![0].label).toHaveLength(40);
  });

  it('an effect needs a named kind of dice, and starts on it', () => {
    const { def, id } = base();
    expect(withRollList(def, id, 'effects', { add: true })).toEqual(def);
    const named = withRollDice(def, id, 0, { name: 'Rage', sides: 8 });
    const withEffect = withRollList(named, id, 'effects', { add: true });
    expect(only(withEffect).effects).toEqual([{ name: 'Rage', face: 8, when: 'critical', label: 'Effect' }]);
    expect(problems(withEffect)).toEqual([]);
  });

  it('cancelling only while counting; a glitch and the zero-dice rule on, changed and off', () => {
    const { def: d0, id } = base('sr6');
    let def = withRollCancel(d0, id, 1);
    expect(only(def).cancel).toEqual({ face: 1 });
    expect('cancel' in only(withRollCancel(withRollRead(def, id, 'sum'), id, 1))).toBe(false);
    def = withRollCancel(def, id, null);
    expect('cancel' in only(def)).toBe(false);
    def = withRollGlitch(def, id, { share: 0.25, none: '  ' });
    expect(only(def).glitch).toEqual({ face: 1, share: 0.25, label: 'Glitch' });
    def = withRollGlitch(def, id, null);
    expect('glitch' in only(def)).toBe(false);
    def = withRollGlitch(def, id, {});
    expect(only(def).glitch).toEqual({ face: 1, share: 0.5, label: 'Glitch' });
    def = withRollZero(def, id, {});
    expect(only(def).zero).toEqual({ count: 2, read: 'lowest' });
    def = withRollZero(def, id, { read: 'highest', count: 3 });
    expect(only(def).zero).toEqual({ count: 3, read: 'highest' });
    expect(problems(def)).toEqual([]);
    expect('zero' in only(withRollZero(def, id, null))).toBe(false);
  });
});

describe('words left empty (6b1b2)', () => {
  it('stay, empty, for the server to say they can\'t be blank; the steps still read', () => {
    const { definition, id } = withNewRoll(HEARTH, 'dnd')!;
    const def = withRollList(definition, id, 'natural', { set: 0, patch: { label: '' } });
    expect(rollList(def)[0].natural![0]).toEqual({ face: 20, label: '', critical: 'success' });
    expect(stepsOf(rollList(def)[0]).special[0]).toBe('NATURAL 20 · ');
    expect(problems(def)).toEqual(['roll d_d_check, natural 1, label: Words of up to 40 characters']);
  });
});

describe('the changes picked before rolling, changed (6b1b3)', () => {
  const only = (def: Definition) => rollList(def)[0];

  it('a new one adds 1, its id from its first name and never taken; ten at most', () => {
    const { definition, id } = withNewRoll(HEARTH, 'pbta')!;
    let def = withRollChange(definition, id, { add: true });
    expect(only(def).changes).toEqual([{ id: 'forward', label: 'Forward +1', add: '1' }, { id: 'bonus', label: 'Bonus', add: '1' }]);
    def = withRollChange(def, id, { add: true });
    expect(only(def).changes![2].id).toBe('bonus_2');
    expect(problems(def)).toEqual([]);
    let full = def;
    for (let i = 0; i < 12; i += 1) full = withRollChange(full, id, { add: true });
    expect(only(full).changes).toHaveLength(10);
  });

  it('changed: its words, extra dice and which are kept, what it adds, what it costs; its id kept', () => {
    const { definition, id } = withNewRoll(HEARTH, 'pbta')!;
    let def = withRollChange(definition, id, { set: 0, patch: { label: 'Push', extra: { dice: 1, keep: 'highest' }, add: null, cost: { from: 'str', amount: 2 } } });
    expect(only(def).changes).toEqual([{ id: 'forward', label: 'Push', extra: { dice: 1, keep: 'highest' }, cost: { from: 'str', amount: 2 } }]);
    expect(problems(def)).toEqual([]);
    def = withRollChange(def, id, { set: 0, patch: { extra: { dice: 40 }, cost: { from: 'str', amount: 0 } } });
    expect(only(def).changes![0]).toEqual({ id: 'forward', label: 'Push', extra: { dice: 10 }, cost: { from: 'str', amount: 1 } });
    def = withRollChange(def, id, { set: 0, patch: { cost: null, label: 'x'.repeat(60) } });
    expect(only(def).changes![0]).toEqual({ id: 'forward', label: 'x'.repeat(40), extra: { dice: 10 } });
  });

  it('never does nothing: taking away its last effect leaves it adding 1', () => {
    const { definition, id } = withNewRoll(HEARTH, 'dnd')!;
    const def = withRollChange(definition, id, { set: 0, patch: { extra: null } });
    expect(only(def).changes![0]).toEqual({ id: 'advantage', label: 'Advantage', add: '1' });
    expect(problems(def)).toEqual([]);
  });

  it('taken away, the last taking the list with it', () => {
    const { definition, id } = withNewRoll(HEARTH, 'pbta')!;
    expect('changes' in only(withRollChange(definition, id, { remove: 0 }))).toBe(false);
  });

  it('can cost any stat, in players\' names', () => {
    expect(costables(HEARTH)).toEqual([{ id: 'str', label: 'STRENGTH' }, { id: 'fight', label: 'FIGHT' }, { id: 'lore', label: 'LORE' }]);
  });
});
