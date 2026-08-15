// Seat layouts for CWN vehicles.
//
// A vehicle declares a layout and the layout decides what seats exist. That is what keeps
// a motorcycle from showing four empty doors, and it is also the validation: seating
// someone means naming a seat the vehicle actually has.
//
// IMPORTANT: the seat ids here are the canonical list. The frontend repeats them in
// frontend/src/sheets/vehicleLayouts.ts, adding the labels and the diagram anchors it
// needs to draw the thing. A test reads this file and fails if the two drift — a seat the
// window offers but the server rejects would look like a broken control.

const LAYOUTS = {
  bike: {
    label: 'BIKE',
    seats: ['driver', 'pillion'],
  },
  car: {
    label: 'CAR',
    seats: ['driver', 'shotgun', 'back_left', 'back_right', 'gunner'],
  },
  van: {
    label: 'VAN',
    seats: ['driver', 'shotgun', 'mid_left', 'mid_right', 'back_left', 'back_right', 'gunner'],
  },
};

/** Vehicles that never had a layout set are cars, which is what most of them are. */
const DEFAULT_LAYOUT = 'car';

const getLayout = (id) => LAYOUTS[String(id || '').trim().toLowerCase()] || LAYOUTS[DEFAULT_LAYOUT];

/** Seats on vehicle `i` of a sheet. */
const seatsFor = (ownerData, i) => getLayout(ownerData?.[`vehicle${Number(i)}_layout`]).seats;

/** Whether `seat` is a real seat on that vehicle — the check behind seating someone. */
const hasSeat = (ownerData, i, seat) => seatsFor(ownerData, i).includes(String(seat || '').trim().toLowerCase());

module.exports = { LAYOUTS, DEFAULT_LAYOUT, getLayout, seatsFor, hasSeat };
