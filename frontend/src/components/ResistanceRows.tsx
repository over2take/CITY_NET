import React from 'react';
import type { Definition } from '../sheets/systemsApi';
import { KINDS, type Kind } from '../sheets/damageTypes';
import { KIND_WORDS, LIMIT, typeChoices, withRow, withNewRow, withoutRow, type Resistance } from '../sheets/resistances';

// A RESISTANCE row (8b3b; approved mockup docs/mockups/damage-pipeline.html, 2026-11-23): RESIST, IMMUNE or VULNERABLE, to
// a damage type or ALL, × beside them, and when it counts in words under; + RESISTANCE under them. On a feature's form (CHOICES and
// ITEMS) and a condition's (CONDITIONS). The rules are sheets/resistances.ts.

const small: React.CSSProperties = { fontSize: 11, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };

export function ResistanceRows({ definition, rows, onChange, when, inputStyle }: {
  definition: Definition;
  rows: Resistance[];
  onChange: (rows: Resistance[]) => void;
  /** When it counts, in words: "at level 3", "while the item counts", "while it is on". */
  when: string;
  inputStyle: React.CSSProperties;
}) {
  const choices = typeChoices(definition, rows.map((r) => r.type));
  const full = withNewRow(definition, rows) === rows;
  return (
    <div role="group" aria-label="Resistances" style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      {rows.map((r, i) => {
        const known = choices.find((t) => t.id === r.type);
        return (
          // A row has no id of its own: its place is what it is.
          <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            {/* As CHANGES A ROLL's rows: the two boxes share the width, × never pushed under them. */}
            <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 6, alignItems: 'center', maxWidth: 360 }}>
              <select aria-label={`Resistance ${i + 1}: kind`} value={r.kind} style={inputStyle} onChange={(e) => onChange(withRow(rows, i, { kind: e.target.value as Kind }))}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
              </select>
              <select aria-label={`Resistance ${i + 1}: type`} value={r.type} style={inputStyle} onChange={(e) => onChange(withRow(rows, i, { type: e.target.value }))}>
                {!known && <option value={r.type}>{r.type.toUpperCase()} (NOT A TYPE)</option>}
                {choices.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id !== r.type && rows.some((x) => x.type === t.id)}>{t.name}{t.off ? ' (OFF)' : ''}</option>
                ))}
              </select>
              <button type="button" className="utility-btn" aria-label={`Remove resistance ${i + 1}`}
                style={{ ...btn, padding: '2px 7px', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => onChange(withoutRow(rows, i))}>×</button>
            </span>
            <span style={small}>{known?.off ? 'counts for nothing while its type is off' : when}</span>
          </span>
        );
      })}
      <div>
        <button type="button" className="utility-btn" style={btn} disabled={full} title={rows.length >= LIMIT ? `At most ${LIMIT}` : undefined}
          onClick={() => onChange(withNewRow(definition, rows))}>+ RESISTANCE</button>
      </div>
    </div>
  );
}
