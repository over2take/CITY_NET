// What a character is carrying, item by item.
//
// This replaces a textarea. Prose is fine for "a photo of her daughter" and useless for
// anything the sheet has to count: ammunition, stims, rations, rope. Every system had the
// same free-text box, so this is one feature four sheets get - the first thing in a long
// while that is not Cities Without Number only.
//
// Weapons are deliberately NOT here. They carry combat stats, they feed the attack picker,
// and they have their own rows and their own stash. What they share is the vocabulary:
// an item is Readied, Stowed, or in the stash, and it means the same thing either place.
//
// Encumbrance is CWN's. Other systems get the table and no Enc column, because inventing a
// carrying rule for a game that does not have one would be worse than not counting.

/** The sheet field holding the array. Same on every system. */
export const INVENTORY_FIELD = 'inventory';

/** Where a thing is. The same three states weapons use. */
export type CarryState = 'readied' | 'stowed' | 'stash';

export const CARRY_STATES: { value: CarryState; label: string; title: string }[] = [
  { value: 'readied', label: 'R', title: 'Readied — in hand or immediately reachable' },
  { value: 'stowed', label: 'S', title: 'Stowed — packed away, a Main Action to reach' },
  { value: 'stash', label: '—', title: 'Stashed — not on you, and costs no Encumbrance' },
];

export interface InventoryItem {
  name: string;
  /** How many. Ammunition and stims are the reason this exists. */
  qty: number;
  /** Encumbrance of ONE of them. Blank where the system has no such rule. */
  enc: string;
  /**
   * Whether these bundle three-to-one (CWN p48).
   *
   * "Small, regularly-shaped objects such as grenades, pharmaceuticals, rations, and
   * firearm magazines can be wrapped into bundles... Three such items can be tied into a
   * bundle that only counts as one item of encumbrance." So it is not quantity times Enc,
   * and a stack of six stims is two, not six.
   */
  bundled: boolean;
  carry: CarryState;
  /** Where it is, for stashed things. The same note the weapon stash keeps. */
  location: string;
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const carryOf = (v: unknown): CarryState => {
  const s = str(v).trim().toLowerCase();
  return s === 'readied' || s === 'stowed' ? s : 'stash';
};

/** An item with every field present, whatever it was handed. */
export const normaliseItem = (raw: unknown): InventoryItem => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: str(r.name),
    // At least one: a row that exists is a thing you have, and zero of something is not
    // an inventory entry, it is a deleted one.
    qty: Math.max(1, Math.floor(num(r.qty)) || 1),
    enc: str(r.enc),
    bundled: r.bundled === true,
    carry: carryOf(r.carry),
    location: str(r.location),
  };
};

/**
 * Whatever the sheet holds, as items.
 *
 * Defensive like every other list here: free-form JSON on a sheet people import into and
 * hand-edit, and a table that throws is worse than one that is empty.
 */
export const readInventory = (
  data: Record<string, unknown> | undefined | null,
): InventoryItem[] => {
  let value: unknown = data?.[INVENTORY_FIELD];
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map(normaliseItem);
};

export const writeInventory = (items: InventoryItem[]): string => JSON.stringify(items);

/**
 * What one stack costs against Encumbrance.
 *
 * Nothing at all while it is stashed - the stash is not on you. Nothing for an Enc 0 item
 * either: the book says any reasonable number of pocket-sized things can be carried.
 *
 * Bundled stacks divide by three and round up, which is the rule rather than a
 * simplification: three grenades are one item of Encumbrance, and four are two.
 */
export const itemEnc = (item: InventoryItem): number => {
  if (item.carry === 'stash') return 0;
  const each = num(item.enc);
  if (each <= 0) return 0;
  const units = item.bundled ? Math.ceil(item.qty / 3) : item.qty;
  return units * each;
};

/** What the whole inventory adds to each track. */
export const inventoryEnc = (
  data: Record<string, unknown> | undefined | null,
): { readied: number; stowed: number } => {
  let readied = 0;
  let stowed = 0;
  for (const item of readInventory(data)) {
    const cost = itemEnc(item);
    if (item.carry === 'readied') readied += cost;
    else if (item.carry === 'stowed') stowed += cost;
  }
  return { readied, stowed };
};

/** A blank row, for the + button. */
export const blankItem = (): InventoryItem =>
  ({ name: '', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' });
