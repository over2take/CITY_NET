import React, { useState } from 'react';
import { currenciesFor, formatAmount, parseAmount, type Currency } from '../sheets/currencies';
import { moneyHeldOn, moneyWords, type MoneyShown } from '../sheets/newCharacterFlow';

// The MONEY step of NEW_CHARACTER.EXE (7c4d; approved mockup new-character): each currency's starting
// amount, a number said, a roll made once and kept, or typed in. Paid into the bank when they finish, and
// not before, so typing can change. What is allowed is the server's (backend creation.js).

interface Props {
  money: MoneyShown[];
  data: Record<string, unknown> | null | undefined;
  system: string | null | undefined;
  onRoll: (id: string) => void;
  onType: (id: string, amount: number | null) => void;
  /** The GM's, filling it in for a player (7c5): a kept roll cleared, to roll again. */
  onClear?: (id: string) => void;
}

const why: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const small: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.8 };
const amountStyle: React.CSSProperties = { fontSize: 16, color: 'var(--cyan)' };
const btn: React.CSSProperties = { alignSelf: 'flex-start', padding: '3px 10px', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, cursor: 'pointer', background: 'none', color: 'var(--warning)', border: '1px solid var(--warning)' };
const box: React.CSSProperties = { width: 140, padding: '3px 6px', fontFamily: 'inherit', fontSize: 12, background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)' };

/** What a player types for an amount, in smallest units: a currency's own way, or a whole number. */
const readAmount = (currency: Currency | undefined, text: string): number | null => {
  // No minus: a start can't be below nothing, and a lone "-" on its way to one reads as 0.
  if (text.trim().startsWith('-')) return null;
  if (currency) {
    const parsed = parseAmount(currency, text);
    return parsed.ok ? parsed.amount : null;
  }
  return /^\d+$/.test(text.trim()) ? Number(text) : null;
};

function Typed({ entry, currency, held, onType }: { entry: MoneyShown; currency: Currency | undefined; held: number | null; onType: Props['onType'] }) {
  const [text, setText] = useState(held === null ? '' : currency ? formatAmount(currency, held) : String(held));
  const empty = !text.trim();
  const read = readAmount(currency, text);
  return (
    <>
      <p style={why}>How much do you start with?</p>
      <input type="text" aria-label={entry.name} value={text} style={box} aria-invalid={!empty && read === null ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) onType(entry.id, null);
          else { const n = readAmount(currency, e.target.value); if (n !== null) onType(entry.id, n); }
        }} />
      {!empty && read === null && <span role="note" style={{ ...small, color: 'var(--warning)', opacity: 1 }}>THAT DOESN&apos;T READ AS AN AMOUNT</span>}
    </>
  );
}

export function MoneyStep({ money, data, system, onRoll, onType, onClear }: Props) {
  const currencies = currenciesFor(system);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {money.map((m) => {
        const currency = currencies.find((c) => c.id === m.id);
        const say = (n: number) => moneyWords(system, m.id, n);
        const held = moneyHeldOn(data, m.id);
        return (
          <section key={m.id} aria-label={m.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={small}>{m.name.toUpperCase()}</span>
            {m.how === 'number' && <span style={amountStyle}>{say(m.amount ?? 0)}</span>}
            {m.how === 'roll' && held === null && (
              <>
                <p style={why}>{m.each}, rolled once.</p>
                <button type="button" style={btn} onClick={() => onRoll(m.id)}>ROLL FOR IT</button>
              </>
            )}
            {m.how === 'roll' && held !== null && <span style={amountStyle}>{say(held)}</span>}
            {m.how === 'roll' && held !== null && !onClear && <span style={small}>ROLLED, AND KEPT. YOUR GM CAN CLEAR IT FOR ANOTHER GO.</span>}
            {m.how === 'roll' && held !== null && onClear && <button type="button" style={btn} aria-label={`Clear the roll for ${m.name}`} onClick={() => onClear(m.id)}>CLEAR THE ROLL</button>}
            {m.how === 'typed' && <Typed entry={m} currency={currency} held={held} onType={onType} />}
          </section>
        );
      })}
      <p style={small}>{onClear ? 'PAID INTO THEIR BANK AT FINISH. A ROLL NOT MADE IS MADE THEN.' : 'PAID INTO YOUR BANK WHEN YOU FINISH.'}</p>
    </div>
  );
}
