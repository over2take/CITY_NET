// What a building is for, and whether you can trade in it.
//
// Mirrored from backend/buildingTypes.js, which owns the vocabulary; this owns how it is
// drawn. A test cross-checks the two against the real server module rather than trusting
// that they were both edited.
//
// Distinct from `classification`, which means the mesh a custom structure is drawn from.
// A ripperdoc and a noodle bar can share a shape; what separates them is what you can do
// inside.

/** What a shop deals in, or null while it has no catalogue yet. */
export type ShopStock = 'cyberware' | null;

export interface BuildingType {
  id: string;
  label: string;
  shop: boolean;
  sells: ShopStock;
}

export const BUILDING_TYPES: BuildingType[] = [
  { id: 'ripperdoc', label: 'Ripperdoc', shop: true, sells: 'cyberware' },
  { id: 'gun_shop', label: 'Gun Shop', shop: true, sells: null },
  { id: 'clinic', label: 'Clinic', shop: true, sells: null },
  { id: 'garage', label: 'Garage', shop: true, sells: null },
  { id: 'bar', label: 'Bar', shop: false, sells: null },
  { id: 'corp', label: 'Corporate', shop: false, sells: null },
  { id: 'residence', label: 'Residence', shop: false, sells: null },
  { id: 'industrial', label: 'Industrial', shop: false, sells: null },
];

const BY_ID = new Map(BUILDING_TYPES.map((t) => [t.id, t]));

export const buildingTypeById = (id: string | null | undefined): BuildingType | undefined =>
  BY_ID.get(String(id ?? ''));

/** Whether a building of this type can trade at all. */
export const isShop = (id: string | null | undefined): boolean =>
  Boolean(buildingTypeById(id)?.shop);

/**
 * The systems shops exist under.
 *
 * Cities Without Number only for now, which is a deliberate first step rather than an
 * oversight: the catalogue that makes a shop worth opening is the CWN one. Widening this
 * means adding to the set here and to SHOP_SYSTEMS on the server.
 */
export const SHOP_SYSTEMS = new Set(['cities_without_number']);

export const shopsAvailable = (gameSystem: string | null | undefined): boolean =>
  SHOP_SYSTEMS.has(String(gameSystem ?? ''));
