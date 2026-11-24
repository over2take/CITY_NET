import React from 'react';
import type { DieSymbol, OwnDie, DieFace } from '../sheets/dice';
import { IconLook } from './IconLook';
import { Drawing } from './Drawing';

// How a system's own dice look (6c2b2; approved mockup docs/mockups/builder-dice.html, decision 10): a symbol, a face, and
// a drawing on a die for the pad's preview. Moved out of DrawPad.tsx in 8b0, so the pad is the pad for anything drawn.

/** A symbol as the dice show it: its drawing, its icon (drawn or uploaded), or its mark. */
export function SymbolLook({ symbol, size = 16 }: { symbol: DieSymbol; size?: number }) {
  return <IconLook drawn={symbol.drawn} icon={symbol.icon} size={size} title={symbol.name}
    fallback={<span>{symbol.mark ?? [...symbol.name][0]?.toUpperCase() ?? '?'}</span>} />;
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

/** The pad's preview for a die's symbol: the drawing on a die of the theme's color, a bad die's danger, and small. */
export function OnADie({ drawn }: { drawn: string[] }) {
  return (
    <>
      <span style={{ fontSize: 10, letterSpacing: 2, opacity: 0.75 }}>ON A DIE</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {(['var(--green)', 'var(--danger)'] as const).map((color) => (
          <span key={color} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', border: `2px solid ${color}`, color }}><Drawing drawn={drawn} size={24} /></span>
        ))}
        <span style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', border: '2px solid var(--green)', color: 'var(--green)' }}><Drawing drawn={drawn} size={14} /></span>
      </div>
      <span style={{ fontSize: 11, opacity: 0.85, maxWidth: '26ch' }}>One color: the die&apos;s, or the theme&apos;s. Press and drag to draw; the log still writes its mark.</span>
    </>
  );
}
