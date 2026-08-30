import React, { useMemo, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { buildingTypeById } from '../data/buildingTypes';
import { CWN_CYBERWARE, type CwnCyberPreset } from '../sheets/cwnCyberwarePresets';
import { CYBERWARE_FIELD, readRows, normaliseRow } from '../sheets/cyberwareRows';
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

/** What the shop has on the shelf, which for now is one catalogue or none. */
function stockFor(sells: string | null): CwnCyberPreset[] {
  return sells === 'cyberware' ? CWN_CYBERWARE : [];
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
      windowStyle={{ width: 780, maxWidth: '95vw' }}
    >
      <div className="content">
        <div style={{ ...mono(9), color: 'var(--cyan)', marginBottom: 6 }}>
          {type ? type.label.toUpperCase() : 'UNKNOWN'} · {stock.length} LINE{stock.length === 1 ? '' : 'S'}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {tabButton('buy', 'BUY')}
          {tabButton('sell', 'SELL')}
        </div>

        {tab === 'buy' ? (
          <>
            {/* Said plainly rather than left to be discovered by a player whose money does
                not move. A button that quietly does half of what it says is worse than one
                that says which half. */}
            <div style={{ ...mono(9), color: 'var(--warning)', marginBottom: 8, letterSpacing: 0 }}>
              {sheet
                ? 'NOTHING IS CHARGED YET — BUY ADDS THE PIECE TO YOUR AUGMENTS, UNPLACED'
                : 'NO CHARACTER SHEET LOADED — NOTHING TO BUY ONTO'}
            </div>

            {stock.length === 0 ? (
              <div style={{ ...mono(10), color: 'var(--grid-section)', padding: '10px 0', letterSpacing: 0 }}>
                NO CATALOGUE FOR THIS SHOP YET. Cyberware is the only stock list built so far;
                weapons, armour and drugs are still to come.
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
                <div className="cyber-scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
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
          </>
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
