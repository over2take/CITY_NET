import React from 'react';
import { buyCost, buyShown, type BuyWay, type CreationShown } from '../sheets/newCharacterFlow';

// A point buy in NEW_CHARACTER.EXE (7c3d; approved mockup new-character): the points left, each stat with
// its number, what it has cost and what the next costs, and a button either way. Each stat starts at the
// lowest, and points may be left over. What is allowed is worked out here to draw it and held by the
// server, which every move is asked of (backend creation.js).

interface Props {
  way: BuyWay;
  groups: CreationShown['stats'];
  data: Record<string, unknown> | null | undefined;
  /** Each group's name over its stats, when there can be several. */
  named: boolean;
  onBuy: (stat: string, value: number) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.8 };
const step: React.CSSProperties = { minWidth: 24, padding: '0 6px', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', background: 'none', color: 'var(--green)', border: '1px solid var(--green)' };

export function BuyNumbers({ way, groups, data, named, onBuy }: Props) {
  const shown = buyShown(way, groups.flatMap((g) => g.stats), data);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p role="status" style={{ margin: 0, fontSize: 12, letterSpacing: 1, color: shown.left < 0 ? 'var(--warning)' : 'var(--cyan)' }}>
        {shown.left < 0 ? `${-shown.left} POINTS TOO MANY` : `${shown.left} OF ${way.points} POINTS LEFT`}
      </p>
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {named && <span style={small}>{g.label.toUpperCase()}</span>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 6 }}>
            {g.stats.map((s) => {
              const n = shown.held[s.id];
              const up = n < way.highest ? buyCost(way, n + 1) - buyCost(way, n) : null;
              return (
                <div key={s.id} role="group" aria-label={`${s.label}: ${n}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 4, border: '1px solid var(--green)' }}>
                  <span style={small}>{s.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" style={step} aria-label={`${s.label} down`} disabled={!shown.canLower(s.id)} onClick={() => onBuy(s.id, n - 1)}>−</button>
                    <span style={{ fontSize: 16, minWidth: 22, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <button type="button" style={step} aria-label={`${s.label} up`} disabled={!shown.canRaise(s.id)} onClick={() => onBuy(s.id, n + 1)}>+</button>
                  </span>
                  <span style={small}>COST {buyCost(way, n)}{up === null ? '' : ` · NEXT +${up}`}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
