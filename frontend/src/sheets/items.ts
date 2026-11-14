// The builder's ITEMS page as logic (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): a system's slots (each
// character has so many: ATTUNED, 3) and its items, each with what its features need (carried, worn, or worn and in a
// slot) and the features themselves, a class's but for a level, a list or an increase. Read from the definition and
// written back; the server checks it (backend systemBuilder/items.js). Items share the one set of names options and
// features have, so a new one's id never takes one of those (choices.ts takenIds).
//
// INSTALLS (7e4b; approved mockup docs/mockups/installed.html, 2026-11-11): what an item may be put in as, each costing
// against a stat or formula, ADDING TO it up to a limit or TAKING FROM it down to one; an item needing one has a COST.
// They share the slots' names, as an item needs one or the other by the same word.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { keptFeature, takenIds, type Feature, type FeaturePatch } from './choices';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** A slot: what an item may need besides being worn, and how many each character has. */
export interface ItemSlot { id: string; label: string; count: number }
/** An item: its name, words, what its features need (`worn` when it says nothing), and its features. */
export interface Item { id: string; label: string; description?: string; needs?: string; cost?: number; features?: Feature[] }
/** An install (7e4): what each costs against, ADDING TO it (`adds`, as when it says nothing) or TAKING FROM it, and its limit, a formula. */
export interface ItemInstall { id: string; label: string; against: string; way?: 'adds' | 'takes'; limit: string }

export const LIMITS = { items: 200, slots: 10, count: 20, features: 20, label: 40, description: 2000, installs: 10, cost: 1000 };

const itemsPart = (def: Definition): Obj => (isObject(def.items) ? def.items : {});

/** The system's slots, those with an id. */
export const itemSlots = (def: Definition): ItemSlot[] => (Array.isArray(itemsPart(def).slots) ? itemsPart(def).slots as unknown[] : [])
  .filter((s): s is Obj => isObject(s) && typeof s.id === 'string')
  .map((s) => ({ ...s, id: s.id as string, label: text(s.label), count: Number.isInteger(s.count) ? s.count as number : 0 }));

/** The system's installs (7e4), those with an id. */
export const itemInstalls = (def: Definition): ItemInstall[] => (Array.isArray(itemsPart(def).installs) ? itemsPart(def).installs as unknown[] : [])
  .filter((s): s is Obj => isObject(s) && typeof s.id === 'string')
  .map((s) => ({ ...s, id: s.id as string, label: text(s.label), against: text(s.against), limit: text(s.limit) }));

/** The system's items, those with an id. */
export const itemList = (def: Definition): Item[] => (Array.isArray(itemsPart(def).list) ? itemsPart(def).list as unknown[] : [])
  .filter((i): i is Obj => isObject(i) && typeof i.id === 'string')
  .map((i) => ({ ...i, id: i.id as string, label: text(i.label) }) as Item);

/** An item's features, those with an id. */
export const itemFeatures = (item: Item): Feature[] => (Array.isArray(item.features) ? item.features : [])
  .filter((f): f is Feature => isObject(f) && typeof f.id === 'string')
  .map((f) => ({ ...f, label: text(f.label) }));

/** The definition with these slots and items, its installs kept (or these); an empty part, and empty items, store nothing. */
const withItems = (def: Definition, slots: ItemSlot[], list: Item[], installs: ItemInstall[] = itemInstalls(def)): Definition => {
  const items = { ...(slots.length ? { slots } : {}), ...(installs.length ? { installs } : {}), ...(list.length ? { list } : {}) };
  const next: Definition = { ...def };
  if (Object.keys(items).length) next.items = items; else delete next.items;
  return next;
};

// ─── SLOTS ──────────────────────────────────────────────────────────────────

/** A new slot at the end, one each until the GM says otherwise. Null at the most. */
export const withNewSlot = (def: Definition): { definition: Definition; id: string } | null => {
  const slots = itemSlots(def);
  if (slots.length >= LIMITS.slots) return null;
  const id = idFor('new slot', [...slots.map((s) => s.id), ...itemInstalls(def).map((s) => s.id)]);
  return { definition: withItems(def, [...slots, { id, label: 'NEW SLOT', count: 1 }], itemList(def)), id };
};

/** A slot's name or how many each character has; its id stays. A count is kept whole, from 0 to the most. */
export const withSlot = (def: Definition, id: string, patch: { label?: string; count?: number }): Definition =>
  withItems(def, itemSlots(def).map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...(patch.label !== undefined ? { label: patch.label } : {}) };
    if (patch.count !== undefined && Number.isFinite(patch.count)) next.count = Math.min(LIMITS.count, Math.max(0, Math.trunc(patch.count)));
    return next;
  }), itemList(def));

/** A slot removed; an item needing it goes back to needing only to be worn. */
export const withoutSlot = (def: Definition, id: string): Definition =>
  withItems(def, itemSlots(def).filter((s) => s.id !== id), itemList(def).map((i) => (i.needs !== id ? i
    : Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'needs')) as unknown as Item)));

// ─── ITEMS ──────────────────────────────────────────────────────────────────

/** A new item at the end, worn to count. Null at the most. */
export const withNewItem = (def: Definition): { definition: Definition; id: string } | null => {
  const list = itemList(def);
  if (list.length >= LIMITS.items) return null;
  const id = idFor('new item', takenIds(def));
  return { definition: withItems(def, itemSlots(def), [...list, { id, label: 'NEW ITEM' }]), id };
};

