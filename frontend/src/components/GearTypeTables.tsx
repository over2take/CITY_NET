import React, { useState } from 'react';
import { CARRY_STATES, type InventoryItem } from '../sheets/inventory';
import type { ItemsShown } from '../sheets/gearItems';
import { gearTables, valueText, withLineValue, newLineOf, shownCells, cellWords, type Cell } from '../sheets/gearTypes';

// A custom system's gear by item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14), each thing one
// compact line (8a3c1; approved mockup docs/mockups/gear-compact.html, 2026-11-15, after the user saw SHEET.EXE's table
// scroll sideways): its name, how many, where it is, ✎ and × on top; under it only the columns it has, as words, its
// item's faint, ROLL beside a DAMAGE or DICE; an empty column one it doesn't have. ✎ opens every column as a box, one line
// at a time, closed by DONE, ✎ again or opening another; a line made by hand opens so. One layout in SHEET.EXE and the
// standalone tab, the wider fitting more on a line. What goes where is sheets/gearTypes.ts; the lines are the one
// inventory, written back whole.

interface Props {
  items: InventoryItem[];
  itemsShown: ItemsShown;
  readOnly: boolean;
  write: (next: InventoryItem[]) => void;
  /** Whether a line is an item installed: kept named and in place. */
  locked: (index: number) => boolean;
  /** What goes under a line: an item's WEAR, ATTUNE and uses. */
  under: (index: number) => React.ReactNode;
  /** A DAMAGE or DICE rolled into the log (8a3b), where the viewer may roll: read only or not, as a stat's ROLL. */
  onRoll?: (index: number, column: string) => void;
}

const input: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--black) 50%, transparent)', border: '1px solid var(--green)', color: 'var(--green)',
  fontFamily: 'inherit', fontSize: '0.7rem', padding: '1px 4px', width: '100%', boxSizing: 'border-box', minWidth: 0,
};
const heading: React.CSSProperties = { fontSize: '0.55rem', opacity: 0.85, letterSpacing: '1px' };
const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.65 };
const smallButton: React.CSSProperties = { fontSize: '0.5rem', padding: '0 5px', letterSpacing: '1px', flexShrink: 0 };

