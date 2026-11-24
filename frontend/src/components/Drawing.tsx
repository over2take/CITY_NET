import React from 'react';
import { drawnSquares } from '../sheets/drawings';

// A drawing from the builder's 16 x 16 pad (6c2b2; its own file since 8b1b, so ConditionIcon and IconLook both draw it):
// its squares in the color around it, the theme's.

/** A drawing as squares in the color around it. */
export function Drawing({ drawn, size = 16, block = false }: { drawn: string[]; size?: number; block?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden
      style={{ display: block ? 'block' : 'inline-block', ...(block ? {} : { verticalAlign: '-0.15em' }), flexShrink: 0 }}>
      {drawnSquares(drawn).map(([x, y]) => <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
    </svg>
  );
}
