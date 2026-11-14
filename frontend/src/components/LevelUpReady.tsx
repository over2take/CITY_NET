import React from 'react';
import { levelUpOffer } from '../sheets/xpMeter';
import type { SheetTemplate } from '../sheets/types';

// LEVEL UP READY on a sheet (7d2b; approved mockup docs/mockups/level-up.html): for a player, once it's available,
// the button that opens LEVEL_UP.EXE (7d3a), saying LEVELING UP · CONTINUE once it was left open. Whether it may
// go ahead is the table's, outside the app. Without `onOpen`, as the GM's view of a sheet or the sheet in its
// own tab, it only says so. What it reads is sheets/xpMeter.ts.

const btn: React.CSSProperties = { display: 'block', width: '100%', marginTop: '5px', background: 'none', border: '1px solid var(--warning)', color: 'var(--warning)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 8px' };
const said: React.CSSProperties = { fontSize: '0.6rem', marginTop: '4px', letterSpacing: '1px', color: 'var(--warning)' };

export function LevelUpReady({ template, data, onOpen }: { template: SheetTemplate; data: Record<string, unknown> | null | undefined; onOpen?: () => void }) {
  const offer = levelUpOffer(template, data);
  if (!offer?.ready) return null;
  if (offer.firstPick) return <div role="status" style={said}>LEVEL UP READY: PICK A {offer.firstPick.toUpperCase()} FIRST</div>;
  const words = offer.leveling ? 'LEVELING UP · CONTINUE' : 'LEVEL UP READY';
  if (!onOpen) return <div role="status" style={said}>{offer.leveling ? 'LEVELING UP' : words}</div>;
  return <button type="button" className="unread-flash" style={btn} onClick={onOpen}>{words}</button>;
}
