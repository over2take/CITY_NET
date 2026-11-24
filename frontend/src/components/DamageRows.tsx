import React, { useState } from 'react';
import { rowsOf, textOf, withRow, withNewRow, withoutRow, type DamageRow, type RowType } from '../sheets/damageRows';
import { IconLook } from './IconLook';

// An item's DAMAGE as rows (8b2b; approved 2026-11-23, "that's perfect"): one per part, its dice in a box with eˣ (the
// caller's: the builder's formula box, or the sheet's), its TYPE from the game's damage types or NO TYPE, DMG, × for all but
// one; + PART adds another, its type the column's MOST LINES ARE or the last part's. What is kept is the text
// (sheets/damageRows.ts), so a part being typed stays a row while it has no dice. A text the rows can't say the same is the
// caller's one box.

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** The game's damage types that are on, with their pictures. */
  types: (RowType & { icon?: string; drawn?: string[] })[];
  /** The column's MOST LINES ARE (a type id): what an empty DAMAGE and a new part start as. */
  usual?: string | null;
  /** What the first part's box is called: "Flame Tongue DAMAGE". The rest add "part 2". */
  label: string;
  /** A part's dice box, with its eˣ and its words line. */
  renderDice: (part: { i: number; dice: string; onDice: (dice: string) => void; label: string }) => React.ReactNode;
  /** The one box, for a text the rows can't say the same. */
  fallback: React.ReactNode;
  /** Under the last part where there are several: what it all comes to. */
  whole?: React.ReactNode;
  readOnly?: boolean;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.75 };
const select: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 11, padding: '3px 4px', minWidth: 0, maxWidth: 160,
};

export function DamageRows({ value, onChange, types, usual = null, label, renderDice, fallback, whole, readOnly = false }: Props) {
  // The rows being written, with the text they make: kept while that is still the value, so a part with no dice yet stays.
  const [draft, setDraft] = useState<{ text: string; rows: DamageRow[] } | null>(null);
  // A usual type that isn't on writes nothing: textOf finds no name for it.
  const rows = draft && draft.text === value ? draft.rows
    : !value.trim() ? [{ dice: '', type: usual }] : rowsOf(value, types);
  if (!rows) return <>{fallback}</>;
  const put = (next: DamageRow[]) => {
    const text = textOf(next, types);
    setDraft({ text, rows: next });
    if (text !== value) onChange(text);
  };
  const partLabel = (i: number) => (i === 0 ? label : `${label} part ${i + 1}`);

  return (
    <div role="group" aria-label={`${label} parts`} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {rows.map((r, i) => {
        const t = types.find((x) => x.id === r.type);
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>{renderDice({ i, dice: r.dice, onDice: (dice) => put(withRow(rows, i, { dice })), label: partLabel(i) })}</div>
            <span style={{ display: 'flex', gap: 5, alignItems: 'center', paddingTop: 3 }}>
              <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center', color: 'var(--green)' }}>{t && <IconLook icon={t.icon} drawn={t.drawn} size={14} />}</span>
              <select aria-label={`${partLabel(i)} type`} value={r.type ?? ''} disabled={readOnly} style={select}
                onChange={(e) => put(withRow(rows, i, { type: e.target.value || null }))}>
                <option value="">NO TYPE</option>
                {types.map((x) => <option key={x.id} value={x.id}>{x.name.toUpperCase()}</option>)}
              </select>
              <span style={small}>DMG</span>
              {rows.length > 1 && !readOnly && (
                <button type="button" className="utility-btn danger-btn" aria-label={`Remove ${partLabel(i)}`} style={{ fontFamily: 'monospace', fontSize: 11, padding: '1px 7px' }}
                  onClick={() => put(withoutRow(rows, i))}>×</button>
              )}
            </span>
          </div>
        );
      })}
      {whole}
      {!readOnly && (
        <div>
          <button type="button" className="utility-btn" aria-label={`Add a part to ${label}`} style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '3px 9px' }}
            onClick={() => put(withNewRow(rows, usual))}>+ PART</button>
        </div>
      )}
    </div>
  );
}
