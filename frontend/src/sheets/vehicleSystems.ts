/**
 * Which game systems have vehicles.
 *
 * Mirrors `backend/sheets/vehicleSystems.js`. The server is the authority — it refuses
 * seating actions for a system that is not on its own list — so this exists only to decide
 * what the interface offers: whether to subscribe to a roster, and whether to show the
 * buttons that open the seating window.
 *
 * Two short lists rather than one shared one because the two halves ship separately and
 * the client is not trusted with the rule anyway. If they ever disagree, the failure is a
 * button that opens an empty window, not a permission hole.
 */
export const VEHICLE_SYSTEMS = ['cities_without_number', 'cyberpunk_red'];

export const hasVehicles = (system?: string) => VEHICLE_SYSTEMS.includes(String(system ?? ''));
