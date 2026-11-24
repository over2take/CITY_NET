import React from 'react';
import { ConditionIcon } from './ConditionIcon';
import { Drawing } from './Drawing';

// A picture in the theme's color, of any of the three kinds a builder picture comes in (8b0; shared by the dice's symbols,
// the damage types next): one of the drawn icons, an upload (kept in its own colors), or a drawing from the 16 by 16 pad.

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
