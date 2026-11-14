// A system's items on the GEAR tab, as logic (7e3b; approved mockup docs/mockups/items.html, 2026-11-10). The items
// and slots come in the render copy, in words (backend choices.js itemsRenderedOf); what this character wears and
// attunes, and what works, come in their sheet, worked out by the server on every save (items.js itemsShown, under
// the sheet's _worked). Nothing here decides what an item does: the server does, and the sheet only draws what it
// says and asks it to change (the itemAction socket). Pure, so InventorySection and GearItemLine only draw.
//
// A gear line is an item when its name is the item's, as shops match. One line wears as one: two lines of the same
// name have the buttons on the first carried one. Wearing is free; ATTUNE needs the item worn and a slot free, or the
// GM's ATTUNE ANYWAY; taken off, it stays attuned until ENDed.
//
// Installed (7e4c; approved mockup docs/mockups/installed.html, 2026-11-11): an item needing an install has INSTALL on its
// line (the player's or the GM's), costing against its install's stat or formula; past the limit only the GM's INSTALL
// ANYWAY. Installed, its line is locked (kept, not sold or moved) until REMOVE gives the cost back.

import type { FeatureShown } from './choicesShown';
import { WORKED_KEY } from './choicesShown';
import type { InventoryItem } from './inventory';

/** A slot as the render copy says it: its name, and how many each character has. */
export interface SlotShown { id: string; label: string; count: number }
/** An item as the render copy says it: what its features need ('carried', 'worn' or a slot's id), and its features. */
export interface ItemShown { id: string; label: string; description?: string; needs: string; cost?: number; features: FeatureShown[] }
/** An install as the render copy says it (7e4c): its name, what it costs against by name, which way. */
export interface InstallShown { id: string; label: string; against: string; way: 'adds' | 'takes' }
/** A system's items, slots and installs (backend choices.js itemsRenderedOf). */
export interface ItemsShown { slots: SlotShown[]; installs?: InstallShown[]; list: ItemShown[] }

/** What the server worked out of one carried item (backend items.js itemsShown). */
export interface ItemWorked { id: string; needs: string; worn?: true; attuned?: true; installed?: true; working?: true }
/** What the server worked out of one install (7e4c): its costs all told, the value it costs against now, and its limit. */
export interface InstallWorked { id: string; used: number; value: number | null; limit: number | null }
/** What the server worked out of one slot: this character's count, and how many are used. */
export interface SlotWorked { id: string; count: number; used: number }

/** A change to what is worn and attuned, as the itemAction socket takes it (backend items.js itemAction). */
export type ItemAction =
  | { kind: 'wear' | 'takeOff' | 'attune' | 'end' | 'install' | 'uninstall'; item: string }
  | { kind: 'slots'; slot: string; count: number | null };

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A number as the sheet says it: 2.75, never 2.7500000001. */
export const amount = (n: number) => String(Math.round(n * 100) / 100);

/** The items and slots the last save worked out, those well formed enough to draw. */
export const itemsWorkedOn = (data: Obj | null | undefined): { items: ItemWorked[]; slots: SlotWorked[]; installs: InstallWorked[] } => {
  const w = isObject(data) && isObject(data[WORKED_KEY]) ? data[WORKED_KEY] as Obj : {};
  return {
    items: Array.isArray(w.items) ? (w.items as unknown[]).filter((i): i is ItemWorked => isObject(i) && typeof i.id === 'string') : [],
    slots: Array.isArray(w.slots) ? (w.slots as unknown[]).filter((s): s is SlotWorked => isObject(s) && typeof s.id === 'string'
      && Number.isInteger(s.count) && Number.isInteger(s.used)) : [],
    installs: Array.isArray(w.installs) ? (w.installs as unknown[]).filter(isObject).flatMap((s) => (typeof s.id === 'string' && finite(s.used) !== null
      ? [{ id: s.id, used: finite(s.used)!, value: finite(s.value), limit: finite(s.limit) }] : [])) : [],
  };
};

const key = (name: string) => name.trim().toLowerCase();
const carried = (line: InventoryItem) => line.carry === 'readied' || line.carry === 'stowed';

/**
 * Which gear line draws each item, by line: the first carried line of its name, or, with none carried, the first of
 * its name, so a stashed one still says why it does nothing. Lines that are no item, or a second of one, get none.
 */
export const itemLines = (items: ItemsShown | undefined, lines: InventoryItem[]): Map<number, ItemShown> => {
  const out = new Map<number, ItemShown>();
  for (const item of items?.list ?? []) {
    const named = lines.map((l, i) => [l, i] as const).filter(([l]) => key(l.name) !== '' && key(l.name) === key(item.label));
    const line = named.find(([l]) => carried(l)) ?? named[0];
    if (line) out.set(line[1], item);
  }
  return out;
};

/**
 * The verb a slot's name is made from, for its button: ATTUNED → ATTUNE, BONDED → BOND, LINKED → LINK. A name that
 * isn't one of those (BOUND, a noun) is its own button.
 */
