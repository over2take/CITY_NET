// A system's own building types and shop catalogues: the names it calls them, and which it has.
//
// The app's types and catalogues are fixed (buildingTypes.js): a Ripperdoc sells cyberware, a
// Gun Shop weapons. A custom system renames them (a Ripperdoc is a Temple, Cyberware is Relics)
// and turns any off, never adds new ones (decided with the user, 2026-10-01). The ids stay,
// so a building keeps its type and a shop its uploaded stock whatever the system calls them,
// and turning one back on brings it all back: off only hides.
//
//   buildings: {
//     types:      { ripperdoc: { name: 'Temple' }, corp: { on: false } },
//     catalogues: { cyberware: { name: 'Relics', currency: 'favor' }, vehicles: { on: false } },
//   }
//
// A catalogue may also name the currency its shelves are priced in, one of the system's own
// (currencies.js), so a guild hall can sell for Favor while the market sells for Gold (decided
// with the user, 2026-10-02). Unset, it is priced in the system's main currency.
//
// Its own module, needing only the vocabulary, so the definition checks and the running game
// can both use it without a circle.
//
// The game's own kinds of shop (8a7b; approved mockup docs/mockups/types-in-shops.html, 2026-11-21, the user: "in Item Type we
// have a section to add what store sells this item ... then add that store to the building Type list"): a GM makes an
// Apothecary or a Fence, named as they like, which an item type's SOLD AT can tick and a building can be. It sells only the
// types that tick it, in the General Store's look. Another game hasn't got it: a building set to it is no shop there.
//
//   buildings: { shops: [{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', on: false }] }

const { BUILDING_TYPES, CATALOGUES, shelvedCatalogues, isShop } = require('../buildingTypes');
const { partOn } = require('./parts');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The longest name a system may give a type or catalogue: the same as one glossary word. */
const NAME_LIMIT = 40;
/** The most shops of its own a game makes. */
const SHOPS_MOST = 20;
/** A shop's id: made from its name when made, fixed after, as items' and types' are. */
const SHOP_ID = /^[a-z][a-z0-9_]{0,63}$/;
const SHOP_KEYS = ['id', 'name', 'on'];

const KINDS = {
  types: new Set(BUILDING_TYPES.map((t) => t.id)),
  catalogues: new Set(CATALOGUES.map((c) => c.id)),
};

/**
 * Problems with a definition's `buildings` section, pushed onto `problems`. `currencyIds` are the
 * system's own currencies, which a catalogue's currency must be one of.
 */
const checkBuildings = (buildings, problems, currencyIds = []) => {
  if (buildings === undefined) return;
  if (!isPlainObject(buildings)) { problems.push({ where: 'buildings', message: 'Must be a set of types and catalogues' }); return; }
  for (const [kind, entries] of Object.entries(buildings)) {
    // The game's own kinds of shop (8a7b): a list of its own.
    if (kind === 'shops') { checkShops(entries, problems); continue; }
    // Own keys only: a file's "constructor" or "__proto__" is a kind like any other, and refused.
    const ids = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
    if (!ids) { problems.push({ where: `buildings ${kind}`, message: 'Only "types", "catalogues" and "shops" are set here' }); continue; }
    if (!isPlainObject(entries)) { problems.push({ where: `buildings ${kind}`, message: 'Must be a set of ids' }); continue; }
    for (const [id, setting] of Object.entries(entries)) {
      const where = `buildings ${kind} ${id}`;
      if (!ids.has(id)) { problems.push({ where, message: kind === 'types' ? 'Not a building type of the app' : 'Not a shop catalogue of the app' }); continue; }
      if (!isPlainObject(setting)) { problems.push({ where, message: 'Must say a name, on, or both' }); continue; }
      const keys = kind === 'catalogues' ? ['name', 'on', 'currency'] : ['name', 'on'];
      for (const key of Object.keys(setting)) {
        if (!keys.includes(key)) problems.push({ where: `${where}, ${key}`, message: kind === 'catalogues' ? 'Only "name", "on" and "currency" are set here' : 'Only "name" and "on" are set here' });
      }
      if (kind === 'catalogues' && setting.currency !== undefined) {
        if (!currencyIds.length) problems.push({ where: `${where}, currency`, message: 'This system has no currencies of its own' });
        else if (!currencyIds.includes(setting.currency)) problems.push({ where: `${where}, currency`, message: "Not one of this system's currencies" });
      }
      if (setting.on !== undefined && typeof setting.on !== 'boolean') problems.push({ where: `${where}, on`, message: 'Must be true or false' });
      if (setting.name !== undefined) {
        if (typeof setting.name !== 'string' || !setting.name.trim()) problems.push({ where: `${where}, name`, message: 'Must be some text' });
        else if (setting.name.trim().length > NAME_LIMIT) problems.push({ where: `${where}, name`, message: `At most ${NAME_LIMIT} characters` });
      }
    }
  }
};

