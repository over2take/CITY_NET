import React, { useState } from 'react';
import { spentAfterClick, maySpendRecovery, spentAtText, spendCount, type ChoicesAction, type RecoveryPool, type RecoveryWorked } from '../sheets/choicesShown';

// A character's recovery dice on their sheet (R2b; approved mockup docs/mockups/rest-on-sheet.html,
// 2026-10-30), at the head of the CHOICES block: the system's name for them, what one heals and
// where they're spent, then each pool (a class's die, or a formula's count of the largest) as pips,
// lit while left. SPEND rolls some (− and + say how many): the server rolls, heals and logs it
// (backend sheets/recover.js), and the tray opens as for any roll. For real dice, a pip ticks one
// off, or back, as a feature's uses do. Where the system leaves spending to the GM, a player's
// controls wait until the GM opens it; the GM's never do.

interface Props {
  recovery: RecoveryWorked;
  /** May anything be changed here at all (not read-only, with a socket to ask). */
  can: boolean;
  gm: boolean;
  /** Whether the GM has spending open (the recovery_open setting). */
  open: boolean;
  ask: (action: ChoicesAction) => void;
  /** Spends and rolls `count` of a pool. Absent: no SPEND. */
  onSpend?: (pool: string, count: number) => void;
}

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.7 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '1px 7px',
};

function Pool({ pool, name, allowed, ask, onSpend }: { pool: RecoveryPool; name: string; allowed: boolean; ask: Props['ask']; onSpend?: Props['onSpend'] }) {
  const left = pool.total - pool.spent;
  const [wanted, setWanted] = useState(1);
  const count = spendCount(wanted, left);
  const title = `${pool.label} d${pool.die}`;
  return (
    <div role="group" aria-label={title} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.65rem' }}>
      <span style={{ letterSpacing: '1px', minWidth: '7em' }}>{pool.label.toUpperCase()} D{pool.die}</span>
      <span role="group" aria-label={`${title} left`} style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
        {Array.from({ length: pool.total }, (_, i) => {
          const lit = i >= pool.spent;
          return (
            <button key={i} type="button" aria-label={`${title} ${i + 1}`} aria-pressed={!lit} disabled={!allowed}
              title={lit ? 'Left: click to tick off, for real dice' : 'Spent: click to take back'}
              onClick={() => ask({ kind: 'recovery', pool: pool.id, spent: spentAfterClick(i, pool.spent) })}
              style={{ width: 11, height: 11, padding: 0, border: '1px solid var(--cyan)', background: lit ? 'var(--cyan)' : 'none', cursor: allowed ? 'pointer' : 'default' }} />
          );
        })}
      </span>
      <span style={small}>{left} OF {pool.total} LEFT</span>
      {onSpend && allowed && left > 0 && (
        <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', marginLeft: 'auto' }}>
          <button type="button" style={btn} aria-label={`Spend fewer ${title}`} disabled={count <= 1} onClick={() => setWanted(count - 1)}>−</button>
          <span aria-label={`How many ${title} to spend`}>{count}</span>
          <button type="button" style={btn} aria-label={`Spend more ${title}`} disabled={count >= left} onClick={() => setWanted(count + 1)}>+</button>
          <button type="button" style={{ ...btn, borderColor: 'var(--cyan)', color: 'var(--cyan)' }} title={`Roll and heal: ${name}`}
            onClick={() => onSpend(pool.id, count)}>SPEND {count}D{pool.die}</button>
        </span>
      )}
    </div>
  );
}

export function RecoveryDice({ recovery, can, gm, open, ask, onSpend }: Props) {
  const allowed = can && maySpendRecovery(recovery, gm, open);
  const waiting = can && !allowed;
  return (
    <section aria-label={recovery.name} style={{ display: 'flex', flexDirection: 'column', gap: '5px', border: '1px solid color-mix(in srgb, var(--cyan) 45%, transparent)', padding: '5px 7px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.65rem', letterSpacing: '2px' }}>{recovery.name.toUpperCase()}</span>
        <span style={small}>ONE HEALS {recovery.heals.toUpperCase()} · {spentAtText(recovery)}</span>
      </div>
      {recovery.pools.map((p) => <Pool key={p.id} pool={p} name={recovery.name} allowed={allowed} ask={ask} onSpend={onSpend} />)}
      {waiting && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>THE GM OPENS SPENDING: UNTIL THEN THESE WAIT</span>}
      {gm && recovery.spend === 'gm' && <span style={small}>{open ? 'SPENDING IS OPEN FOR PLAYERS' : 'SPENDING IS CLOSED FOR PLAYERS'} · OPEN OR CLOSE IT IN THE GAME TAB&apos;S RESTS</span>}
    </section>
  );
}