export const slotVerb = (label: string): string => {
  const word = label.trim().toUpperCase();
  if (!/ED$/.test(word) || word.length < 5) return word;
  const stem = word.slice(0, -2);
  // A doubled last letter is the past tense's own (PINNED → PIN), but for those words end in (BLESSED, FILLED).
  if (/([B-DGHJKMNPRTV])\1$/.test(stem)) return stem.slice(0, -1);
  // Where the E was the word's, not the ending's: ATTUNE, PRIME, FUSE, PLACE, CHARGE, FORCE, VALUE.
  if (/[B-DF-HJ-NP-TV-Z][AIU][NM]$|[AEIOU][CGSVZ]$|[RNDL][GVC]$|U$/.test(stem)) return `${stem}E`;
  return stem;
};

/** A button on an item's line: what it says, what it asks (none: drawn, but not to be pressed), why not. */
export interface GearButton { label: string; action: ItemAction | null; on?: true; hot?: true; title?: string }

/** What an item's line draws: its NEEDS tag, its buttons, and what it says it is doing. */
export interface GearRow {
  tag: string | null;
  buttons: GearButton[];
  say: { text: string; warn: boolean } | null;
}

/**
 * An item's line as the viewer sees it (the mockup's sheet): WEAR or WORN · TAKE OFF; for one needing a slot, ATTUNE
 * once worn (ATTUNED · END when it is), and with every slot taken nothing but the GM's ATTUNE ANYWAY; and what it is
 * doing: WORKING, CARRIED, or why it does nothing. Read-only, the same words without anything to press.
 */
export const gearRow = (
  item: ItemShown, worked: { items: ItemWorked[]; slots: SlotWorked[]; installs?: InstallWorked[] }, slots: SlotShown[],
  { gm = false, readOnly = false, installs = [] }: { gm?: boolean; readOnly?: boolean; installs?: InstallShown[] } = {},
): GearRow => {
  const state = worked.items.find((i) => i.id === item.id);
  const install = installs.find((s) => s.id === item.needs) ?? null;
  if (install) return installRow(item, state, install, worked.installs ?? [], { gm, readOnly });
  const slot = slots.find((s) => s.id === item.needs) ?? null;
  const L = slot ? slot.label.toUpperCase() : '';
  const tag = slot ? `NEEDS ${L}` : null;
  // The server lists only what is carried: a stashed line (or one not saved yet) does nothing.
  if (!state) return { tag, buttons: [], say: { text: 'STASHED: DOES NOTHING', warn: false } };
  if (item.needs === 'carried') return { tag, buttons: [], say: state.working ? { text: 'WORKING', warn: false } : null };
  const press = (action: ItemAction) => (readOnly ? null : action);
  const buttons: GearButton[] = [state.worn
    ? { label: 'WORN · TAKE OFF', action: press({ kind: 'takeOff', item: item.id }), on: true }
    : { label: 'WEAR', action: press({ kind: 'wear', item: item.id }) }];
  let say: GearRow['say'] = state.working ? { text: 'WORKING', warn: false } : state.worn ? null : { text: 'CARRIED', warn: false };
  if (slot) {
    const use = worked.slots.find((s) => s.id === slot.id);
    const full = !!use && use.used >= use.count;
    const verb = slotVerb(slot.label);
    if (state.attuned) buttons.push({ label: `${L} · END`, action: press({ kind: 'end', item: item.id }), on: true });
    else if (!state.worn) buttons.push({ label: verb, action: null, title: 'Wear it first' });
    else if (full && gm) buttons.push({ label: `${verb} ANYWAY`, action: press({ kind: 'attune', item: item.id }), hot: true, title: `Every ${L} slot is taken: yours to allow past it` });
    else if (full) buttons.push({ label: verb, action: null, title: `No ${L} slot free: end one first, or ask your GM` });
    else buttons.push({ label: verb, action: press({ kind: 'attune', item: item.id }) });
    if (state.worn && !state.attuned) say = { text: `WORN, NOT ${L}: DOES NOTHING YET${full && !gm ? ` · NO ${L} SLOT FREE` : ''}`, warn: true };
    if (!state.worn && state.attuned) say = { text: `${L}, NOT WORN: DOES NOTHING`, warn: true };
  }
  return { tag, buttons, say };
};

/** Whether an install has room for a cost: adding, the value plus it within the limit; taking, the value less it. Unknowable, no. */
export const fits = (install: InstallShown, w: InstallWorked | undefined, cost: number): boolean => {
  if (!w || w.value === null || w.limit === null) return false;
  return install.way === 'takes' ? w.value - cost >= w.limit - 1e-9 : w.value + cost <= w.limit + 1e-9;
};

/**
 * An installed-type item's line (7e4c): INSTALL with room (the GM's INSTALL ANYWAY without, a player's disabled and why), or
 * INSTALLED · REMOVE; what it costs, and what it is doing.
 */
