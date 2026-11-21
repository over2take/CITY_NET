// The builder's ITEM TYPES as logic (8a2; approved mockup docs/mockups/item-types.html, 2026-11-14): what kind of
// thing an item is, and the columns that kind has. Every system starts with GEAR (WEIGHT, PRICE); a type comes from a
// preset or blank, each column one of six kinds, and an item of the type fills its columns. Read from the definition
// and written back; the server checks it (backend systemBuilder/itemTypes.js) and these mirror its limits.
//
// The first edit writes the whole list the page shows, GEAR included, so a WEAPONS type added to a system that had
// none keeps GEAR beside it. A column's id is made from its name when it is added and stays, as an item's does.

import type { Definition } from './systemsApi';
import type { Item } from './items';
import { idFor } from './setup';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type ColumnKind = 'number' | 'text' | 'damage' | 'dice' | 'count' | 'pick';
/** A column: its name and kind, with what its kind has (a NUMBER's unit, a COUNT's button, rest and reloads, PICK ONE's words). */
export interface ItemColumn { id: string; label: string; kind: ColumnKind; unit?: string; button?: string; refill?: string; reload?: string[]; options?: string[] }
export interface ItemType { id: string; label: string; one?: string; columns: ItemColumn[] }

export const KINDS: { id: ColumnKind; label: string; why: string }[] = [
  { id: 'number', label: 'NUMBER', why: 'NUMBER: a value, like a WEIGHT or an armor\'s DEFENSE, with a unit if you want one (LB).' },
  { id: 'text', label: 'TEXT', why: 'TEXT: words, like a range of "melee" or "30 ft".' },
  { id: 'damage', label: 'DAMAGE', why: 'DAMAGE: dice that are damage, rolled from the sheet (1d8 + @might_mod).' },
  { id: 'dice', label: 'DICE', why: 'DICE: any other roll from the sheet, healing or an effect (2d4 + 2); never damage.' },
  { id: 'count', label: 'COUNT', why: 'COUNT: so many of so many, spent by a button you name and refilled by a rest, or by RELOAD from items carried.' },
  { id: 'pick', label: 'PICK ONE', why: 'PICK ONE: one of the words you list, like LIGHT, MEDIUM, HEAVY.' },
];
const KIND_IDS = KINDS.map((k) => k.id) as string[];

export const LIMITS = { types: 10, columns: 20, options: 20, word: 30, text: 200, count: 1000, reload: 10, unit: 12, label: 40 };

