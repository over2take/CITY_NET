// Which game systems have vehicles, and what the shared machinery may assume about them.
//
// Written against a real second system rather than guessed at. When only CWN had vehicles,
// `vehicleState` simply hardcoded its name; the moment Cyberpunk RED wanted the same
// seating window, that constant was the thing standing in the way.
//
// It stays this small because the sheet templates agree on field ids. A vehicle is
// `vehicle{i}_*` in both, and `hp` / `hp_max` / `armor` / `crew` mean the same things even
// where a system calls them SDP, SP and Seats on screen. That is a deliberate choice made
// in the templates: the labels carry each system's vocabulary, the storage does not, so
// the roster, the seating window and the hull bar are one implementation rather than three.
//
// If a system ever needs a different field layout, this is where the mapping belongs —
// but do not invent that shape before something needs it.

/** The contract a system's vehicle fields must satisfy, for whoever adds the third. */
const VEHICLE_FIELDS = {
  /** A vehicle exists once this is above zero. Everything else may be blank. */
  hpMax: (i) => `vehicle${i}_hp_max`,
  hp: (i) => `vehicle${i}_hp`,
  /** Subtracted from damage. */
  armor: (i) => `vehicle${i}_armor`,
  /** Seat count, driver included. */
  crew: (i) => `vehicle${i}_crew`,
  /** Which wireframe to draw. */
  type: (i) => `vehicle${i}_type`,
  name: (i) => `vehicle${i}_name`,
  moving: (i) => `vehicle${i}_moving`,
};

const VEHICLE_SYSTEMS = ['cities_without_number', 'cyberpunk_red'];

/** Whether the active system has vehicles at all. Gates every seating socket action. */
const hasVehicles = (system) => VEHICLE_SYSTEMS.includes(String(system || ''));

module.exports = { VEHICLE_SYSTEMS, VEHICLE_FIELDS, hasVehicles };
