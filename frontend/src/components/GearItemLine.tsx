import React, { useState } from 'react';
import type { ItemShown, ItemAction, GearRow, SlotCounter, InstallCounter } from '../sheets/gearItems';
import { slotCountAsked } from '../sheets/gearItems';
import { spentAfterClick, type ChoicesAction } from '../sheets/choicesShown';

// A system's item on its gear line, and the slot counters over the gear (7e3b; approved mockup docs/mockups/items.html).
// Only draws: what each line says and asks is sheets/gearItems.ts gearRow, and the server decides (itemAction).

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px' };
const tag = (color: string): React.CSSProperties => ({ ...small, border: `1px solid ${color}`, color, padding: '1px 4px', lineHeight: 1.3 });
const button = (on?: true, hot?: true): React.CSSProperties => ({
  fontSize: '0.55rem', padding: '1px 6px', whiteSpace: 'nowrap',
  ...(on ? { background: 'color-mix(in srgb, var(--green) 25%, transparent)' } : {}),
  ...(hot ? { borderColor: 'var(--warning)', color: 'var(--warning)' } : {}),
});

/** One item's line under its gear row: the NEEDS tag, WEAR and ATTUNE, what it is doing, and its features' uses. */
export function GearItemLine({ item, row, uses, canUse, onItem, onChoices }: {
  item: ItemShown;
  row: GearRow;
  uses: { feature: ItemShown['features'][number]; max: number; spent: number }[];
  /** Whether the viewer may tick the uses. */
  canUse: boolean;
  onItem?: (action: ItemAction) => void;
  onChoices?: (action: ChoicesAction) => void;
}) {
  return (
    <div data-testid={`gear-item-${item.id}`} style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 0 4px 8px', borderLeft: '1px solid var(--cyan)' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...small, color: 'var(--cyan)' }} title={item.description}>{item.label.toUpperCase()}</span>
        {row.tag && <span style={tag('var(--cyan)')}>{row.tag}</span>}
        {row.buttons.map((b) => (
          <button key={b.label} type="button" className="utility-btn" aria-label={`${b.label} ${item.label}`} aria-pressed={b.on ? true : undefined}
            disabled={!b.action || !onItem} title={b.title} onClick={() => { if (b.action) onItem?.(b.action); }} style={button(b.on, b.hot)}>
            {b.label}
          </button>
        ))}
        {row.say && <span role="note" aria-label={`${item.label}: what it is doing`} style={{ ...small, color: row.say.warn ? 'var(--warning)' : 'var(--green)', opacity: row.say.warn ? 1 : 0.75 }}>{row.say.text}</span>}
      </div>
      {uses.map(({ feature: f, max, spent }) => (
        <span key={f.id} role="group" aria-label={`${f.label} uses`} style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', fontSize: '0.62rem' }}>
          <span>{f.label}</span>
          {Array.from({ length: max }, (_, i) => {
            const left = i >= spent;
            return (
              <button key={i} type="button" aria-label={`${f.label} use ${i + 1}`} aria-pressed={!left} disabled={!canUse}
                title={left ? 'Left: click to spend' : 'Spent: click to take back'}
                onClick={() => onChoices?.({ kind: 'use', feature: f.id, spent: spentAfterClick(i, spent) })}
                style={{ width: 11, height: 11, padding: 0, border: '1px solid var(--cyan)', background: left ? 'var(--cyan)' : 'none', cursor: canUse ? 'pointer' : 'default' }} />
            );
          })}
          <span style={small}>{max - spent} OF {max}{f.uses?.refill ? ` · ${f.uses.refill.toUpperCase()}` : ''}</span>
        </span>
      ))}
    </div>
  );
}

/** The GM's box for one character's count of a slot: blank or the system's number puts it back. Keyed by the count, so a
 *  new one from the server starts it again. */
function OwnCount({ counter, onItem }: { counter: SlotCounter; onItem: (action: ItemAction) => void }) {
  const [typed, setTyped] = useState(String(counter.count));
  const send = () => {
    const asked = slotCountAsked(counter, typed);
    if (asked) onItem(asked); else setTyped(String(counter.count));
  };
  return (
    <input aria-label={`${counter.label}: how many this character has`} type="number" min={0} max={20} value={typed}
      title={`The system gives ${counter.standard}. Blank puts it back.`}
      onChange={(e) => setTyped(e.target.value)} onBlur={send} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
      style={{ width: '38px', background: 'color-mix(in srgb, var(--black) 50%, transparent)', border: '1px solid var(--green)', color: 'var(--green)', fontFamily: 'inherit', fontSize: '0.6rem', padding: '0 2px' }} />
  );
}

/** The slots over the gear: ATTUNED 2 OF 3, amber when full; the GM may set this character's own count. And the installs' costs (7e4c). */
export function GearSlots({ counters, installs = [], gm, onItem }: { counters: SlotCounter[]; installs?: InstallCounter[]; gm: boolean; onItem?: (action: ItemAction) => void }) {
  if (!counters.length && !installs.length) return null;
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
      {counters.map((c) => (
        <span key={c.id} role="group" aria-label={`${c.label} slots`} style={{ ...tag(c.full ? 'var(--warning)' : 'var(--green)'), display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
          {c.label} {c.used} OF {gm && onItem ? <OwnCount key={c.count} counter={c} onItem={onItem} /> : c.count}
          {c.own && <span style={{ opacity: 0.7 }}>· THEIR OWN (SYSTEM {c.standard})</span>}
        </span>
      ))}
      {/* Each install's cost against its limit (7e4c): CYBERWARE · STRAIN 2.75 OF 3, amber at it. */}
      {installs.map((c) => (
        <span key={c.id} role="group" aria-label={`${c.label} installs`} style={{ ...tag(c.full ? 'var(--warning)' : 'var(--green)'), display: 'inline-flex', gap: '4px', alignItems: 'center' }}>{c.text}</span>
      ))}
    </div>
  );
}
