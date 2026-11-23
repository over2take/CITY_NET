// The kinds of shop an item type is SOLD AT, and the game's own kinds of shop (8a7b2; approved mockup
// docs/mockups/types-in-shops.html, section 2, 2026-11-21). The app's six shops by what this game calls them, then the
// shops this game made (an Apothecary, a Fence), which + NEW SHOP adds. Read from the definition and written back; the
// server checks it (backend systemBuilder/buildings.js checkShops, itemTypes.js sold_at).

import type { Definition } from './systemsApi';
import { BUILDING_TYPES } from '../data/buildingTypes';
import { idFor } from './setup';
import { itemTypes, ownTypes, withType, type ItemType } from './itemTypes';
import { buildingSetting, BUILDING_NAME_LIMIT } from './wordsFeatures';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The most shops of its own a game makes (buildings.js SHOPS_MOST). */
export const SHOPS_MOST = 20;
/** A shop's id, as the server takes it (buildings.js SHOP_ID). */
const SHOP_ID = /^[a-z][a-z0-9_]{0,63}$/;
/** Where a type is sold when it says nothing (itemTypes.js DEFAULT_SOLD_AT). */
export const DEFAULT_SOLD_AT = ['general_store'];
const APP_SHOPS = BUILDING_TYPES.filter((t) => t.shop);
const APP_IDS = BUILDING_TYPES.map((t) => t.id);

/** One of the game's own kinds of shop, as stored. */
export interface OwnShop { id: string; name: string; on?: boolean; buys?: 'sells' | 'anything' }
/** A kind of shop to tick: its id, its name in this game, whether the game made it, and whether it is on. */
export interface ShopChoice { id: string; name: string; own: boolean; on: boolean }

const buildingsOf = (def: Definition): Obj => (isObject(def.buildings) ? def.buildings : {});

/** The game's own kinds of shop, those well formed, in its order. */
export const ownShopsOf = (def: Definition): OwnShop[] => {
  const list = buildingsOf(def).shops;
  return (Array.isArray(list) ? list : []).filter((s): s is OwnShop => isObject(s) && typeof s.id === 'string' && SHOP_ID.test(s.id)
    && !APP_IDS.includes(s.id) && typeof s.name === 'string');
};

/** Every kind of shop a type can be sold at: the app's, named as this game names them, then the game's own. */
export const shopChoices = (def: Definition): ShopChoice[] => [
  ...APP_SHOPS.map((t) => {
    const s = buildingSetting(def, 'types', t.id);
    return { id: t.id, name: s.name?.trim() || t.label, own: false, on: s.on !== false };
  }),
  ...ownShopsOf(def).map((s) => ({ id: s.id, name: s.name.trim() || s.id, own: true, on: s.on !== false })),
];

/** The kinds of shop a type is sold at: what it says, else the General Store. */
export const soldAtOf = (type: ItemType): string[] => (Array.isArray(type.sold_at) ? type.sold_at : DEFAULT_SOLD_AT);

/** A type sold at a kind of shop, or no longer: the list kept in the order the shops are shown. */
export const withSoldAtToggled = (def: Definition, typeId: string, shopId: string): Definition => {
  const type = itemTypes(def).find((t) => t.id === typeId);
  if (!type) return def;
  const was = soldAtOf(type);
  const ticked = new Set(was.includes(shopId) ? was.filter((id) => id !== shopId) : [...was, shopId]);
  const order = shopChoices(def).map((c) => c.id);
  return withType(def, typeId, { sold_at: [...order.filter((id) => ticked.has(id)), ...[...ticked].filter((id) => !order.includes(id))] });
};

/** A name as typed: trimmed, its spaces single. */
const tidy = (name: string) => name.trim().replace(/\s+/g, ' ');

/**
 * + NEW SHOP: a shop of the game's own by this name, at the end of its shops, its id made from its name and fixed after;
 * one of this name already (the app's by its name here, or the game's own) is that one, and nothing is made. Null for a
 * blank name, or a new one past the most.
 */
export const withNewShop = (def: Definition, name: string): { definition: Definition; id: string } | null => {
  const wanted = tidy(name).slice(0, BUILDING_NAME_LIMIT);
  if (!wanted) return null;
  const known = shopChoices(def).find((c) => c.name.toLowerCase() === wanted.toLowerCase());
  if (known) return { definition: def, id: known.id };
  const own = ownShopsOf(def);
  if (own.length >= SHOPS_MOST) return null;
  const id = idFor(wanted, [...APP_IDS, ...own.map((s) => s.id)]);
  return { definition: { ...def, buildings: { ...buildingsOf(def), shops: [...own, { id, name: wanted }] } }, id };
};

/** The definition with these as the game's own shops; none stores nothing. */
const withShops = (def: Definition, shops: OwnShop[]): Definition => {
  const buildings: Obj = { ...buildingsOf(def) };
  if (shops.length) buildings.shops = shops; else delete buildings.shops;
  const next: Definition = { ...def };
  if (Object.keys(buildings).length) next.buildings = buildings; else delete next.buildings;
  return next;
};

/**
 * One of the game's own shops renamed, switched on or off, or set to buy anything (8a7b3b, FEATURES). On, and buying what
 * it sells, are as unsaid and store nothing. A blank name is kept while it is typed; the server's checks say it needs one.
 */
export const withOwnShop = (def: Definition, id: string, patch: { name?: string; on?: boolean; buys?: 'sells' | 'anything' }): Definition =>
  withShops(def, ownShopsOf(def).map((s) => {
    if (s.id !== id) return s;
    const next: OwnShop = { ...s, ...patch };
    if (next.on !== false) delete next.on;
    if (next.buys !== 'anything') delete next.buys;
    return next;
  }));

/** One of the game's own shops deleted (8a7b3b): gone from its shops, and from every type's SOLD AT. */
export const withoutOwnShop = (def: Definition, id: string): Definition => {
  let next = withShops(def, ownShopsOf(def).filter((s) => s.id !== id));
  for (const t of itemTypes(next)) if (Array.isArray(t.sold_at) && t.sold_at.includes(id)) next = withType(next, t.id, { sold_at: t.sold_at.filter((s) => s !== id) });
  return next;
};

/** The game's own types sold at a kind of shop, by name (8a7b3b: what a shop of its own sells, said on FEATURES). */
export const typesSoldAt = (def: Definition, shopId: string): string[] =>
  (ownTypes(def) ? itemTypes(def).filter((t) => soldAtOf(t).includes(shopId)).map((t) => t.label.trim() || t.id) : []);

/** What SOLD AT says under its shops: every one it is sold at, by name, or that it is sold nowhere. */
export const soldAtWords = (def: Definition, type: ItemType): string => {
  const choices = shopChoices(def);
  const names = soldAtOf(type).map((id) => choices.find((c) => c.id === id)?.name).filter(Boolean);
  if (!names.length) return 'Sold nowhere: only given, from GIVE.EXE.';
  const dashed = choices.some((c) => c.own) ? ' Dashed: shops this game made.' : '';
  return `Sold at every ${names.join(', every ')} in this game.${dashed}`;
};
