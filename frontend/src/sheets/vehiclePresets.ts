// The CWN vehicle table.
//
// From the Cities Without Number Quick Reference Documents (CC BY-NC 4.0, by 0frames),
// the same licence under which the skill and weapon lists in the templates are embedded.
//
// Picking a preset fills the stat block. Everything here is book data except the seat
// names and the `art` mapping, which are ours — the book gives a crew count, not a
// seating plan.
//
// Two columns do real work beyond reference:
//   crew   — how many seats the vehicle has.
//   hrdpt  — how many Heavy weapons it mounts. Not how many gunners it has: a Tank is
//            crew 3 with 3 hardpoints, so it can never man every gun and drive at once.
//            That tension is the rule, not a rounding error, so mounts are a separate
//            list from seats and anyone aboard can fire one as their action.

export type VehicleArt =
  | 'bike' | 'car' | 'van' | 'microlight' | 'heli' | 'multirotor' | 'vtol' | 'apc' | 'tracked' | 'hover';

export interface VehiclePreset {
  id: string;
  label: string;
  art: VehicleArt;
  cost: number;
  spd: number;
  /** Armour Rating. Null where the book prints * or ** instead of a number. */
  armor: number | null;
  tt: number;
  ac: number;
  hp: number;
  crew: number;
  hrdpt: number;
  /** Power and Mass the hull has to spend on fittings and mounted weapons. */
  pow: number;
  mass: number;
  size: 'S' | 'M' | 'L';
  /** Named positions, in order. Crew beyond this list are numbered. */
  seatNames?: string[];
  /** The * and ** immunity rules, written into the vehicle's notes on selection. */
  note?: string;
}

const HEAVY_ONLY = 'Immune to anything short of a Heavy weapon, or one that can inflict Traumatic Hits.';
const GM_CALL = 'Immune to anything the GM thinks could not reasonably harm it. Traumatic Hits apply if the GM judges the weapon and circumstances reasonable.';

export const VEHICLE_PRESETS: VehiclePreset[] = [
  {
    id: 'motorcycle', label: 'MOTORCYCLE', art: 'bike',
    cost: 1000, spd: 1, armor: 4, tt: 10, ac: 13, hp: 10, crew: 1, hrdpt: 0, pow: 1, mass: 3, size: 'S',
    seatNames: ['RIDER'],
  },
  {
    id: 'micro_flyer', label: 'MICRO FLYER', art: 'microlight',
    cost: 3000, spd: 0, armor: 0, tt: 6, ac: 13, hp: 10, crew: 1, hrdpt: 0, pow: 1, mass: 4, size: 'S',
    seatNames: ['PILOT'],
  },
  {
    id: 'car', label: 'CAR', art: 'car',
    cost: 5000, spd: 0, armor: 6, tt: 12, ac: 11, hp: 30, crew: 5, hrdpt: 1, pow: 3, mass: 7, size: 'M',
    seatNames: ['DRIVER', 'SHOTGUN', 'B.LEFT', 'B.RIGHT', 'REAR'],
  },
  {
    id: 'truck', label: 'TRUCK', art: 'van',
    cost: 7500, spd: 0, armor: 6, tt: 12, ac: 11, hp: 35, crew: 2, hrdpt: 1, pow: 3, mass: 14, size: 'L',
    seatNames: ['DRIVER', 'SHOTGUN'],
  },
  {
    id: 'helicopter', label: 'HELICOPTER', art: 'heli',
    cost: 50000, spd: 3, armor: 6, tt: 10, ac: 14, hp: 20, crew: 6, hrdpt: 1, pow: 4, mass: 9, size: 'M',
    seatNames: ['PILOT', 'CO-PILOT'],
  },
  {
    id: 'tank', label: 'TANK', art: 'tracked',
    cost: 500000, spd: 0, armor: null, tt: 12, ac: 18, hp: 40, crew: 3, hrdpt: 3, pow: 8, mass: 15, size: 'L',
    seatNames: ['DRIVER', 'GUNNER', 'COMMANDER'], note: GM_CALL,
  },
  {
    id: 'apc', label: 'APC', art: 'apc',
    cost: 60000, spd: -1, armor: null, tt: 10, ac: 16, hp: 30, crew: 16, hrdpt: 1, pow: 5, mass: 14, size: 'L',
    seatNames: ['DRIVER', 'GUNNER'], note: HEAVY_ONLY,
  },
  {
    id: 'gev', label: 'GEV', art: 'hover',
    cost: 100000, spd: 1, armor: null, tt: 10, ac: 16, hp: 30, crew: 3, hrdpt: 2, pow: 6, mass: 10, size: 'L',
    seatNames: ['DRIVER', 'GUNNER', 'COMMANDER'], note: HEAVY_ONLY,
  },
  {
    id: 'casra', label: 'CASRA', art: 'multirotor',
    cost: 200000, spd: 2, armor: 10, tt: 10, ac: 18, hp: 35, crew: 2, hrdpt: 2, pow: 7, mass: 10, size: 'L',
    seatNames: ['PILOT', 'GUNNER'],
  },
  {
    id: 'dropcraft', label: 'DROPCRAFT', art: 'vtol',
    cost: 1000000, spd: 3, armor: 12, tt: 12, ac: 16, hp: 40, crew: 13, hrdpt: 2, pow: 8, mass: 12, size: 'L',
    seatNames: ['PILOT', 'CO-PILOT'],
  },
];

