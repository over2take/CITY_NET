import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import { CARRY_STATES, type InventoryItem } from '../sheets/inventory';
import type { ItemsShown } from '../sheets/gearItems';
import { gearTables, gearBands, valueText, withLineValue, newLineOf, shownCells, cellWords, countOf, type Cell, type CountAnswer, type CountKind, type TableRow, type TypeShown } from '../sheets/gearTypes';
import { useGearBands } from '../hooks/useGearBands';
import { diceWords, SHAPES, shapeText, insertName, type GearDiceRead } from '../sheets/gearDice';
import { FormulaIcon } from './FormulaIcon';

// A custom system's gear by item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14), each thing one
// compact line (8a3c1; approved mockup docs/mockups/gear-compact.html, 2026-11-15, after the user saw SHEET.EXE's table
// scroll sideways): its name, how many, where it is, ✎ and × on top; under it only the columns it has, as words, its
// item's faint, ROLL beside a DAMAGE or DICE; an empty column one it doesn't have. ✎ opens every column as a box, one line
// at a time, closed by DONE, ✎ again or opening another; a line made by hand opens so. One layout in SHEET.EXE and the
// standalone tab, the wider fitting more on a line. What goes where is sheets/gearTypes.ts; the lines are the one
// inventory, written back whole. A COUNT reads "AMMO 4 / 6" with its button (FIRE) and RELOAD beside it (8a4b), done by
// the server, which asks which carried line to reload from when there are several. The lines in bands (G2; approved mockup
// docs/mockups/sheet-gear-layout.html, layout A): EQUIPPED, USABLE and PACK by each type's ON THE SHEET, a group per type,
// in hand first; STASH, closed to start, whatever the type; a band's head closes it and the sheet remembers. A thing is
// made by hand from the row of + buttons at the top; a closed band something lands in pulses, then stays bright until
// opened; a thing worn, attuned or installed is in EQUIPPED whatever its type. One line a thing (G3; the same mockup, decision 3): its name, how many,
// the columns it has as words with ROLL, FIRE and RELOAD, where it is carried; a click on it opens the card, every column a
// box with NAME, HOW MANY, LOCATION and REMOVE, one card at a time; ✎ at the end of every line opens it too. A line with
// nothing filled in at all, on it or its item, says FILL IN, which opens the card at its first box: a column blank beside
// others filled is one that doesn't apply (8a3c1), so says nothing (the user, 2026-11-22). A PICK ONE box is as wide as its
// words.

interface Props {
  items: InventoryItem[];
  itemsShown: ItemsShown;
  readOnly: boolean;
  write: (next: InventoryItem[]) => void;
  /** Whether a line is an item installed: kept named and in place. */
  locked: (index: number) => boolean;
  /** Whether a line is an item worn, attuned or installed: on you, so in EQUIPPED whatever its type's band. */
  on?: (index: number) => boolean;
  /** What goes under a line: an item's WEAR, ATTUNE and uses. */
  under: (index: number) => React.ReactNode;
  /** A DAMAGE or DICE rolled into the log (8a3b), where the viewer may roll: read only or not, as a stat's ROLL. */
  onRoll?: (index: number, column: string) => void;
  /** A DAMAGE or DICE as typed under ✎, read as ROLL would on this character (8a3c2): its words line and eˣ. */
  onReadDice?: (text: string) => Promise<GearDiceRead | null>;
  /**
   * A COUNT's button (FIRE, USE) or RELOAD, done by the server (8a4b): the line by its place, the column by id, RELOAD's
   * `from` the carried line picked once asked. Null where no answer came.
   */
  onCount?: (index: number, column: string, kind: CountKind, from?: number) => Promise<CountAnswer | null>;
}

const input: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--black) 50%, transparent)', border: '1px solid var(--green)', color: 'var(--green)',
  fontFamily: 'inherit', fontSize: '0.7rem', padding: '1px 4px', width: '100%', boxSizing: 'border-box', minWidth: 0,
};
const heading: React.CSSProperties = { fontSize: '0.55rem', opacity: 0.85, letterSpacing: '1px' };
const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.65 };
const smallButton: React.CSSProperties = { fontSize: '0.5rem', padding: '0 5px', letterSpacing: '1px', flexShrink: 0 };

