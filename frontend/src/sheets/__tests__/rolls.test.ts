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
