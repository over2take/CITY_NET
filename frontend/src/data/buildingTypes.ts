// What a building is for, and whether you can trade in it.
//
// Mirrored from backend/buildingTypes.js, which owns the vocabulary; this owns how it is
// drawn. A test cross-checks the two against the real server module rather than trusting
// that they were both edited.
//
// Distinct from `classification`, which means the mesh a custom structure is drawn from.
// A ripperdoc and a noodle bar can share a shape; what separates them is what you can do
// inside.

/**
 * A catalogue a shop can deal in - one per priced table in the book.
 *
 * One entry per table rather than one per shop, because the tables are what the rules
 * actually group: a gun shop and an armorer both sell mods, and the mod tables (p58-59)
 * are one page split in half.
 */
export type ShopStock =
  | 'cyberware' | 'cyber_mods' | 'skillplugs'
  | 'weapons' | 'weapon_mods'
  | 'armor' | 'armor_mods'
  | 'pharmaceuticals'
  | 'vehicles' | 'vehicle_fittings' | 'vehicle_weapons'
  | 'gear';

export interface Catalogue {
  id: ShopStock;
  label: string;
  /** The book page the prices come from, so anyone checking one knows where to look. */
  page: number;
  /** Whether a shop can actually show this catalogue today. See the note below. */
  shelved: boolean;
}

/**
 * `shelved` says whether a shop can actually show this catalogue today. The three that
 * cannot are each blocked on something real, and the reason matters more than the flag:
 *
 *   cyber_mods (p74) - "Cyberware mod costs are expressed as a percentage cost of the
 *                      system they're installed on." There is no flat price to print, so
 *                      a shelf would have to ask what you are modding first. This is also
 *                      why the mod catalogue has no `cost` field to begin with.
 *   skillplugs (p64) - priced, but a plug is a skill crossed with a level rather than a
 *                      row in a table, so a shelf means generating the cross product. A
 *                      deliberate omission, not an oversight.
 *   vehicles (p82)   - transcribed and priced, but buying one is not adding a row: a
 *                      vehicle is its own sheet with its own token. Its fittings and
 *                      weapons sell fine, because those ARE parts.
 *
 * Cyberdecks (p75) and drones (p76) are absent entirely: both were set aside to be handled
 * outside CITY_NET, so they are not a gap here to be closed.
 */
export const CATALOGUES: Catalogue[] = [
  { id: 'cyberware', label: 'Cyberware', page: 66, shelved: true },
  { id: 'cyber_mods', label: 'Cyberware Mods', page: 74, shelved: false },
  { id: 'skillplugs', label: 'Skillplugs', page: 64, shelved: false },
  { id: 'weapons', label: 'Weapons', page: 55, shelved: true },
  { id: 'weapon_mods', label: 'Weapon Mods', page: 59, shelved: true },
  { id: 'armor', label: 'Armor', page: 53, shelved: true },
  { id: 'armor_mods', label: 'Armor Mods', page: 58, shelved: true },
  { id: 'pharmaceuticals', label: 'Pharmaceuticals', page: 60, shelved: true },
  { id: 'vehicles', label: 'Vehicles', page: 82, shelved: false },
  { id: 'vehicle_fittings', label: 'Vehicle Fittings', page: 84, shelved: true },
  { id: 'vehicle_weapons', label: 'Vehicle Weapons', page: 84, shelved: true },
  { id: 'gear', label: 'Operator Gear', page: 50, shelved: true },
];

const CATALOGUE_BY_ID = new Map(CATALOGUES.map((c) => [c.id, c]));

export interface BuildingType {
  id: string;
  label: string;
  shop: boolean;
  sells: ShopStock[];
}

/**
 * What each storefront trades in.
 *
 * **`sells` is what the BOOK says the shop deals in, not what CITY_NET can draw yet.** Three
 * of the twelve catalogues have no shelf behind them, for the reasons listed above. A type
 * listing one anyway is the point: the gap is written down where the next person will see
 * it, `shelved` is what the shop window actually reads, and a test holds the two together
 * so this can never quietly claim to sell something it cannot show.
 *
 * It is a list rather than one id because the rules do not sort into one table per shop.
 * A gun shop sells guns and the mods that go on them; a ripperdoc sells ware, the mods for
 * it, and the plugs that use it. Forcing a single catalogue meant the second and third
 * tables had nowhere to go, which is why the mod and vehicle tables have sat unsold.
 */
export const BUILDING_TYPES: BuildingType[] = [
  { id: 'ripperdoc', label: 'Ripperdoc', shop: true, sells: ['cyberware', 'cyber_mods', 'skillplugs'] },
  { id: 'gun_shop', label: 'Gun Shop', shop: true, sells: ['weapons', 'weapon_mods'] },
  // The pharmacy. A clinic was always a shop with an empty shelf; the drug table (p60-61)
  // is what it was waiting for.
  { id: 'clinic', label: 'Clinic', shop: true, sells: ['pharmaceuticals'] },
  // The garage has been a shop with nothing in it since it was added. The three vehicle
  // tables were already transcribed and priced; they had no way to be declared.
  { id: 'garage', label: 'Garage', shop: true, sells: ['vehicles', 'vehicle_fittings', 'vehicle_weapons'] },
  // New. Armor (p53) and the armor half of the mod page (p58) had no storefront at all,
  // which left the one thing every operator buys first with nowhere to buy it.
  { id: 'armorer', label: 'Armorer', shop: true, sells: ['armor', 'armor_mods'] },
  // New. The Common Operator Gear table (p50) - rope, medkits, gas masks, ammunition.
  { id: 'general_store', label: 'General Store', shop: true, sells: ['gear'] },
  { id: 'bar', label: 'Bar', shop: false, sells: [] },
  { id: 'corp', label: 'Corporate', shop: false, sells: [] },
  { id: 'residence', label: 'Residence', shop: false, sells: [] },
  { id: 'industrial', label: 'Industrial', shop: false, sells: [] },
];

const BY_ID = new Map(BUILDING_TYPES.map((t) => [t.id, t]));

export const buildingTypeById = (id: string | null | undefined): BuildingType | undefined =>
  BY_ID.get(String(id ?? ''));

/** Whether a building of this type can trade at all. */
export const isShop = (id: string | null | undefined): boolean =>
  Boolean(buildingTypeById(id)?.shop);

/** Whether this type deals in a given catalogue. */
export const sellsCatalogue = (
  id: string | null | undefined, catalogue: ShopStock,
): boolean => Boolean(buildingTypeById(id)?.sells.includes(catalogue));

/** The catalogues this type deals in that a shop can actually put on a shelf. */
export const shelvedCatalogues = (id: string | null | undefined): ShopStock[] =>
  (buildingTypeById(id)?.sells ?? []).filter((c) => CATALOGUE_BY_ID.get(c)?.shelved);

/** A catalogue's book-facing label and page, for a tab and a heading. */
export const catalogueById = (id: ShopStock): Catalogue | undefined => CATALOGUE_BY_ID.get(id);

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
