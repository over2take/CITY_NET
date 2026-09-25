import React, { useEffect, useState } from 'react';
import { TerminalWindow } from './TerminalWindow';
import {
  buildingTypeById, shelvedCatalogues, catalogueById, typeLabel, catalogueLabel, type ShopStock,
} from '../data/buildingTypes';
import {
  SETTLE_BALANCE, SETTLE_DEBT, REFUSAL_TEXT, buybackValue,
  type Settle, type RefusalReason,
} from '../data/shopRules';
import { ownedItems, sellableAt, BOOK_SYSTEM } from '../sheets/ownedItems';
import { uploadedIn, type UploadedEntry } from '../sheets/uploadedCatalogues';
import { placeUploaded, destinationOf } from '../sheets/shopPlacement';
import { columnsFor } from '../sheets/catalogueSchema';
import { EmptyShopSteps } from './EmptyShopSteps';
import { CWN_CYBERWARE, type CwnCyberPreset } from '../sheets/cwnCyberwarePresets';
import { CYBERWARE_FIELD, readRows, normaliseRow } from '../sheets/cyberwareRows';
import { CWN_WEAPONS, weaponToStashed, type CwnWeaponPreset } from '../sheets/cwnWeaponPresets';
import { readStash, firstFreeRow, stashedToCarried } from '../sheets/cwnWeaponStash';
import { carriedEnc, encLimits } from '../sheets/cwnEncumbrance';
import { CWN_PHARMACEUTICALS, pharmaByName, type Pharmaceutical } from '../sheets/cwnPharma';
import { CWN_ARMOR, acText, OBSOLETE_TECH, type ArmorPreset } from '../sheets/cwnArmorPresets';
import { CWN_GEAR, encText, ENC_FOOTNOTE, type GearItem } from '../sheets/cwnGearPresets';
import { CWN_ARMOR_MODS, CWN_WEAPON_MODS, type GearMod } from '../sheets/cwnGearMods';
import { VEHICLE_FITTINGS, type VehicleFitting } from '../sheets/vehicleFittings';
import { VEHICLE_WEAPONS, type VehicleWeapon } from '../sheets/vehicleWeapons';
import { VEHICLE_PRESETS, presetFields, type VehiclePreset } from '../sheets/vehiclePresets';
import {
  INVENTORY_FIELD, readInventory, writeInventory, blankItem, type InventoryItem,
} from '../sheets/inventory';
import { CWN_WEAPON_ROWS, CWN_VEHICLE_ROWS } from '../sheets/templates/cities_without_number';
import { usePlayerSheet } from '../hooks/usePlayerSheet';

// A shop: what the building carries, and a way to take a piece away with you.
//
// **BUY charges the buyer's bank account, and the thing only appears once it is paid for.**
// The money is the server's business and is not decided here: this window sends a
// catalogue and an id, and the price is looked up on the other side. It prints prices, but
// it does not get to name them.
//
// That makes a purchase a round trip. The sheet write for each shelf is registered when
// the BUY goes out and run when the receipt comes back, so nothing lands on a sheet that
// was not paid for. The gap it leaves is the opposite one - a disconnect between the
// charge and the write loses the item rather than the money - which is the safer way round
// but is still a gap, and undoing it would mean reversing every kind of sheet write.
//
// Buying is still not installing. A bought augment lands in the same "not yet placed on
// the body" list an import lands in, because buying is a transaction and installing is
// surgery with strain and a doctor's roll behind it.
//
// No stock is kept: a shop never runs out.
//
// Buying and selling are separate tabs rather than two buttons on a row, because they are
// not two halves of one list. Buying reads the shop's stock; selling reads what *you* are
// carrying, which will be more than augments - gear, weapons, a car. A SELL button beside
// a shop's catalogue would be offering to sell you something you may not own.
//
// Every price is the book's. A per-store markup is one of the open questions, and a street
// doc being cheaper than a corp clinic is very much the genre - but inventing a number
// here would bake in an answer nobody chose.
//
// **A shop shows one shelf at a time, with a tab per catalogue it carries.** Most
// storefronts in the rules trade in more than one table - a gun shop sells guns and the
// mods that go on them - and the shelves are long enough that stacking two of them in one
// scroll would bury both. When a shop carries only one, no tab row is drawn: a single tab
// is a label pretending to be a control.

interface Props {
  /** The building being shopped in, for the title. */
  name: string;
  /** Which building, so the server can check this shop really stocks what was asked for. */
  locationId: number;
  /**
   * What this shop pays for second-hand goods, already resolved from the location's own
   * rate and the global one. Shown here; worked out again by the server when it pays.
   */
  buybackPct: number;
  buildingType: string;
  /**
   * The game being played, which decides what is on the shelves and where it lands.
   *
   * Cities Without Number shops sell from the book, with its own rules for where things go
   * - a weapon arrives Stowed, a Tank carries its immunity note. Every other system's shops
   * carry only what the GM uploaded, placed into that system's own sheet rows.
   */
  system: string;
  /**
   * Whether the viewer runs the game. An admin opening an empty shop is told how to stock
   * it; a player is only told that the GM does.
   */
  isAdmin?: boolean;
  /** Opens SHOP_CATALOGUES, for the admin's stocking steps. */
  onOpenCatalogues?: () => void;
  /** The shopper's own sheet: where a bought piece lands, and what a sold one comes from. */
  socket: any;
  userName: string | null;
  onClose: () => void;
  /** The building's picture for the corner, as its own window shows it. */
  preview?: React.ReactNode;
}

type Tab = 'buy' | 'sell';

const mono = (size: number): React.CSSProperties => ({
  fontFamily: 'monospace', fontSize: size, letterSpacing: 1,
});

const cell: React.CSSProperties = {
  padding: '3px 6px', borderBottom: '1px solid var(--dark-green)', textAlign: 'left',
};

/** Prices are printed the same way on every shelf, whatever the shelf is selling. */
const credits = (n: number): string => (n === 0 ? 'N/A' : `${n.toLocaleString()}cr`);

/**
 * Sorting a shop's shelf.
 *
 * Three states per column, not two: a shelf has a natural order - the book's, which groups
 * pistols with pistols - and once you have sorted by price there is otherwise no way back
 * to it short of closing the window.
 *
 * The first click goes whichever way is useful for that kind of column. Names want A-Z;
 * prices, damage and magazines want the biggest first, because nobody opens a gun shop
 * wondering what the cheapest thing is.
 */
type SortDir = 'asc' | 'desc' | null;

interface SortState { key: string; dir: SortDir }

