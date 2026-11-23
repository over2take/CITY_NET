import React from 'react';
import { drawnSquares } from '../sheets/drawings';
import { ConditionIcon } from './ConditionIcon';

// A picture in the theme's color, of any of the three kinds a builder picture comes in (8b0; shared by the dice's symbols,
// the damage types next): one of the drawn icons, an upload (kept in its own colors), or a drawing from the 16 by 16 pad.

/** A drawing as squares in the color around it. */
export function Drawing({ drawn, size = 16 }: { drawn: string[]; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0 }}>
      {drawnSquares(drawn).map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
    </svg>
  );
}

/**
 * A picture: its drawing where it has one, else its icon (drawn or uploaded), else `fallback` (a symbol's mark, say).
 * A drawing wins over an icon, as the server keeps only one of them.
 */
export function IconLook({ icon, drawn, size = 16, title, fallback = null }: {
  icon?: string; drawn?: string[]; size?: number; title?: string; fallback?: React.ReactNode;
}) {
  if (drawn) return <Drawing drawn={drawn} size={size} />;
  if (icon) return <span style={{ display: 'inline-block', verticalAlign: '-0.15em' }}><ConditionIcon icon={icon} size={size} title={title} /></span>;
  return <>{fallback}</>;
}
