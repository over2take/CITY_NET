// Weapons a CWN vehicle can mount on a hardpoint.
//
// From the Cities Without Number Quick Reference Documents (CC BY-NC 4.0, by 0frames):
// the mounting table on p.81 and the weapon stats on p.81 and p.57.
//
// Two kinds are in here. Five are purpose-built vehicle weapons with their own stat line.
// The rest are Heavy weapons from the personal tables that a hardpoint can carry, so their
// damage comes from there — a Grenade Launcher fires whatever grenade you loaded, which is
// why it has no fixed damage at all.
//
// The book's damage notation carries markers the dice roller cannot read:
//   !  the Trauma Die can inflict Traumatic Hits on vehicles and drones
//   #  can fire to suppress when fixed to a vehicle
//   ^  damage is always non-lethal unless desired otherwise
// So the damage stored is clean dice, and `!` is carried on the trauma value instead —
// `d12/x3!` — where the resolver reads it. Without it a weapon simply cannot traumatise a
// vehicle, which is the whole point of the marker.

export interface VehicleWeapon {
  id: string;
  label: string;
  /** Power and Mass the mount draws from the vehicle, and the smallest hull it fits. */
  power: number;
  mass: number;
  minSize: 'S' | 'M' | 'L';
  /** Clean dice. Absent where the book gives none — a Grenade Launcher, say. */
  dmg?: string;
  /** `d12/x3!` — the trailing marker is what lets it hurt a vehicle. */
  trauma?: string;
  range?: string;
  cost?: number;
  mag?: number;
  /** Suppressive fire when vehicle-mounted (the book's #). Reference only for now. */
  suppress?: boolean;
  /** Non-lethal by default (the book's ^). Reference only for now. */
  nonLethal?: boolean;
  note?: string;
}

export const VEHICLE_WEAPONS: VehicleWeapon[] = [
  {
    id: 'anti_materiel_rifle', label: 'ANTI-MATERIEL RIFLE', power: 0, mass: 1, minSize: 'M',
    dmg: '3d8', trauma: 'd12/x3', range: '1K/2K', cost: 8000, mag: 5,
  },
  {
    id: 'drone_cannon', label: 'DRONE CANNON', power: 1, mass: 1, minSize: 'M',
    dmg: '2d8', trauma: 'd10/x3', range: '200/1,000', cost: 5000, mag: 10,
  },
  {
    id: 'grenade_launcher', label: 'GRENADE LAUNCHER', power: 0, mass: 1, minSize: 'M',
    range: '150/350', cost: 3000, mag: 3,
    note: 'Damage is the grenade loaded, so it is left blank.',
  },
  {
    id: 'headshot_pod', label: 'HEADSHOT POD', power: 3, mass: 2, minSize: 'L',
    dmg: '4d6', trauma: 'd20/x4', range: '1,000/2,000', cost: 20000, mag: 1,
  },
  {
    id: 'heavy_machine_gun', label: 'HEAVY MACHINE GUN', power: 0, mass: 2, minSize: 'M',
    dmg: '3d6', trauma: 'd12/x3', range: '500/2K', cost: 10000, mag: 10, suppress: true,
  },
  {
    id: 'main_tank_gun', label: 'MAIN TANK GUN', power: 1, mass: 4, minSize: 'L',
    dmg: '4d12', trauma: 'd20/x4', range: '1,000/3,000', cost: 100000, mag: 1,
  },
  {
    id: 'mounted_autogun', label: 'MOUNTED AUTOGUN', power: 1, mass: 2, minSize: 'L',
    dmg: '3d8', trauma: 'd12/x2', range: '500/2,000', cost: 15000, mag: 10, suppress: true,
  },
  {
    id: 'other_small_arms', label: 'OTHER SMALL ARMS', power: 0, mass: 1, minSize: 'M',
    note: 'Whatever small arm is bolted on; take its stats from the personal weapon tables.',
  },
  {
    id: 'rocket_launcher', label: 'ROCKET LAUNCHER', power: 1, mass: 1, minSize: 'M',
    dmg: '3d10', trauma: 'd10/x3', range: '2K/4K', cost: 5000,
  },
  {
    id: 'shrieker_gun', label: 'SHRIEKER GUN', power: 2, mass: 2, minSize: 'M',
    dmg: '2d6', range: '100/400', cost: 10000, suppress: true, nonLethal: true,
    note: 'Sonic crowd control. Non-lethal, and it cannot traumatise a vehicle.',
  },
];

export const getVehicleWeapon = (id: string | null | undefined): VehicleWeapon | null =>
  VEHICLE_WEAPONS.find(w => w.id === String(id ?? '').trim().toLowerCase()) ?? null;

/** Choices for a mount's TYPE. Blank stays available — bolt on whatever you like. */
export const VEHICLE_WEAPON_OPTIONS = [
  { value: '', label: 'CUSTOM' },
  ...VEHICLE_WEAPONS.map(w => ({ value: w.id, label: w.label })),
];

const SIZE_ORDER: Record<string, number> = { S: 0, M: 1, L: 2 };

/** Whether a hull this size can carry the weapon at all. Unknown sizes do not block. */
export const fitsVehicle = (weapon: VehicleWeapon, vehicleSize: string | null | undefined) => {
  const hull = SIZE_ORDER[String(vehicleSize ?? '').trim().toUpperCase()];
  if (hull === undefined) return true;
  return hull >= SIZE_ORDER[weapon.minSize];
};

/**
 * The mount fields a weapon writes.
 *
 * `!` rides on the trauma value rather than the damage, because damage is fed to the dice
 * roller and a marker in it would break the roll. The weapons the book does not mark
 * cannot hurt a vehicle, and get no marker.
 */
export const weaponMountFields = (
  vehicleIndex: number,
  mountIndex: number,
  weapon: VehicleWeapon,
): Record<string, string | number> => {
  const p = `vehicle${vehicleIndex}_weapon${mountIndex}`;
  const out: Record<string, string | number> = {
    [`${p}_type`]: weapon.id,
    [`${p}_name`]: weapon.label,
    [`${p}_dmg`]: weapon.dmg ?? '',
    // Every vehicle weapon the book gives a trauma die is marked !, so a mount that has
    // one can use it. A weapon with no die gets a blank rather than a stale value.
    [`${p}_trauma`]: weapon.trauma ? `${weapon.trauma}!` : '',
    [`${p}_skill`]: 'shoot',
  };
  return out;
};