/** An item's name, words, what it needs or its cost; its id stays. Blank words and WORN store nothing. Needing an install, it
 *  has a cost (1 to start), kept from 0 to the most; needing anything else, none. */
export const withItem = (def: Definition, id: string, patch: { label?: string; description?: string; needs?: string; cost?: number }): Definition => {
  const installs = new Set(itemInstalls(def).map((s) => s.id));
  return withItems(def, itemSlots(def), itemList(def).map((i) => {
    if (i.id !== id) return i;
    const next: Item = { ...i, ...patch };
    if (typeof next.description === 'string' && !next.description.trim()) delete next.description;
    if (!next.needs || next.needs === 'worn') delete next.needs;
    if (next.needs && installs.has(next.needs)) {
      const c = typeof next.cost === 'number' && Number.isFinite(next.cost) ? next.cost : 1;
      next.cost = Math.min(LIMITS.cost, Math.max(0, c));
    } else delete next.cost;
    return next;
  }));
};

/** An item removed, with its features. */
export const withoutItem = (def: Definition, id: string): Definition =>
  withItems(def, itemSlots(def), itemList(def).filter((i) => i.id !== id));

/** What an item's features need, as the page offers it: CARRIED, WORN, WORN AND each slot's name, INSTALLED AS each install's. */
export const needsChoices = (def: Definition): { id: string; label: string }[] => [
  { id: 'carried', label: 'CARRIED' }, { id: 'worn', label: 'WORN' },
  ...itemSlots(def).map((s) => ({ id: s.id, label: `WORN AND ${(s.label.trim() || s.id).toUpperCase()}` })),
  ...itemInstalls(def).map((s) => ({ id: s.id, label: `INSTALLED AS ${(s.label.trim() || s.id).toUpperCase()}` })),
];

/** The install an item needs, or null. */
export const installOf = (def: Definition, item: Item): ItemInstall | null => itemInstalls(def).find((s) => s.id === item.needs) ?? null;

// ─── INSTALLS (7e4b) ────────────────────────────────────────────────────────

/** A new install at the end, costing against nothing yet (the page asks), adding to it, its limit to say. Null at the most. */
export const withNewInstall = (def: Definition): { definition: Definition; id: string } | null => {
  const installs = itemInstalls(def);
  if (installs.length >= LIMITS.installs) return null;
  const id = idFor('new install', [...itemSlots(def).map((s) => s.id), ...installs.map((s) => s.id)]);
  return { definition: withItems(def, itemSlots(def), itemList(def), [...installs, { id, label: 'NEW INSTALL', against: '', limit: '' }]), id };
};

/** An install's name, what it costs against, which way, or its limit; its id stays. ADDS TO stores nothing. */
export const withInstall = (def: Definition, id: string, patch: { label?: string; against?: string; way?: 'adds' | 'takes'; limit?: string }): Definition =>
  withItems(def, itemSlots(def), itemList(def), itemInstalls(def).map((s) => {
    if (s.id !== id) return s;
    const next: ItemInstall = { ...s, ...patch };
    if (next.way !== 'takes') delete next.way;
    return next;
  }));

/** An install removed; an item needing it goes back to needing only to be worn, its cost gone. */
export const withoutInstall = (def: Definition, id: string): Definition =>
  withItems(def, itemSlots(def), itemList(def).map((i) => (i.needs !== id ? i
    : Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'needs' && k !== 'cost')) as unknown as Item)), itemInstalls(def).filter((s) => s.id !== id));

/** What an item needs, in words: WORN when it says nothing, the slot's id where it is gone. */
export const needsWords = (def: Definition, item: Item): string =>
  needsChoices(def).find((n) => n.id === (item.needs || 'worn'))?.label ?? `WORN AND ${String(item.needs).toUpperCase()}`;

// ─── AN ITEM'S FEATURES ─────────────────────────────────────────────────────

const withItemFeatures = (def: Definition, itemId: string, change: (features: Feature[]) => Feature[]): Definition =>
  withItems(def, itemSlots(def), itemList(def).map((i) => {
    if (i.id !== itemId) return i;
    const features = change(itemFeatures(i));
    const next: Item = { ...i, features };
    if (!features.length) delete next.features;
    return next;
  }));

/** A new feature on an item, with an id of its own among every option, feature and item. Null at the most. */
export const withNewItemFeature = (def: Definition, itemId: string): { definition: Definition; id: string } | null => {
  const item = itemList(def).find((i) => i.id === itemId);
  if (!item || itemFeatures(item).length >= LIMITS.features) return null;
  const id = idFor('new feature', takenIds(def));
  return { definition: withItemFeatures(def, itemId, (fs) => [...fs, { id, label: 'NEW FEATURE' }]), id };
};

/** An item's feature changed, kept as a pick's is, but never at a level. */
export const withItemFeature = (def: Definition, itemId: string, featureId: string, patch: FeaturePatch): Definition =>
  withItemFeatures(def, itemId, (fs) => fs.map((f) => (f.id !== featureId ? f : keptFeature(f, patch, false))));

/** An item's feature removed. */
export const withoutItemFeature = (def: Definition, itemId: string, featureId: string): Definition =>
  withItemFeatures(def, itemId, (fs) => fs.filter((f) => f.id !== featureId));