/** Problems with the game's own kinds of shop (8a7b), pushed onto `problems`. */
const checkShops = (shops, problems) => {
  if (!Array.isArray(shops)) { problems.push({ where: 'buildings shops', message: 'A list of the shops this game makes' }); return; }
  if (shops.length > SHOPS_MOST) problems.push({ where: 'buildings shops', message: `At most ${SHOPS_MOST} shops of its own` });
  const seen = new Set();
  shops.forEach((shop, n) => {
    const where = `buildings shop ${n + 1}`;
    if (!isPlainObject(shop)) { problems.push({ where, message: 'Must say an id and a name' }); return; }
    for (const key of Object.keys(shop)) if (!SHOP_KEYS.includes(key)) problems.push({ where: `${where}, ${key}`, message: 'Only "id", "name" and "on" are set here' });
    if (typeof shop.id !== 'string' || !SHOP_ID.test(shop.id)) problems.push({ where: `${where}, id`, message: 'Lowercase letters, digits and _, starting with a letter' });
    else if (KINDS.types.has(shop.id)) problems.push({ where: `${where}, id`, message: `The app has a building type called ${shop.id}: call it something else` });
    else if (seen.has(shop.id)) problems.push({ where: `${where}, id`, message: `Two shops called ${shop.id}` });
    else seen.add(shop.id);
    if (typeof shop.name !== 'string' || !shop.name.trim()) problems.push({ where: `${where}, name`, message: 'Must be some text' });
    else if (shop.name.trim().length > NAME_LIMIT) problems.push({ where: `${where}, name`, message: `At most ${NAME_LIMIT} characters` });
    if (shop.on !== undefined && typeof shop.on !== 'boolean') problems.push({ where: `${where}, on`, message: 'Must be true or false' });
  });
};

/** The game's own kinds of shop (8a7b), those well formed, in its order: { id, name, on }. None for a game with none. */
const ownShops = (definition) => {
  const list = definition && isPlainObject(definition.buildings) && Array.isArray(definition.buildings.shops) ? definition.buildings.shops : [];
  const seen = new Set();
  return list.filter((s) => isPlainObject(s) && typeof s.id === 'string' && SHOP_ID.test(s.id) && !KINDS.types.has(s.id)
    && typeof s.name === 'string' && s.name.trim() && !seen.has(s.id) && seen.add(s.id))
    .map((s) => ({ id: s.id, name: s.name.trim().slice(0, NAME_LIMIT), on: s.on !== false }));
};

/** The game's own kind of shop by id (8a7b), or null where it has none of that id. */
const ownShopOf = (definition, id) => ownShops(definition).find((s) => s.id === String(id || '')) || null;

/** Every kind of shop this game has the ids of (8a7b): the app's, and its own. What SOLD AT may tick. */
const shopKindsOf = (definition) => [...BUILDING_TYPES.filter((t) => t.shop).map((t) => t.id), ...ownShops(definition).map((s) => s.id)];