const installRow = (
  item: ItemShown, state: ItemWorked | undefined, install: InstallShown, worked: InstallWorked[], { gm, readOnly }: { gm: boolean; readOnly: boolean },
): GearRow => {
  const L = install.label.toUpperCase();
  const cost = typeof item.cost === 'number' && Number.isFinite(item.cost) ? item.cost : 0;
  const against = install.against.toUpperCase();
  const tag = `${L} · COSTS ${amount(cost)} ${against}`;
  if (!state) return { tag, buttons: [], say: { text: 'STASHED: NOT INSTALLED', warn: false } };
  const press = (action: ItemAction) => (readOnly ? null : action);
  if (state.installed) {
    return { tag, buttons: [{ label: 'INSTALLED · REMOVE', action: press({ kind: 'uninstall', item: item.id }), on: true }],
      say: state.working ? { text: 'WORKING', warn: false } : null };
  }
  const room = fits(install, worked.find((w) => w.id === install.id), cost);
  if (room) return { tag, buttons: [{ label: 'INSTALL', action: press({ kind: 'install', item: item.id }) }], say: { text: 'CARRIED, DOES NOTHING TILL INSTALLED', warn: false } };
  return gm
    ? { tag, buttons: [{ label: 'INSTALL ANYWAY', action: press({ kind: 'install', item: item.id }), hot: true, title: `Past ${L}'s limit: yours to allow` }],
      say: { text: `PAST ${L}'S LIMIT`, warn: true } }
    : { tag, buttons: [{ label: 'INSTALL', action: null, title: `Past ${L}'s limit: only your GM can install it` }],
      say: { text: `PAST ${L}'S LIMIT · ONLY YOUR GM CAN`, warn: true } };
};

/** An install's counter over the gear (7e4c): CYBERWARE · STRAIN 2.75 OF 3, full at its limit. */
export interface InstallCounter { id: string; label: string; text: string; full: boolean }

/** The counters, one for each install the system has, as the last save worked them out. */
export const installCounters = (items: ItemsShown | undefined, worked: { installs?: InstallWorked[] }): InstallCounter[] => (items?.installs ?? []).map((s) => {
  const w = (worked.installs ?? []).find((x) => x.id === s.id);
  const L = s.label.toUpperCase();
  const what = s.against.toUpperCase();
  const value = w && w.value !== null ? amount(w.value) : '?';
  const limit = w && w.limit !== null ? amount(w.limit) : '?';
  const full = !!w && w.value !== null && w.limit !== null && (s.way === 'takes' ? w.value <= w.limit + 1e-9 : w.value >= w.limit - 1e-9);
  return { id: s.id, label: L, text: s.way === 'takes' ? `${L} · ${what} ${value}, NEVER BELOW ${limit}` : `${L} · ${what} ${value} OF ${limit}`, full };
});

/** The names of the items installed, lowercased (7e4c): their lines are locked, and a shop won't buy one. */
export const installedNames = (items: ItemsShown | undefined, worked: { items: ItemWorked[] }): Set<string> => {
  const installed = new Set(worked.items.filter((i) => i.installed).map((i) => i.id));
  return new Set((items?.list ?? []).filter((i) => installed.has(i.id)).map((i) => i.label.trim().toLowerCase()));
};

/** A slot's counter over the gear: ATTUNED 2 OF 3, full when every one is used; `own` when the GM set this character's. */
export interface SlotCounter { id: string; label: string; used: number; count: number; full: boolean; own: boolean; standard: number }

/** The counters, one for each slot the system has, as the last save worked them out. */
export const slotCounters = (items: ItemsShown | undefined, worked: { slots: SlotWorked[] }): SlotCounter[] => (items?.slots ?? []).map((s) => {
  const w = worked.slots.find((x) => x.id === s.id);
  const count = w ? w.count : s.count;
  const used = w ? w.used : 0;
  return { id: s.id, label: s.label.toUpperCase(), used, count, full: used >= count, own: count !== s.count, standard: s.count };
});

/**
 * What the GM's box for one character's count asks: blank, or the system's own number, puts it back (null); a whole
 * number 0 to 20 sets it; anything else asks nothing.
 */
export const slotCountAsked = (counter: SlotCounter, typed: string): ItemAction | null => {
  const t = typed.trim();
  if (t === '' || Number(t) === counter.standard) return counter.own ? { kind: 'slots', slot: counter.id, count: null } : null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 20 || n === counter.count) return null;
  return { kind: 'slots', slot: counter.id, count: n };
};

/** An item's features with uses, for their pips on its line, and how many are left by the last save. */
export const itemUses = (item: ItemShown, uses: Record<string, { max: number; spent: number }>) => item.features
  .filter((f) => f.uses && uses[f.id])
  .map((f) => ({ feature: f, max: uses[f.id].max, spent: Math.min(uses[f.id].max, uses[f.id].spent) }));
