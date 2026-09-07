import React, { useMemo, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { buildingTypeById } from '../data/buildingTypes';
import { CWN_CYBERWARE, type CwnCyberPreset } from '../sheets/cwnCyberwarePresets';
import { CYBERWARE_FIELD, readRows, normaliseRow } from '../sheets/cyberwareRows';
import { CWN_WEAPONS, weaponToStashed, type CwnWeaponPreset } from '../sheets/cwnWeaponPresets';
import { STASH_FIELD, readStash, writeStash } from '../sheets/cwnWeaponStash';
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

export function ShopWindow({ name, buildingType, socket, userName, onClose }: Props) {
  const [pos, setPos] = useState({ x: 140, y: 90 });
  const [tab, setTab] = useState<Tab>('buy');
  const [filter, setFilter] = useState('');
  /** How many of each line has been taken this visit, so a press has visible effect. */
  const [taken, setTaken] = useState<Record<string, number>>({});

  const { sheet, handleFieldChange } = usePlayerSheet(socket, userName);

  const type = buildingTypeById(buildingType);
  const stock = useMemo(() => stockFor(type?.sells ?? null), [type]);
  const weaponStock = useMemo(() => weaponStockFor(type?.sells ?? null), [type]);
  const sellsWeapons = (type?.sells ?? null) === 'weapons';

  const shownWeapons = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return weaponStock;
    return weaponStock.filter((w) =>
      w.name.toLowerCase().includes(q) || w.note.toLowerCase().includes(q)
      || w.category.includes(q));
  }, [weaponStock, filter]);

  /**
   * Buying a weapon puts it in the stash, not into a carried row.
   *
   * You have walked out of a shop holding a bag; whether the thing ends up in your hands
   * is a decision you make afterwards, on the sheet. It also means a shop can never fail
   * for want of a free row, which is what "do not enforce how much someone can buy" needs
   * in order to be true.
   */
  const buyWeapon = (w: CwnWeaponPreset) => {
    if (!sheet) return;
    const next = [...readStash(sheet.data), weaponToStashed(w, name || '')];
    handleFieldChange(STASH_FIELD, writeStash(next) as never);
    setTaken((t) => ({ ...t, [w.id]: (t[w.id] ?? 0) + 1 }));
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter((i) => i.name.toLowerCase().includes(q) || i.effect.toLowerCase().includes(q));
  }, [stock, filter]);

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
                  ? 'NOTHING IS CHARGED YET — BUY PUTS THE WEAPON IN YOUR STASH'
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
                {/* RANGE and MAG are shown and not bought: the sheet has no field for
                    either, and picking a rifle without knowing its range is not a choice.
                    Said here rather than discovered when they fail to appear. */}
                <div style={{ ...mono(9), color: 'var(--grid-section)', marginBottom: 6, letterSpacing: 0 }}>
                  Range and magazine are printed for reference — the sheet has nowhere to keep them yet.
                </div>
                <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <table style={{ ...mono(10), width: '100%', borderCollapse: 'collapse', letterSpacing: 0 }}>
                    <thead>
                      <tr style={{ color: 'var(--grid-section)' }}>
                        <th style={cell}>NAME</th>
                        <th style={cell}>DMG</th>
                        <th style={cell}>RANGE</th>
                        <th style={{ ...cell, textAlign: 'right' }}>MAG</th>
                        <th style={{ ...cell, textAlign: 'right' }}>ENC</th>
                        <th style={{ ...cell, textAlign: 'right' }}>PRICE</th>
                        <th style={cell}>NOTE</th>
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
                          <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              className="utility-btn"
                              disabled={!sheet}
                              aria-label={`Buy ${w.name}`}
                              onClick={() => buyWeapon(w)}
                            >BUY</button>
                            {taken[w.id] ? (
                              <span style={{ marginLeft: 6, color: 'var(--cyan)' }}>x{taken[w.id]}</span>
                            ) : null}
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
                        <th style={cell}>NAME</th>
                        <th style={cell}>TYPE</th>
                        <th style={{ ...cell, textAlign: 'right' }}>STRAIN</th>
                        <th style={{ ...cell, textAlign: 'right' }}>PRICE</th>
                        <th style={cell}>EFFECT</th>
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
