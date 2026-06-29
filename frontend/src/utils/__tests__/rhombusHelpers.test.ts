import { describe, it, expect } from 'vitest';
import { mergeRhombusHealthFromLocation, resolveDeployHealth } from '../rhombusHelpers';

const prev = { color: '#00ff00', name: 'GHOST', description: 'desc', hp_max: 100, hp_current: 100, hp_temp: 0 };

describe('mergeRhombusHealthFromLocation', () => {
  it('restores damaged hp_current from DB on server restart', () => {
    // Simulate: player took damage (DB has 45), client prev had full health
    const existing = { color: '#ff0000', name: 'VIPER', description: '', hp_max: 100, hp_current: 45, hp_temp: 0 };
    const result = mergeRhombusHealthFromLocation(existing, prev);
    expect(result.hp_current).toBe(45);
  });

  it('does not reset wounded hp_current to max', () => {
    // The original bug: hp_current was not read from DB, so it stayed at max
    const existing = { color: '#00ff00', name: '', description: '', hp_max: 100, hp_current: 1, hp_temp: 0 };
    const result = mergeRhombusHealthFromLocation(existing, { ...prev, hp_current: 100 });
    expect(result.hp_current).toBe(1);
    expect(result.hp_current).not.toBe(result.hp_max);
  });

  it('preserves hp_current = 0 (character at zero health)', () => {
    const existing = { color: '#00ff00', name: '', description: '', hp_max: 100, hp_current: 0, hp_temp: 0 };
    const result = mergeRhombusHealthFromLocation(existing, prev);
    expect(result.hp_current).toBe(0);
  });

  it('falls back to hp_max when DB hp_current is null (new character)', () => {
    const existing = { color: '#00ff00', name: '', description: '', hp_max: 80, hp_current: null, hp_temp: null };
    const result = mergeRhombusHealthFromLocation(existing, prev);
    expect(result.hp_current).toBe(80);
  });

  it('syncs hp_temp from DB', () => {
    const existing = { color: '#00ff00', name: '', description: '', hp_max: 100, hp_current: 100, hp_temp: 15 };
    const result = mergeRhombusHealthFromLocation(existing, prev);
    expect(result.hp_temp).toBe(15);
  });

  it('resets hp_temp to 0 when DB hp_temp is null', () => {
    const existing = { color: '#00ff00', name: '', description: '', hp_max: 100, hp_current: 100, hp_temp: null };
    const result = mergeRhombusHealthFromLocation(existing, prev);
    expect(result.hp_temp).toBe(0);
  });

  it('syncs color and name from DB', () => {
    const existing = { color: '#ff00ff', name: 'NOVA', description: 'runner', hp_max: 60, hp_current: 60, hp_temp: 0 };
    const result = mergeRhombusHealthFromLocation(existing, prev);
    expect(result.color).toBe('#ff00ff');
    expect(result.name).toBe('NOVA');
    expect(result.description).toBe('runner');
  });
});

// ─── resolveDeployHealth ──────────────────────────────────────────────────────

describe('resolveDeployHealth', () => {
  const state = { hp_max: 100, hp_current: 60, hp_temp: 5 };

  it('uses existing DB record when present', () => {
    const existing = { hp_max: 100, hp_current: 45, hp_temp: 10 };
    expect(resolveDeployHealth(existing, state)).toEqual({ hp_max: 100, hp_current: 45, hp_temp: 10 });
  });

  it('carries damaged hp_current from rhombusState when no existing record', () => {
    // Bug: exiting a battle map with no main-map rhombus → hp_current must NOT reset to max
    const result = resolveDeployHealth(null, state);
    expect(result.hp_current).toBe(60);
    expect(result.hp_current).not.toBe(result.hp_max);
  });

  it('carries hp_temp from rhombusState when no existing record', () => {
    const result = resolveDeployHealth(null, state);
    expect(result.hp_temp).toBe(5);
  });

  it('uses hp_max as hp_current fallback when rhombusState.hp_current is 0/falsy but hp_max is set', () => {
    const result = resolveDeployHealth(null, { hp_max: 80, hp_current: 0, hp_temp: 0 });
    // hp_current 0 is falsy — falls back to hp_max (acceptable: 0 HP players can't deploy)
    expect(result.hp_current).toBe(80);
  });

  it('defaults to 100 hp when both existing and rhombusState have no hp_max', () => {
    const result = resolveDeployHealth(null, { hp_max: 0, hp_current: 0, hp_temp: 0 });
    expect(result.hp_max).toBe(100);
    expect(result.hp_current).toBe(100);
  });

  it('existing hp_current = 0 (dead) is preserved, not overwritten with hp_max', () => {
    const existing = { hp_max: 100, hp_current: 0, hp_temp: 0 };
    expect(resolveDeployHealth(existing, state).hp_current).toBe(0);
  });
});
