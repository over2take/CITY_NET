import { describe, it, expect } from 'vitest';
import { switchRules, carryingShown, SHOW_ENCUMBRANCE, BAND_CONDITIONS, APPLY_CONDITION_MODIFIERS } from '../tableSwitches';

// The GAME tab's encumbrance and condition switches (8a6b; approved mockup docs/mockups/carrying-on-sheet.html).

describe('switchRules', () => {
  it('each only where the system has what it switches, in order, all on to start', () => {
    expect(switchRules({ encumbrance: true, band_conditions: true, applied_conditions: true }).map((r) => [r.settingKey, r.label, r.defaultOn]))
      .toEqual([[SHOW_ENCUMBRANCE, 'SHOW ENCUMBRANCE', true], [BAND_CONDITIONS, 'BAND CONDITIONS', true], [APPLY_CONDITION_MODIFIERS, 'APPLY CONDITION MODIFIERS', true]]);
    expect(switchRules({ encumbrance: true, band_conditions: false, applied_conditions: false }).map((r) => r.settingKey)).toEqual([SHOW_ENCUMBRANCE]);
    expect(switchRules({ encumbrance: false, band_conditions: true, applied_conditions: false }).map((r) => r.settingKey)).toEqual([BAND_CONDITIONS]);
    expect(switchRules({ encumbrance: false, band_conditions: false, applied_conditions: true }).map((r) => r.settingKey)).toEqual([APPLY_CONDITION_MODIFIERS]);
  });
  it('none for a built-in game or a system not loaded yet', () => {
    expect(switchRules(null)).toEqual([]);
    expect(switchRules(undefined)).toEqual([]);
    expect(switchRules({ encumbrance: false, band_conditions: false, applied_conditions: false })).toEqual([]);
  });
  it('each says what it does, and what off means', () => {
    for (const r of switchRules({ encumbrance: true, band_conditions: true, applied_conditions: true })) expect(r.title, r.label).toMatch(/Off: /);
  });
  it('the keys the server reads (backend sheets/bandConditions.js BAND_SETTING, conditionsOnSheet.js CONDITIONS_SETTING)', () => {
    // Pinned here as words: those modules load the server's own, which a frontend test may not (crossBoundaryImports).
    expect([BAND_CONDITIONS, APPLY_CONDITION_MODIFIERS]).toEqual(['band_conditions', 'apply_condition_modifiers']);
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
