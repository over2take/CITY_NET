import React from 'react';
import { kitItemsText, kitsShownOn } from '../sheets/newCharacterFlow';
import type { SheetTemplate } from '../sheets/types';

// The KITS step of NEW_CHARACTER.EXE (7c4b; approved mockup new-character): what everyone gets, then the
// kits to pick from, one at a time, each saying what is in it and one out of reach what it needs. Picking
// gives nothing yet: it all lands in the inventory on FINISH, so a mind can be changed.

interface Props {
  template: SheetTemplate;
  data: Record<string, unknown> | null | undefined;
  /** A kit picked, or null to put it back. */
  onPick: (kit: string | null) => void;
  /** Filling it in for a player (7c5): one not met can be picked anyway. */
  gm?: boolean;
}

const why: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const small: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.8 };
const kitBtn = (on: boolean): React.CSSProperties => ({
  padding: '3px 8px', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, textAlign: 'left', cursor: 'pointer',
  border: '1px solid var(--green)', background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)',
});

export function KitsStep({ template, data, onPick, gm = false }: Props) {
  const { everyone, offered, picked } = kitsShownOn(template, data);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {everyone.map((k) => <p key={k.id} style={why}>Everyone gets {k.name.toUpperCase()}: {kitItemsText(k.items)}.</p>)}
      {offered.length > 0 && <p style={why}>Pick a kit. One you don&apos;t meet is off, saying what it needs.</p>}
      {offered.length > 0 && (
        <div role="group" aria-label="Kits to pick from" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', gap: '6px 8px', alignItems: 'center' }}>
          {offered.map(({ kit, unmet }) => {
            const on = picked?.kit.id === kit.id;
            const off = !!unmet && !on && !gm;
            return (
              <React.Fragment key={kit.id}>
                <button type="button" className={off ? 'choice-off' : undefined} aria-pressed={on} disabled={off} style={{ ...kitBtn(on), gridColumn: 1, opacity: off ? 0.6 : 1 }}
                  onClick={() => onPick(on ? null : kit.id)}>{kit.name.toUpperCase()}</button>
                <span style={{ gridColumn: 2, display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left' }}>
                  <span style={small}>{kitItemsText(kit.items)}</span>
                  {unmet && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>NEEDS {unmet}{gm ? ' · ADD ANYWAY' : ''}</span>}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      )}
      {!offered.length && <p style={why}>Nothing to pick here.</p>}
      <p style={small}>{gm ? 'IT ALL GOES IN THEIR INVENTORY AT FINISH.' : 'IT ALL GOES IN YOUR INVENTORY WHEN YOU FINISH.'}</p>
    </div>
  );
}
