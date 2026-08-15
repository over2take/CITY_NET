// Seats on a CWN vehicle.
//
// A vehicle's Crew is its seat count, so the seats are derived from it rather than
// declared per vehicle type. Ids are positional — `driver` and then `seat2`..`seatN` —
// which means the server needs only the number to validate a seating request. The names a
// player sees (SHOTGUN, CO-PILOT) live with the presets on the client, where they are
// display text and cannot disagree with anything here.
//
// Guns are deliberately NOT seats. A Tank is crew 3 with 3 hardpoints, so it can never man
// every gun and drive at once; making each hardpoint a seat would hand it a fourth body
// and quietly resolve a tension the rules intend. Mounts are a separate list and anyone
// aboard can fire one as their action.

/** A vehicle with no crew recorded still holds its driver. */
const DEFAULT_CREW = 1;

/** Nobody has built a vehicle needing more, and it bounds a hostile seat index. */
const MAX_CREW = 32;

const crewOf = (ownerData, i) => {
  const n = Number(ownerData?.[`vehicle${Number(i)}_crew`]);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CREW;
  return Math.min(Math.floor(n), MAX_CREW);
};

/** Seat ids for vehicle `i`, in order, driver first. */
const seatsFor = (ownerData, i) => {
  const crew = crewOf(ownerData, i);
  const out = ['driver'];
  for (let n = 2; n <= crew; n++) out.push(`seat${n}`);
  return out;
};

/** Whether `seat` is a real seat on that vehicle — the check behind seating someone. */
const hasSeat = (ownerData, i, seat) =>
  seatsFor(ownerData, i).includes(String(seat || '').trim().toLowerCase());

/**
 * Hardpoints: how many Heavy weapons the vehicle mounts in its factory configuration.
 *
 * Zero is a real answer — a motorcycle carries none — so an unset value means zero rather
 * than falling back to something permissive.
 */
const hardpointsOf = (ownerData, i) => {
  const n = Number(ownerData?.[`vehicle${Number(i)}_hrdpt`]);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

module.exports = { DEFAULT_CREW, MAX_CREW, crewOf, seatsFor, hasSeat, hardpointsOf };
