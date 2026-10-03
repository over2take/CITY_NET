import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { DISTANCE_UNITS, distanceUnitFor, rulerReading } from '../distance';
import { registerCustomTemplate, clearCustomTemplates, customTemplate, type CustomRender } from '../customTemplates';

/**
 * What the map's ruler reads in the running system's unit (3d2). Decided with the user,
 * 2026-10-02: meters and yards converted from the map's feet, squares and hexes counted in the
 * map's own squares, zones with no number; feet for every built-in system and a custom one that
 * gave no answer, exactly as the ruler has always read.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const hearth = (distance?: string): CustomRender => ({
  id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] }, ...(distance ? { distance } : {}),
});

beforeEach(() => clearCustomTemplates());
afterEach(() => clearCustomTemplates());

describe('the units', () => {
  it('are the server\'s six', () => {
    const server = createRequire(import.meta.url)('../../../../backend/systemBuilder/core.js');
    expect([...DISTANCE_UNITS]).toEqual(server.DISTANCE);
  });
});

describe('the running system\'s unit', () => {
  it('is feet in every built-in system', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', null, undefined]) {
      expect(distanceUnitFor(system), String(system)).toBe('feet');
    }
  });

  it('is a custom system\'s own, carried from the server', () => {
    for (const unit of DISTANCE_UNITS) {
      registerCustomTemplate(hearth(unit));
      expect(customTemplate(HEARTH)?.distance).toBe(unit);
      expect(distanceUnitFor(HEARTH), unit).toBe(unit);
    }
  });

  it('is feet for a custom system with no answer, one it can\'t read, or one not loaded yet', () => {
    expect(distanceUnitFor(HEARTH)).toBe('feet');
    registerCustomTemplate(hearth());
    expect(distanceUnitFor(HEARTH)).toBe('feet');
    registerCustomTemplate(hearth('leagues'));
    expect(distanceUnitFor(HEARTH)).toBe('feet');
  });
});

describe('what the ruler reads', () => {
  it('is feet as it always was: squares times the map\'s feet per square, one decimal', () => {
    expect(rulerReading('feet', 6, 5)).toBe('30.0 ft');
    expect(rulerReading('feet', 2.5, 10)).toBe('25.0 ft');
    expect(rulerReading('feet', 1.234, 5)).toBe('6.2 ft');
    expect(rulerReading('feet', 0, 5)).toBe('0.0 ft');
  });

  it('converts those feet to meters and yards, so no map needs its scale redone', () => {
    expect(rulerReading('meters', 6, 5)).toBe('9.1 m');
    expect(rulerReading('meters', 10, 10)).toBe('30.5 m');
    expect(rulerReading('yards', 6, 5)).toBe('10.0 yd');
    expect(rulerReading('yards', 1, 5)).toBe('1.7 yd');
  });

  it('counts the map\'s own squares for squares and hexes, whatever their feet', () => {
    for (const feetPerSquare of [5, 10, 1.5]) {
      expect(rulerReading('squares', 6, feetPerSquare)).toBe('6.0 sq');
      expect(rulerReading('hexes', 4.25, feetPerSquare)).toBe('4.3 hex');
    }
  });

  it('has no number in zones, which have no distances', () => {
    expect(rulerReading('zones', 6, 5)).toBeNull();
  });
});
