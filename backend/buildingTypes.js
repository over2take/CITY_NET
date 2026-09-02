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

const BUILDING_TYPES = [
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

module.exports = { BUILDING_TYPES, typeById, isValidType, isShop };