/** A column's box under ✎: the line's own value, its item's faint where it has none, "none" where neither. */
function CellBox({ cell, label, readOnly, onType, focus = false }: { cell: Cell; label: string; readOnly: boolean; onType: (typed: string) => void; focus?: boolean }) {
  const { column } = cell;
  const given = cell.given !== undefined ? valueText(cell.given) : 'none';
  if (column.kind === 'pick') {
    return (
      // As wide as its longest word (asked 2026-11-20), not the whole card: GRADE beside 90-wide number boxes.
      <select aria-label={label} value={valueText(cell.own)} disabled={readOnly} autoFocus={focus} style={{ ...input, width: 'auto', maxWidth: '100%' }} onChange={(e) => onType(e.target.value)}>
        <option value="">{given}</option>
        {(column.options ?? []).map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
    );
  }
  const number = column.kind === 'number' || column.kind === 'count';
  return (
    <input aria-label={label} type={number ? 'number' : 'text'} min={column.kind === 'count' ? 0 : undefined} step={column.kind === 'count' ? 1 : 'any'}
      value={valueText(cell.own)} placeholder={given} readOnly={readOnly} autoFocus={focus} onChange={(e) => onType(e.target.value)}
      style={{ ...input, ...(number ? { width: '90px' } : {}) }} />
  );
}

/**
 * A DAMAGE or DICE under ✎ (8a3c2; decision 4 of the gear mockup): this line's own dice, which ROLL rolls, its item's
 * faint until typed over and back when cleared; under it, what it reads on this character, worked out by the server as
 * ROLL would, or what is wrong with it; and eˣ, as the builder's formula box has it: SHAPE writes a common one, INSERT
 * puts in one of the system's names.
 */
function DiceBox({ cell, label, onType, onRead, focus = false }: { cell: Cell; label: string; onType: (typed: string) => void; onRead: (text: string) => Promise<GearDiceRead | null>; focus?: boolean }) {
  const [open, setOpen] = useState(false);
  // What the server said, kept with the text it was said of: an answer for older text is never shown.
  const [read, setRead] = useState<{ text: string; result: GearDiceRead | null } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const cursor = useRef(0);
  // What it rolls: its own, else its item's.
  const text = valueText(cell.own ?? cell.given);
  // Asked again only when the text changes, a moment after typing stops: the reader is a new function each render.
  const ask = useEffectEvent((t: string) => onRead(t));
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => { void ask(text).then((result) => { if (live) setRead({ text, result }); }); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);
  const result = read?.text === text ? read.result : null;
  const { words, bad } = diceWords(text, result, cell.column.label);
  const names = result?.names ?? [];
  const put = (next: string) => onType(next);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
      <span style={{ display: 'flex', gap: '4px', minWidth: 0 }}>
        <input ref={input} aria-label={label} type="text" value={valueText(cell.own)} placeholder={cell.given !== undefined ? valueText(cell.given) : 'none'}
          aria-invalid={bad || undefined} spellCheck={false} autoFocus={focus}
          onChange={(e) => { onType(e.target.value); cursor.current = e.target.selectionStart ?? e.target.value.length; }}
          onSelect={(e) => { cursor.current = (e.target as HTMLInputElement).selectionStart ?? 0; }}
          style={{ ...input, flex: 1, ...(bad ? { borderColor: 'var(--danger)' } : {}) }} />
        <button type="button" aria-label={`Help writing ${label}`} aria-expanded={open} title="Help writing it" onClick={() => setOpen((o) => !o)}
          style={{
            width: 24, flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            border: `1px solid ${open ? 'var(--cyan)' : 'var(--green)'}`, color: open ? 'var(--cyan)' : 'var(--green)',
            background: open ? 'color-mix(in srgb, var(--cyan) 18%, transparent)' : 'none',
          }}>
          <FormulaIcon size={13} />
        </button>
      </span>
      <span role="status" aria-label={`${label} on this character`} style={{ fontSize: '0.6rem', letterSpacing: '1px', color: bad ? 'var(--danger)' : 'var(--cyan)', overflowWrap: 'anywhere' }}>{words}</span>
      {open && (
        <span role="group" aria-label={`Help writing ${label}`} style={{ border: '1px solid var(--cyan)', padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.6rem' }}>
          <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={small}>SHAPE</span>
            {SHAPES.map((s) => (
              <button key={s} type="button" className="utility-btn" onClick={() => put(shapeText(s, names))} style={{ fontSize: '0.55rem', padding: '1px 6px' }}>{s}</button>
            ))}
          </span>
          {names.length > 0 && (
            <span style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={small}>INSERT</span>
              {names.map((n) => (
                <button key={n.token} type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { const next = insertName(text, Math.min(cursor.current || text.length, text.length), n.token); put(next.text); cursor.current = next.cursor; input.current?.focus(); }}
                  style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan)', fontFamily: 'inherit', fontSize: '0.6rem', cursor: 'pointer' }}>
                  {n.token} <span style={{ opacity: 0.6 }}>{n.label}</span>
                </button>
              ))}
            </span>
          )}
          <span style={{ ...small, fontSize: '0.5rem' }}>Reads this character&apos;s own numbers. A name the system hasn&apos;t got is said here, never rolled.</span>
        </span>
      )}
    </span>
  );
}