/** A column's box under ✎: the line's own value, its item's faint where it has none, "none" where neither. */
function CellBox({ cell, label, readOnly, onType }: { cell: Cell; label: string; readOnly: boolean; onType: (typed: string) => void }) {
  const { column } = cell;
  const given = cell.given !== undefined ? valueText(cell.given) : 'none';
  if (column.kind === 'pick') {
    return (
      <select aria-label={label} value={valueText(cell.own)} disabled={readOnly} style={input} onChange={(e) => onType(e.target.value)}>
        <option value="">{given}</option>
        {(column.options ?? []).map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
    );
  }
  const number = column.kind === 'number' || column.kind === 'count';
  return (
    <input aria-label={label} type={number ? 'number' : 'text'} min={column.kind === 'count' ? 0 : undefined} step={column.kind === 'count' ? 1 : 'any'}
      value={valueText(cell.own)} placeholder={given} readOnly={readOnly} onChange={(e) => onType(e.target.value)}
      style={{ ...input, ...(number ? { width: '90px' } : {}) }} />
  );
}

export function GearTypeTables({ items, itemsShown, readOnly, write, locked, under, onRoll }: Props) {
  // The one line open under ✎, by its place in the inventory.
  const [open, setOpen] = useState<number | null>(null);
  const tables = gearTables(itemsShown, items);
  const patch = (i: number, next: InventoryItem) => write(items.map((it, n) => (n === i ? next : it)));
  const remove = (i: number) => {
    write(items.filter((_, n) => n !== i));
    setOpen((o) => (o === null || o === i ? null : o > i ? o - 1 : o));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {tables.map(({ type, rows }) => (
        <section key={type.id} aria-label={`${type.label} gear`} style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={heading}>{type.label.toUpperCase()} · {rows.length}</span>
            {!readOnly && (
              <button type="button" className="utility-btn" style={{ fontSize: '0.55rem', padding: '1px 8px' }} aria-label={`Add a ${type.one} by hand`}
                // A line made by hand opens under ✎, to be filled.
                onClick={() => { write([...items, newLineOf(type)]); setOpen(items.length); }}>+ {type.one.toUpperCase()}</button>
            )}
          </div>
          {rows.map(({ index: i, line, columns: lc }) => {
            const cells = shownCells(lc);
            const editing = open === i;
            const stashed = line.carry === 'stash';
            const lockedTitle = locked(i) ? 'Installed: REMOVE it first' : undefined;
            return (
              <div key={i} data-testid={`gear-line-${i}`} style={{ borderLeft: '1px solid var(--dark-green)', padding: '2px 0 4px 8px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, opacity: stashed ? 0.6 : 1 }}>
                <div style={{ display: 'grid', gridTemplateColumns: readOnly ? 'minmax(0, 1fr) 40px 84px' : 'minmax(0, 1fr) 40px 84px 22px 14px', gap: '5px', alignItems: 'center' }}>
                  <input aria-label={`Item ${i + 1} name`} value={line.name} readOnly={readOnly || locked(i)} title={lockedTitle}
                    onChange={(e) => patch(i, { ...line, name: e.target.value })} style={input} />
                  <input aria-label={`Item ${i + 1} quantity`} type="number" min="1" value={line.qty} readOnly={readOnly}
                    onChange={(e) => patch(i, { ...line, qty: Math.max(1, Number(e.target.value) || 1) })} style={{ ...input, textAlign: 'center' }} />
                  <select aria-label={`Item ${i + 1} carried`} value={line.carry} disabled={readOnly || locked(i)} title={lockedTitle}
                    onChange={(e) => patch(i, { ...line, carry: e.target.value as InventoryItem['carry'] })} style={input}>
                    {CARRY_STATES.map((c) => <option key={c.value} value={c.value} title={c.title}>{c.value === 'stash' ? 'STASH' : c.value.toUpperCase()}</option>)}
                  </select>
                  {!readOnly && (
                    <button type="button" aria-label={`Edit item ${i + 1}`} aria-pressed={editing} title={editing ? 'Done' : 'Every column, as boxes'}
                      onClick={() => setOpen(editing ? null : i)}
                      style={{ background: editing ? 'var(--green)' : 'none', color: editing ? 'var(--black)' : 'var(--green)', border: '1px solid var(--green)', cursor: 'pointer', padding: 0, fontSize: '0.7rem', lineHeight: 1.2, fontFamily: 'inherit' }}>✎</button>
                  )}
                  {!readOnly && (
                    <button type="button" aria-label={`Remove item ${i + 1}`} disabled={locked(i)} title={lockedTitle} onClick={() => remove(i)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: locked(i) ? 'not-allowed' : 'pointer', opacity: locked(i) ? 0.35 : 1, padding: 0, fontSize: '0.8rem', lineHeight: 1 }}>×</button>
                  )}
                </div>
                {/* Only the columns it has, as words: its item's faint, ROLL beside a DAMAGE or DICE (8a3b); kept over the boxes
                    while ✎ is open, as the mockup draws it. */}
                {(cells.length > 0 || stashed) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'center', fontSize: '0.7rem' }}>
                    {cells.map((cell) => {
                      const label = `Item ${i + 1} ${cell.column.label}`;
                      const rolls = (cell.column.kind === 'damage' || cell.column.kind === 'dice') && onRoll;
                      return (
                        <span key={cell.column.id} role="note" aria-label={`${label}: ${cellWords(cell)}`} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                          <b style={{ ...small, fontWeight: 'normal' }}>{cell.column.label.toUpperCase()}</b>
                          <span title={cell.own === undefined ? 'As the item has it' : 'This line\'s own'} style={{ opacity: cell.own === undefined ? 0.7 : 1 }}>{cellWords(cell)}</span>
                          {rolls && (
                            <button type="button" className="utility-btn" aria-label={`Roll ${label}`} title={`Roll ${valueText(cell.value)}`}
                              onClick={() => onRoll(i, cell.column.id)} style={smallButton}>ROLL</button>
                          )}
                        </span>
                      );
                    })}
                    {/* Where a stashed thing is, as words (its box is under ✎). */}
                    {stashed && line.location && (
                      <span style={{ display: 'inline-flex', gap: '4px', whiteSpace: 'nowrap' }}><b style={{ ...small, fontWeight: 'normal' }}>STASHED</b>{line.location}</span>
                    )}
                  </div>
                )}
                {!editing && !readOnly && cells.length === 0 && type.columns.length > 0 && (
                  <span style={small}>NOTHING FILLED IN · ✎ TO FILL IT</span>
                )}
                {/* ✎: every column as a box, its item's value faint until typed over, "none" where it has none. */}
                {editing && (
                  <div role="group" aria-label={`Item ${i + 1} columns`} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: '3px 8px', alignItems: 'center', fontSize: '0.6rem', padding: '3px 0' }}>
                    {lc.cells.map((cell) => (
                      <React.Fragment key={cell.column.id}>
                        <span style={{ ...small, textAlign: 'right' }}>{cell.column.label.toUpperCase()}{cell.column.kind === 'number' && cell.column.unit ? ` (${cell.column.unit})` : ''}</span>
                        <CellBox cell={cell} label={`Item ${i + 1} ${cell.column.label}`} readOnly={readOnly} onType={(typed) => patch(i, withLineValue(line, cell.column, typed))} />
                      </React.Fragment>
                    ))}
                    <span style={{ ...small, textAlign: 'right' }} title="Where a stashed item actually is">LOCATION</span>
                    <input aria-label={`Item ${i + 1} location`} value={line.location} readOnly={readOnly} placeholder={stashed ? 'where is it?' : ''}
                      onChange={(e) => patch(i, { ...line, location: e.target.value })} style={input} />
                    <span />
                    <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button type="button" className="utility-btn" onClick={() => setOpen(null)} style={{ fontSize: '0.55rem', padding: '1px 10px' }}>DONE</button>
                      <span style={{ ...small, fontSize: '0.5rem' }}>or ✎ again; opening another line closes this one</span>
                    </span>
                  </div>
                )}
                {under(i)}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
