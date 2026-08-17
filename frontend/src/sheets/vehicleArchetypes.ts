import { ART_KEYS } from '../components/vehicleArt';

/**
 * Starting points for a vehicle, so the numbers do not have to be typed from nothing.
 *
 * **These are the app's own archetypes, not any publisher's table.** Cities Without Number
 * ships its book's vehicles because the CWN Quick Reference Documents are CC BY-NC and say
 * so; systems without that grant get this instead — generic shapes with round numbers we
 * chose, on a scale that is internally consistent and belongs to nobody.
 *
 * They are deliberately approximate. Picking one fills the block and every field stays
 * editable, so a table that wants their own book's exact values types four numbers over
 * the top and keeps the seats and the wireframe. A GM who wants a house ruling does the
 * same. That is the intended workflow rather than a shortcoming of it.
 *
 * The scale, so additions stay coherent:
 *
 * | Pool | Roughly |
 * |---|---|
 * | 30  | exposed — a bike, a jetski, anything you sit on rather than in |
 * | 45  | an ordinary car |
 * | 65  | something big or built for weather |
 * | 90  | armoured |
 * | 110 | a small building that floats |
 *
 * Armour runs 0 for open frames, 5 for a normal hull, 10 for heavy, 20+ for armoured.
 */
export interface VehicleArchetype {
  id: string;
  label: string;
  /** Wireframe key. Filled in with the rest, and editable afterwards like everything else. */
  hull: string;
  /** Damage pool. SDP in Cyberpunk, HP elsewhere — the sheet's label decides what it reads as. */
  pool: number;
  /** Armour that subtracts from damage. */
  armor: number;
  seats: number;
}

export const VEHICLE_ARCHETYPES: VehicleArchetype[] = [
  { id: 'bike',        label: 'BIKE',            hull: 'bike',           pool: 30,  armor: 0,  seats: 2 },
  { id: 'sportbike',   label: 'SPORTBIKE',       hull: 'sportbike',      pool: 30,  armor: 0,  seats: 2 },
  { id: 'compact',     label: 'COMPACT CAR',     hull: 'car',            pool: 45,  armor: 5,  seats: 4 },
  { id: 'sedan',       label: 'LUXURY SEDAN',    hull: 'car',            pool: 55,  armor: 10, seats: 4 },
  { id: 'coupe',       label: 'SPORTS COUPE',    hull: 'coupe',          pool: 45,  armor: 5,  seats: 2 },
  { id: 'supercar',    label: 'SUPERCAR',        hull: 'supercar',       pool: 45,  armor: 5,  seats: 2 },
  { id: 'van',         label: 'VAN / TRUCK',     hull: 'van',            pool: 70,  armor: 10, seats: 3 },
  { id: 'armoured',    label: 'ARMOURED CAR',    hull: 'apc',            pool: 90,  armor: 25, seats: 6 },
  { id: 'jetski',      label: 'JETSKI',          hull: 'jetski',         pool: 30,  armor: 0,  seats: 2 },
  { id: 'speedboat',   label: 'SPEEDBOAT',       hull: 'speedboat',      pool: 45,  armor: 5,  seats: 4 },
  { id: 'cruiser',     label: 'CABIN CRUISER',   hull: 'cruiser',        pool: 65,  armor: 5,  seats: 6 },
  { id: 'yacht',       label: 'YACHT',           hull: 'yacht',          pool: 110, armor: 10, seats: 6 },
  { id: 'gyro',        label: 'GYROCOPTER',      hull: 'gyro',           pool: 30,  armor: 0,  seats: 2 },
  { id: 'heli',        label: 'HELICOPTER',      hull: 'heli',           pool: 65,  armor: 10, seats: 4 },
  { id: 'aerodyne',    label: 'AERODYNE',        hull: 'aerodyne',       pool: 90,  armor: 20, seats: 6 },
  { id: 'aerodyne_fast', label: 'AERODYNE, FAST', hull: 'aerodyne_delta', pool: 65, armor: 15, seats: 2 },
  { id: 'airship',     label: 'AIRSHIP',         hull: 'airship',        pool: 110, armor: 5,  seats: 6 },
];

/** What a new vehicle starts as, before you change it to the one you meant. */
export const DEFAULT_ARCHETYPE = 'bike';

export const getArchetype = (id: string | null | undefined): VehicleArchetype | null =>
  VEHICLE_ARCHETYPES.find(a => a.id === String(id ?? '').trim().toLowerCase()) ?? null;

export const ARCHETYPE_OPTIONS = VEHICLE_ARCHETYPES.map(a => ({ value: a.id, label: a.label }));

/** Whether a name is just an archetype label rather than something a player chose. */
export const isArchetypeName = (name: string) =>
  VEHICLE_ARCHETYPES.some(a => a.label === String(name ?? '').trim().toUpperCase());

/**
 * The seating window's `look` for a system whose vehicles are archetypes.
 *
 * The stored type is an archetype id rather than a wireframe key, so the drawing is looked
 * up through the archetype — the same shape as CWN resolving art from its book entry. Seat
 * names are numbered: without a book table there is nothing to call seat three but CREW 3.
 */
export const archetypeLook = (type: string) => ({
  art: getArchetype(type)?.hull ?? 'car',
});

/** Only for a test to assert against — every archetype has to draw as something. */
export const archetypeHullsAreDrawable = () =>
  VEHICLE_ARCHETYPES.every(a => ART_KEYS.includes(a.hull));