const settingOf = (definition, kind, id) => {
  const section = definition && isPlainObject(definition.buildings) ? definition.buildings[kind] : undefined;
  const setting = isPlainObject(section) ? section[String(id || '')] : undefined;
  return isPlainObject(setting) ? setting : null;
};

/**
 * The catalogues that belong to a part of the app (parts.js): a system without vehicles sells
 * none of the garage's stock (3b4), and one without cyberware none of the ripperdoc's (3b5).
 */
const CATALOGUE_PART = {
  vehicles: 'vehicles', vehicle_fittings: 'vehicles', vehicle_weapons: 'vehicles',
  cyberware: 'cyberware', cyber_mods: 'cyberware', skillplugs: 'cyberware',
};

const catalogueOn = (definition, id) => (settingOf(definition, 'catalogues', id) || {}).on !== false
  && (!CATALOGUE_PART[id] || partOn(definition, CATALOGUE_PART[id]));

/**
 * Whether this system has a building type (`kind` 'types') or catalogue ('catalogues'). On unless
 * it says off. A catalogue is off with its part (the garage's with vehicles), and a shop type is
 * off when every shelf it has is: a garage with nothing to sell is no garage.
 */
const buildingOn = (definition, kind, id) => {
  if (kind === 'catalogues') return catalogueOn(definition, id);
  // One of the game's own shops (8a7b): on unless it says off.
  const own = ownShopOf(definition, id);
  if (own) return own.on;
  if ((settingOf(definition, 'types', id) || {}).on === false) return false;
  const shelves = isShop(id) ? shelvedCatalogues(id) : [];
  return !shelves.length || shelves.some((c) => catalogueOn(definition, c));
};

/**
 * The currency a catalogue is priced in: its own where it names one, the system's main (first)
 * currency otherwise, or null for a system with no currencies, which has the app's single money.
 */
const catalogueCurrency = (definition, id) => {
  const ids = definition && Array.isArray(definition.currencies)
    ? definition.currencies.filter(isPlainObject).map((c) => c.id) : [];
  if (!ids.length) return null;
  const own = (settingOf(definition, 'catalogues', id) || {}).currency;
  return ids.includes(own) ? own : ids[0];
};

/** The system's own name for a type or catalogue, or null where it kept the app's. */
const buildingName = (definition, kind, id) => {
  // One of the game's own shops (8a7b): its name, the only one it has.
  const own = kind === 'types' ? ownShopOf(definition, id) : null;
  if (own) return own.name;
  const name = (settingOf(definition, kind, id) || {}).name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
};

/**
 * What the browser needs: only the types and catalogues the system renamed or turned off, or
 * whose currency it named, each with just what it set. A published definition has been checked,
 * so this only tidies.
 */
const ownBuildings = (definition) => {
  const out = { types: {}, catalogues: {} };
  for (const kind of Object.keys(KINDS)) {
    for (const id of KINDS[kind]) {
      const name = buildingName(definition, kind, id);
      const on = buildingOn(definition, kind, id);
      const own = kind === 'catalogues' ? (settingOf(definition, kind, id) || {}).currency : undefined;
      const currency = own !== undefined && catalogueCurrency(definition, id) === own ? own : undefined;
      if (name || !on || currency) out[kind][id] = { ...(name ? { name } : {}), ...(on ? {} : { on: false }), ...(currency ? { currency } : {}) };
    }
  }
  // And the game's own shops (8a7b), each as it is, for SOLD AT and the BUILDING TYPE list: only where it makes some.
  const shops = ownShops(definition);
  return shops.length ? { ...out, shops } : out;
};

module.exports = { checkBuildings, buildingOn, buildingName, catalogueCurrency, ownBuildings, ownShops, ownShopOf, shopKindsOf, NAME_LIMIT, SHOPS_MOST };