export function GearTypeTables({ items, itemsShown, readOnly, write, locked, on, under, onRoll, onReadDice, onCount }: Props) {
  // The one line open under ✎, by its place in the inventory.
  const [open, setOpen] = useState<number | null>(null);
  // The box the open card starts at: a column's id from FILL IN, 'name' for a line made by hand, else none.
  const [focusAt, setFocusAt] = useState<string | null>(null);
  // A COUNT's RELOAD asking which carried line to take from, or what the server said no with, on the line that asked.
  const [asked, setAsked] = useState<{ index: number; column: string; label: string; from: { line: number; name: string; qty: number }[] } | null>(null);
  const [said, setSaid] = useState<{ index: number; text: string } | null>(null);
  // Waiting on the server: the buttons held, so a quick second FIRE never spends from an answer not yet back.
  const [busy, setBusy] = useState(false);
  const tables = gearTables(itemsShown, items);
  const patch = (i: number, next: InventoryItem) => write(items.map((it, n) => (n === i ? next : it)));
  const remove = (i: number) => {
    write(items.filter((_, n) => n !== i));
    setOpen((o) => (o === null || o === i ? null : o > i ? o - 1 : o));
    // Lines after it move up: what was asked or said of one is no longer where it was.
    setAsked(null);
    setSaid(null);
  };
  const count = (index: number, column: string, label: string, kind: CountKind, from?: number) => {
    if (!onCount) return;
    setBusy(true);
    setAsked(null);
    setSaid(null);
    void onCount(index, column, kind, from).then((answer) => {
      setBusy(false);
      if (!answer) setSaid({ index, text: 'No answer from the server: try again' });
      else if ('ask' in answer) setAsked({ index, column, label, from: answer.ask });
      else if (!answer.ok) setSaid({ index, text: answer.error });
    });
  };
  const bands = gearBands(itemsShown, items, on);
  const { shut, toggle, openBand, news } = useGearBands(Object.fromEntries(bands.map((b) => [b.band, b.count])));
  const bandOfType = (type: TypeShown) => (type.on_sheet === 'equipped' || type.on_sheet === 'usable' ? type.on_sheet : 'pack');
  /** One line a thing (G3), by its place; a click opens its card. `tagged`, in the STASH, says its type. */
  const lineView = ({ index: i, line, columns: lc }: TableRow, type: TypeShown, tagged = false) => {
    const cells = shownCells(lc);
    // Blank on the line and its item alike. Only every column blank is FILL IN: one blank beside others filled doesn't apply.
    const blank = lc.cells.filter((c) => c.own === undefined && c.given === undefined);
    const nothingFilled = blank.length > 0 && blank.length === lc.cells.length;
    const editing = open === i;
    const stashed = line.carry === 'stash';
    const lockedTitle = locked(i) ? 'Installed: REMOVE it first' : undefined;
    const name = line.name.trim() || 'UNNAMED';
    const openAt = (at: string | null) => { setOpen(editing && at === null ? null : i); setFocusAt(at); };
    return (
      <div key={i} data-testid={`gear-line-${i}`} style={{ borderLeft: `1px solid ${editing ? 'var(--green)' : 'var(--dark-green)'}`, padding: '2px 0 4px 8px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, opacity: stashed ? 0.6 : 1 }}>
        {/* In the STASH, whatever its type: the type said, so GUNS and WEAPONS still read apart. */}
        {tagged && <span style={small}>{type.label.toUpperCase()}</span>}
        {/* The line: a click anywhere on it but its buttons and box opens or closes the card. */}
        <div onClick={(e) => { if (!readOnly && !(e.target as HTMLElement).closest('button, input, select, a')) openAt(null); }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'center', fontSize: '0.7rem', minWidth: 0, cursor: readOnly ? 'default' : 'pointer' }}>
          {readOnly
            ? <span style={{ color: 'var(--green)', overflowWrap: 'anywhere' }}>{name}</span>
            : <button type="button" aria-label={`${name}, item ${i + 1}`} aria-expanded={editing} title={editing ? 'Close its card' : 'Open its card: every column, to change'}
                onClick={() => openAt(null)}
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--green)', fontFamily: 'inherit', fontSize: '0.75rem', textAlign: 'left', cursor: 'pointer', overflowWrap: 'anywhere', textDecoration: editing ? 'underline' : 'none', opacity: line.name.trim() ? 1 : 0.6 }}>{name}</button>}
          {line.qty > 1 && <span title="How many">×{line.qty}</span>}
          {/* Only the columns it has, as words: its item's faint, ROLL beside a DAMAGE or DICE (8a3b). */}
          {cells.map((cell) => {
            const label = `Item ${i + 1} ${cell.column.label}`;
            const rolls = (cell.column.kind === 'damage' || cell.column.kind === 'dice') && onRoll;
            // A COUNT (8a4b; decision 6 of the gear mockup): "AMMO 4 / 6", its button and RELOAD beside it, like ROLL.
            const left = cell.column.kind === 'count' && onCount ? countOf(line, cell) : null;
            const word = cell.column.label.toUpperCase();
            const button = (cell.column.button || 'USE').toUpperCase();
            const reload = cell.column.reload ?? [];
            return (
              <span key={cell.column.id} role="note" aria-label={`${label}: ${cellWords(cell, line)}`} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <b style={{ ...small, fontWeight: 'normal' }}>{word}</b>
                <span title={cell.own === undefined ? 'As the item has it' : 'This line\'s own'} style={{ opacity: cell.own === undefined ? 0.7 : 1 }}>{cellWords(cell, line)}</span>
                {rolls && (
                  <button type="button" className="utility-btn" aria-label={`Roll ${label}`} title={`Roll ${valueText(cell.value)}`}
                    onClick={() => onRoll(i, cell.column.id)} style={smallButton}>ROLL</button>
                )}
                {left && (
                  <button type="button" className="utility-btn" aria-label={`${button} ${label}`} disabled={busy || left.now <= 0}
                    title={left.now <= 0 ? `No ${word} left` : `Use one of the ${word}`}
                    onClick={() => count(i, cell.column.id, word, 'spend')} style={smallButton}>{button}</button>
                )}
                {left && reload.length > 0 && (
                  <button type="button" className="utility-btn" aria-label={`Reload ${label}`} disabled={busy || left.now >= left.most}
                    title={left.now >= left.most ? `The ${word} is full` : `From ${reload.join(' or ')} you carry`}
                    onClick={() => count(i, cell.column.id, word, 'reload')} style={smallButton}>RELOAD</button>
                )}
              </span>
            );
          })}
          {/* Where a stashed thing is, as words (its box is in the card). */}
          {stashed && line.location && (
            <span style={{ display: 'inline-flex', gap: '4px', whiteSpace: 'nowrap' }}><b style={{ ...small, fontWeight: 'normal' }}>STASHED</b>{line.location}</span>
          )}
          {!readOnly && !editing && nothingFilled && (
            <button type="button" aria-label={`Fill in item ${i + 1}: ${blank.map((c) => c.column.label.toUpperCase()).join(', ')}`}
              title={`Blank: ${blank.map((c) => c.column.label.toUpperCase()).join(', ')}`} onClick={() => openAt(blank[0].column.id)}
              style={{ ...smallButton, background: 'none', border: '1px dashed var(--green)', color: 'var(--green)', fontFamily: 'inherit', cursor: 'pointer', opacity: 0.8 }}>FILL IN</button>
          )}
          {/* ✎: the card, as a click on the line opens it, for whoever doesn't think to click a name. */}
          {!readOnly && (
            <button type="button" aria-label={`Edit item ${i + 1}`} aria-expanded={editing} title={editing ? 'Close its card' : 'Every column, to change'} onClick={() => openAt(null)}
              style={{ marginLeft: 'auto', background: editing ? 'var(--green)' : 'none', color: editing ? 'var(--black)' : 'var(--green)', border: '1px solid var(--green)', cursor: 'pointer', padding: '0 4px', fontSize: '0.7rem', lineHeight: 1.2, fontFamily: 'inherit' }}>✎</button>
          )}
          {/* Where it is carried, one click to change, as a tag at the end of the line. */}
          <select aria-label={`Item ${i + 1} carried`} value={line.carry} disabled={readOnly || locked(i)} title={lockedTitle ?? 'Where it is carried'}
            // Moved into the stash or out of it (G2): the band it lands in opens, so the line isn't lost from sight.
            onChange={(e) => { const carry = e.target.value as InventoryItem['carry']; patch(i, { ...line, carry }); openBand(carry === 'stash' ? 'stash' : bandOfType(type)); }}
            style={{ ...input, width: 'auto', marginLeft: readOnly ? 'auto' : 0, fontSize: '0.55rem', letterSpacing: '1px', padding: '0 2px' }}>
            {CARRY_STATES.map((c) => <option key={c.value} value={c.value} title={c.title}>{c.value === 'stash' ? 'STASH' : c.value.toUpperCase()}</option>)}
          </select>
        </div>
        {/* RELOAD with more than one kind carried (Pistol Rounds, AP Rounds): which, asked on the line. */}
        {asked && asked.index === i && (
          <div role="group" aria-label={`Item ${i + 1} reload ${asked.label} from`} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center', fontSize: '0.6rem' }}>
            <span style={small}>RELOAD {asked.label} FROM</span>
            {asked.from.map((s) => (
              <button key={s.line} type="button" className="utility-btn" disabled={busy} onClick={() => count(i, asked.column, asked.label, 'reload', s.line)}
                style={{ fontSize: '0.55rem', padding: '1px 6px' }}>{s.name} ×{s.qty}</button>
            ))}
            <button type="button" onClick={() => setAsked(null)}
              style={{ background: 'none', border: 0, color: 'var(--green)', fontFamily: 'inherit', fontSize: '0.55rem', letterSpacing: '1px', cursor: 'pointer', opacity: 0.75 }}>CANCEL</button>
          </div>
        )}
        {said && said.index === i && (
          <span role="status" style={{ fontSize: '0.6rem', color: 'var(--warning)' }}>{said.text}</span>
        )}
        {/* The card: NAME and HOW MANY, every column as a box, its item's value faint until typed over, "none" where it has
            none; LOCATION; DONE and REMOVE. */}
        {editing && (
          <div role="group" aria-label={`Item ${i + 1} columns`} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: '3px 8px', alignItems: 'center', fontSize: '0.6rem', padding: '3px 0' }}>
            <span style={{ ...small, textAlign: 'right' }}>NAME</span>
            <input aria-label={`Item ${i + 1} name`} value={line.name} readOnly={locked(i)} title={lockedTitle} autoFocus={focusAt === 'name'}
              onChange={(e) => patch(i, { ...line, name: e.target.value })} style={input} />
            <span style={{ ...small, textAlign: 'right' }}>HOW MANY</span>
            <input aria-label={`Item ${i + 1} quantity`} type="number" min="1" value={line.qty}
              onChange={(e) => patch(i, { ...line, qty: Math.max(1, Number(e.target.value) || 1) })} style={{ ...input, width: '90px' }} />
            {lc.cells.map((cell) => (
              <React.Fragment key={cell.column.id}>
                {/* Beside its box's top, not halfway down a DAMAGE with its words and eˣ open under it. */}
                <span style={{ ...small, textAlign: 'right', alignSelf: 'start', paddingTop: '4px' }}>{cell.column.label.toUpperCase()}{cell.column.kind === 'number' && cell.column.unit ? ` (${cell.column.unit})` : ''}</span>
                {(cell.column.kind === 'damage' || cell.column.kind === 'dice') && onReadDice
                  ? <DiceBox cell={cell} label={`Item ${i + 1} ${cell.column.label}`} focus={focusAt === cell.column.id} onType={(typed) => patch(i, withLineValue(line, cell.column, typed))} onRead={onReadDice} />
                  : <CellBox cell={cell} label={`Item ${i + 1} ${cell.column.label}`} readOnly={readOnly} focus={focusAt === cell.column.id} onType={(typed) => patch(i, withLineValue(line, cell.column, typed))} />}
              </React.Fragment>
            ))}
            <span style={{ ...small, textAlign: 'right' }} title="Where a stashed item actually is">LOCATION</span>
            <input aria-label={`Item ${i + 1} location`} value={line.location} placeholder={stashed ? 'where is it?' : ''}
              onChange={(e) => patch(i, { ...line, location: e.target.value })} style={input} />
            <span />
            <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="utility-btn" onClick={() => setOpen(null)} style={{ fontSize: '0.55rem', padding: '1px 10px' }}>DONE</button>
              <span style={{ ...small, fontSize: '0.5rem' }} title="Opening another line closes this one">or ✎ again</span>
              <button type="button" aria-label={`Remove item ${i + 1}`} disabled={locked(i)} title={lockedTitle ?? 'Remove it from the sheet'} onClick={() => remove(i)}
                style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', fontFamily: 'inherit', fontSize: '0.55rem', letterSpacing: '1px', padding: '1px 8px', cursor: locked(i) ? 'not-allowed' : 'pointer', opacity: locked(i) ? 0.35 : 1 }}>REMOVE</button>
            </span>
          </div>
        )}
        {under(i)}
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* A thing made by hand, of any type (G2): it opens under ✎ in its type's band, opened if closed. */}
      {!readOnly && (
        <div role="group" aria-label="Add by hand" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {tables.map(({ type }) => (
            <button key={type.id} type="button" className="utility-btn" style={{ fontSize: '0.55rem', padding: '1px 8px' }} aria-label={`Add a ${type.one} by hand`}
              onClick={() => { write([...items, newLineOf(type)]); setOpen(items.length); setFocusAt('name'); openBand(bandOfType(type)); }}>+ {type.one.toUpperCase()}</button>
          ))}
        </div>
      )}
      {bands.map((b) => {
        const closed = shut.has(b.band);
        // Something landed in it while closed (G3): a short pulse, then bright until opened (opening clears it).
        const fresh = news.has(b.band);
        return (
          <section key={b.band} aria-label={`${b.label} band`} style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <button type="button" aria-expanded={!closed} onClick={() => toggle(b.band)} title={fresh ? 'Something new landed here: open to see' : closed ? 'Open' : 'Close'}
              className={fresh ? 'gear-band-news' : undefined}
              // Lit in the theme's own color, a tint behind it: cyan is grey in some themes, and would read dimmer.
              style={{ background: fresh ? 'color-mix(in srgb, var(--green) 20%, transparent)' : 'none', border: 0, borderBottom: '1px solid var(--dark-green)', color: 'var(--green)', fontFamily: 'monospace', fontSize: '0.6rem', letterSpacing: '1px', textAlign: 'left', padding: '2px 0', cursor: 'pointer' }}>
              {closed ? '▸' : '▾'} {b.label} · {b.count}
            </button>
            {!closed && (b.count === 0
              ? <span style={small}>Nothing here.</span>
              : <>
                {b.groups.map(({ type, rows }) => (
                  <section key={type.id} aria-label={`${type.label} gear`} style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                    <span style={heading}>{type.label.toUpperCase()} · {rows.length}</span>
                    {rows.map((row) => lineView(row, type))}
                  </section>
                ))}
                {b.loose.map(({ type, row }) => lineView(row, type, true))}
              </>)}
          </section>
        );
      })}
    </div>
  );
}
