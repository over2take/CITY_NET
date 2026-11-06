import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import { moneyOfRow, moneyRollProblems, moneyRows, wholeUnitOf, withMoneyRow, type MoneySet } from '../sheets/newCharacter';
import { formatAmount, parseAmount, type Currency } from '../sheets/currencies';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';

// What each currency starts at, on the NEW CHARACTER page's MONEY step (7c4d; approved mockup
// new-character): nothing, a number, a roll or typed in by the player. Written through the builder's
// `edit`; the logic is sheets/newCharacter.ts and the checks backend creation.js.

interface Props { definition: Definition; edit: (next: Definition) => void }

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const note: React.CSSProperties = { fontSize: 11, lineHeight: 1.45, opacity: 0.7, margin: 0 };
const box: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', minWidth: 0 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 8px', cursor: 'pointer',
});

const HOW: { id: 'none' | MoneySet['how']; label: string; why: string }[] = [
  { id: 'none', label: 'NOTHING', why: 'They start with none of this.' },
  { id: 'number', label: 'A NUMBER', why: 'The same for everyone, paid into the bank.' },
  { id: 'roll', label: 'A ROLL', why: 'Rolled once and kept, the table seeing it in the log, in whole pieces of this money, then paid into the bank.' },
  { id: 'typed', label: 'TYPED IN', why: 'They say what they have, and it is paid into the bank.' },
];

/** An amount as this currency writes it: read as typed, written once it reads. */
function AmountBox({ label, amount, currency, onChange }: { label: string; amount: number; currency: Currency | null; onChange: (next: number) => void }) {
  const say = (n: number) => (currency ? formatAmount(currency, n) : String(n));
  const read = (text: string): number | null => {
    // No minus: a start can't be below nothing, and a lone "-" on its way to one reads as 0.
    if (text.trim().startsWith('-')) return null;
    if (!currency) return /^\d+$/.test(text.trim()) ? Number(text) : null;
    const parsed = parseAmount(currency, text);
    return parsed.ok ? parsed.amount : null;
  };
  const [text, setText] = useState(say(amount));
  return (
    <input type="text" aria-label={label} value={text} style={box} aria-invalid={read(text) === null ? true : undefined}
      onChange={(e) => { setText(e.target.value); const n = read(e.target.value); if (n !== null) onChange(n); }} />
  );
}

export function MoneyPanel({ definition, edit }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {moneyRows(definition).map(({ id, name, currency }) => {
        const set = moneyOfRow(definition, id);
        const now = set?.how ?? 'none';
        const label = name.toUpperCase();
        const start = (how: typeof now): MoneySet | null => {
          if (how === 'none') return null;
          if (how === 'number') return { how, amount: 100 * wholeUnitOf(currency) };
          return how === 'roll' ? { how, each: '3d6 * 10' } : { how };
        };
        return (
          <div key={id} role="group" aria-label={name} style={grid}>
            <FieldName beside hint={HINTS['creation.money']} style={small}>{label}</FieldName>
            <span role="group" aria-label={`${name} starts with`} style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' }}>
              {HOW.map((h) => (
                <button key={h.id} type="button" aria-pressed={now === h.id} style={seg(now === h.id)}
                  onClick={() => { if (now !== h.id) edit(withMoneyRow(definition, id, start(h.id))); }}>{h.label}</button>
              ))}
            </span>
            <span />
            <p style={note}>{HOW.find((h) => h.id === now)?.why}</p>
            {set?.how === 'number' && <>
              <span />
              <AmountBox key={`${id}-number`} label={`${name} amount`} amount={set.amount} currency={currency} onChange={(amount) => edit(withMoneyRow(definition, id, { how: 'number', amount }))} />
            </>}
            {set?.how === 'roll' && <>
              <span />
              <input type="text" aria-label={`${name} roll`} value={set.each} maxLength={60} style={box} aria-invalid={moneyRollProblems(set.each).length ? true : undefined}
                onChange={(e) => edit(withMoneyRow(definition, id, { how: 'roll', each: e.target.value }))} />
              {moneyRollProblems(set.each).map((p) => (
                <React.Fragment key={p}><span /><span role="note" style={{ ...note, color: 'var(--warning)', opacity: 1 }}>{p}</span></React.Fragment>
              ))}
            </>}
          </div>
        );
      })}
    </div>
  );
}
