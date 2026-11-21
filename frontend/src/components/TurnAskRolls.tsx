import React, { useMemo } from 'react';
import { useTurnAsks, type AskSocket } from '../modules/initiative/hooks/useTurnAsks';
import { asksOnToken, askHeading, askButton } from '../sheets/turnAsks';

/**
 * The rolls a condition's EACH TURN asks of this token, under the HP box (8a9c2; approved mockup
 * docs/mockups/condition-turn-effects.html, 2026-11-19, the user: "would be nice to ask the user to roll"): POISONED · YOUR
 * SAVE, what it rolls in the player's words, and ROLL SAVE, until rolled. On SHEET.EXE and the standalone tab alike, as
 * the HP box is; the GM looking at a player's sheet sees them too, and may roll them. Nothing while none is waiting.
 */
export function TurnAskRolls({ socket, tokenId }: { socket: AskSocket | null; tokenId: number }) {
  // The hook takes a ref, as App's socketRef; this one holds the sheet's own connection.
  const ref = useMemo(() => ({ current: socket }), [socket]);
  const { asks, roll, rolling, error } = useTurnAsks(ref);
  const mine = asksOnToken(asks, tokenId);
  if (!mine.length) return null;
  return (
    <div role="region" aria-label="Rolls asked" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {mine.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--warning)', padding: '6px 8px', background: 'color-mix(in srgb, var(--warning) 6%, transparent)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '1px', color: 'var(--warning)', fontWeight: 'bold' }}>{askHeading(a)}</div>
            <div style={{ fontSize: '0.6rem', opacity: 0.85, marginTop: '2px' }}>{a.yours}</div>
          </div>
          <button
            type="button"
            onClick={() => roll(a.id)}
            disabled={rolling.includes(a.id)}
            title={a.says}
            style={{ background: 'none', fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--warning)', border: '1px solid var(--warning)' }}
          >
            {askButton(a)}
          </button>
        </div>
      ))}
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.6rem', letterSpacing: '1px' }}>{error}</span>}
    </div>
  );
}
