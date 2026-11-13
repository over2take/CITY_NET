import React from 'react';
import { markAction, markTitle, type ImproveAction, type ImproveShown } from '../sheets/improveShown';

// IMPROVE BY USE's mark on a stat (7f3b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a small circle beside
// its name, filled once marked, that the player or the GM clicks to tick or clear. Where the sheet can't be changed, a
// mark is shown only while it is on. What it says is sheets/improveShown.ts.

interface Props {
  improve: ImproveShown;
  stat: string;
  label: string;
  marked: boolean;
  onImprove?: (action: ImproveAction) => void;
}

export function ImproveMark({ improve, stat, label, marked, onImprove }: Props) {
  if (!onImprove && !marked) return null;
  return (
    <button type="button" aria-label={`${label} marked`} aria-pressed={marked} disabled={!onImprove} title={markTitle(improve, marked, !!onImprove)}
      onClick={onImprove ? () => onImprove(markAction(stat, marked)) : undefined}
      style={{
        width: 10, height: 10, padding: 0, borderRadius: '50%', flexShrink: 0, cursor: onImprove ? 'pointer' : 'default',
        border: '1px solid var(--cyan)', background: marked ? 'var(--cyan)' : 'none', opacity: onImprove || marked ? 1 : 0.5,
      }} />
  );
}
