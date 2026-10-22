import React, { useEffect, useRef, useState } from 'react';
import { drawnAt, withSquare, drawnSquares, BLANK_DRAWN, type DieSymbol, type OwnDie, type DieFace } from '../sheets/dice';
import { ConditionIcon } from './ConditionIcon';

// A dice symbol drawn (6c2b2; approved mockup docs/mockups/builder-dice.html, decision 10): the
// DICE tab's 16 by 16 pad, and a symbol as the dice show it. A drawing is one color, the color of
// what it sits on (the theme's, or a bad die's danger), as the drawn icons are.

/** A drawing as squares in the color around it. */
export function Drawing({ drawn, size = 16 }: { drawn: string[]; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0 }}>
      {drawnSquares(drawn).map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
    </svg>
  );
}

/** A symbol as the dice show it: its drawing, its icon (drawn or uploaded), or its mark. */
export function SymbolLook({ symbol, size = 16 }: { symbol: DieSymbol; size?: number }) {
  if (symbol.drawn) return <Drawing drawn={symbol.drawn} size={size} />;
  if (symbol.icon) return <span style={{ display: 'inline-block', verticalAlign: '-0.15em' }}><ConditionIcon icon={symbol.icon} size={size} title={symbol.name} /></span>;
  return <span>{symbol.mark ?? [...symbol.name][0]?.toUpperCase() ?? '?'}</span>;
}

/** A face as the dice show it: its number (signed on a die with any below 0) and its symbols' looks, '·' for a blank. */
export function FaceShown({ die, face, symbols, size = 15 }: { die: OwnDie; face: DieFace; symbols: DieSymbol[]; size?: number }) {
  const signed = die.faces.some((f) => (f.n ?? 0) < 0);
  const n = face.n === undefined ? '' : signed && face.n > 0 ? `+${face.n}` : String(face.n);
  const looks = (face.s ?? []).map((id, i) => {
    const s = symbols.find((x) => x.id === id);
    return s ? <SymbolLook key={`${id}${i}`} symbol={s} size={size} /> : <span key={`${id}${i}`}>?</span>;
  });
  if (!n && !looks.length) return <span>·</span>;
  return <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>{n}{looks}</span>;
}

interface Props {
  drawn: string[];
  /** The drawing after a stroke, once the pointer lets go: one edit a stroke. */
  onChange: (drawn: string[]) => void;
  /** What is being drawn, for the squares' names: "Skull". */
  name: string;
}

/**
 * The pad: press and drag to draw (or rub out, with ERASE); CLEAR empties it. Each square is a
 * button too, so a keyboard draws it a square at a time.
 */
export function DrawPad({ drawn, onChange, name }: Props) {
  const [rows, setRows] = useState(drawn);
  const [ink, setInk] = useState(true);
  const painting = useRef(false);
  // What the pad shows now, for the stroke's end, which a window listener reads.
  const latest = useRef(rows);
  useEffect(() => { latest.current = rows; }, [rows]);
  // Another symbol picked, or the drawing changed elsewhere (undo): the pad shows it.
  useEffect(() => { if (!painting.current) setRows(drawn); }, [drawn]);
  useEffect(() => {
    const up = () => { if (painting.current) { painting.current = false; onChange(latest.current); } };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [onChange]);
  const paint = (x: number, y: number) => setRows((r) => withSquare(r, x, y, ink));
  const cell = 14;
  // The pad's middle, across and down, to center a drawing by: over the squares, not in their way.
  const middle = { position: 'absolute', background: 'color-mix(in srgb, var(--green) 45%, transparent)', pointerEvents: 'none' } as const;
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div role="group" aria-label={`Drawing of ${name}`} onPointerLeave={() => { if (painting.current) { painting.current = false; onChange(latest.current); } }}
        style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(16, ${cell}px)`, border: '1px solid var(--green)', background: 'var(--black)', touchAction: 'none', userSelect: 'none', width: 'max-content' }}>
        <span aria-hidden data-testid="pad-middle" style={{ ...middle, left: 8 * cell - 0.5, top: 0, bottom: 0, width: 1 }} />
        <span aria-hidden data-testid="pad-middle" style={{ ...middle, top: 8 * cell - 0.5, left: 0, right: 0, height: 1 }} />
        {Array.from({ length: 256 }, (_, i) => {
          const x = i % 16; const y = Math.floor(i / 16); const on = drawnAt(rows, x, y);
          return (
            <button key={i} type="button" aria-label={`Square ${x + 1}, ${y + 1}`} aria-pressed={on}
              onPointerDown={(e) => { e.preventDefault(); painting.current = true; paint(x, y); }}
              onPointerEnter={() => { if (painting.current) paint(x, y); }}
              onClick={(e) => { if (e.detail === 0) onChange(withSquare(rows, x, y, !on)); }}
              style={{ width: cell, height: cell, padding: 0, border: '1px solid color-mix(in srgb, var(--green) 10%, transparent)', background: on ? 'var(--green)' : 'none', cursor: 'crosshair' }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div role="group" aria-label="Pen" style={{ display: 'inline-flex', border: '1px solid var(--dark-green)', alignSelf: 'flex-start' }}>
          {([[true, 'DRAW'], [false, 'ERASE']] as const).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={ink === v} onClick={() => setInk(v)}
              style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, padding: '3px 8px', border: 0, background: ink === v ? 'var(--green)' : 'none', color: ink === v ? 'var(--black)' : 'var(--text)', cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        <div><button type="button" className="utility-btn" style={{ fontFamily: 'monospace', fontSize: 11, padding: '4px 9px' }} onClick={() => { setRows(BLANK_DRAWN); onChange(BLANK_DRAWN); }}>CLEAR</button></div>
        <span style={{ fontSize: 10, letterSpacing: 2, opacity: 0.75 }}>ON A DIE</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(['var(--green)', 'var(--danger)'] as const).map((color) => (
            <span key={color} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', border: `2px solid ${color}`, color }}><Drawing drawn={rows} size={24} /></span>
          ))}
          <span style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', border: '2px solid var(--green)', color: 'var(--green)' }}><Drawing drawn={rows} size={14} /></span>
        </div>
        <span style={{ fontSize: 11, opacity: 0.85, maxWidth: '26ch' }}>One color: the die&apos;s, or the theme&apos;s. Press and drag to draw; the log still writes its mark.</span>
      </div>
    </div>
  );
}
