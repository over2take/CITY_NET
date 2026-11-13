import React from 'react';
import { buyRows, ledgerRows, spendTotals, spendWorkedOf, type SpendAction, type SpendShown } from '../sheets/spendShown';
import type { ChoiceListShown } from '../sheets/choicesShown';

// SPEND XP on a custom system's sheet (7f2c1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): XP unspent with
// what was awarded, spent and is waiting; a BUY beside each thing XP buys, at the price the server worked out or with why
// it can't be bought; and SPENT, the ledger, newest first, with the GM's APPROVE, DECLINE and UNDO. What it says is
// sheets/spendShown.ts; every purchase goes to the server (a spendAction).

interface Props {
  spend: SpendShown | null | undefined;
  lists: ChoiceListShown[];
  data: Record<string, unknown>;
  /** What this system calls XP. */
  word: string;
  gm?: boolean;
  /** Asks the server; absent where the sheet can't be changed. */
  onSpend?: (action: SpendAction) => void;
  /** What the server last said no to. */
  refused?: string | null;
}

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.7 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '2px 8px',
};
const hot: React.CSSProperties = { ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: '8px', alignItems: 'center', fontSize: '0.62rem', letterSpacing: '1px' };
const STATE_WORDS = { done: '', pending: 'PENDING', undone: 'UNDONE', declined: 'DECLINED' } as const;

export function SpendSection({ spend, lists, data, word, gm = false, onSpend, refused }: Props) {
  const worked = spendWorkedOf(data);
  if (!spend || !worked) return null;
  const totals = spendTotals(data);
  const buys = buyRows(spend, lists, data, word, !!onSpend);
  const ledger = ledgerRows(spend, lists, data, word, gm && !!onSpend);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
      <div role="status" aria-label={`${word} unspent`} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--cyan)', fontSize: '0.75rem', letterSpacing: '2px' }}>{word} {worked.unspent} UNSPENT</span>
        <span style={small}>{totals.awarded} AWARDED · {totals.spent} SPENT{totals.waiting ? ` · ${totals.waiting} WAITING FOR THE GM` : ''}</span>
      </div>
      {buys.length > 0 && (
        <ul aria-label={`What ${word} buys`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {buys.map((b) => (
            <li key={`${b.buy} ${b.target}`} aria-label={b.name} style={row}>
              <span style={{ minWidth: 0 }}>{b.name}{b.now !== null && <span style={{ color: 'var(--green)', marginLeft: '6px' }}>{b.now}</span>}</span>
              <span style={{ ...small, color: b.can ? undefined : 'var(--warning)', opacity: b.can ? 0.7 : 0.9 }}>{b.why ?? b.price}</span>
              <button type="button" style={{ ...btn, opacity: b.can ? 1 : 0.4, cursor: b.can ? 'pointer' : 'default' }} disabled={!b.can} title={b.why ?? b.price}
                aria-label={`Buy ${b.name}`} onClick={() => onSpend?.({ kind: 'buy', buy: b.buy, target: b.target })}>BUY</button>
            </li>
          ))}
        </ul>
      )}
      <span style={small}>SPENT</span>
      {ledger.length ? (
        <ul aria-label="Spent" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {ledger.map((l) => (
            <li key={l.n} aria-label={l.what} style={{ ...row, opacity: l.state === 'undone' || l.state === 'declined' ? 0.55 : 1 }}>
              <span style={{ minWidth: 0, textDecoration: l.state === 'undone' || l.state === 'declined' ? 'line-through' : undefined }}>{l.what}</span>
              <span style={small}>{l.cost} · BY {l.by}{STATE_WORDS[l.state] && <span style={{ color: l.state === 'pending' ? 'var(--warning)' : undefined, marginLeft: '6px' }}>{STATE_WORDS[l.state]}</span>}</span>
              <span style={{ display: 'inline-flex', gap: '4px' }}>
                {l.actions.map((a) => (
                  <button key={a} type="button" style={a === 'decline' || a === 'undo' ? hot : btn} onClick={() => onSpend?.({ kind: a, entry: l.n })}>{a.toUpperCase()}</button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : <span style={{ ...small, opacity: 0.5 }}>NOTHING BOUGHT YET</span>}
      {refused && <div role="alert" style={{ fontSize: '0.62rem', color: 'var(--warning)' }}>{refused}</div>}
    </div>
  );
}
