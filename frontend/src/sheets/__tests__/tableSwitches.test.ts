import { describe, it, expect } from 'vitest';
import { switchRules, choiceRules, carryingShown, gearByPlayers, SHOW_ENCUMBRANCE, BAND_CONDITIONS, APPLY_CONDITION_MODIFIERS, CONDITION_TURN_EFFECTS, PLAYERS_CHANGE_GEAR, APPLY_DAMAGE, WORK_OUT_RESISTANCES, HIT_TOTALS_GM_ONLY } from '../tableSwitches';
import { createRequire } from 'module';

const damageTypes = createRequire(import.meta.url)('../../../../backend/systemBuilder/damageTypes.js');

// The GAME tab's encumbrance and condition switches (8a6b; approved mockup docs/mockups/carrying-on-sheet.html).

describe('choiceRules (8b5b)', () => {
  const base = { encumbrance: false, band_conditions: false, applied_conditions: false };
  it('APPLY DAMAGE and WORK OUT RESISTANCES, the system\'s own marked and kept as following it', () => {
    const rules = choiceRules({ ...base, damage: { apply: 'confirm', work_out: true } });
    expect(rules.map((r) => [r.settingKey, r.label])).toEqual([[APPLY_DAMAGE, 'APPLY DAMAGE'], [WORK_OUT_RESISTANCES, 'WORK OUT RESISTANCES']]);
    expect(rules[0].options).toEqual([{ value: 'auto', label: 'AUTO' }, { value: '', label: "CONFIRM (SYSTEM'S)" }, { value: 'off', label: 'OFF' }]);
    expect(rules[1].options).toEqual([{ value: '', label: "ON (SYSTEM'S)" }, { value: '0', label: 'OFF' }]);
    const other = choiceRules({ ...base, damage: { apply: 'off', work_out: false } });
    expect(other[0].options).toEqual([{ value: 'auto', label: 'AUTO' }, { value: 'confirm', label: 'CONFIRM' }, { value: '', label: "OFF (SYSTEM'S)" }]);
    expect(other[1].options).toEqual([{ value: '1', label: 'ON' }, { value: '', label: "OFF (SYSTEM'S)" }]);
    expect(rules.every((r) => r.title.length > 40)).toBe(true);
  });

  it('kept where the server reads them, every value one it knows; none for a game not made in the builder', () => {
    expect([APPLY_DAMAGE, WORK_OUT_RESISTANCES]).toEqual([damageTypes.APPLY_DAMAGE_SETTING, damageTypes.WORK_OUT_SETTING]);
    const [apply, workOut] = choiceRules({ ...base, damage: { apply: 'auto', work_out: true } });
    const def = { format: 1, name: 'X', damage: { apply: 'auto' } };
    expect(apply.options.map((o) => damageTypes.damageRulesOf(def, { [APPLY_DAMAGE]: o.value }).apply)).toEqual(['auto', 'confirm', 'off']);
    expect(workOut.options.map((o) => damageTypes.damageRulesOf(def, { [WORK_OUT_RESISTANCES]: o.value }).workOut)).toEqual([true, false]);
    expect(choiceRules(base)).toEqual([]);
    expect(choiceRules(null)).toEqual([]);
    expect(choiceRules(undefined)).toEqual([]);
  });
});

describe('HIT TOTALS ON NPCS: GM ONLY (8b5c)', () => {
  it('where hits reach their targets, on to start (the user, 2026-11-25), kept where the server reads it', () => {
    const base = { encumbrance: false, band_conditions: false, applied_conditions: false };
    expect(switchRules({ ...base, damage: { apply: 'confirm', work_out: true } }).map((r) => [r.settingKey, r.label, r.defaultOn]))
      .toEqual([[HIT_TOTALS_GM_ONLY, 'HIT TOTALS ON NPCS: GM ONLY', true]]);
    expect(switchRules({ ...base, gear: true, damage: { apply: 'auto', work_out: false } }).map((r) => r.settingKey)).toEqual([HIT_TOTALS_GM_ONLY, PLAYERS_CHANGE_GEAR]);
    expect(switchRules(base).map((r) => r.settingKey)).not.toContain(HIT_TOTALS_GM_ONLY);
    expect(HIT_TOTALS_GM_ONLY).toBe(damageTypes.HIT_TOTALS_SETTING);
  });
});