export const getPreset = (id: string | null | undefined): VehiclePreset | null =>
  VEHICLE_PRESETS.find(p => p.id === String(id ?? '').trim().toLowerCase()) ?? null;

/**
 * Choices for the TYPE field. Every vehicle is one of the book's — there is no CUSTOM.
 *
 * A custom vehicle was a hole rather than a feature: with no type it had no crew, no
 * hardpoints and no Trauma Target, so it seated one person, refused to fire the mounts you
 * could still fill in, and took traumatic hits twice as often as any real vehicle. Start
 * from the nearest book entry and edit the numbers instead.
 */
export const VEHICLE_TYPE_OPTIONS = VEHICLE_PRESETS.map(p => ({ value: p.id, label: p.label }));

/** What a new vehicle starts as, before you change it to the one you meant. */
export const DEFAULT_VEHICLE_TYPE = 'motorcycle';

/**
 * Whether a name is just a type label rather than something the player chose.
 *
 * A vehicle called MOTORCYCLE has not been named; one called Betty has. Changing the type
 * should rename the first and leave the second alone.
 */
export const isPresetName = (name: string) =>
  VEHICLE_PRESETS.some(p => p.label === String(name ?? '').trim().toUpperCase());

/**
 * The sheet fields a preset writes for vehicle `i`.
 *
 * Armour is left alone where the book prints * or ** — there is no number to write, and
 * inventing one would be worse than the GM reading the note and ruling.
 */
export const presetFields = (i: number, preset: VehiclePreset): Record<string, string | number> => {
  const out: Record<string, string | number> = {
    [`vehicle${i}_name`]: preset.label,
    [`vehicle${i}_type`]: preset.id,
    [`vehicle${i}_hp`]: preset.hp,
    [`vehicle${i}_hp_max`]: preset.hp,
    [`vehicle${i}_ac`]: preset.ac,
    [`vehicle${i}_spd`]: preset.spd,
    [`vehicle${i}_tt`]: preset.tt,
    [`vehicle${i}_crew`]: preset.crew,
    [`vehicle${i}_hrdpt`]: preset.hrdpt,
    [`vehicle${i}_pow`]: preset.pow,
    [`vehicle${i}_mass`]: preset.mass,
    [`vehicle${i}_cost`]: preset.cost,
    [`vehicle${i}_size`]: preset.size,
  };
  if (preset.armor !== null) out[`vehicle${i}_armor`] = preset.armor;
  return out;
};