const weight: ItemColumn = { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' };
const price: ItemColumn = { id: 'price', label: 'PRICE', kind: 'number' };
/** What a system with no types of its own has, as the server's GEAR. */
export const GEAR: ItemType = { id: 'gear', label: 'GEAR', one: 'Gear', columns: [weight, price] };

/** The presets a type starts from: its name, one of it, its columns. */
export const PRESETS: { id: string; label: string; type: ItemType }[] = [
  { id: 'weapon', label: 'WEAPON', type: { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
    { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' },
    { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' }, weight, price] } },
  { id: 'armor', label: 'ARMOR', type: { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [
    { id: 'defense', label: 'DEFENSE', kind: 'number' }, { id: 'type', label: 'TYPE', kind: 'pick', options: ['LIGHT', 'MEDIUM', 'HEAVY'] }, weight, price] } },
  { id: 'gear', label: 'GEAR', type: GEAR },
  { id: 'consumable', label: 'CONSUMABLE', type: { id: 'consumables', label: 'CONSUMABLES', one: 'Consumable', columns: [
    { id: 'uses', label: 'USES', kind: 'count', button: 'USE' }, { id: 'effect', label: 'EFFECT', kind: 'dice' }, weight, price] } },
  { id: 'spell', label: 'SPELL', type: { id: 'spells', label: 'SPELLS', one: 'Spell', columns: [
    { id: 'level', label: 'LEVEL', kind: 'number' }, { id: 'range', label: 'RANGE', kind: 'text' }, { id: 'damage', label: 'DAMAGE', kind: 'damage' },
    { id: 'charges', label: 'CHARGES', kind: 'count', button: 'CAST', refill: 'long_rest' }] } },
];

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const itemsPart = (def: Definition): Obj => (isObject(def.items) ? def.items : {});

/** Whether the system makes types of its own (none: it has GEAR). */
export const ownTypes = (def: Definition): boolean => list(itemsPart(def).types).some((t) => isObject(t) && typeof t.id === 'string');

/** The system's types, each with its columns of a known kind; GEAR where it makes none. */
export const itemTypes = (def: Definition): ItemType[] => {
  const own = list(itemsPart(def).types).filter((t): t is Obj => isObject(t) && typeof t.id === 'string').map((t) => ({
    ...t, id: t.id as string, label: typeof t.label === 'string' ? t.label : '',
    columns: list(t.columns).filter((c): c is Obj => isObject(c) && typeof c.id === 'string' && KIND_IDS.includes(c.kind as string))
      .map((c) => ({ ...c, id: c.id as string, label: typeof c.label === 'string' ? c.label : '', kind: c.kind as ColumnKind })),
  }) as ItemType);
  return own.length ? own : [copy(GEAR)];
};

/** The type an item is: the one it names, or the first. */
export const typeOf = (def: Definition, id: unknown): ItemType => { const types = itemTypes(def); return types.find((t) => t.id === id) ?? types[0]; };

/** The items, as stored (each a record). */
const storedItems = (def: Definition): Obj[] => list(itemsPart(def).list).filter(isObject);

/** The definition with these types and items; an empty list stores nothing. */
const withPart = (def: Definition, types: ItemType[], items: Obj[] = storedItems(def)): Definition => {
  const rest: Obj = { ...itemsPart(def) };
  delete rest.types; delete rest.list;
  const part = { ...rest, ...(types.length ? { types } : {}), ...(items.length ? { list: items } : {}) };
  const next: Definition = { ...def };
  if (Object.keys(part).length) next.items = part; else delete next.items;
  return next;
};

/** An item with its type and values: `type` written, `values` only the ones it has. */
const itemWith = (item: Obj, type: string | undefined, values: Obj): Obj => {
  const next: Obj = { ...item };
  if (type === undefined) delete next.type; else next.type = type;
  if (Object.keys(values).length) next.values = values; else delete next.values;
  return next;
};
const valuesOf = (item: Obj): Obj => (isObject(item.values) ? item.values : {});

/** Each item's values kept where `keep` says, for the items of `typeId` as they are now. */
const keepValues = (def: Definition, typeId: string, keep: (columnId: string, value: unknown) => boolean): Obj[] =>
  storedItems(def).map((i) => (typeOf(def, i.type).id !== typeId ? i
    : itemWith(i, i.type as string | undefined, Object.fromEntries(Object.entries(valuesOf(i)).filter(([c, v]) => keep(c, v))))));

// ─── TYPES ──────────────────────────────────────────────────────────────────

/** A new type at the end, from a preset or blank (NEW TYPE, a WEIGHT), its id its own. Null at the most. */
export const withNewType = (def: Definition, preset?: string): { definition: Definition; id: string } | null => {
  const types = itemTypes(def);
  if (types.length >= LIMITS.types) return null;
  const from = PRESETS.find((p) => p.id === preset)?.type ?? { id: 'new_type', label: 'NEW TYPE', one: 'Thing', columns: [weight] };
  const made = copy(from);
  const id = idFor(made.id, types.map((t) => t.id));
  return { definition: withPart(def, [...types, { ...made, id }]), id };
};

/** A type's name or what one of it is called; its id stays. A blank ONE stores nothing. */
export const withType = (def: Definition, id: string, patch: { label?: string; one?: string }): Definition =>
  withPart(def, itemTypes(def).map((t) => {
    if (t.id !== id) return t;
    const next: ItemType = { ...t, ...patch };
    if (typeof next.one === 'string' && !next.one.trim()) delete next.one;
    return next;
  }));

/** A type removed; its items go to the first type left, their values gone. The last type stays. */
export const withoutType = (def: Definition, id: string): Definition => {
  const types = itemTypes(def);
  if (types.length <= 1) return def;
  // An item that said nothing was the first type: with the first gone, it is the new first and keeps no values either.
  return withPart(def, types.filter((t) => t.id !== id), storedItems(def).map((i) => (typeOf(def, i.type).id !== id ? i : itemWith(i, undefined, {}))));
};

/**
 * A type made the DEFAULT (8aL1; approved mockup docs/mockups/items-layout.html, 2026-11-14): moved to the top, where a
 * line that is no item lands and a new item starts. An item that said nothing was the old default, and is said to be it,
 * so none changes type. Already the default, or gone: as it was.
 */
export const withDefaultType = (def: Definition, id: string): Definition => {
  const types = itemTypes(def);
  const at = types.findIndex((t) => t.id === id);
  if (at <= 0) return def;
  const was = types[0].id;
  return withPart(def, [types[at], ...types.filter((t) => t.id !== id)],
    storedItems(def).map((i) => (typeof i.type === 'string' && types.some((t) => t.id === i.type) ? i : itemWith(i, was, valuesOf(i)))));
};

// ─── COLUMNS ────────────────────────────────────────────────────────────────

const withColumns = (def: Definition, typeId: string, change: (columns: ItemColumn[]) => ItemColumn[], items?: Obj[]): Definition =>
  withPart(def, itemTypes(def).map((t) => (t.id !== typeId ? t : { ...t, columns: change(t.columns) })), items);

/** A new NUMBER column at the end of a type. Null at the most. */
export const withNewColumn = (def: Definition, typeId: string): { definition: Definition; id: string } | null => {
  const type = itemTypes(def).find((t) => t.id === typeId);
  if (!type || type.columns.length >= LIMITS.columns) return null;
  const id = idFor('new column', type.columns.map((c) => c.id));
  return { definition: withColumns(def, typeId, (cs) => [...cs, { id, label: 'NEW COLUMN', kind: 'number' }]), id };
};

/** Only the parts a kind has, each kept as the server checks it. */
const kept = (c: ItemColumn): ItemColumn => {
  const next: ItemColumn = { id: c.id, label: c.label, kind: c.kind };
  if (c.kind === 'number' && typeof c.unit === 'string' && c.unit.trim()) next.unit = c.unit.slice(0, LIMITS.unit);
  if (c.kind === 'count') {
    if (typeof c.button === 'string' && c.button.trim()) next.button = c.button.slice(0, LIMITS.word);
    if (typeof c.refill === 'string' && c.refill) next.refill = c.refill;
    const reload = [...new Set((c.reload ?? []).filter((r) => typeof r === 'string'))].slice(0, LIMITS.reload);
    if (reload.length) next.reload = reload;
  }
  if (c.kind === 'pick') next.options = (c.options ?? []).slice(0, LIMITS.options);
  return next;
};

/**
 * A column's name, kind or what its kind has; its id stays. A new kind keeps only its own parts (PICK ONE starting
 * with no words) and the items of the type lose their value for it, which no longer fits; PICK ONE's words changed,
 * an item's word that is gone goes too.
 */
export const withColumn = (def: Definition, typeId: string, columnId: string,
  patch: { label?: string; kind?: ColumnKind; unit?: string; button?: string; refill?: string; reload?: string[]; options?: string[] }): Definition => {
  const was = itemTypes(def).find((t) => t.id === typeId)?.columns.find((c) => c.id === columnId);
  if (!was) return def;
  const next = kept({ ...was, ...patch });
  const items = next.kind !== was.kind ? keepValues(def, typeId, (c) => c !== columnId)
    : next.kind === 'pick' ? keepValues(def, typeId, (c, v) => c !== columnId || (next.options ?? []).includes(v as string))
      : undefined;
  return withColumns(def, typeId, (cs) => cs.map((c) => (c.id === columnId ? next : c)), items);
};

/** A column removed, with each item's value for it. */
export const withoutColumn = (def: Definition, typeId: string, columnId: string): Definition =>
  withColumns(def, typeId, (cs) => cs.filter((c) => c.id !== columnId), keepValues(def, typeId, (c) => c !== columnId));

/** PICK ONE's words from what the GM types: split at commas, trimmed, each once, the blanks dropped. */
export const wordsFrom = (text: string): string[] => [...new Set(text.split(',').map((w) => w.trim()).filter(Boolean))];

// ─── AN ITEM'S TYPE AND VALUES ──────────────────────────────────────────────

/** An item made another type: the values of columns the new type has too, of the same kind, are kept. */
export const withItemType = (def: Definition, itemId: string, typeId: string): Definition => {
  const to = itemTypes(def).find((t) => t.id === typeId);
  if (!to) return def;
  return withPart(def, ownTypes(def) ? itemTypes(def) : [], storedItems(def).map((i) => {
    if (i.id !== itemId) return i;
    const from = typeOf(def, i.type);
    const same = (c: string) => { const a = from.columns.find((x) => x.id === c); const b = to.columns.find((x) => x.id === c); return !!a && !!b && a.kind === b.kind; };
    const moved = itemWith(i, typeId, Object.fromEntries(Object.entries(valuesOf(i)).filter(([c]) => same(c))));
    // Its price goes with it (8a7a3b1): into the new type's PRICE column, or its own where the new type has none.
    const price = rawPrice(def, i);
    if (!isPrice(price)) return moved;
    delete moved.price;
    if (to.columns.some(isPriceColumn)) return itemWith(moved, typeId, { ...valuesOf(moved), [PRICE_COLUMN]: price });
    return { ...moved, price };
  }));
};

/** One of an item's values; undefined, or blank words, takes it away. */
export const withItemValue = (def: Definition, itemId: string, columnId: string, value: string | number | undefined): Definition =>
  withPart(def, ownTypes(def) ? itemTypes(def) : [], storedItems(def).map((i) => {
    if (i.id !== itemId) return i;
    const values = { ...valuesOf(i) };
    if (value === undefined || (typeof value === 'string' && !value.trim())) delete values[columnId]; else values[columnId] = value;
    return itemWith(i, i.type as string | undefined, values);
  }));

/** An item's values for its type's columns, those it has. */
export const itemValues = (def: Definition, item: { type?: unknown; values?: unknown }): Obj => {
  const values = isObject(item.values) ? item.values : {};
  return Object.fromEntries(typeOf(def, item.type).columns.filter((c) => Object.prototype.hasOwnProperty.call(values, c.id)).map((c) => [c.id, values[c.id]]));
};

// ─── AN ITEM'S PRICE AND IN SHOPS (8a7a3b1) ─────────────────────────────────

/** A type's own column read as an item's price (backend itemTypes.js, 8a7a3a): a NUMBER column called `price`. */
export const PRICE_COLUMN = 'price';
/** The most an item can cost, as the server checks it. */
export const MOST_PRICE = 1000000000;
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MOST_PRICE;
const isPriceColumn = (c: ItemColumn) => c.id === PRICE_COLUMN && c.kind === 'number';

/** The type's PRICE column an item's price is kept in, or undefined: then the item keeps its own `price`. */
export const priceColumnOf = (def: Definition, item: { type?: unknown }): ItemColumn | undefined => typeOf(def, item.type).columns.find(isPriceColumn);

/** An item's price as the server reads it (itemPrice): its own, else its type's PRICE column's value; undefined with neither. */
const rawPrice = (def: Definition, item: Obj): unknown => {
  if (item.price !== undefined) return item.price;
  const value = valuesOf(item)[PRICE_COLUMN];
  return priceColumnOf(def, item) && isPrice(value) ? value : undefined;
};

/** An item's price, for its PRICE box: undefined where it has none (or one the server would refuse). */
export const itemPriceOf = (def: Definition, item: Item): number | undefined => { const p = rawPrice(def, item as unknown as Obj); return isPrice(p) ? p : undefined; };

/** Whether the shops sell it (backend inShops): as its switch says; one saved before the switch was, by whether it has a price. */
export const inShopsOf = (def: Definition, item: Item): boolean =>
  (typeof item.in_shops === 'boolean' ? item.in_shops : rawPrice(def, item as unknown as Obj) !== undefined);

/** Whether it is IN SHOPS with no price: a problem until it has one or is turned off, as the server lists it. */
export const priceNeeded = (def: Definition, item: Item): boolean => item.in_shops === true && rawPrice(def, item as unknown as Obj) === undefined;

/** An item's price: in its type's PRICE column where it has one, else its own; undefined takes it away. */
export const withItemPrice = (def: Definition, itemId: string, price: number | undefined): Definition =>
  withPart(def, ownTypes(def) ? itemTypes(def) : [], storedItems(def).map((i) => {
    if (i.id !== itemId) return i;
    const next: Obj = { ...i };
    delete next.price;
    if (priceColumnOf(def, i)) {
      const values = { ...valuesOf(i) };
      if (price === undefined) delete values[PRICE_COLUMN]; else values[PRICE_COLUMN] = price;
      return itemWith(next, i.type as string | undefined, values);
    }
    return price === undefined ? next : { ...next, price };
  }));

/** Whether the shops sell an item, as it is switched. */
export const withInShops = (def: Definition, itemId: string, on: boolean): Definition =>
  withPart(def, ownTypes(def) ? itemTypes(def) : [], storedItems(def).map((i) => (i.id === itemId ? { ...i, in_shops: on } : i)));

// ─── WHAT ELSE GOES WITH A REST OR AN ITEM ──────────────────────────────────

/** Every COUNT that a rest refilled refilled by nothing: the rest is gone. */
export const withoutRefillBy = (def: Definition, restId: string): Definition => {
  if (!ownTypes(def) || !itemTypes(def).some((t) => t.columns.some((c) => c.refill === restId))) return def;
  return withPart(def, itemTypes(def).map((t) => ({ ...t, columns: t.columns.map((c) => (c.refill === restId ? kept({ ...c, refill: undefined }) : c)) })));
};

/** Every COUNT reloaded from an item no longer reloaded from it: the item is gone. */
export const withoutReloadFrom = (def: Definition, itemId: string): Definition => {
  if (!ownTypes(def) || !itemTypes(def).some((t) => t.columns.some((c) => (c.reload ?? []).includes(itemId)))) return def;
  return withPart(def, itemTypes(def).map((t) => ({ ...t, columns: t.columns.map((c) => (!(c.reload ?? []).includes(itemId) ? c
    : kept({ ...c, reload: (c.reload ?? []).filter((r) => r !== itemId) }))) })));
};
