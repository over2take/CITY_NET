// Vehicle fittings, from the CWN table on p.84.
// CC BY-NC 4.0 by 0frames, like the rest of the QRD-derived data here.
//
// `power` is drain, so a Power System carries a negative one — it is the only thing in
// the table that gives Power back rather than spending it. Keeping the sign consistent
// means the budget is a plain sum instead of two special cases.
//
// The effects are printed, not applied. Several rewrite the stat block (Extra Durability
// is +25% max HP, Hardpoint Support adds a mount), and a fitting can be stripped again —
// so silently editing the numbers would leave no way to undo it. The list is the record;
// the stat block stays yours to set.

export interface VehicleFitting {
  id: string;
  label: string;
  /** Purchase cost. Zero where the book prints None. */
  cost: number;
  /** Power drawn. Negative for the Power Systems, which supply it. */
  power: number;
  mass: number;
  minSize: 'S' | 'M' | 'L';
  effect: string;
  note?: string;
}

export const VEHICLE_FITTINGS: VehicleFitting[] = [
  { id: 'advanced_sensors', label: 'ADVANCED SENSORS', cost: 8000, power: 1, mass: 0, minSize: 'S', effect: 'Night vision and more' },
  { id: 'afterburners', label: 'AFTERBURNERS', cost: 5000, power: 1, mass: 2, minSize: 'S', effect: 'Boost Speed briefly in combat' },
  { id: 'armor_plating', label: 'ARMOR PLATING', cost: 5000, power: 0, mass: 3, minSize: 'S', effect: 'Adds Armor to the vehicle' },
  { id: 'cargo_space', label: 'CARGO SPACE', cost: 0, power: 0, mass: 1, minSize: 'S', effect: 'Protected cargo space' },
  { id: 'crash_pod', label: 'CRASH POD', cost: 2500, power: 0, mass: 2, minSize: 'M', effect: 'Protects in case of crash' },
  { id: 'ecm_emitter', label: 'ECM EMITTER', cost: 10000, power: 2, mass: 0, minSize: 'M', effect: 'Jams incoming missiles' },
  { id: 'emissions_cloaking', label: 'EMISSIONS CLOAKING', cost: 10000, power: 1, mass: 2, minSize: 'S', effect: 'Radar and thermal near-invisibility' },
  { id: 'extra_durability', label: 'EXTRA DURABILITY', cost: 5000, power: 0, mass: 4, minSize: 'M', effect: 'Increases maximum HP by 25%' },
  { id: 'extra_passengers', label: 'EXTRA PASSENGERS', cost: 2500, power: 0, mass: 2, minSize: 'S', effect: 'Adds Crew' },
  { id: 'field_portable', label: 'FIELD PORTABLE', cost: 1000, power: 0, mass: 2, minSize: 'S', effect: 'Breaks down into portable components' },
  { id: 'ghost_driver', label: 'GHOST DRIVER', cost: 2500, power: 1, mass: 1, minSize: 'S', effect: 'Limited AI driving' },
  { id: 'hardpoint_support', label: 'HARDPOINT SUPPORT', cost: 5000, power: 1, mass: 1, minSize: 'M', effect: 'Adds another hardpoint' },
  { id: 'jack_control_port', label: 'JACK CONTROL PORT', cost: 5000, power: 2, mass: 0, minSize: 'S', effect: 'Drive it via cranial jack' },
  {
    id: 'limpet_mount', label: 'LIMPET MOUNT', cost: 5000, power: 0, mass: 3, minSize: 'M',
    effect: 'Mount a smaller vehicle on it',
    note: 'The larger version costs $10,000 and takes 6 Mass — adjust by hand if you fit that one.',
  },
  { id: 'living_quarters', label: 'LIVING QUARTERS', cost: 8000, power: 0, mass: 4, minSize: 'L', effect: 'Cramped but usable living quarters' },
  { id: 'medbay', label: 'MEDBAY', cost: 10000, power: 1, mass: 2, minSize: 'M', effect: 'Emergency bay for one patient' },
  { id: 'offroad_package', label: 'OFFROAD PACKAGE', cost: 5000, power: 1, mass: 3, minSize: 'L', effect: 'Deep wilderness operation' },
  { id: 'power_small', label: 'POWER SYSTEM, SMALL', cost: 1000, power: -2, mass: 2, minSize: 'S', effect: 'Adds 2 Power at a cost in Mass' },
  { id: 'power_medium', label: 'POWER SYSTEM, MEDIUM', cost: 5000, power: -4, mass: 3, minSize: 'M', effect: 'Adds 4 Power at a cost in Mass' },
  { id: 'power_large', label: 'POWER SYSTEM, LARGE', cost: 10000, power: -8, mass: 5, minSize: 'L', effect: 'Adds 8 Power at a cost in Mass' },
  { id: 'sealed_atmosphere', label: 'SEALED ATMOSPHERE', cost: 5000, power: 1, mass: 1, minSize: 'M', effect: 'Pressurized, temp-controlled interior' },
  { id: 'smugglers_hold', label: "SMUGGLER'S HOLD", cost: 1000, power: 0, mass: 1, minSize: 'S', effect: 'Hidden cargo space' },
  { id: 'targeting_board', label: 'TARGETING BOARD', cost: 2500, power: 1, mass: 1, minSize: 'M', effect: 'One gunner can run up to three guns' },
  { id: 'tool_rack', label: 'TOOL RACK', cost: 2500, power: 0, mass: 2, minSize: 'M', effect: 'Repair the vehicle or other things' },
];

