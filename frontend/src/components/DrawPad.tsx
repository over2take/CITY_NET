import React, { useEffect, useRef, useState } from 'react';
import { drawnAt, withSquare, BLANK_DRAWN } from '../sheets/drawings';

// The builder's 16 by 16 pad (6c2b2 for a die's symbol; approved mockup docs/mockups/builder-dice.html, decision 10;
// shared since 8b0, the damage types' icons next). A drawing is one color, the color of what it sits on, as the drawn
// icons are. What it is drawn for shows its own preview beside the pen and CLEAR (the dice: ON A DIE, DiceLook.tsx).

interface Props {
  drawn: string[];
  /** The drawing after a stroke, once the pointer lets go: one edit a stroke. */
  onChange: (drawn: string[]) => void;
  /** What is being drawn, for the squares' names: "Skull". */
  name: string;
  /** How the drawing looks where it will be shown, as it is drawn: the rows on the pad now. */
  preview?: (drawn: string[]) => React.ReactNode;
}

/**
 * The pad: press and drag to draw (or rub out, with ERASE); CLEAR empties it. Each square is a
 * button too, so a keyboard draws it a square at a time.
 */
export function DrawPad({ drawn, onChange, name, preview }: Props) {
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
        {preview?.(rows)}
      </div>
    </div>
  );
}
