import { customTemplate, isCustomSystem, useCustomTemplate } from './customTemplates';

// Which parts of the app the running game uses (Layer 2 of the system builder). A custom
// system can turn off the bank, shops, vehicles, cyberware and the rest, for a game that has
// no such thing.
//
// Every place that belongs to a part asks, beside the rule it already has:
//
//   hasVehicles(system) && partOn(system, 'vehicles')
//
// Under a built-in system the answer is always on, so CWN, Cyberpunk RED, Shadowrun and
// Generic show exactly what they always have; each place's own rule still decides (only CWN
// has cyberware). Under a custom system it is off only where that system turned the part off.
// Until a custom system's definition has loaded, every part counts as on, as today. Off only
// hides: nothing a part holds is deleted, so turning it back on brings all of it back.

/** The parts a system can turn off. Mirrors PARTS in backend/systemBuilder/parts.js. */
export const PARTS = [
  'bank', 'shops', 'vehicles', 'cyberware', 'initiative', 'combat', 'token_health',
  'death', 'luck', 'xp', 'npc_tiers', 'sheet_import',
] as const;
export type Part = typeof PARTS[number];

/** A lookup bound to the running system, as useParts returns. */
export type PartLookup = (part: Part) => boolean;

/** Every part on: for components drawn without a running system to ask about. */
export const allPartsOn: PartLookup = () => true;

/** Whether `part` is on while `system` runs. */
export const partOn = (system: string | null | undefined, part: Part): boolean => {
  if (!isCustomSystem(system)) return true;
  return customTemplate(system)?.parts?.[part]?.on !== false;
};

/**
 * `on(part)` for the running system, redrawing when a custom system's definition arrives.
 * Fetches it if nobody has yet.
 */
export function useParts(system: string | null | undefined) {
  useCustomTemplate(system);
  return ((part) => partOn(system, part)) as PartLookup;
}