describe('switchRules', () => {
  it('each only where the system has what it switches, in order, all on to start', () => {
    expect(switchRules({ encumbrance: true, band_conditions: true, applied_conditions: true }).map((r) => [r.settingKey, r.label, r.defaultOn]))
      .toEqual([[SHOW_ENCUMBRANCE, 'SHOW ENCUMBRANCE', true], [BAND_CONDITIONS, 'BAND CONDITIONS', true], [APPLY_CONDITION_MODIFIERS, 'APPLY CONDITION MODIFIERS', true]]);
    expect(switchRules({ encumbrance: true, band_conditions: false, applied_conditions: false }).map((r) => r.settingKey)).toEqual([SHOW_ENCUMBRANCE]);
    expect(switchRules({ encumbrance: false, band_conditions: true, applied_conditions: false }).map((r) => r.settingKey)).toEqual([BAND_CONDITIONS]);
    expect(switchRules({ encumbrance: false, band_conditions: false, applied_conditions: true }).map((r) => r.settingKey)).toEqual([APPLY_CONDITION_MODIFIERS]);
    // CONDITION TURN EFFECTS (8a9c), last: where a condition has an EACH TURN; a server from before it says nothing of it.
    expect(switchRules({ encumbrance: true, band_conditions: false, applied_conditions: false, turn_effects: true }).map((r) => [r.settingKey, r.label, r.defaultOn]))
      .toEqual([[SHOW_ENCUMBRANCE, 'SHOW ENCUMBRANCE', true], [CONDITION_TURN_EFFECTS, 'CONDITION TURN EFFECTS', true]]);
    expect(switchRules({ encumbrance: false, band_conditions: false, applied_conditions: false, turn_effects: false })).toEqual([]);
    // PLAYERS CHANGE GEAR (G6b), last: where the system makes its own item types.
    expect(switchRules({ encumbrance: true, band_conditions: false, applied_conditions: false, gear: true }).map((r) => [r.settingKey, r.label, r.defaultOn]))
      .toEqual([[SHOW_ENCUMBRANCE, 'SHOW ENCUMBRANCE', true], [PLAYERS_CHANGE_GEAR, 'PLAYERS CHANGE GEAR', true]]);
    expect(switchRules({ encumbrance: false, band_conditions: false, applied_conditions: false, gear: false })).toEqual([]);
  });
  it('none for a built-in game or a system not loaded yet', () => {
    expect(switchRules(null)).toEqual([]);
    expect(switchRules(undefined)).toEqual([]);
    expect(switchRules({ encumbrance: false, band_conditions: false, applied_conditions: false })).toEqual([]);
  });
  it('each says what it does, and what off means', () => {
    for (const r of switchRules({ encumbrance: true, band_conditions: true, applied_conditions: true, turn_effects: true, gear: true })) expect(r.title, r.label).toMatch(/Off: /);
  });
  it('the keys the server reads (backend sheets/bandConditions.js BAND_SETTING, conditionsOnSheet.js CONDITIONS_SETTING, tokens/turnEffects.js TURN_EFFECTS_SETTING)', () => {
    // Pinned here as words: those modules load the server's own, which a frontend test may not (crossBoundaryImports).
    expect([BAND_CONDITIONS, APPLY_CONDITION_MODIFIERS, CONDITION_TURN_EFFECTS, PLAYERS_CHANGE_GEAR]).toEqual(['band_conditions', 'apply_condition_modifiers', 'condition_turn_effects', 'players_change_gear']);
  });
});

describe('carryingShown', () => {
  it('on unless the table switched it off', () => {
    expect(carryingShown([])).toBe(true);
    expect(carryingShown([{ key: SHOW_ENCUMBRANCE, value: '1' }])).toBe(true);
    expect(carryingShown([{ key: 'band_conditions', value: '0' }])).toBe(true);
    expect(carryingShown([{ key: SHOW_ENCUMBRANCE, value: '0' }])).toBe(false);
  });
});

describe('gearByPlayers (G6b)', () => {
  it('on unless the table switched PLAYERS CHANGE GEAR off', () => {
    expect(gearByPlayers([])).toBe(true);
    expect(gearByPlayers([{ key: PLAYERS_CHANGE_GEAR, value: '1' }])).toBe(true);
    expect(gearByPlayers([{ key: 'show_encumbrance', value: '0' }])).toBe(true);
    expect(gearByPlayers([{ key: PLAYERS_CHANGE_GEAR, value: '0' }])).toBe(false);
  });
});
