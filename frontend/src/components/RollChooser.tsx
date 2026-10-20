import React, { useState } from 'react';
import type { SheetField, RollPick } from '../sheets/types';

// The chooser by a custom system's sheet (6b2b; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19: "a roll with changes asks first; one without rolls straight away"). Opened by a die
// button whose field has more than one roll, or a roll with changes: which roll, the changes picked
// (one that costs something says what, and what the sheet has: a cost the sheet can't pay is off,
// 6b3a), then ROLL or CANCEL. It remembers nothing between rolls; how a roll rolls, and paying for
// it, are the server's.

interface Props {
  field: SheetField;
  /** The sheet as it is, for what a cost would take or add. */
  data: Record<string, unknown>;
  onRoll: (pick: RollPick) => void;
  onCancel: () => void;
}

/** What a cost says, and whether the sheet can pay it: what it has, and for one that adds, its highest. */
const costOf = (cost: NonNullable<NonNullable<SheetField['customRolls']>[number]['changes'][number]['cost']>, data: Record<string, unknown>) => {
  const n = Number(data[cost.from]);
  const has = Number.isFinite(n) ? n : 0;
  const name = (cost.label || cost.from).toUpperCase();
  if (cost.adds) {
    const over = cost.max !== undefined && has + cost.amount > cost.max;
    return { words: `ADDS ${cost.amount} ${name} · ${has}${cost.max !== undefined ? ` OF ${cost.max}` : ''}`, can: !over };
  }
  return { words: `COSTS ${cost.amount} ${name} · YOU HAVE ${has}`, can: has >= cost.amount };
};

export function RollChooser({ field, data, onRoll, onCancel }: Props) {
  const rolls = field.customRolls ?? [];
  const [rollId, setRollId] = useState(rolls[0]?.id ?? '');
  const [changes, setChanges] = useState<string[]>([]);
  const roll = rolls.find((r) => r.id === rollId) ?? rolls[0];
  if (!roll) return null;
  const pickRoll = (id: string) => { setRollId(id); setChanges([]); };
  return (
    <div role="dialog" aria-label={`Roll ${field.label}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
      style={{ position: 'sticky', top: 0, zIndex: 2, border: '1px solid var(--warning)', background: 'var(--black)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.7rem', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.6)' }}>
      <div style={{ color: 'var(--warning)', letterSpacing: 1, fontSize: '0.62rem' }}>ROLL · {field.label.toUpperCase()}</div>
      {rolls.length > 1 && (
        <div role="radiogroup" aria-label="Which roll" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {rolls.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={r.id === roll.id} onClick={() => pickRoll(r.id)}
              style={{ background: r.id === roll.id ? 'var(--green)' : 'none', color: r.id === roll.id ? 'var(--black)' : 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: 1, padding: '2px 8px', cursor: 'pointer' }}>
              {r.label.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {roll.changes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {roll.changes.map((c) => {
            const on = changes.includes(c.id);
            const cost = c.cost ? costOf(c.cost, data) : null;
            const off = !!cost && !cost.can;
            return (
              <button key={c.id} type="button" role="switch" aria-checked={on} disabled={off}
                title={off ? (c.cost!.adds ? 'That would take it past its highest' : 'There is not enough to pay it') : undefined}
                onClick={() => setChanges(on ? changes.filter((x) => x !== c.id) : [...changes, c.id])}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: off ? 'var(--danger)' : 'var(--cyan)', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: 1, cursor: off ? 'default' : 'pointer', opacity: off ? 0.6 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span aria-hidden style={{ width: 18, height: 9, borderRadius: 5, border: '1px solid currentColor', background: on ? 'currentColor' : 'none', flexShrink: 0 }} />
                {c.label.toUpperCase()}{cost ? ` · ${cost.words}` : ''}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" autoFocus onClick={() => onRoll({ rollId: roll.id, changes })}
          style={{ background: 'var(--warning)', color: 'var(--black)', border: 0, fontFamily: 'inherit', fontWeight: 'bold', fontSize: '0.65rem', letterSpacing: 1, padding: '3px 12px', cursor: 'pointer' }}>
          ROLL {roll.label.toUpperCase()}
        </button>
        <button type="button" onClick={onCancel}
          style={{ background: 'none', color: 'var(--green)', border: '1px dashed var(--green)', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: 1, padding: '3px 10px', cursor: 'pointer' }}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
