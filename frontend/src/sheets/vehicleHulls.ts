import { ART_KEYS } from '../components/vehicleArt';

/**
 * The hull shapes a vehicle can be drawn as, for any system's sheet to offer.
 *
 * Labels describe the *shape*, never a book's name for a particular vehicle. That is partly
 * a licensing line — a picker listing one publisher's model names would be reproducing
 * their table — and partly just true: a speedboat is a speedboat in every ruleset, and the
 * next system to want one should not inherit somebody else's vocabulary to get it.
 *
 * Systems with a vehicle table of their own do not need this. Cities Without Number picks
 * the wireframe from the book entry, so its players never see a shape picker at all; this
 * is for systems where the player types their own stats and just wants the right outline.
 */
export const HULL_LABELS: Record<string, string> = {
  bike: 'BIKE',
  sportbike: 'SPORTBIKE',
  car: 'CAR',
  coupe: 'COUPE',
  supercar: 'SUPERCAR',
  van: 'VAN / TRUCK',
  apc: 'APC',
  tracked: 'TRACKED',
  hover: 'HOVERCRAFT',
  jetski: 'JETSKI',
  speedboat: 'SPEEDBOAT',
  cruiser: 'CABIN CRUISER',
  yacht: 'YACHT',
  microlight: 'MICROLIGHT',
  gyro: 'GYROCOPTER',
  heli: 'HELICOPTER',
  multirotor: 'MULTIROTOR',
  vtol: 'TILTROTOR',
  aerodyne: 'AERODYNE',
  aerodyne_delta: 'AERODYNE, DELTA',
  airship: 'AIRSHIP',
};

/**
 * Every drawable hull, in the order above rather than the registry's.
 *
 * Grouped by kind — road, water, air — because a player picking a hull is looking for the
 * shape of the thing they own, and an alphabetical list scatters the three boats.
 */
export const HULL_OPTIONS = Object.keys(HULL_LABELS)
  .filter(k => ART_KEYS.includes(k))
  .map(value => ({ value, label: HULL_LABELS[value] }));

/** The shape a vehicle gets when nobody has chosen one. */
export const DEFAULT_HULL = 'car';

/**
 * The seating window's `look` for a system whose players pick the hull themselves.
 *
 * Where CWN resolves the wireframe from its book entry, here the stored type *is* the art
 * key, so this is nearly the identity function — its job is refusing a key that no longer
 * draws anything, which is what would happen to a saved sheet if a shape were ever renamed.
 *
 * No seat names: without a book table there is nothing to call seat three but CREW 3.
 */
export const hullLook = (type: string) => ({
  art: ART_KEYS.includes(type) ? type : DEFAULT_HULL,
});
