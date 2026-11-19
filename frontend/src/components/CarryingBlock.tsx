import type { CSSProperties } from 'react';
import type { SheetData } from '../sheets/types';
import { carryingOf, meterOf, legendOf, conditionLine, amount, type Tone } from '../sheets/carrying';

// CARRYING at the top of a custom system's GEAR tab (8a6a; approved mockup docs/mockups/carrying-on-sheet.html, A): what the
// character carries against what they can, its band, a meter ticked where each band ends, what the band means and the band's
// condition where it is on. The logic is sheets/carrying.ts; this only draws it. Nothing where the system counts no encumbrance.

const TONE: Record<Tone, string> = { green: 'var(--green)', warning: 'var(--warning)', danger: 'var(--danger)' };
const small: CSSProperties = { fontSize: '0.58rem', letterSpacing: '1px', opacity: 0.7 };

export function CarryingBlock({ data, noToken = false }: {
  data: SheetData;
  /** The player's own sheet with no token on the map: a band's condition has nothing to go on. */
  noToken?: boolean;
}) {
  const c = carryingOf(data as Record<string, unknown>);
  if (!c) return null;
  const meter = meterOf(c);
  const color = meter ? TONE[meter.tone] : 'var(--green)';
  const legend = legendOf(c);
  const on = conditionLine(c, (data as Record<string, unknown>)._band_condition, noToken);
  const unit = c.unit ? ` ${c.unit}` : '';
  return (
    <div data-testid="sheet-carrying" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '2px 0 6px', textAlign: 'left', lineHeight: 1.3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.7rem', letterSpacing: '1px' }}>
        <span>
          CARRYING <span style={{ color }}>{amount(c.carried)}</span>
          {c.capacity !== null ? ` / ${amount(c.capacity)}${unit}` : unit}
        </span>
        {c.band && (
          <span data-testid="sheet-carrying-band" style={{ color, border: '1px solid currentColor', padding: '0 5px', fontSize: '0.6rem', whiteSpace: 'nowrap' }}>
            {c.band}
          </span>
        )}
      </div>
      {meter && (
        <div role="meter" aria-label="Carrying" aria-valuemin={0} aria-valuemax={c.capacity ?? 0} aria-valuenow={c.carried}
          aria-valuetext={`${amount(c.carried)} of ${amount(c.capacity!)}${unit}${c.band ? `, ${c.band}` : ''}`}
          style={{ position: 'relative', height: '8px', border: '1px solid var(--dark-green)' }}>
          <div data-testid="sheet-carrying-fill" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${meter.fill}%`, background: `color-mix(in srgb, ${color} 55%, transparent)` }} />
          {meter.ticks.map((t) => (
            <div key={t} style={{ position: 'absolute', top: '-3px', bottom: '-3px', left: `${t}%`, width: '1px', background: 'var(--green)', opacity: 0.6 }} />
          ))}
        </div>
      )}
      {legend && <span style={small}>{legend}</span>}
      {c.says && <span style={{ fontSize: '0.62rem', color }}>{c.says}</span>}
      {on && <span data-testid="sheet-carrying-condition" style={{ ...small, color: noToken ? undefined : 'var(--warning)', opacity: noToken ? 0.6 : 1 }}>{on}</span>}
    </div>
  );
}
