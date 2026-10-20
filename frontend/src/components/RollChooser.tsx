import React, { useState } from 'react';
import type { SheetField, RollPick } from '../sheets/types';

// The chooser by a custom system's sheet (6b2b; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19: "a roll with changes asks first; one without rolls straight away"). Opened by a die
// button whose field has more than one roll, or a roll with changes: which roll, the changes picked
// (a change that costs something shows what it costs, and waits for the table to take costs), then
// ROLL or CANCEL. It remembers nothing between rolls; how a roll rolls is the server's.

interface Props {
  field: SheetField;
  onRoll: (pick: RollPick) => void;
  onCancel: () => void;
}

export function RollChooser({ field, onRoll, onCancel }: Props) {
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
            const costs = !!c.cost;
            return (
              <button key={c.id} type="button" role="switch" aria-checked={on} disabled={costs}
                title={costs ? 'The table takes what a change costs in the next update' : undefined}
                onClick={() => setChanges(on ? changes.filter((x) => x !== c.id) : [...changes, c.id])}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'var(--cyan)', fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: 1, cursor: costs ? 'default' : 'pointer', opacity: costs ? 0.5 : 1, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span aria-hidden style={{ width: 18, height: 9, borderRadius: 5, border: '1px solid var(--cyan)', background: on ? 'var(--cyan)' : 'none', flexShrink: 0 }} />
                {c.label.toUpperCase()}{c.cost ? ` · COSTS ${c.cost.amount} ${c.cost.from.toUpperCase()}, NOT YET` : ''}
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
