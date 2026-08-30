import React, { useMemo, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { buildingTypeById } from '../data/buildingTypes';
import { CWN_CYBERWARE, type CwnCyberPreset } from '../sheets/cwnCyberwarePresets';

// A shop, as far as it goes today: what the building carries, and what it would cost.
//
// A shell on purpose. BUY and SELL are present and inert - no money moves, no stock is
// kept, nothing reaches a character sheet. They are here so the shape of the thing can be
// argued about while it is cheap to change, and so the questions that are actually hard
// (whether buying installs, who may buy, what a store restocks) are asked against
// something rather than in the abstract.
//
// Every price is the book's. A per-store markup is one of the open questions, and a street
// doc being cheaper than a corp clinic is very much the genre - but inventing a number
// here would bake in an answer nobody chose.

interface Props {
  /** The building being shopped in, for the title. */
  name: string;
  buildingType: string;
  onClose: () => void;
}

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

export function ShopWindow({ name, buildingType, onClose }: Props) {
  const [pos, setPos] = useState({ x: 140, y: 90 });
  const [filter, setFilter] = useState('');

  const type = buildingTypeById(buildingType);
  const stock = useMemo(() => stockFor(type?.sells ?? null), [type]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter((i) => i.name.toLowerCase().includes(q) || i.effect.toLowerCase().includes(q));
  }, [stock, filter]);

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

        {/* Said plainly rather than left to be discovered by a player whose money does not
            move. A disabled button with no explanation reads as a bug. */}
        <div style={{ ...mono(9), color: 'var(--warning)', marginBottom: 8, letterSpacing: 0 }}>
          PREVIEW ONLY — NOTHING IS BOUGHT, SOLD OR CHARGED YET
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
                          disabled
                          title="Not wired up yet"
                          aria-label={`Buy ${item.name}`}
                          style={{ padding: '1px 6px', fontSize: 9, marginRight: 4 }}
                        >BUY</button>
                        <button
                          type="button"
                          className="utility-btn"
                          disabled
                          title="Not wired up yet"
                          aria-label={`Sell ${item.name}`}
                          style={{ padding: '1px 6px', fontSize: 9 }}
                        >SELL</button>
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
    </DraggableWindow>
  );
}