export const getFitting = (id: string | null | undefined): VehicleFitting | null =>
  VEHICLE_FITTINGS.find(f => f.id === String(id ?? '').trim().toLowerCase()) ?? null;

export const FITTING_OPTIONS = VEHICLE_FITTINGS.map(f => ({ value: f.id, label: f.label }));

/** A chip's second line: what it costs the vehicle and what it does. */
export const describeFitting = (id: string) => {
  const f = getFitting(id);
  if (!f) return '';
  const power = f.power === 0 ? '' : f.power < 0 ? ` +${-f.power}pow` : ` ${f.power}pow`;
  const mass = f.mass === 0 ? '' : ` ${f.mass}mass`;
  return `${power}${mass}`.trim();
};

/** Fittings a hull this size can take. Unknown sizes do not filter. */
const SIZE_ORDER: Record<string, number> = { S: 0, M: 1, L: 2 };
export const fittingFitsVehicle = (fitting: VehicleFitting, vehicleSize: string | null | undefined) => {
  const hull = SIZE_ORDER[String(vehicleSize ?? '').trim().toUpperCase()];
  if (hull === undefined) return true;
  return hull >= SIZE_ORDER[fitting.minSize];
};

/**
 * What a vehicle has spent and what it has left.
 *
 * Mounted weapons draw on the same budget as fittings — the book is explicit that a
 * hardpoint costs Power and Mass "just as a fitting does" — so both are counted, or the
 * numbers would flatter every armed vehicle.
 */
export const budgetFor = (
  fittingIds: string[],
  weaponPower: number,
  weaponMass: number,
  totalPower: number,
  totalMass: number,
) => {
  const spentPower = fittingIds.reduce((n, id) => n + (getFitting(id)?.power ?? 0), 0) + weaponPower;
  const spentMass = fittingIds.reduce((n, id) => n + (getFitting(id)?.mass ?? 0), 0) + weaponMass;
  return {
    spentPower, spentMass,
    powerLeft: totalPower - spentPower,
    massLeft: totalMass - spentMass,
    over: spentPower > totalPower || spentMass > totalMass,
  };
};

/** Fittings are stored as a JSON array of ids in one field. */
export const parseFittings = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch { return []; }
};
