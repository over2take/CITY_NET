import React, { useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import {
  buildingTypeById, shelvedCatalogues, catalogueById, type ShopStock,
} from '../data/buildingTypes';
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
import {
  INVENTORY_FIELD, readInventory, writeInventory, blankItem, type InventoryItem,
} from '../sheets/inventory';
import { CWN_WEAPON_ROWS } from '../sheets/templates/cities_without_number';
import { usePlayerSheet } from '../hooks/usePlayerSheet';

// A shop: what the building carries, and a way to take a piece away with you.
//
// BUY puts the piece on your sheet and stops there. No money moves, no stock is kept. That
// split is not a shortcut - buying is a transaction and installing is surgery with strain
// and a doctor's roll behind it, so a bought piece lands in the same "not yet placed on the
// body" list an import lands in, and gets fitted on the diagram like anything else.
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
  buildingType: string;
  /** The shopper's own sheet: where a bought piece lands, and what a sold one comes from. */
  socket: any;
  userName: string | null;
  onClose: () => void;
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

export function ShopWindow({ name, buildingType, socket, userName, onClose }: Props) {
  const [pos, setPos] = useState({ x: 140, y: 90 });
  const [tab, setTab] = useState<Tab>('buy');
  const [filter, setFilter] = useState('');
  /** How many of each line has been taken this visit, so a press has visible effect. */
  const [taken, setTaken] = useState<Record<string, number>>({});

  const { sheet, handleFieldChange, handleFieldsChange, encumbranceEnforced } =
    usePlayerSheet(socket, userName);
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

  /** A press landed. Counted per line so the button can say how many you have taken. */
  const count = (key: string) => setTaken((t) => ({ ...t, [key]: (t[key] ?? 0) + 1 }));

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
    const why = refuseReason(w);
    if (why) { setRefused(why); return; }
    const data = (sheet!.data ?? {}) as Record<string, unknown>;
    const row = firstFreeRow(data, CWN_WEAPON_ROWS)!;
    setRefused(null);
    handleFieldsChange?.(stashedToCarried(weaponToStashed(w, name || ''), row));
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
    notice: 'NOTHING IS CHARGED YET — BUY PUTS THE WEAPON IN A WEAPON SLOT, STOWED',
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
    buy: (p) => {
      addToInventory(p.label, '', (item) => pharmaByName(item.name)?.id === p.id);
      count(p.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS A DOSE TO YOUR INVENTORY, STOWED',
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
    buy: (item) => {
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
      count(item.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS THE PIECE TO YOUR AUGMENTS, UNPLACED',
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
    buy: (a) => {
      addToInventory(a.label, String(a.enc), (item) => item.name === a.label);
      count(a.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS THE ARMOR TO YOUR INVENTORY, STOWED',
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
    buy: (g) => {
      // The symbol rows carry no Encumbrance the sheet can add up, so they go in blank
      // rather than as a zero somebody would later mistake for a measurement.
      addToInventory(g.label, g.encNote ? '' : String(g.enc), (item) => item.name === g.label);
      count(g.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS THE ITEM TO YOUR INVENTORY, STOWED',
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
    buy: (m) => {
      addToInventory(m.label, '', (item) => item.name === m.label);
      count(m.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS THE MOD TO YOUR INVENTORY, UNFITTED',
    filterHint: 'Filter by name or effect',
    note: `Buying a mod is not fitting it — that is a ${fits} check at a bench, and the `
      + 'sheet is where a fitted mod goes. A given mod can only be added once to any one item.',
  });

  // --------------------------------------------------------------- vehicles

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
    buy: (f) => {
      addToInventory(f.label, '', (item) => item.name === f.label);
      count(f.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS THE FITTING TO YOUR INVENTORY, UNFITTED',
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
    buy: (w) => {
      addToInventory(w.label, '', (item) => item.name === w.label);
      count(w.id);
    },
    notice: 'NOTHING IS CHARGED YET — BUY ADDS THE WEAPON TO YOUR INVENTORY, UNMOUNTED',
    filterHint: 'Filter by name or note',
    note: 'A line with no price is not sold separately — it comes with the hull. Mounting '
      + 'happens on the vehicle sheet, against its hardpoints and power.',
  };

  // ------------------------------------------------------------------------

  /** Every shelf this build knows how to draw, by catalogue. */
  const SHELVES: Partial<Record<ShopStock, Shelf<any>>> = {
    cyberware: cyberShelf,
    weapons: weaponShelf,
    weapon_mods: modShelf('weapon_mods', CWN_WEAPON_MODS, 'Fix'),
    armor: armorShelf,
    armor_mods: modShelf('armor_mods', CWN_ARMOR_MODS, 'Fix'),
    pharmaceuticals: pharmaShelf,
    vehicle_fittings: fittingShelf,
    vehicle_weapons: vehicleWeaponShelf,
    gear: gearShelf,
  };

  const shelf: Shelf<any> | undefined = shelfId ? SHELVES[shelfId] : undefined;

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
   * Resizable, following the chat and sheet windows.
   *
   * A shop is a long list read down while comparing prices, and a fixed height meant
   * scrolling sixty lines through a 320px slot on a monitor with room to spare. The flex
   * column is what makes the table take the height rather than the window growing round a
   * fixed-height list.
   */
  const windowStyle: React.CSSProperties = {
    width: '780px', height: '520px',
    minWidth: '420px', maxWidth: '95vw', minHeight: '260px', maxHeight: '92vh',
    resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column',
  };

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      className={`utility-btn ${tab === id ? 'active' : ''}`}
      aria-pressed={tab === id}
      onClick={() => setTab(id)}
      style={{ flex: 1 }}
    >{label}</button>
  );

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
    <DraggableWindow
      title={`SHOP · ${name || 'UNNAMED'}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={windowStyle}
      contentStyle={{ flex: 1, minHeight: 0, maxHeight: 'none', display: 'flex', flexDirection: 'column' }}
    >
      <div className="content" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...mono(9), color: 'var(--cyan)', marginBottom: 6 }}>
          {type ? type.label.toUpperCase() : 'UNKNOWN'} ·{' '}
          {rows.length} LINE{rows.length === 1 ? '' : 'S'}
          {/* The book page, so a price can be checked without hunting for the table. */}
          {shelf && catalogueById(shelf.id) && ` · CWN P${catalogueById(shelf.id)!.page}`}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {tabButton('buy', 'BUY')}
          {tabButton('sell', 'SELL')}
        </div>

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
                  >{(catalogueById(id)?.label ?? id).toUpperCase()}</button>
                ))}
              </div>
            )}

            {/* Said plainly rather than left to be discovered by a player whose money does
                not move. A button that quietly does half of what it says is worse than one
                that says which half. */}
            <div style={{ ...mono(9), color: 'var(--warning)', marginBottom: 8, letterSpacing: 0 }}>
              {!sheet
                ? 'NO CHARACTER SHEET LOADED — NOTHING TO BUY ONTO'
                : shelf?.notice ?? ''}
            </div>

            {!shelf ? (
              <div style={{ ...mono(10), color: 'var(--grid-section)', padding: '10px 0', letterSpacing: 0, lineHeight: 1.6 }}>
                NO CATALOGUE FOR THIS SHOP YET.
                {/* Named, so the answer to "why is this empty" is on the screen. */}
                {type?.sells.length
                  ? ` The book has ${type.sells.map((s) => catalogueById(s)?.label ?? s).join(' and ')} for this
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
                    padding: '3px 5px', width: '100%', marginBottom: 6,
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
                <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                                  ...(colKey === 'name' ? { whiteSpace: 'nowrap' } : {}),
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
                  <div style={{ ...mono(10), color: 'var(--grid-section)', paddingTop: 6 }}>
                    NOTHING MATCHES THAT
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div style={{ ...mono(10), color: 'var(--grid-section)', padding: '10px 0', letterSpacing: 0, lineHeight: 1.6 }}>
            SELLING IS NOT WIRED UP YET.
            <br />
            <br />
            It reads what you are carrying rather than what the shop stocks, and that is
            more than augments — gear, weapons and vehicles all end up here. Taking chrome
            out is also not the mirror image of putting it in: the book puts surgery and a
            complications roll on the way out too.
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
