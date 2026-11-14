import React from 'react';
import { giftRolledOn, giftWords, kitItemsText, moneyWords } from '../sheets/newCharacterFlow';
import type { GiftsShown, OptionShown } from '../sheets/choicesShown';

// What an option gives a new character (7c4e), in NEW_CHARACTER.EXE only, as a plain sheet gives nothing:
// said beside an option before picking it, and under the picked one with its money to roll. A roll is the
// server's, made once and kept with that option (backend creation.js); all of it comes as they finish.

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', textAlign: 'left' };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--warning)', color: 'var(--warning)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '1px 7px',
};

/** Beside an option not picked yet. */
export function GiftsOffered({ gives, system, column }: { gives: GiftsShown; system: string | null | undefined; column: number }) {
  return <span style={{ ...small, gridColumn: column, color: 'var(--cyan)' }}>GIVES {giftWords(gives, system)}</span>;
}

/** Under a picked one: what comes, with ROLL FOR IT for money to roll, and what that came to. */
export function GiftsHeld({ option, gives, data, system, onRoll, onClear }: {
  option: OptionShown; gives: GiftsShown; data: Record<string, unknown>; system: string | null | undefined; onRoll: (option: string, id: string) => void;
  /** The GM's, filling it in for a player (7c5): a kept roll cleared, to roll again. */
  onClear?: (option: string, id: string) => void;
}) {
  return (
    <div role="group" aria-label={`What ${option.label} gives`} style={{ display: 'flex', flexDirection: 'column', gap: '3px', color: 'var(--cyan)' }}>
      <span style={small}>GIVEN AS YOU FINISH</span>
      {gives.items?.length ? <span style={small}>{kitItemsText(gives.items)}</span> : null}
      {(gives.money ?? []).map((m) => {
        const rolled = m.how === 'roll' ? giftRolledOn(data, option.id, m.id) : null;
        const amount = m.how === 'number' ? m.amount ?? 0 : rolled;
        return (
          <div key={m.id} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={small}>{m.name}: {amount === null ? m.each : moneyWords(system, m.id, amount)}</span>
            {amount === null && <button type="button" style={btn} aria-label={`Roll ${m.name} for ${option.label}`} title={`Rolls ${m.each}, once, written to the log`} onClick={() => onRoll(option.id, m.id)}>ROLL FOR IT</button>}
            {rolled !== null && !onClear && <span style={{ ...small, opacity: 0.7 }}>ROLLED, AND KEPT</span>}
            {rolled !== null && onClear && <button type="button" style={btn} aria-label={`Clear the roll of ${m.name} for ${option.label}`} onClick={() => onClear(option.id, m.id)}>CLEAR THE ROLL</button>}
          </div>
        );
      })}
    </div>
  );
}
