import React, { useMemo, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { buildingTypeById } from '../data/buildingTypes';
import { CWN_CYBERWARE, type CwnCyberPreset } from '../sheets/cwnCyberwarePresets';
import { CYBERWARE_FIELD, readRows, normaliseRow } from '../sheets/cyberwareRows';
import { CWN_WEAPONS, weaponToStashed, type CwnWeaponPreset } from '../sheets/cwnWeaponPresets';
import { readStash, firstFreeRow, stashedToCarried } from '../sheets/cwnWeaponStash';
import { carriedEnc, encLimits } from '../sheets/cwnEncumbrance';
import { CWN_WEAPON_ROWS } from '../sheets/templates/cities_without_number';
import { usePlayerSheet } from '../hooks/usePlayerSheet';

// A shop: what the building carries, and a way to take a piece away with you.
//
// BUY puts the piece on your sheet as an *unplaced* row and stops there. No money moves,
// no stock is kept. That split is not a shortcut - buying is a transaction and installing
// is surgery with strain and a doctor's roll behind it, so a bought piece lands in the
// same "not yet placed on the body" list an import lands in, and gets fitted on the
// diagram like anything else.
//
// Buying and selling are separate tabs rather than two buttons on a row, because they are
// not two halves of one list. Buying reads the shop's stock; selling reads what *you* are
// carrying, which will be more than augments - gear, weapons, a car. A SELL button beside
// a shop's catalogue would be offering to sell you something you may not own.
//
// Every price is the book's. A per-store markup is one of the open questions, and a street
// doc being cheaper than a corp clinic is very much the genre - but inventing a number
// here would bake in an answer nobody chose.

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

/** What the shop has on the shelf. Two catalogues so far, or none. */
function stockFor(sells: string | null): CwnCyberPreset[] {
  return sells === 'cyberware' ? CWN_CYBERWARE : [];
}

function weaponStockFor(sells: string | null): CwnWeaponPreset[] {
  return sells === 'weapons' ? CWN_WEAPONS : [];
}

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
  columns: Record<string, { value: (row: T) => string | number; numeric?: boolean }>,
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
  const stock = useMemo(() => stockFor(type?.sells ?? null), [type]);
  const weaponStock = useMemo(() => weaponStockFor(type?.sells ?? null), [type]);
  const sellsWeapons = (type?.sells ?? null) === 'weapons';

  /** What each weapon column sorts on, and which way its first click goes. */
  const WEAPON_COLUMNS: Record<string, {
    label: string; value: (w: CwnWeaponPreset) => string | number;
    numeric?: boolean; first: SortDir; align?: 'right';
  }> = {
    name: { label: 'NAME', value: (w) => w.name, first: 'asc' },
    dmg: { label: 'DMG', value: (w) => w.dmg, first: 'asc' },
    // The first number is what matters: 10/80 is a short-range weapon whatever its long is.
    range: { label: 'RANGE', value: (w) => Number(w.range.split('/')[0]) || 0, numeric: true, first: 'desc' },
    mag: { label: 'MAG', value: (w) => Number(w.mag) || 0, numeric: true, first: 'desc', align: 'right' },
    enc: { label: 'ENC', value: (w) => Number(w.enc) || 0, numeric: true, first: 'asc', align: 'right' },
    price: { label: 'PRICE', value: (w) => w.price, numeric: true, first: 'desc', align: 'right' },
    note: { label: 'NOTE', value: (w) => w.note, first: 'asc' },
    // Its own column, because hanging it off the BUY button moved the button every time
    // somebody bought something.
    owned: { label: 'OWNED', value: (w) => ownedCount(w.name), numeric: true, first: 'desc', align: 'right' },
  };

  const shownWeapons = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const both = kinds.ranged === kinds.melee;
    const byKind = both ? weaponStock : weaponStock.filter((w) =>
      (kinds.ranged ? w.skill === 'shoot' : w.skill !== 'shoot'));
    const matched = !q ? byKind : byKind.filter((w) =>
      w.name.toLowerCase().includes(q) || w.note.toLowerCase().includes(q)
      || w.category.includes(q));
    return applySort(matched, sort, WEAPON_COLUMNS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weaponStock, filter, sort, kinds]);

  /**
   * Buying a weapon puts it in the stash, not into a carried row.
   *
   * You have walked out of a shop holding a bag; whether the thing ends up in your hands
   * is a decision you make afterwards, on the sheet. It also means a shop can never fail
   * for want of a free row, which is what "do not enforce how much someone can buy" needs
   * in order to be true.
   */
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

  /** The same treatment for the ripperdoc's shelf: it is the same kind of list. */
  const CYBER_COLUMNS: Record<string, {
    label: string; value: (c: CwnCyberPreset) => string | number;
    numeric?: boolean; first: SortDir; align?: 'right';
  }> = {
    name: { label: 'NAME', value: (c) => c.name, first: 'asc' },
    type: { label: 'TYPE', value: (c) => c.type, first: 'asc' },
    strain: { label: 'STRAIN', value: (c) => c.strain, numeric: true, first: 'asc', align: 'right' },
    price: { label: 'PRICE', value: (c) => c.price, numeric: true, first: 'desc', align: 'right' },
    effect: { label: 'EFFECT', value: (c) => c.effect, first: 'asc' },
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = !q ? stock
      : stock.filter((i) => i.name.toLowerCase().includes(q) || i.effect.toLowerCase().includes(q));
    return applySort(matched, sort, CYBER_COLUMNS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock, filter, sort]);

  const buy = (item: CwnCyberPreset) => {
    if (!sheet) return;
    // Unplaced: owning a piece and having it in your body are two different facts, and the
    // diagram is the only thing that decides the second.
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
    setTaken((t) => ({ ...t, [item.id]: (t[item.id] ?? 0) + 1 }));
  };

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
          {(sellsWeapons ? weaponStock.length : stock.length)} LINE{(sellsWeapons ? weaponStock.length : stock.length) === 1 ? '' : 'S'}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {tabButton('buy', 'BUY')}
          {tabButton('sell', 'SELL')}
        </div>

        {tab === 'buy' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Said plainly rather than left to be discovered by a player whose money does
                not move. A button that quietly does half of what it says is worse than one
                that says which half. */}
            <div style={{ ...mono(9), color: 'var(--warning)', marginBottom: 8, letterSpacing: 0 }}>
              {!sheet
                ? 'NO CHARACTER SHEET LOADED — NOTHING TO BUY ONTO'
                : sellsWeapons
                  ? 'NOTHING IS CHARGED YET — BUY PUTS THE WEAPON IN A WEAPON SLOT, STOWED'
                  : 'NOTHING IS CHARGED YET — BUY ADDS THE PIECE TO YOUR AUGMENTS, UNPLACED'}
            </div>

            {sellsWeapons ? (
              <>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name, note or kind"
                  aria-label="Filter stock"
                  style={{
                    background: 'var(--black)', border: '1px solid var(--dark-green)',
                    color: 'var(--green)', fontFamily: 'monospace', fontSize: 11,
                    padding: '3px 5px', width: '100%', marginBottom: 6,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 6 }}>
                  {(['ranged', 'melee'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`utility-btn ${kinds[k] ? 'active' : ''}`}
                      aria-pressed={kinds[k]}
                      onClick={() => setKinds((s2) => ({ ...s2, [k]: !s2[k] }))}
                      style={{ ...mono(12), padding: '2px 10px', letterSpacing: 1 }}
                    >{k.toUpperCase()}</button>
                  ))}
                </div>
                {/* RANGE and MAG are shown and not bought: the sheet has no field for
                    either, and picking a rifle without knowing its range is not a choice.
                    Said here rather than discovered when they fail to appear. */}
                <div style={{ ...mono(9), color: 'var(--grid-section)', marginBottom: 6, letterSpacing: 0 }}>
                  Range and magazine are printed for reference — the sheet has nowhere to keep them yet.
                </div>
                {refused && (
                  <div style={{ ...mono(10), color: 'var(--danger)', marginBottom: 6, letterSpacing: 0 }}>
                    {refused}
                  </div>
                )}
                <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <table style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                    <thead>
                      <tr style={{ color: 'var(--grid-section)' }}>
                        {Object.entries(WEAPON_COLUMNS).map(([key, col]) => (
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
                      {shownWeapons.map((w) => (
                        <tr key={w.id}>
                          <td style={cell}>{w.name}</td>
                          <td style={{ ...cell, color: 'var(--cyan)' }}>{w.dmg || '—'}</td>
                          <td style={cell}>{w.range || '—'}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>{w.mag || '—'}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>{w.enc}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>
                            {w.price === 0 ? 'N/A' : `${w.price.toLocaleString()}cr`}
                          </td>
                          <td style={{ ...cell, color: 'var(--grid-section)' }}>{w.note}</td>
                          <td style={{ ...cell, textAlign: 'right', color: 'var(--cyan)' }}>
                            {ownedCount(w.name) > 0 ? `x${ownedCount(w.name)}` : ''}
                          </td>
                          <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              className="utility-btn"
                              disabled={!sheet}
                              aria-label={`Buy ${w.name}`}
                              onClick={() => buyWeapon(w)}
                            >BUY</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : stock.length === 0 ? (
              <div style={{ ...mono(10), color: 'var(--grid-section)', padding: '10px 0', letterSpacing: 0 }}>
                NO CATALOGUE FOR THIS SHOP YET. Cyberware and weapons are the stock lists built
                so far; armour and drugs are still to come.
              </div>
            ) : (
              <>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name or effect"
                  aria-label="Filter stock"
                  style={{
                    background: 'var(--black)', border: '1px solid var(--dark-green)',
                    color: 'var(--green)', fontFamily: 'monospace', fontSize: 11,
                    padding: '3px 5px', width: '100%', marginBottom: 6,
                  }}
                />
                <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <table style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                    <thead>
                      <tr style={{ color: 'var(--grid-section)' }}>
                        {Object.entries(CYBER_COLUMNS).map(([key, col]) => (
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
                      {shown.map((item) => (
                        <tr key={item.id}>
                          <td style={cell}>{item.name}</td>
                          <td style={{ ...cell, color: 'var(--cyan)' }}>{item.type.toUpperCase()}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>{item.strain}</td>
                          <td style={{ ...cell, textAlign: 'right' }}>{item.price.toLocaleString()}cr</td>
                          <td style={{ ...cell, color: 'var(--grid-section)' }}>{item.effect}</td>
                          <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              className="utility-btn"
                              disabled={!sheet}
                              onClick={() => buy(item)}
                              title={sheet ? 'Adds it to your augments, unplaced' : 'No character sheet loaded'}
                              aria-label={`Buy ${item.name}`}
                              style={{ padding: '1px 6px', fontSize: 9 }}
                            >BUY{taken[item.id] ? ` ×${taken[item.id]}` : ''}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shown.length === 0 && (
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
