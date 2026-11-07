import React from 'react';
import { levelUpOffer, type LevelTarget } from '../sheets/xpMeter';
import type { SheetTemplate } from '../sheets/types';

// LEVEL UP READY on a sheet (7d2b; approved mockup docs/mockups/level-up.html): for a player, once it's available,
// the button going up, one per class if they have several. Whether it may go ahead is the table's, outside the
// app. Without `onLevelUp`, as the GM's view of a sheet, it only says so. What it reads is sheets/xpMeter.ts.

const btn: React.CSSProperties = { display: 'block', width: '100%', marginTop: '5px', background: 'none', border: '1px solid var(--warning)', color: 'var(--warning)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 8px' };
const said: React.CSSProperties = { fontSize: '0.6rem', marginTop: '4px', letterSpacing: '1px', color: 'var(--warning)' };

export function LevelUpReady({ template, data, onLevelUp }: { template: SheetTemplate; data: Record<string, unknown> | null | undefined; onLevelUp?: (target: LevelTarget) => void }) {
  const offer = levelUpOffer(template, data);
  if (!offer?.ready) return null;
  if (offer.firstPick) return <div role="status" style={said}>LEVEL UP READY: PICK A {offer.firstPick.toUpperCase()} FIRST</div>;
  if (!onLevelUp) return <div role="status" style={said}>LEVEL UP READY</div>;
  return (
    <>
      {offer.targets.map((t) => (
        <button key={t.option ?? 'level'} type="button" className="unread-flash" style={btn} onClick={() => onLevelUp(t)}>
          {offer.targets.length > 1 ? `LEVEL UP: ${t.name.toUpperCase()} ${t.level} → ${t.level + 1}` : 'LEVEL UP READY'}
        </button>
      ))}
    </>
  );
}
