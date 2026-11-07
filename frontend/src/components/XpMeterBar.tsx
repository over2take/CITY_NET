import React from 'react';
import { xpMeter, xpMeterWords } from '../sheets/xpMeter';
import { wordFor } from '../sheets/words';
import type { SheetTemplate } from '../sheets/types';

// The XP meter on a sheet (7d2a; approved mockup docs/mockups/level-up.html): as the HP bar above it, cells in a
// 12px frame between gutters of the same width, so the two line up. It turns cyan once there's enough for the
// next level, as the EXP bar does. What it says is sheets/xpMeter.ts.

const GUTTER: React.CSSProperties = { fontSize: '0.6rem', width: '32px', flexShrink: 0, whiteSpace: 'nowrap' };

export function XpMeterBar({ template, data }: { template: SheetTemplate; data: Record<string, unknown> | null | undefined }) {
  const meter = xpMeter(template, data);
  if (!meter) return null;
  const word = wordFor(template.id, 'xp', 'short', 'XP').toUpperCase();
  const color = meter.ready ? 'var(--cyan)' : 'var(--green)';
  return (
    <div data-testid="xp-meter" style={{ marginTop: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ ...GUTTER, opacity: 0.65 }}>{word}</span>
        <div role="img" aria-label={`${word}: ${xpMeterWords(meter)}`} style={{ flex: 1, minWidth: 0, display: 'flex', gap: meter.cells > 40 ? '1px' : '2px', height: '12px', border: `1px solid ${color}`, padding: '1px', boxSizing: 'border-box', background: 'color-mix(in srgb, var(--black) 60%, transparent)' }}>
          {Array.from({ length: meter.cells }, (_, i) => (
            <div key={i} data-lit={i < meter.lit || undefined} style={{ flex: 1, minWidth: 0, height: '100%', background: i < meter.lit ? color : 'transparent', transition: 'background 0.2s' }} />
          ))}
        </div>
        <span style={{ ...GUTTER, color }}>LV {meter.level}</span>
      </div>
      <div style={{ fontSize: '0.6rem', marginTop: '3px', lineHeight: 1.4, letterSpacing: '1px', color: meter.ready ? 'var(--cyan)' : undefined, opacity: meter.ready ? 1 : 0.65 }}>{xpMeterWords(meter)}</div>
    </div>
  );
}
