// What a building is for.
//
// Distinct from `classification`, which is already taken and means the mesh a custom
// structure is drawn from. A ripperdoc and a noodle bar can share a shape; what separates
// them is what you can do inside.
//
// Only a few of these trade. The rest exist so a map can be labelled without every label
// implying a shop button, and so the list has somewhere to grow.
//
// Mirrored in frontend/src/data/buildingTypes.ts, which owns how they are drawn. The two
// staying in step is covered by a test rather than by hoping.

/**
 * The things a shop can deal in, drawn from the book's priced tables.
 *
 * One entry per table rather than one per shop, because the tables are what the rules
 * actually group: a gun shop and an armorer both sell mods, and the mod tables (p58-59)
 * are one page split in half. Naming the table keeps `sells` honest when two storefronts
 * want the same shelf.
 *
 * `page` is the book page, so anyone checking a price knows where to look.
 *
 * `shelved` says whether a shop can actually show this catalogue today. The two that
 * cannot are each blocked on something real, and the reason matters more than the flag:
 *
 *   cyber_mods (p74) - "Cyberware mod costs are expressed as a percentage cost of the
 *                      system they're installed on." There is no flat price to print, so
 *                      a shelf would have to ask what you are modding first. This is also
 *                      why the mod catalogue has no `cost` field to begin with.
 *   skillplugs (p64) - priced, but a plug is a skill crossed with a level rather than a
 *                      row in a table, so a shelf means generating the cross product. A
 *                      deliberate omission, not an oversight.
 *
 * Vehicles were on this list too, on the grounds that buying one is not adding a row
 * because a vehicle is its own sheet. That was wrong. The sheet already keeps six numbered
 * vehicle slots and already has the function that fills one from a preset, so a garage
 * does exactly what the gun shop does with weapon rows.
 *
 * Cyberdecks (p75) and drones (p76) are absent entirely: both were set aside to be handled
 * outside CITY_NET, so they are not a gap here to be closed.
 */
const CATALOGUES = [
  { id: 'cyberware', label: 'Cyberware', page: 66, shelved: true },
  { id: 'cyber_mods', label: 'Cyberware Mods', page: 74, shelved: false },
  { id: 'skillplugs', label: 'Skillplugs', page: 64, shelved: false },
  { id: 'weapons', label: 'Weapons', page: 55, shelved: true },
  { id: 'weapon_mods', label: 'Weapon Mods', page: 59, shelved: true },
  { id: 'armor', label: 'Armor', page: 53, shelved: true },
  { id: 'armor_mods', label: 'Armor Mods', page: 58, shelved: true },
  { id: 'pharmaceuticals', label: 'Pharmaceuticals', page: 60, shelved: true },
  { id: 'vehicles', label: 'Vehicles', page: 82, shelved: true },
  { id: 'vehicle_fittings', label: 'Vehicle Fittings', page: 84, shelved: true },
  { id: 'vehicle_weapons', label: 'Vehicle Weapons', page: 84, shelved: true },
  { id: 'gear', label: 'Operator Gear', page: 50, shelved: true },
];

const CATALOGUE_BY_ID = new Map(CATALOGUES.map((c) => [c.id, c]));

/**
 * What each storefront trades in.
 *
 * **`sells` is what the BOOK says the shop deals in, not what CITY_NET can draw yet.** Two
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
const BUILDING_TYPES = [
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

/** A type by id, or undefined for anything not on the list. */
const typeById = (id) => BY_ID.get(String(id || ''));

/**
 * Whether a value may be stored.
 *
 * Empty is allowed and means "no type set", which is what every building starts as and
 * what clearing one returns it to.
 */
const isValidType = (id) => id === null || id === undefined || id === '' || BY_ID.has(String(id));

/** Whether a building of this type can trade at all. */
const isShop = (id) => Boolean(typeById(id) && typeById(id).shop);

/** Whether this type deals in a given catalogue. */
const sellsCatalogue = (id, catalogue) => {
  const type = typeById(id);
  return Boolean(type && type.sells.includes(catalogue));
};

/** The catalogues this type deals in that a shop can actually put on a shelf. */
const shelvedCatalogues = (id) => {
  const type = typeById(id);
  if (!type) return [];
  return type.sells.filter((c) => CATALOGUE_BY_ID.has(c) && CATALOGUE_BY_ID.get(c).shelved);
};

module.exports = {
  BUILDING_TYPES, CATALOGUES, typeById, isValidType, isShop, sellsCatalogue, shelvedCatalogues,
};