const nextSort = (state: SortState, key: string, firstDir: SortDir): SortState => {
  if (state.key !== key) return { key, dir: firstDir };
  if (state.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return { key: '', dir: null };
};

const sortArrow = (state: SortState, key: string): string =>
  state.key !== key || !state.dir ? '' : state.dir === 'asc' ? ' ▲' : ' ▼';

/**
 * Sort a copy, or hand back the original order untouched.
 *
 * A numeric column compares as numbers - "10/30" and "100/300" sort as strings in an
 * order nobody wants, and an empty cell is not a zero, so blanks are kept at the bottom
 * whichever way the column is pointing.
 */
function applySort<T>(
  rows: T[],
  state: SortState,
  columns: Record<string, ShelfColumn<T>>,
): T[] {
  const col = columns[state.key];
  if (!col || !state.dir) return rows;
  const dir = state.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    const xBlank = x === '' || x === null || x === undefined;
    const yBlank = y === '' || y === null || y === undefined;
    if (xBlank && yBlank) return 0;
    if (xBlank) return 1;
    if (yBlank) return -1;
    if (col.numeric) return ((Number(x) || 0) - (Number(y) || 0)) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
}

/**
 * One column on a shelf.
 *
 * `value` is what the column sorts on; `render` is what it draws, and defaults to the
 * value. Keeping both on one object is what stops a column sorting by one thing while
 * showing another - the bug that is invisible until somebody sorts by a column whose cell
 * was formatted separately.
 */
interface ShelfColumn<T> {
  label: string;
  value: (row: T) => string | number;
  render?: (row: T) => React.ReactNode;
  numeric?: boolean;
  first: SortDir;
  align?: 'right';
  /** Book prose: clip to this many pixels and put the whole thing on hover. */
  clip?: number;
}

/**
 * A catalogue as a shop can show it.
 *
 * Everything a shelf needs is on this object, so adding the next catalogue is writing one
 * of these rather than another branch in the render. Before this existed there were three
 * near-identical tables in this file, each with its own copy of the filter box, the
 * scroller, the sortable header and the BUY column; the fourth would have been a fourth
 * copy, and there are now eight.
 */
interface Shelf<T> {
  id: ShopStock;
  rows: T[];
  columns: Record<string, ShelfColumn<T>>;
  rowKey: (row: T) => string;
  /** Whether a row matches the filter box. Lowercased query, never empty. */
  matches: (row: T, q: string) => boolean;
  buy: (row: T) => void;
  /** A row that is on the shelf to be read rather than bought. */
  buyable?: (row: T) => boolean;
  /** Counts a BUY press this visit, so the button has visible effect. */
  countKey?: (row: T) => string;
  /** The amber line: what BUY actually does on this shelf. */
  notice: string;
  filterHint: string;
  /** An optional grey line under the filter, for something the table cannot say itself. */
  note?: React.ReactNode;
  /** Extra controls above the table - the weapon kind toggles are the only ones so far. */
  controls?: React.ReactNode;
}

export function ShopWindow({
  name, locationId, buildingType, system, buybackPct: pct, socket, userName, onClose,
  isAdmin = false, onOpenCatalogues, preview,
}: Props) {
  /** Whether this game's shops sell from the CWN book. Nobody else's do. */
  const book = system === BOOK_SYSTEM;
  const [pos, setPos] = useState({ x: 140, y: 90 });
  const [tab, setTab] = useState<Tab>('buy');
  const [filter, setFilter] = useState('');
  /** Narrows the sell list, the way the buy side's filter narrows a shelf. */
  const [sellFilter, setSellFilter] = useState('');
  /** How many of each line has been taken this visit, so a press has visible effect. */
  const [taken, setTaken] = useState<Record<string, number>>({});

  const { sheet, handleFieldChange, handleFieldsChange, encumbranceEnforced, overdraftAllowed } =
    usePlayerSheet(socket, userName);
  /**
   * The sheet as it is now, for a placement that runs when a receipt arrives.
   *
   * A purchase is placed after a round trip, and the render that sent it may be several
   * sheet changes old by then - two quick buys would otherwise both see the same free row.
   */
  const sheetNow = React.useRef(sheet);
  sheetNow.current = sheet;

  /**
   * What the buyer has, straight from the server's own broadcast.
   *
   * Not read off the sheet. The sheet carries cash as a linked field that mirrors this,
   * but a shop deciding whether somebody can afford something should be looking at the
   * account rather than at a copy of it.
   */
  const [account, setAccount] = useState<{ balance: number; debt: number } | null>(null);

  useEffect(() => {
    if (!socket || !userName) return;
    const onBank = (info: { username: string; balance: number; debt: number }) => {
      if (info && info.username === userName) {
        setAccount({ balance: Number(info.balance) || 0, debt: Number(info.debt) || 0 });
      }
    };
    socket.on('bankUpdate', onBank);
    socket.emit('requestBankBalance', { username: userName });
    return () => { socket.off?.('bankUpdate', onBank); };
  }, [socket, userName]);

  /**
   * A purchase the player has been asked to make a decision about.
   *
   * Held rather than acted on: the shop knows the balance, so it can see a shortfall
   * coming and ask how to cover it BEFORE spending anything. Nothing has been sent to the
   * server while this is set.
   */
  const [asking, setAsking] = useState<
    { catalogue: ShopStock; itemId: string; label: string; price: number } | null
  >(null);

  /**
   * What each shelf does with a row once it has actually been paid for.
   *
   * Registered when the BUY is sent and run when the receipt comes back, because the
   * sheet write and the charge are two different machines: money is the server's, and
   * placing a thing on a sheet - a weapon row, a vehicle slot, an unplaced augment - is
   * this window's and is tested here. Keyed by catalogue and id so two purchases in
   * flight cannot deliver each other's goods.
   */
  const pending = React.useRef(new Map<string, () => void>());
  const pendingKey = (catalogue: string, itemId: string) => `${catalogue}/${itemId}`;

  useEffect(() => {
    if (!socket) return;
    const onPurchase = (res: {
      ok: boolean; catalogue: string; itemId: string; reason?: RefusalReason;
      price?: number; settled?: Settle;
    }) => {
      const key = pendingKey(res.catalogue, res.itemId);
      const place = pending.current.get(key);
      pending.current.delete(key);
      if (!res.ok) {
        setRefused(REFUSAL_TEXT[res.reason as RefusalReason] ?? 'The purchase did not go through.');
        return;
      }
      setRefused(null);
      // Only now does the thing exist. Paid for, then owned.
      place?.();
      setTaken((t) => ({ ...t, [res.itemId]: (t[res.itemId] ?? 0) + 1 }));
    };
    socket.on('shopPurchase', onPurchase);
    return () => { socket.off?.('shopPurchase', onPurchase); };
  }, [socket]);
  /** Why the last purchase did not happen, cleared as soon as anything else does. */
  const [refused, setRefused] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: '', dir: null });
  /**
   * Which kinds of weapon to show.
   *
   * Split on the SKILL rather than on the book's table, because the book's melee table
   * also holds grenades and a thrown grenade is not a melee weapon. Shoot is ranged;
   * Stab and Punch are not.
   *
   * One on narrows to it. Both on, or both off, means no opinion - which is the same
   * thing, so it shows everything either way rather than an empty shelf.
   */
  const [kinds, setKinds] = useState({ ranged: false, melee: false });

  const type = buildingTypeById(buildingType);
  const catalogues = shelvedCatalogues(buildingType);
  /** The tab somebody pressed, if they have pressed one. Not necessarily the open shelf. */
  const [picked, setPicked] = useState<ShopStock | null>(null);

  /**
   * Which shelf is open: the one picked, or the first this shop carries.
   *
   * Worked out during the render rather than kept in step by an effect. The effect version
   * was wrong in a way that showed: changing which building the window is pointed at
   * rendered once with the PREVIOUS shop's shelf - a general store showing fourteen lines
   * of armor, header and all - and only corrected on the following tick.
   *
   * Deriving it also covers the shop being retyped underneath an open window for free,
   * rather than as a second case to remember.
   */
  const shelfId: ShopStock | null =
    picked && catalogues.includes(picked) ? picked : catalogues[0] ?? null;

  /**
   * Put one of something into the inventory, stacking onto a row already there.
   *
   * `same` decides what counts as the same thing, because that differs: a drug matches
   * through its alias table, everything else matches on its name. Stash rows are never
   * stacked onto - a box of stims in a locker is yours, but it is not what you just walked
   * out of the shop holding.
   */
  const addToInventory = (
    label: string, enc: string, same: (item: InventoryItem) => boolean,
  ) => {
    if (!sheet) return;
    const data = (sheet.data ?? {}) as Record<string, unknown>;
    const items = readInventory(data);
    const i = items.findIndex((item) => item.carry !== 'stash' && same(item));
    const next = i >= 0
      ? items.map((item, n) => (n === i ? { ...item, qty: item.qty + 1 } : item))
      : [...items, { ...blankItem(), name: label, qty: 1, enc }];
    setRefused(null);
    handleFieldChange?.(INVENTORY_FIELD, writeInventory(next));
  };

  /**
   * Send a purchase, and remember what to do when it is paid for.
   *
   * `settle` is only sent when the player has been asked and answered. The server checks
   * everything again - the price, the shop, the house rule, the balance - so this is a
   * courtesy rather than a gate: it exists so the common refusal happens without a round
   * trip and so a shortfall is a question rather than a rejection.
   */
  const send = (
    catalogue: ShopStock, itemId: string, place: () => void, settle?: Settle,
  ) => {
    pending.current.set(pendingKey(catalogue, itemId), place);
    setRefused(null);
    socket?.emit('buyFromShop', { locationId, catalogue, itemId, settle });
  };

  /**
   * Try to buy one of something.
   *
   * The shelf hands over what to write onto the sheet if this succeeds; nothing is
   * written here. Three outcomes: it is affordable and goes straight out, it is not and
   * the house says no, or it is not and the player gets asked how to cover it.
   */
  const purchase = (
    catalogue: ShopStock, itemId: string, label: string, price: number, place: () => void,
  ) => {
    if (!sheet) { setRefused('No character sheet loaded.'); return; }
    const balance = account?.balance ?? 0;
    if (price <= balance) return send(catalogue, itemId, place);
    if (!overdraftAllowed) {
      setRefused(
        `Not enough credits — ${label} is ${credits(price)} and you have ${credits(balance)}.`,
      );
      return;
    }
    // Asked rather than assumed. Debt and a negative balance are different problems.
    setAsking({ catalogue, itemId, label, price });
    pending.current.set(pendingKey(catalogue, itemId), place);
  };

  // ─────────────────────────────────────────────────────────────── selling ───

  /**
   * What this character owns that this shop would take.
   *
   * Derived from the sheet every render rather than kept anywhere. The server derives the
   * same list from the same sheet when it pays, which is what stops the two disagreeing -
   * see the note at the top of ownedItems.ts.
   */
  const owned = sheet ? ownedItems(sheet.data as Record<string, unknown>, system) : [];
  const sellable = sellableAt(owned, catalogues);
  const sellQuery = sellFilter.trim().toLowerCase();
  /** The sell list as shown: narrowed by its filter. Totals still count the whole list. */
  const shownSellable = sellQuery ? sellable.filter((l) => l.label.toLowerCase().includes(sellQuery)) : sellable;

  /** How many of each line are on the sell list, by line key. */
  const [basket, setBasket] = useState<Record<string, number>>({});
  /** True once SELL is pressed, until it is confirmed or backed out of. */
  const [confirming, setConfirming] = useState(false);
  /** What the last sale came to, so the payout and any warning stay on screen. */
  const [receipt, setReceipt] = useState<{ payout: number; fromBody: number } | null>(null);

  /**
   * Add or remove one, never past what they own.
   *
   * Clamped here as well as on the server because the list is the thing a player reasons
   * about: a basket that says three when they own two is a question they should never be
   * asked to answer.
   */
  const stage = (key: string, delta: number) => {
    const line = sellable.find((l) => l.key === key);
    if (!line) return;
    setReceipt(null);
    setBasket((b) => {
      const next = Math.max(0, Math.min(line.qty, (b[key] ?? 0) + delta));
      const out = { ...b, [key]: next };
      if (next === 0) delete out[key];
      return out;
    });
  };

  /** The sell list as lines, in the order the shelf shows them. */
  const staging = sellable
    .filter((l) => (basket[l.key] ?? 0) > 0)
    .map((l) => ({ line: l, qty: basket[l.key], label: l.label }));

  const basketTotal = staging.reduce(
    (sum, s) => sum + buybackValue(s.line.unitPrice, pct) * s.qty, 0,
  );

  /**
   * How much of the sell list is chrome currently in somebody's body.
   *
   * Counted from the places a line sits rather than from the line itself, because a
   * character can own two of a piece with one installed and one still boxed - and only
   * one of those needs a surgeon.
   */
  const stagedFromBody = staging.reduce((n, s) => {
    let left = s.qty;
    let installed = 0;
    for (const at of s.line.at) {
      if (left <= 0) break;
      const take = Math.min(left, at.qty);
      if (at.placed) installed += take;
      left -= take;
    }
    return n + installed;
  }, 0);

  /**
   * Take the implants back off the sell list, and keep the rest of it.
   *
   * The whole point of the warning is that the player may not have realised, and the only
   * answer available until now was to cancel the lot and start again. Each line is trimmed
   * to however many of that thing are NOT in a body - which works because boxed pieces are
   * listed before installed ones, so what survives is exactly the ones nobody has to be
   * opened up for.
   */
  const keepImplants = () => {
    setConfirming(false);
    setBasket((b) => {
      const next: Record<string, number> = {};
      for (const s of staging) {
        const loose = s.line.at.reduce((n, at) => n + (at.placed ? 0 : at.qty), 0);
        const keep = Math.min(s.qty, loose);
        if (keep > 0) next[s.line.key] = keep;
      }
      return next;
    });
  };

  const commitSale = () => {
    if (!staging.length) return;
    setConfirming(false);
    socket?.emit('sellToShop', {
      locationId,
      items: staging.map((s) => ({
        catalogue: s.line.catalogue,
        id: s.line.id,
        // Carried for the unpriced lines, which have no catalogue or id to be found by.
        label: s.line.label,
        qty: s.qty,
      })),
    });
  };

  useEffect(() => {
    if (!socket) return;
    const onSale = (res: { ok: boolean; reason?: RefusalReason; payout?: number; fromBody?: number }) => {
      if (!res.ok) {
        setRefused(REFUSAL_TEXT[res.reason as RefusalReason] ?? 'The sale did not go through.');
        return;
      }
      // The sheet has already changed on the server; the list here follows from it as
      // soon as the refreshed sheet arrives, so the basket just empties.
      setRefused(null);
      setBasket({});
      setReceipt({ payout: Number(res.payout) || 0, fromBody: Number(res.fromBody) || 0 });
    };
    socket.on('shopSale', onSale);
    return () => { socket.off?.('shopSale', onSale); };
  }, [socket]);

  /** The player answered the shortfall question. Send it with their choice. */
  const answerAsking = (settle: Settle) => {
    if (!asking) return;
    const { catalogue, itemId } = asking;
    const place = pending.current.get(pendingKey(catalogue, itemId));
    setAsking(null);
    if (place) send(catalogue, itemId, place, settle);
  };

  // ---------------------------------------------------------------- weapons

  /**
   * How many of a weapon the character already has, carried or stashed.
   *
   * Counted off the sheet rather than off what was clicked this visit, so deleting one
   * from the sheet is reflected on the shelf. The shop is showing what you own, not what
   * you have pressed.
   */
  const ownedCount = (weaponName: string): number => {
    if (!sheet) return 0;
    const data = sheet.data as Record<string, unknown>;
    let n = readStash(data).filter((x) => x.name === weaponName).length;
    for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) {
      if (String(data[`weapon${i}_name`] ?? '').trim() === weaponName) n += 1;
    }
    return n;
  };

  /**
   * Why this weapon cannot be bought, or null.
   *
   * Two limits, and the second only where the table asked for it. A shop that took the
   * money and quietly dropped the gun would be worse than one that says no.
   */
  const refuseReason = (w: CwnWeaponPreset): string | null => {
    if (!sheet) return 'No character sheet loaded.';
    const data = sheet.data as Record<string, unknown>;
    if (firstFreeRow(data, CWN_WEAPON_ROWS) === null) {
      return `No free weapon slot — all ${CWN_WEAPON_ROWS} are full. Stash one first.`;
    }
    if (encumbranceEnforced) {
      // It arrives Stowed, so it is the Stowed allowance it has to fit inside.
      const { stowed: used } = carriedEnc(data, CWN_WEAPON_ROWS);
      const max = encLimits(data).stowed;
      const cost = Number(w.enc) || 0;
      if (used + cost > max) {
        return `Too much to carry — ${w.name} is ${cost} Enc and you have ${Math.max(0, max - used)} of ${max} Stowed free.`;
      }
    }
    return null;
  };

  /**
   * Bought weapons go into a carried row, Stowed.
   *
   * You are walking out of the shop with it. Stowed rather than Readied because it is in
   * a bag until you decide otherwise, which is also the more forgiving of the two limits.
   */
  const buyWeapon = (w: CwnWeaponPreset) => {
    // Checked before the money moves: a full weapon rack is a reason not to sell, not
    // something to discover after the account has been debited.
    const why = refuseReason(w);
    if (why) { setRefused(why); return; }
    purchase('weapons', w.id, w.name, w.price, () => {
      const data = (sheet!.data ?? {}) as Record<string, unknown>;
      const row = firstFreeRow(data, CWN_WEAPON_ROWS);
      if (row === null) return;
      handleFieldsChange?.(stashedToCarried(weaponToStashed(w, name || ''), row));
    });
  };

  const weaponShelf: Shelf<CwnWeaponPreset> = {
    id: 'weapons',
    rows: CWN_WEAPONS,
    rowKey: (w) => w.id,
    columns: {
      name: { label: 'NAME', value: (w) => w.name, first: 'asc' },
      dmg: { label: 'DMG', value: (w) => w.dmg, render: (w) => w.dmg || '—', first: 'asc' },
      // The first number is what matters: 10/80 is a short-range weapon whatever its long is.
      range: {
        label: 'RANGE', value: (w) => Number(w.range.split('/')[0]) || 0, numeric: true,
        first: 'desc', render: (w) => w.range || '—',
      },
      mag: {
        label: 'MAG', value: (w) => Number(w.mag) || 0, numeric: true, first: 'desc',
        align: 'right', render: (w) => w.mag || '—',
      },
      enc: { label: 'ENC', value: (w) => Number(w.enc) || 0, numeric: true, first: 'asc', align: 'right' },
      price: { label: 'PRICE', value: (w) => w.price, numeric: true, first: 'desc', align: 'right', render: (w) => credits(w.price) },
      note: { label: 'NOTE', value: (w) => w.note, first: 'asc' },
      // Its own column, because hanging it off the BUY button moved the button every time
      // somebody bought something.
      owned: {
        label: 'OWNED', value: (w) => ownedCount(w.name), numeric: true, first: 'desc',
        align: 'right', render: (w) => (ownedCount(w.name) > 0 ? `x${ownedCount(w.name)}` : ''),
      },
    },
    matches: (w, q) =>
      w.name.toLowerCase().includes(q) || w.note.toLowerCase().includes(q)
      || w.category.includes(q),
    buy: buyWeapon,
    notice: 'GOES INTO A WEAPON SLOT, STOWED',
    filterHint: 'Filter by name, note or kind',
    // RANGE and MAG are shown and not bought: the sheet has no field for either, and
    // picking a rifle without knowing its range is not a choice. Said here rather than
    // discovered when they fail to appear.
    note: 'Range and magazine are printed for reference — the sheet has nowhere to keep them yet.',
    controls: (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 6 }}>
        {(['ranged', 'melee'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`utility-btn ${kinds[k] ? 'active' : ''}`}
            aria-pressed={kinds[k]}
            onClick={() => setKinds((s) => ({ ...s, [k]: !s[k] }))}
            style={{ ...mono(12), padding: '2px 10px', letterSpacing: 1 }}
          >{k.toUpperCase()}</button>
        ))}
      </div>
    ),
  };

  // ---------------------------------------------------------- pharmaceuticals

  /**
   * How many doses of a drug the character owns.
   *
   * Read off the inventory, stash included: the shelf is showing what you own, and a box
   * of stims in a locker is still yours. That is deliberately wider than what the sheet
   * will let you inject, which is the carried rows only.
   */
  const ownedDoses = (drugId: string): number => {
    if (!sheet) return 0;
    return readInventory(sheet.data as Record<string, unknown>)
      .filter((item) => pharmaByName(item.name)?.id === drugId)
      .reduce((n, item) => n + item.qty, 0);
  };

  /**
   * A dose goes into the inventory, because that is what a dose is.
   *
   * No refusal here, unlike the gun shop. That one had to say no because weapon slots are
   * finite; drugs are pocket-sized, the book's own rule is that any reasonable number of
   * such things can be carried, and there is nothing for a purchase to fail against.
   */
  const pharmaShelf: Shelf<Pharmaceutical> = {
    id: 'pharmaceuticals',
    rows: CWN_PHARMACEUTICALS,
    rowKey: (p) => p.id,
    columns: {
      name: {
        label: 'NAME', value: (p) => p.label, first: 'asc',
        render: (p) => (
          <>
            {p.label}
            {/* The book's @: you cannot simply walk in and buy this one. */}
            {p.rare && <span style={{ color: 'var(--warning)' }} title="Needs a Contact to obtain"> @</span>}
            {/* Four of these are poisons. Worth knowing at the counter rather than after
                you have swallowed one yourself. */}
            {p.hostile && (
              <span style={{ color: 'var(--danger)' }} title="Hostile — administered to someone else"> ☠</span>
            )}
          </>
        ),
      },
      price: { label: 'PRICE', value: (p) => p.cost, numeric: true, first: 'desc', align: 'right', render: (p) => credits(p.cost) },
      // "None" is a real answer and a useful one to sort to the top - it means anyone can
      // administer it. Sorted as -1 so it lands below Heal-0 rather than being read as blank.
      heal: {
        label: 'HEAL', value: (p) => (p.heal === null ? -1 : p.heal), numeric: true,
        first: 'asc', align: 'right', render: (p) => (p.heal === null ? '—' : `Heal-${p.heal}`),
      },
      lasts: {
        label: 'LASTS', value: (p) => p.duration, first: 'asc',
        render: (p) => (p.duration === 'instant' ? '—' : p.duration),
      },
      // Clipped to one line with the whole thing on hover. These are the book's paragraphs,
      // not the one-liners the cyberware shelf carries - Reset's runs to four hundred
      // characters, and a row that tall makes the shelf unreadable.
      effect: { label: 'EFFECT', value: (p) => p.effect, first: 'asc', clip: 340 },
      owned: {
        label: 'OWNED', value: (p) => ownedDoses(p.id), numeric: true, first: 'desc',
        align: 'right', render: (p) => (ownedDoses(p.id) > 0 ? `x${ownedDoses(p.id)}` : ''),
      },
    },
    matches: (p, q) => p.label.toLowerCase().includes(q) || p.effect.toLowerCase().includes(q),
    buy: (p) => purchase('pharmaceuticals', p.id, p.label, p.cost, () => {
      addToInventory(p.label, '', (item) => pharmaByName(item.name)?.id === p.id);
    }),
    notice: 'A DOSE GOES INTO YOUR INVENTORY, STOWED',
    filterHint: 'Filter by name or effect',
    // Said on the shelf, because the table sells sixteen and the sheet rolls with three.
    // A player choosing Psycho should know what they are getting.
    note: 'Boneshaker, Olympus and Avalanche change a number the app rolls with. The rest '
      + 'carry their text for the table to rule on.',
  };

  // -------------------------------------------------------------- cyberware

  const cyberShelf: Shelf<CwnCyberPreset> = {
    id: 'cyberware',
    rows: CWN_CYBERWARE,
    rowKey: (c) => c.id,
    columns: {
      name: { label: 'NAME', value: (c) => c.name, first: 'asc' },
      type: { label: 'TYPE', value: (c) => c.type, first: 'asc', render: (c) => c.type.toUpperCase() },
      strain: { label: 'STRAIN', value: (c) => c.strain, numeric: true, first: 'asc', align: 'right' },
      price: { label: 'PRICE', value: (c) => c.price, numeric: true, first: 'desc', align: 'right', render: (c) => credits(c.price) },
      effect: { label: 'EFFECT', value: (c) => c.effect, first: 'asc' },
    },
    matches: (c, q) => c.name.toLowerCase().includes(q) || c.effect.toLowerCase().includes(q),
    countKey: (c) => c.id,
    buy: (item) => purchase('cyberware', item.id, item.name, item.price, () => {
      if (!sheet) return;
      // Unplaced: owning a piece and having it in your body are two different facts, and
      // the diagram is the only thing that decides the second.
      const row = normaliseRow({
        name: item.name,
        type: item.type,
        hl: item.strain,
        cost: item.price,
        conc: item.conc,
        data: item.effect,
        mods: (item.mods ?? []).map((m) => ({ ...m })),
        equipped: true,
        placed: false,
      });
      handleFieldChange(CYBERWARE_FIELD, [...readRows(sheet.data), row] as never);
    }),
    notice: 'GOES INTO YOUR AUGMENTS, UNPLACED — BUYING IS NOT SURGERY',
    filterHint: 'Filter by name or effect',
  };

  // ------------------------------------------------------------------ armor

  /** How many of a named thing the inventory is holding, stash included. */
  const ownedNamed = (label: string): number => {
    if (!sheet) return 0;
    return readInventory(sheet.data as Record<string, unknown>)
      .filter((item) => item.name === label)
      .reduce((n, item) => n + item.qty, 0);
  };

  const GROUP_LABEL: Record<ArmorPreset['group'], string> = {
    civilian: 'CIVILIAN', suit: 'SUIT', accessory: 'ACCESSORY',
  };

  /**
   * Armor goes into the inventory rather than onto the AC fields.
   *
   * The same split the ripperdoc uses: buying a thing and wearing it are two decisions,
   * you can only wear one set at a time, and the sheet's armor fields are the player's to
   * set. A shop that overwrote your AC because you bought a spare jacket would be wrong.
   */
  const armorShelf: Shelf<ArmorPreset> = {
    id: 'armor',
    rows: CWN_ARMOR,
    rowKey: (a) => a.id,
    columns: {
      name: {
        label: 'NAME', value: (a) => a.label, first: 'asc',
        render: (a) => (
          <>
            {a.label}
            {/* The book's @: needs a Contact or some other special opportunity. */}
            {a.rare && <span style={{ color: 'var(--warning)' }} title="Needs a Contact to purchase"> @</span>}
            {/* The book's H: -1 to every Sneak and Exert check, and they stack. */}
            {a.heavy && <span style={{ color: 'var(--danger)' }} title="Heavy — -1 to Sneak and Exert"> H</span>}
          </>
        ),
      },
      group: { label: 'KIND', value: (a) => a.group, first: 'asc', render: (a) => GROUP_LABEL[a.group] },
      // Accessories add rather than set, so "+2" and "12" are different kinds of number
      // and the shelf has to say which it is printing.
      rac: { label: 'R.AC', value: (a) => a.rangedAc, numeric: true, first: 'desc', align: 'right', render: (a) => acText(a, 'ranged') },
      mac: { label: 'M.AC', value: (a) => a.meleeAc, numeric: true, first: 'desc', align: 'right', render: (a) => acText(a, 'melee') },
      soak: { label: 'SOAK', value: (a) => a.soak, numeric: true, first: 'desc', align: 'right' },
      enc: { label: 'ENC', value: (a) => a.enc, numeric: true, first: 'asc', align: 'right' },
      tt: {
        label: 'TT', value: (a) => a.traumaTargetMod, numeric: true, first: 'desc', align: 'right',
        render: (a) => (a.traumaTargetMod ? `+${a.traumaTargetMod}` : '—'),
      },
      subtle: {
        label: 'SUBTLE?', value: (a) => (a.subtle ? 'Subtle' : 'Obvious'), first: 'asc',
        render: (a) => (
          <span style={{ color: a.subtle ? 'var(--cyan)' : 'var(--grid-section)' }}>
            {a.subtle ? 'SUBTLE' : 'OBVIOUS'}
          </span>
        ),
      },
      price: { label: 'PRICE', value: (a) => a.cost, numeric: true, first: 'desc', align: 'right', render: (a) => credits(a.cost) },
      owned: {
        label: 'OWNED', value: (a) => ownedNamed(a.label), numeric: true, first: 'desc',
        align: 'right', render: (a) => (ownedNamed(a.label) > 0 ? `x${ownedNamed(a.label)}` : ''),
      },
    },
    matches: (a, q) => a.label.toLowerCase().includes(q) || a.group.includes(q),
    buy: (a) => purchase('armor', a.id, a.label, a.cost, () => {
      addToInventory(a.label, String(a.enc), (item) => item.name === a.label);
    }),
    notice: 'GOES INTO YOUR INVENTORY, STOWED — IT DOES NOT SET YOUR AC',
    filterHint: 'Filter by name or kind',
    note: (
      <>
        Buying does not set your AC — armor goes into your inventory and the sheet&apos;s
        armor fields stay yours. NS accessories cannot be added to suit armor.
        {' '}<span style={{ color: 'var(--warning)' }}>{OBSOLETE_TECH.label}:</span>{' '}
        {OBSOLETE_TECH.effect} Not on the shelf, because the penalties are rolled after the
        sale.
      </>
    ),
  };

  // ------------------------------------------------------------------- gear

  const gearShelf: Shelf<GearItem> = {
    id: 'gear',
    rows: CWN_GEAR,
    rowKey: (g) => g.id,
    columns: {
      name: { label: 'NAME', value: (g) => g.label, first: 'asc' },
      price: { label: 'PRICE', value: (g) => g.cost, numeric: true, first: 'desc', align: 'right', render: (g) => credits(g.cost) },
      enc: { label: 'ENC', value: (g) => g.enc, numeric: true, first: 'asc', align: 'right', render: encText },
      note: { label: 'NOTE', value: (g) => g.note, first: 'asc', clip: 380 },
      owned: {
        label: 'OWNED', value: (g) => ownedNamed(g.label), numeric: true, first: 'desc',
        align: 'right', render: (g) => (ownedNamed(g.label) > 0 ? `x${ownedNamed(g.label)}` : ''),
      },
    },
    matches: (g, q) => g.label.toLowerCase().includes(q) || g.note.toLowerCase().includes(q),
    buy: (g) => purchase('gear', g.id, g.label, g.cost, () => {
      // The symbol rows carry no Encumbrance the sheet can add up, so they go in blank
      // rather than as a zero somebody would later mistake for a measurement.
      addToInventory(g.label, g.encNote ? '' : String(g.enc), (item) => item.name === g.label);
    }),
    notice: 'GOES INTO YOUR INVENTORY, STOWED',
    filterHint: 'Filter by name or what it does',
    note: ENC_FOOTNOTE,
  };

  // ------------------------------------------------------------------- mods

  /**
   * The two mod tables, p58 and p59.
   *
   * One shelf builder for both: they are one page in the book split in half, they share an
   * interface, and the only thing that differs is which list and which shop.
   *
   * A bought mod goes into the inventory as a part. Fitting it is a Fix check at a bench,
   * not something a counter does, and the sheet already owns where a fitted mod lives.
   */
  const modShelf = (id: ShopStock, rows: GearMod[], fits: string): Shelf<GearMod> => ({
    id,
    rows,
    rowKey: (m) => m.id,
    columns: {
      name: { label: 'NAME', value: (m) => m.label, first: 'asc' },
      skill: { label: 'SKILL', value: (m) => m.skill, first: 'asc' },
      price: { label: 'PRICE', value: (m) => m.cost, numeric: true, first: 'desc', align: 'right', render: (m) => credits(m.cost) },
      // Tech 0 is "anyone can source the parts", which is worth showing as a word rather
      // than as a zero that reads like a missing value.
      tech: {
        label: 'TECH', value: (m) => m.tech, numeric: true, first: 'asc', align: 'right',
        render: (m) => (m.tech ? `TL${m.tech}` : '—'),
      },
      effect: { label: 'EFFECT', value: (m) => m.effect, first: 'asc', clip: 360 },
      requires: {
        label: 'FITS', value: (m) => m.requires ?? '', first: 'asc',
        render: (m) => (
          <span style={{ color: 'var(--grid-section)' }}>{m.requires ?? 'any'}</span>
        ),
      },
      owned: {
        label: 'OWNED', value: (m) => ownedNamed(m.label), numeric: true, first: 'desc',
        align: 'right', render: (m) => (ownedNamed(m.label) > 0 ? `x${ownedNamed(m.label)}` : ''),
      },
    },
    matches: (m, q) => m.label.toLowerCase().includes(q) || m.effect.toLowerCase().includes(q),
    buy: (m) => purchase(id, m.id, m.label, m.cost, () => {
      addToInventory(m.label, '', (item) => item.name === m.label);
    }),
    notice: 'GOES INTO YOUR INVENTORY, UNFITTED',
    filterHint: 'Filter by name or effect',
    note: `Buying a mod is not fitting it — that is a ${fits} check at a bench, and the `
      + 'sheet is where a fitted mod goes. A given mod can only be added once to any one item.',
  });

  // --------------------------------------------------------------- vehicles

  /**
   * The first vehicle slot with nothing in it, or null when all six are full.
   *
   * A slot is free when it has no name. The sheet writes the preset's label into the name
   * on selection, so "has a name" and "has a vehicle" are the same question.
   */
  const firstFreeVehicle = (data: Record<string, unknown>): number | null => {
    for (let i = 1; i <= CWN_VEHICLE_ROWS; i += 1) {
      if (!String(data[`vehicle${i}_name`] ?? '').trim()) return i;
    }
    return null;
  };

  /** How many of a preset the character already has parked, by type rather than by name. */
  const ownedVehicles = (preset: VehiclePreset): number => {
    if (!sheet) return 0;
    const data = sheet.data as Record<string, unknown>;
    let n = 0;
    for (let i = 1; i <= CWN_VEHICLE_ROWS; i += 1) {
      if (String(data[`vehicle${i}_type`] ?? '') === preset.id) n += 1;
    }
    return n;
  };

  /**
   * A bought vehicle fills a vehicle slot on the sheet.
   *
   * This shelf was left out of the first pass on the grounds that a vehicle is its own
   * sheet rather than a row - which was wrong. It is the same move the gun shop already
   * makes: find the first free numbered slot and write the block into it. `presetFields`
   * is the sheet's own function for exactly this, the one the TYPE dropdown calls, so the
   * shop cannot fill a vehicle in differently from the sheet.
   *
   * The * and ** vehicles carry an immunity instead of an Armour Rating, and the note is
   * where that rule lives. A Tank bought without it would silently lose the line that says
   * small arms cannot hurt it.
   */
  const buyVehicle = (preset: VehiclePreset) => {
    if (!sheet) { setRefused('No character sheet loaded.'); return; }
    // Checked before the money moves, like the weapon rack.
    if (firstFreeVehicle((sheet.data ?? {}) as Record<string, unknown>) === null) {
      setRefused(
        `No free vehicle slot — all ${CWN_VEHICLE_ROWS} are full. Clear one on the sheet first.`,
      );
      return;
    }
    purchase('vehicles', preset.id, preset.label, preset.cost, () => {
      const data = (sheet.data ?? {}) as Record<string, unknown>;
      const slot = firstFreeVehicle(data);
      if (slot === null) return;
      const fields = presetFields(slot, preset);
      if (preset.note) fields[`vehicle${slot}_notes`] = preset.note;
      handleFieldsChange?.(fields);
    });
  };

  const vehicleShelf: Shelf<VehiclePreset> = {
    id: 'vehicles',
    rows: VEHICLE_PRESETS,
    rowKey: (v) => v.id,
    columns: {
      name: { label: 'NAME', value: (v) => v.label, first: 'asc' },
      price: { label: 'PRICE', value: (v) => v.cost, numeric: true, first: 'desc', align: 'right', render: (v) => credits(v.cost) },
      spd: { label: 'SPD', value: (v) => v.spd, numeric: true, first: 'desc', align: 'right' },
      // Null armor is an immunity rather than a zero - the note column carries the rule.
      armor: {
        label: 'AR', value: (v) => (v.armor === null ? '' : v.armor), numeric: true,
        first: 'desc', align: 'right', render: (v) => (v.armor === null ? '*' : v.armor),
      },
      ac: { label: 'AC', value: (v) => v.ac, numeric: true, first: 'desc', align: 'right' },
      hp: { label: 'HP', value: (v) => v.hp, numeric: true, first: 'desc', align: 'right' },
      tt: { label: 'TT', value: (v) => v.tt, numeric: true, first: 'desc', align: 'right' },
      crew: { label: 'CREW', value: (v) => v.crew, numeric: true, first: 'desc', align: 'right' },
      // Hardpoints are not gunners: a Tank is crew 3 with 3 mounts and can never drive and
      // man every gun at once. Worth seeing before you buy one.
      hrdpt: { label: 'HRD', value: (v) => v.hrdpt, numeric: true, first: 'desc', align: 'right' },
      // What the hull has to spend on the fittings and mounts sold on the next tab along.
      pow: { label: 'POW', value: (v) => v.pow, numeric: true, first: 'desc', align: 'right' },
      mass: { label: 'MASS', value: (v) => v.mass, numeric: true, first: 'desc', align: 'right' },
      size: { label: 'SIZE', value: (v) => v.size, first: 'asc' },
      owned: {
        label: 'OWNED', value: ownedVehicles, numeric: true, first: 'desc',
        align: 'right', render: (v) => (ownedVehicles(v) > 0 ? `x${ownedVehicles(v)}` : ''),
      },
    },
    matches: (v, q) => v.label.toLowerCase().includes(q) || v.art.includes(q) || v.size.toLowerCase() === q,
    buy: buyVehicle,
    notice: `FILLS ONE OF YOUR ${CWN_VEHICLE_ROWS} VEHICLE SLOTS`,
    filterHint: 'Filter by name, kind or size',
    note: 'AR shown as * is an immunity rather than a rating — the rule goes into that '
      + "vehicle's notes when you buy it. POW and MASS are the budget its fittings and "
      + 'mounts spend, and HRD is how many Heavy weapons it can mount, not how many it can crew.',
  };

  const fittingShelf: Shelf<VehicleFitting> = {
    id: 'vehicle_fittings',
    rows: VEHICLE_FITTINGS,
    rowKey: (f) => f.id,
    columns: {
      name: { label: 'NAME', value: (f) => f.label, first: 'asc' },
      price: { label: 'PRICE', value: (f) => f.cost, numeric: true, first: 'desc', align: 'right', render: (f) => credits(f.cost) },
      power: { label: 'POW', value: (f) => f.power, numeric: true, first: 'asc', align: 'right' },
      mass: { label: 'MASS', value: (f) => f.mass, numeric: true, first: 'asc', align: 'right' },
      size: { label: 'MIN', value: (f) => f.minSize, first: 'asc' },
      effect: { label: 'EFFECT', value: (f) => f.effect, first: 'asc', clip: 360 },
      owned: {
        label: 'OWNED', value: (f) => ownedNamed(f.label), numeric: true, first: 'desc',
        align: 'right', render: (f) => (ownedNamed(f.label) > 0 ? `x${ownedNamed(f.label)}` : ''),
      },
    },
    matches: (f, q) => f.label.toLowerCase().includes(q) || f.effect.toLowerCase().includes(q),
    buy: (f) => purchase('vehicle_fittings', f.id, f.label, f.cost, () => {
      addToInventory(f.label, '', (item) => item.name === f.label);
    }),
    notice: 'GOES INTO YOUR INVENTORY, UNFITTED',
    filterHint: 'Filter by name or effect',
    note: 'POW and MASS are what the fitting costs the vehicle once installed, and MIN is '
      + 'the smallest hull that can take it. The vehicle sheet is where it gets fitted.',
  };

  const vehicleWeaponShelf: Shelf<VehicleWeapon> = {
    id: 'vehicle_weapons',
    rows: VEHICLE_WEAPONS,
    rowKey: (w) => w.id,
    columns: {
      name: { label: 'NAME', value: (w) => w.label, first: 'asc' },
      dmg: { label: 'DMG', value: (w) => w.dmg ?? '', first: 'asc', render: (w) => w.dmg || '—' },
      trauma: { label: 'TRAUMA', value: (w) => w.trauma ?? '', first: 'asc', render: (w) => w.trauma || '—' },
      range: { label: 'RANGE', value: (w) => w.range ?? '', first: 'asc', render: (w) => w.range || '—' },
      mag: {
        label: 'MAG', value: (w) => w.mag ?? '', numeric: true, first: 'desc', align: 'right',
        render: (w) => w.mag ?? '—',
      },
      // A hardpoint weapon with no price is one the book does not sell separately, which
      // credits() already prints as N/A rather than as free.
      price: {
        label: 'PRICE', value: (w) => w.cost ?? '', numeric: true, first: 'desc',
        align: 'right', render: (w) => (w.cost === undefined ? '—' : credits(w.cost)),
      },
      power: { label: 'POW', value: (w) => w.power, numeric: true, first: 'asc', align: 'right' },
      mass: { label: 'MASS', value: (w) => w.mass, numeric: true, first: 'asc', align: 'right' },
      size: { label: 'MIN', value: (w) => w.minSize, first: 'asc' },
      owned: {
        label: 'OWNED', value: (w) => ownedNamed(w.label), numeric: true, first: 'desc',
        align: 'right', render: (w) => (ownedNamed(w.label) > 0 ? `x${ownedNamed(w.label)}` : ''),
      },
    },
    matches: (w, q) => w.label.toLowerCase().includes(q) || (w.note ?? '').toLowerCase().includes(q),
    // A weapon the book prices as part of a hull rather than over a counter.
    buyable: (w) => w.cost !== undefined,
    buy: (w) => purchase('vehicle_weapons', w.id, w.label, w.cost ?? 0, () => {
      addToInventory(w.label, '', (item) => item.name === w.label);
    }),
    notice: 'GOES INTO YOUR INVENTORY, UNMOUNTED',
    filterHint: 'Filter by name or note',
    note: 'A line with no price is not sold separately — it comes with the hull. Mounting '
      + 'happens on the vehicle sheet, against its hardpoints and power.',
  };

  // ------------------------------------------------------- any other system

  /**
   * Write a placement onto the sheet.
   *
   * One field goes through the single-field save, which is the one that takes an array -
   * the cyberware table is one. Several go as one batch, because a dozen single saves fired
   * together race and all but the last are lost.
   */
  const applyPatch = (patch: Record<string, unknown>) => {
    const entries = Object.entries(patch);
    if (entries.length === 1) handleFieldChange?.(entries[0][0], entries[0][1] as never);
    else if (entries.length) handleFieldsChange?.(patch as Record<string, string | number>);
  };

  /**
   * A shelf of whatever the GM uploaded, for a system with no book on this side.
   *
   * The columns are the ones the catalogue file has for this system, so the shelf shows
   * exactly what the GM typed in. Where a bought item goes is `placeUploaded`'s business,
   * read from the system's own sheet template.
   */
  const uploadedShelf = (id: ShopStock): Shelf<UploadedEntry> => {
    const extra = columnsFor(system, id).columns.slice(2);
    const rows = uploadedIn(id);
    const ownedOf = (e: UploadedEntry) => owned.find((l) => l.key === `${id}/${e.id}`)?.qty ?? 0;
    const columns: Record<string, ShelfColumn<UploadedEntry>> = {
      name: { label: 'NAME', value: (e) => e.name, first: 'asc' },
      price: { label: 'PRICE', value: (e) => e.price, numeric: true, first: 'desc', align: 'right', render: (e) => credits(e.price) },
    };
    for (const col of extra) {
      const cells = rows.map((e) => String(e.fields[col] ?? '')).filter(Boolean);
      // Sorted as numbers only when every filled cell is one - "3d6" is not.
      const numeric = cells.length > 0 && cells.every((v) => Number.isFinite(Number(v)));
      columns[col] = {
        label: col.replace(/_/g, ' ').toUpperCase(),
        value: (e) => (numeric ? Number(e.fields[col]) || 0 : String(e.fields[col] ?? '')),
        render: (e) => String(e.fields[col] ?? '') || '—',
        numeric,
        first: numeric ? 'desc' : 'asc',
        ...(numeric ? { align: 'right' as const } : {}),
        ...(col === 'effect' || col === 'description' ? { clip: 360 } : {}),
      };
    }
    columns.owned = {
      label: 'OWNED', value: ownedOf, numeric: true, first: 'desc', align: 'right',
      render: (e) => (ownedOf(e) > 0 ? `x${ownedOf(e)}` : ''),
    };
    return {
      id,
      rows,
      columns,
      rowKey: (e) => e.id,
      matches: (e, q) => e.name.toLowerCase().includes(q)
        || Object.values(e.fields).some((v) => String(v).toLowerCase().includes(q)),
      buy: (e) => {
        if (!sheet) { setRefused('No character sheet loaded.'); return; }
        // Checked before the money moves: a full weapon rack is a reason not to sell.
        const first = placeUploaded(system, id, e, sheet.data as Record<string, unknown>);
        if (!first.ok) { setRefused(first.reason); return; }
        purchase(id, e.id, e.name, e.price, () => {
          const placed = placeUploaded(
            system, id, e, (sheetNow.current?.data ?? {}) as Record<string, unknown>,
          );
          if (placed.ok) applyPatch(placed.patch);
          else setRefused(`${placed.reason} It was paid for — ask your GM to add it by hand.`);
        });
      },
      notice: destinationOf(system, id),
      filterHint: 'Filter by name or anything on the line',
    };
  };

  // ------------------------------------------------------------------------

  /** Every CWN shelf, drawn from the book, by catalogue. */
  const BOOK_SHELVES: Partial<Record<ShopStock, Shelf<any>>> = {
    cyberware: cyberShelf,
    weapons: weaponShelf,
    weapon_mods: modShelf('weapon_mods', CWN_WEAPON_MODS, 'Fix'),
    armor: armorShelf,
    armor_mods: modShelf('armor_mods', CWN_ARMOR_MODS, 'Fix'),
    pharmaceuticals: pharmaShelf,
    vehicles: vehicleShelf,
    vehicle_fittings: fittingShelf,
    vehicle_weapons: vehicleWeaponShelf,
    gear: gearShelf,
  };

  const base: Shelf<any> | undefined = !shelfId
    ? undefined
    : book ? BOOK_SHELVES[shelfId] : uploadedShelf(shelfId);

  /**
   * The shelf, with whatever the GM uploaded added to it.
   *
   * Appended rather than merged into the catalogue modules, because the built-in tables are
   * compiled in and an upload is a separate thing that sits on top. An uploaded row with
   * the same id as a book one replaces it on the shelf, the same way the server prices it -
   * otherwise a house-ruled Heavy Pistol would be listed twice at two prices.
   *
   * The columns are whatever this shelf already draws. An uploaded entry carries its sheet
   * fields under the same names, so `dmg` lands in the DMG column with no mapping.
   */
  /**
   * Worked out on every render, and NOT memoised.
   *
   * A shelf carries its own `buy`, and that closure captures the balance, the sheet and
   * the handlers from the render it was made in. Memoising on the rows - which are a
   * stable module constant - handed back the first render's shelf forever, and the first
   * render happens before the balance has arrived. Every purchase then saw a zero balance
   * and refused. Filtering and sorting a few dozen rows is not worth that.
   */
  const shelf: Shelf<any> | undefined = (() => {
    // Outside CWN the shelf already IS the uploads; there is no book to add them to.
    if (!base || !book) return base;
    const extra = uploadedIn(base.id);
    if (!extra.length) return base;

    const asRow = (e: { id: string; name: string; price: number; fields: Record<string, string> }) => ({
      id: e.id,
      // Both spellings, because the shelves are not consistent about it: weapons and
      // cyberware use `name`, everything newer uses `label`.
      name: e.name,
      label: e.name,
      price: e.price,
      cost: e.price,
      ...e.fields,
    });

    const byId = new Map(base.rows.map((r: any) => [base.rowKey(r), r]));
    for (const e of extra) byId.set(e.id, asRow(e));
    return { ...base, rows: [...byId.values()] };
  })();

  /** The open shelf, filtered and sorted. Small lists, so done plainly on each render. */
  const rows: any[] = (() => {
    if (!shelf) return [];
    const q = filter.trim().toLowerCase();
    let list = shelf.rows;
    // The weapon shelf's own narrowing. Both on, or both off, means no opinion.
    if (shelf.id === 'weapons' && kinds.ranged !== kinds.melee) {
      list = list.filter((w: CwnWeaponPreset) =>
        (kinds.ranged ? w.skill === 'shoot' : w.skill !== 'shoot'));
    }
    if (q) list = list.filter((row) => shelf.matches(row, q));
    return applySort(list, sort, shelf.columns);
  })();

  /**
   * Switching shelves clears the sort and the filter.
   *
   * A sort key belongs to the columns it was set on - "MAG, descending" means nothing on
   * the armor shelf - and carrying a filter across would open the new shelf already
   * narrowed to something the player typed about a different list.
   */
  const openShelf = (id: ShopStock) => {
    setPicked(id);
    setSort({ key: '', dir: null });
    setFilter('');
    setRefused(null);
  };

  return (
    // The layout of the building and token windows it opens from: the building in the
    // corner, BUY and SELL down the left, the open one's list on the right with its filter
    // and shelf tabs on top. Wider than they are, because a shelf is a table.
    <TerminalWindow
      title={`SHOP · ${name || 'UNNAMED'}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      preview={preview}
      folders={[{ id: 'buy' as Tab, label: 'BUY' }, { id: 'sell' as Tab, label: 'SELL' }]}
      open={tab}
      onOpen={setTab}
      panelMode="list"
      width={980}
      label={`${name || 'Shop'} shop`}
      header={(
        <span style={{ color: 'var(--cyan)' }}>
          {type ? typeLabel(type.id, system).toUpperCase() : 'UNKNOWN'} ·{' '}
          {rows.length} LINE{rows.length === 1 ? '' : 'S'}
          {/* The book page, so a price can be checked without hunting for the table. */}
          {book && shelf && catalogueById(shelf.id) && ` · CWN P${catalogueById(shelf.id)!.page}`}
          {/* What you can spend, where you are about to spend it. A shop that charges an
              account without showing it is asking people to shop blind. */}
          {account && (
            <>
              {' · '}
              <span style={{ color: account.balance < 0 ? 'var(--danger)' : undefined }}>
                {credits(account.balance)}
              </span>
              {account.debt > 0 && (
                <span style={{ color: 'var(--warning)' }}> · {credits(account.debt)} OWED</span>
              )}
            </>
          )}
        </span>
      )}
    >
        {tab === 'buy' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* One tab per catalogue, and none at all for a shop that carries one. A lone
                tab is a label wearing a button's clothes. */}
            {catalogues.length > 1 && (
              <div
                role="tablist"
                aria-label="Catalogue"
                style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}
              >
                {catalogues.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={`utility-btn ${shelfId === id ? 'active' : ''}`}
                    aria-selected={shelfId === id}
                    onClick={() => openShelf(id)}
                    style={{ ...mono(10), padding: '2px 10px', letterSpacing: 1, flex: 1 }}
                  >{catalogueLabel(id, system).toUpperCase()}</button>
                ))}
              </div>
            )}

            {/*
              Where a bought thing lands.

              This used to lead with what BUY did about money - first that it did nothing,
              then that it charged you. Both have stopped being worth saying: the first was
              a disclaimer for an unfinished feature, and the second told people a BUY
              button takes their money. What is left is the part nobody can guess, which is
              that a weapon arrives stowed rather than in hand and an augment arrives owned
              rather than installed.

              Amber only when there is no sheet, because that is the one case that is
              actually a warning. The rest is a label and is drawn like one.
            */}
            <div
              style={{
                ...mono(9), marginBottom: 8, letterSpacing: 0,
                color: sheet ? 'var(--grid-section)' : 'var(--warning)',
              }}
            >
              {!sheet
                ? 'NO CHARACTER SHEET LOADED — NOTHING TO BUY ONTO'
                : shelf?.notice ?? ''}
            </div>

            {!shelf ? (
              <div style={{ ...mono(10), color: 'var(--grid-section)', padding: '10px 0', letterSpacing: 0, lineHeight: 1.6 }}>
                NO CATALOGUE FOR THIS SHOP YET.
                {/* Named, so the answer to "why is this empty" is on the screen. */}
                {type?.sells.length
                  ? ` The book has ${type.sells.map((s) => catalogueLabel(s, system)).join(' and ')} for this
                      storefront, but nothing here can put it on a shelf yet.`
                  : ' This building type does not trade.'}
              </div>
            ) : (
              <>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={shelf.filterHint}
                  aria-label="Filter stock"
                  style={{
                    background: 'var(--black)', border: '1px solid var(--dark-green)',
                    color: 'var(--green)', fontFamily: 'monospace', fontSize: 11,
                    padding: '3px 5px', width: '100%', boxSizing: 'border-box', marginBottom: 6,
                  }}
                />
                {shelf.controls}
                {shelf.note && (
                  <div style={{ ...mono(9), color: 'var(--grid-section)', marginBottom: 6, letterSpacing: 0, lineHeight: 1.5 }}>
                    {shelf.note}
                  </div>
                )}
                {refused && (
                  <div style={{ ...mono(10), color: 'var(--danger)', marginBottom: 6, letterSpacing: 0 }}>
                    {refused}
                  </div>
                )}

                {/*
                  Short of the price, with the house rule on.

                  Asked rather than decided, because taking on debt and letting an account
                  go under are different problems with different consequences, and which
                  one a player wants is not something a shop can infer. Cancel is a real
                  third answer and is listed with the others rather than hidden in a
                  corner - nothing has been charged at this point.
                */}
                {asking && (
                  <div
                    role="alertdialog"
                    aria-label="Not enough credits"
                    style={{
                      ...mono(10), letterSpacing: 0, marginBottom: 8, padding: '6px 8px',
                      border: '1px solid var(--warning)', color: 'var(--warning)',
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>
                      {asking.label.toUpperCase()} costs {credits(asking.price)} and you have{' '}
                      {credits(account?.balance ?? 0)}. How do you want to cover the{' '}
                      {credits(asking.price - (account?.balance ?? 0))} short?
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="utility-btn"
                        onClick={() => answerAsking(SETTLE_DEBT)}
                        title="Spend what you have and borrow the rest"
                        style={{ ...mono(10), padding: '2px 10px' }}
                      >TAKE DEBT</button>
                      <button
                        type="button"
                        className="utility-btn"
                        onClick={() => answerAsking(SETTLE_BALANCE)}
                        title="Let the balance go below zero"
                        style={{ ...mono(10), padding: '2px 10px' }}
                      >GO NEGATIVE</button>
                      <button
                        type="button"
                        className="utility-btn"
                        onClick={() => {
                          pending.current.delete(pendingKey(asking.catalogue, asking.itemId));
                          setAsking(null);
                        }}
                        style={{ ...mono(10), padding: '2px 10px' }}
                      >CANCEL</button>
                    </div>
                  </div>
                )}
                <div className="cyber-scroll" style={{ flex: rows.length === 0 ? '0 0 auto' : 1, minHeight: 0, overflowY: 'auto' }}>
                  <table style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                    <thead>
                      <tr style={{ color: 'var(--grid-section)' }}>
                        {Object.entries(shelf.columns).map(([key, col]) => (
                          <th
                            key={key}
                            onClick={() => setSort((st) => nextSort(st, key, col.first))}
                            aria-label={`Sort by ${col.label}`}
                            title="Click to sort — again to reverse, again for the book's own order"
                            style={{
                              ...cell, cursor: 'pointer', whiteSpace: 'nowrap',
                              textAlign: col.align ?? 'left',
                              color: sort.key === key && sort.dir ? 'var(--cyan)' : undefined,
                            }}
                          >{col.label}{sortArrow(sort, key)}</th>
                        ))}
                        <th style={{ ...cell, textAlign: 'right' }}>&nbsp;</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const key = shelf.rowKey(row);
                        const canBuy = shelf.buyable ? shelf.buyable(row) : true;
                        const label = String(shelf.columns.name.value(row));
                        return (
                          <tr key={key}>
                            {Object.entries(shelf.columns).map(([colKey, col]) => (
                              <td
                                key={colKey}
                                title={col.clip ? String(col.value(row)) : undefined}
                                style={{
                                  ...cell,
                                  textAlign: col.align ?? 'left',
                                  // Names, numbers and ranges read as one piece; only the prose wraps.
                                  ...(colKey === 'name' || colKey === 'dmg' || colKey === 'range' || col.align === 'right'
                                    ? { whiteSpace: 'nowrap' } : {}),
                                  ...(colKey === 'effect' || colKey === 'note'
                                    ? { color: 'var(--grid-section)' } : {}),
                                  ...(colKey === 'owned' ? { color: 'var(--cyan)' } : {}),
                                  ...(col.clip
                                    ? {
                                      maxWidth: col.clip, overflow: 'hidden',
                                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }
                                    : {}),
                                }}
                              >{col.render ? col.render(row) : col.value(row)}</td>
                            ))}
                            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {canBuy ? (
                                <button
                                  type="button"
                                  className="utility-btn"
                                  disabled={!sheet}
                                  aria-label={`Buy ${label}`}
                                  title={sheet ? shelf.notice : 'No character sheet loaded'}
                                  onClick={() => shelf.buy(row)}
                                  style={{ padding: '1px 6px', fontSize: 9 }}
                                >BUY{taken[key] ? ` ×${taken[key]}` : ''}</button>
                              ) : (
                                <span style={{ color: 'var(--grid-section)' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rows.length === 0 && (
                  <div data-testid="shelf-empty" style={{ ...mono(11), color: 'var(--green)', padding: '10px 0', letterSpacing: 0 }}>
                    {/* An empty shelf and a filter that matched nothing are different
                        answers, and only one of them is somebody else's job to fix. */}
                    {shelf.rows.length === 0
                      ? 'Nothing on the shelves yet — the GM adds stock in SHOP_CATALOGUES.'
                      : 'NOTHING MATCHES THAT'}
                  </div>
                )}
                {isAdmin && (
                  <EmptyShopSteps
                    buildingType={buildingType}
                    system={system}
                    onOpenCatalogues={onOpenCatalogues}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...mono(9), color: 'var(--grid-section)', marginBottom: 8, letterSpacing: 0 }}>
              THIS SHOP PAYS {pct}% OF THE {book ? 'BOOK' : 'SHELF'} PRICE · ADD WHAT YOU WANT TO SELL, THEN SELL
            </div>

            {refused && (
              <div style={{ ...mono(10), color: 'var(--danger)', marginBottom: 6, letterSpacing: 0 }}>
                {refused}
              </div>
            )}

            {/* What the last sale came to, kept until something else happens. */}
            {receipt && (
              <div style={{ ...mono(10), color: 'var(--cyan)', marginBottom: 6, letterSpacing: 0, lineHeight: 1.5 }}>
                SOLD FOR {credits(receipt.payout)}.
                {receipt.fromBody > 0 && (
                  <span style={{ color: 'var(--warning)' }}>
                    {' '}{receipt.fromBody === 1 ? 'A piece' : `${receipt.fromBody} pieces`} of
                    installed cyberware came out. Ask your GM about the surgery roll.
                  </span>
                )}
              </div>
            )}

            {sellable.length === 0 ? (
              <div style={{ ...mono(11), color: 'var(--green)', padding: '10px 0', letterSpacing: 0, lineHeight: 1.6 }}>
                {!sheet
                  ? 'NO CHARACTER SHEET LOADED — NOTHING TO SELL.'
                  : 'NOTHING HERE THIS SHOP WOULD BUY. A shop only takes the kinds of thing it sells.'}
              </div>
            ) : (
              <>
                <input
                  value={sellFilter}
                  onChange={(e) => setSellFilter(e.target.value)}
                  placeholder="Filter by name"
                  aria-label="Filter what you can sell"
                  style={{
                    background: 'var(--black)', border: '1px solid var(--dark-green)',
                    color: 'var(--green)', fontFamily: 'monospace', fontSize: 11,
                    padding: '3px 5px', width: '100%', boxSizing: 'border-box', marginBottom: 6,
                  }}
                />
                <div className="cyber-scroll" style={{ flex: shownSellable.length === 0 ? '0 0 auto' : 1, minHeight: 0, overflowY: 'auto' }}>
                  <table style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                    <thead>
                      <tr style={{ color: 'var(--grid-section)' }}>
                        <th style={cell}>ITEM</th>
                        <th style={{ ...cell, textAlign: 'right' }}>HAVE</th>
                        <th style={{ ...cell, textAlign: 'right' }}>EACH</th>
                        <th style={{ ...cell, textAlign: 'right' }}>SELLING</th>
                        <th style={{ ...cell, textAlign: 'right' }}>&nbsp;</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownSellable.map((l) => {
                        const staged = basket[l.key] ?? 0;
                        const left = l.qty - staged;
                        const each = buybackValue(l.unitPrice, pct);
                        const installed = l.at.some((a) => a.placed);
                        return (
                          <tr key={l.key}>
                            <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                              {l.label}
                              {/* The book puts surgery on taking chrome out and this app
                                  models none of it, so it is flagged before it is sold
                                  rather than mentioned afterwards. */}
                              {installed && (
                                <span
                                  style={{ color: 'var(--warning)' }}
                                  title="Currently installed. Selling it removes the implant with no surgery roll — square that with your GM."
                                > ⚕</span>
                              )}
                              {/* Nothing on any shelf, so nothing the shop can value. */}
                              {l.unitPrice === null && (
                                <span
                                  style={{ color: 'var(--grid-section)' }}
                                  title="Not on any shelf, so the shop cannot price it. Sells for nothing — settle up with your GM."
                                > ?</span>
                              )}
                            </td>
                            <td style={{ ...cell, textAlign: 'right' }}>×{left}</td>
                            <td style={{ ...cell, textAlign: 'right' }}>
                              {l.unitPrice === null ? '—' : credits(each)}
                            </td>
                            <td style={{ ...cell, textAlign: 'right', color: 'var(--cyan)' }}>
                              {staged > 0 ? `×${staged}` : ''}
                            </td>
                            <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                className="utility-btn"
                                disabled={left <= 0 || confirming}
                                aria-label={`Add ${l.label} to the sell list`}
                                onClick={() => stage(l.key, 1)}
                                style={{ padding: '1px 6px', fontSize: 9 }}
                              >ADD</button>
                              {staged > 0 && (
                                <button
                                  type="button"
                                  className="utility-btn"
                                  disabled={confirming}
                                  aria-label={`Take ${l.label} off the sell list`}
                                  onClick={() => stage(l.key, -1)}
                                  style={{ padding: '1px 6px', fontSize: 9, marginLeft: 4 }}
                                >−</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {shownSellable.length === 0 && (
                  <div data-testid="sell-empty" style={{ ...mono(11), color: 'var(--green)', padding: '10px 0', letterSpacing: 0 }}>
                    NOTHING MATCHES THAT
                  </div>
                )}

                {/*
                  The sell list, and one confirmation for the lot.

                  A basket rather than a button per row: selling is irreversible and this
                  way there is exactly one moment to look at what is about to go, whatever
                  its size.
                */}
                <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: 6, marginTop: 6 }}>
                  {staging.length === 0 ? (
                    <div style={{ ...mono(9), color: 'var(--grid-section)', letterSpacing: 0 }}>
                      NOTHING ON THE SELL LIST YET
                    </div>
                  ) : confirming ? (
                    <div style={{ ...mono(10), letterSpacing: 0, lineHeight: 1.5 }}>
                      <div style={{ color: 'var(--warning)', marginBottom: 4 }}>
                        SELL {staging.reduce((n, s) => n + s.qty, 0)} ITEM
                        {staging.reduce((n, s) => n + s.qty, 0) === 1 ? '' : 'S'} FOR{' '}
                        {credits(basketTotal)}? THIS CANNOT BE UNDONE.
                      </div>
                      {stagedFromBody > 0 && (
                        <div style={{ color: 'var(--danger)', marginBottom: 4 }}>
                          ⚕ {stagedFromBody === 1 ? 'One piece' : `${stagedFromBody} pieces`} of
                          this is installed cyberware. It comes straight out with no surgery
                          roll — ask your GM how they want to handle that, or keep it and sell
                          the rest.
                        </div>
                      )}
                      <div style={{ color: 'var(--grid-section)', marginBottom: 6 }}>
                        {staging.map((s) => `${s.label} ×${s.qty}`).join(' · ')}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="utility-btn"
                          onClick={commitSale}
                          style={{ ...mono(10), padding: '2px 10px' }}
                        >CONFIRM</button>
                        {/* A way out of the implants alone. Cancelling the whole basket
                            was the only answer before, which is a poor one when the
                            surgery is a surprise and the rest of the list is fine. */}
                        {stagedFromBody > 0 && (
                          <button
                            type="button"
                            className="utility-btn"
                            onClick={keepImplants}
                            title="Take the installed cyberware off the list and keep the rest of the sale"
                            style={{ ...mono(10), padding: '2px 10px' }}
                          >KEEP IMPLANTS</button>
                        )}
                        <button
                          type="button"
                          className="utility-btn"
                          onClick={() => setConfirming(false)}
                          style={{ ...mono(10), padding: '2px 10px' }}
                        >BACK</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ ...mono(10), letterSpacing: 0 }}>
                      <div style={{ color: 'var(--grid-section)', marginBottom: 6, lineHeight: 1.5 }}>
                        {staging.map((s) => `${s.label} ×${s.qty}`).join(' · ')}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="utility-btn"
                          onClick={() => { setReceipt(null); setConfirming(true); }}
                          style={{ ...mono(10), padding: '2px 10px' }}
                        >SELL · {credits(basketTotal)}</button>
                        <button
                          type="button"
                          className="utility-btn"
                          onClick={() => setBasket({})}
                          style={{ ...mono(10), padding: '2px 10px' }}
                        >CLEAR</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
    </TerminalWindow>
  );
}
