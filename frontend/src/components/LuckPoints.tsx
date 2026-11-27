import React from 'react';
import { armAt, armedWords, type LuckNow, type LuckShown } from '../sheets/luckPoints';

// A game's luck points on the sheet (8c6; approved mockup docs/mockups/rule-library.html, section 4): its name, a point each, those
// left filled, those set aside for the next roll lit; clicked to set them aside (or back). The next roll from the sheet spends
// them (SheetRenderer's rollNow). What it shows is sheets/luckPoints.ts.

export function LuckPoints({ rule, now, armed, onArm }: {
  rule: LuckShown;
  now: LuckNow;
  armed: number;
  /** Setting points aside; none where the sheet can't roll (read only). */
  onArm?: (n: number) => void;
}) {
  if (now.most <= 0) return null;
  const set = Math.min(armed, now.current);
  return (
    <div role="group" aria-label={rule.name} style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', opacity: 0.65, letterSpacing: '0.5px' }}>{rule.name}</span>
        <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {Array.from({ length: now.most }, (_, i) => {
            const left = i < now.current;
            const aside = left && i < set;
            const color = aside ? 'var(--warning)' : 'var(--green)';
            return (
              <button key={i} type="button" disabled={!onArm || !left}
                aria-label={left ? `${rule.name} ${i + 1} of ${now.most}${aside ? ', set aside' : ''}` : `${rule.name} ${i + 1} of ${now.most}, spent`}
                aria-pressed={left ? aside : undefined}
                title={!onArm || !left ? undefined : aside ? 'Set aside for the next roll: click to keep it' : 'Set aside for the next roll'}
                onClick={() => onArm?.(armAt(set, i + 1, now.current))}
                // Told apart by shape, never by color alone: left filled, set aside a thick ring, spent a faint thin one.
                style={{
                  width: '12px', height: '12px', padding: 0, borderRadius: '50%', boxSizing: 'border-box',
                  border: aside ? `3px solid ${color}` : `1px solid ${color}`,
                  background: left && !aside ? color : 'transparent', opacity: left ? 1 : 0.4, cursor: onArm && left ? 'pointer' : 'default',
                }} />
            );
          })}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--green)', opacity: 0.85 }}>{now.current}/{now.most}</span>
      </div>
      {set > 0 && <span role="status" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--warning)' }}>{armedWords(rule, set)}</span>}
    </div>
  );
}
