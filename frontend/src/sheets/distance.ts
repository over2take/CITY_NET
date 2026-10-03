import { customTemplate, isCustomSystem } from './customTemplates';

// What the map's ruler reads in the running system's distance unit (3d2). Pure, so it is tested
// apart from the ruler that shows it (components/MeasurementTool.tsx, 3d3).
//
// The map knows distances in its own squares, and each map's scale says how many feet a square is
// (5 unless the GM set another). The ruler has always read feet. Decided with the user, 2026-10-02:
// - meters and yards are converted from those feet, so no map ever needs its scale redone;
// - squares and hexes count the map's own squares, whatever their feet;
// - zones have no distances, so the ruler draws its line with no number.
// Every built-in system, and a custom one that gave no answer, keeps feet.

/** The units a system can choose. Mirrors backend/systemBuilder/core.js DISTANCE (a test holds them together). */
export const DISTANCE_UNITS = ['meters', 'feet', 'yards', 'squares', 'hexes', 'zones'] as const;
export type DistanceUnit = typeof DISTANCE_UNITS[number];

const isUnit = (u: unknown): u is DistanceUnit => typeof u === 'string' && (DISTANCE_UNITS as readonly string[]).includes(u);

/** The running system's unit: a custom system's own answer, feet otherwise. */
export const distanceUnitFor = (system: string | null | undefined): DistanceUnit => {
  if (!isCustomSystem(system)) return 'feet';
  const unit = customTemplate(system)?.distance;
  return isUnit(unit) ? unit : 'feet';
};

/** Meters in a foot, exactly. */
const METERS_PER_FOOT = 0.3048;

/**
 * What the ruler reads for a line `squares` long on a map whose square is `feetPerSquare` feet, or
 * null for no number at all. One decimal place, as the ruler has always shown feet.
 */
export const rulerReading = (unit: DistanceUnit, squares: number, feetPerSquare: number): string | null => {
  const feet = squares * feetPerSquare;
  switch (unit) {
    case 'meters': return `${(feet * METERS_PER_FOOT).toFixed(1)} m`;
    case 'yards': return `${(feet / 3).toFixed(1)} yd`;
    case 'squares': return `${squares.toFixed(1)} sq`;
    case 'hexes': return `${squares.toFixed(1)} hex`;
    case 'zones': return null;
    default: return `${feet.toFixed(1)} ft`;
  }
};
