import React, { useState } from 'react';
import { customTemplate, useCustomTemplate } from '../sheets/customTemplates';

// REFILL LUCK on the GAME tab (8c6; approved mockup docs/mockups/rule-library.html, section 4, answer 7): the GM puts every player's
// character back to their most, any time, beside the rests that refill it when called. Only where the running game has luck.
// The server does it (socket 'refillLuck') and says how many had spent some.

export function RefillLuck({ system, socketOf }: {
  system: string | null | undefined;
  /** The live connection, read when REFILL is pressed (a ref's, never read while drawing). */
  socketOf: () => { emit: (event: string, ...args: unknown[]) => unknown } | null | undefined;
}) {
  useCustomTemplate(system);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const luck = system ? customTemplate(system)?.luck : undefined;
  if (!luck) return null;
  const refill = () => {
    const socket = socketOf();
    if (busy) return;
    if (!socket) { setSaid({ ok: false, text: 'NOT CONNECTED' }); return; }
    setBusy(true);
    setSaid(null);
    socket.emit('refillLuck', (a: { ok: boolean; refilled?: number; error?: string } | undefined) => {
      setBusy(false);
      if (!a?.ok) setSaid({ ok: false, text: (a?.error ?? 'Not done').toUpperCase() });
      else setSaid({ ok: true, text: a.refilled ? `${a.refilled} ${a.refilled === 1 ? 'CHARACTER' : 'CHARACTERS'} BACK TO THEIR MOST` : 'EVERYONE HAS ALL OF IT' });
    });
  };
  return (
    <section aria-label={`Refill ${luck.name}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', border: '1px solid var(--dark-green)', padding: '6px 8px' }}>
      <span style={{ fontSize: '0.65rem', opacity: 0.7, letterSpacing: '1px' }}>{luck.name} · each character&apos;s back to their most</span>
      <button type="button" className="utility-btn" disabled={busy} onClick={refill} style={{ fontSize: '0.65rem' }}>REFILL {luck.name}</button>
      {said && <span role={said.ok ? 'status' : 'alert'} style={{ fontSize: '0.6rem', letterSpacing: '1px', color: said.ok ? 'var(--cyan)' : 'var(--danger)' }}>{said.text}</span>}
    </section>
  );
}
