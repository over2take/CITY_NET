import React from 'react';
import { CONDITION_ICONS, isDrawnIcon, isUploadedIcon } from '../sheets/conditionIcons';

// A condition's icon (4e1b): one drawn for CITY_NET, stroked in the theme's color, or a picture the
// GM uploaded, drawn through <img> only, which is what makes an uploaded SVG safe (as currency
// icons and battle maps). Anything else draws the target, so a broken reference still shows a mark.

export function ConditionIcon({ icon, size = 18, title }: { icon: string; size?: number; title?: string }) {
  if (isUploadedIcon(icon)) {
    return <img src={icon} alt={title ?? ''} width={size} height={size} style={{ objectFit: 'contain', display: 'block', flexShrink: 0 }} />;
  }
  const paths = CONDITION_ICONS[isDrawnIcon(icon) ? icon : 'target'];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ display: 'block', flexShrink: 0 }}>
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
