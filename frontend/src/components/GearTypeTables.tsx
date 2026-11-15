import React from 'react';
import { CARRY_STATES, type InventoryItem } from '../sheets/inventory';
import type { ItemsShown } from '../sheets/gearItems';
import { gearTables, valueText, withLineValue, newLineOf, type Cell, type ColumnShown } from '../sheets/gearTypes';

// A custom system's gear as a table per item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14): each
// type's lines with its columns, a line's own value over its item's (shown faint until typed over), and + to add a line
// of the type by hand. What goes where is sheets/gearTypes.ts; the lines are the one inventory, written back whole.

interface Props {
  items: InventoryItem[];
  itemsShown: ItemsShown;
  readOnly: boolean;
  write: (next: InventoryItem[]) => void;
  /** Whether a line is an item installed: kept named and in place. */
  locked: (index: number) => boolean;
  /** What goes under a line: an item's WEAR, ATTUNE and uses. */
  under: (index: number) => React.ReactNode;
}

const input: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--black) 50%, transparent)', border: '1px solid var(--green)', color: 'var(--green)',
  fontFamily: 'inherit', fontSize: '0.7rem', padding: '1px 4px', width: '100%', boxSizing: 'border-box', minWidth: 0,
};
const heading: React.CSSProperties = { fontSize: '0.55rem', opacity: 0.65, letterSpacing: '1px', textAlign: 'left', alignSelf: 'end', overflowWrap: 'anywhere', lineHeight: 1.2 };

/** How wide a column of a kind is. */
const WIDTH: Record<ColumnShown['kind'], string> = { number: '60px', count: '56px', text: '110px', damage: '120px', dice: '120px', pick: '90px' };

/** One cell: a box of the line's own value, its item's showing faint where it has none. */
function CellBox({ cell, label, readOnly, onType }: { cell: Cell; label: string; readOnly: boolean; onType: (typed: string) => void }) {
  const { column } = cell;
  if (column.kind === 'pick') {
    return (
      <select aria-label={label} value={valueText(cell.own)} disabled={readOnly} style={input} onChange={(e) => onType(e.target.value)}>
        <option value="">{cell.given !== undefined ? valueText(cell.given) : '—'}</option>
        {(column.options ?? []).map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
    );
  }
  const number = column.kind === 'number' || column.kind === 'count';
  return (
    <input aria-label={label} type={number ? 'number' : 'text'} min={column.kind === 'count' ? 0 : undefined} step={column.kind === 'count' ? 1 : 'any'}
      value={valueText(cell.own)} placeholder={valueText(cell.given)} readOnly={readOnly} onChange={(e) => onType(e.target.value)}
      style={{ ...input, ...(number ? { textAlign: 'center' } : {}) }} />
  );
}

export function GearTypeTables({ items, itemsShown, readOnly, write, locked, under }: Props) {
  const tables = gearTables(itemsShown, items);
  const patch = (i: number, next: InventoryItem) => write(items.map((it, n) => (n === i ? next : it)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {tables.map(({ type, rows }) => {
        const columns = ['minmax(110px, 1fr)', '44px', ...type.columns.map((c) => WIDTH[c.kind]), '84px', 'minmax(80px, 1fr)', ...(readOnly ? [] : ['20px'])].join(' ');
        return (
          <section key={type.id} aria-label={`${type.label} gear`} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ ...heading, opacity: 0.85 }}>{type.label.toUpperCase()} · {rows.length}</span>
              {!readOnly && (
                <button type="button" className="utility-btn" style={{ fontSize: '0.55rem', padding: '1px 8px' }} aria-label={`Add a ${type.one} by hand`}
                  onClick={() => write([...items, newLineOf(type)])}>+ {type.one.toUpperCase()}</button>
              )}
            </div>
            {rows.length > 0 && (
              // Its own themed scrollbar: a nested scroll box otherwise draws the browser's wide default over the boxes.
              <div className="crt-scroll" style={{ overflowX: 'auto', paddingBottom: '2px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: columns, gap: '4px 6px', alignItems: 'center', minWidth: 'min-content' }}>
                  <div style={heading}>NAME</div>
                  <div style={heading}>QTY</div>
                  {type.columns.map((c) => <div key={c.id} style={heading}>{c.label.toUpperCase()}{c.kind === 'number' && c.unit ? ` (${c.unit})` : ''}</div>)}
                  <div style={heading}>WHERE</div>
                  <div style={heading} title="Where a stashed item actually is">LOCATION</div>
                  {!readOnly && <div />}
                  {rows.map(({ index: i, line, columns: lc }) => (
                    <React.Fragment key={i}>
                      <input aria-label={`Item ${i + 1} name`} value={line.name} readOnly={readOnly || locked(i)} title={locked(i) ? 'Installed: REMOVE it first' : undefined}
                        onChange={(e) => patch(i, { ...line, name: e.target.value })} style={input} />
                      <input aria-label={`Item ${i + 1} quantity`} type="number" min="1" value={line.qty} readOnly={readOnly}
                        onChange={(e) => patch(i, { ...line, qty: Math.max(1, Number(e.target.value) || 1) })} style={{ ...input, textAlign: 'center' }} />
                      {lc.cells.map((cell) => (
                        <CellBox key={cell.column.id} cell={cell} label={`Item ${i + 1} ${cell.column.label}`} readOnly={readOnly}
                          onType={(typed) => patch(i, withLineValue(line, cell.column, typed))} />
                      ))}
                      <select aria-label={`Item ${i + 1} carried`} value={line.carry} disabled={readOnly || locked(i)} title={locked(i) ? 'Installed: REMOVE it first' : undefined}
                        onChange={(e) => patch(i, { ...line, carry: e.target.value as InventoryItem['carry'] })} style={input}>
                        {CARRY_STATES.map((c) => <option key={c.value} value={c.value} title={c.title}>{c.value === 'stash' ? 'STASH' : c.value.toUpperCase()}</option>)}
                      </select>
                      <input aria-label={`Item ${i + 1} location`} value={line.location} readOnly={readOnly} placeholder={line.carry === 'stash' ? 'where is it?' : ''}
                        onChange={(e) => patch(i, { ...line, location: e.target.value })} style={input} />
                      {!readOnly && (
                        <button type="button" aria-label={`Remove item ${i + 1}`} disabled={locked(i)} title={locked(i) ? 'Installed: REMOVE it first' : undefined}
                          onClick={() => write(items.filter((_, n) => n !== i))}
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: locked(i) ? 'not-allowed' : 'pointer', opacity: locked(i) ? 0.35 : 1, padding: 0, fontSize: '0.8rem', lineHeight: 1 }}>×</button>
                      )}
                      {under(i)}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
