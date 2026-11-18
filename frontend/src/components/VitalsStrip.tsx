import React, { useState } from 'react';
import type { Location } from '../types';
import { HitPointsPanel } from './HitPoints';
import { useHealthView } from '../hooks/useHealthView';
import { isCustomSystem } from '../sheets';
import { useWords } from '../sheets/words';
import { amountOf, healthBody, takesAnAmount, hasHealth, hasStim, type SheetVitals, type VitalsAction } from '../sheets/vitals';
import { createPlayerTokenRow } from './tokenActions';

// The vitals strip (8s3b; mockup docs/mockups/vitals-strip.html, approved 2026-11-17): under the sheet header's HP bar,
// on every tab of SHEET.EXE and the standalone tab alike. An amount, DAMAGE, HEAL and TEMP for a pool of hit points; HEALTH
// ▾ (or a click on the HP bar) opens the HEALTH window's own panel right here, for everything else. The same route as
// HEALTH, so the token, the map and every open sheet move together; the map's HEALTH window is unchanged.

const small: React.CSSProperties = {
  background: 'none', fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '1px 7px', cursor: 'pointer', whiteSpace: 'nowrap',
};
const button = (color: string): React.CSSProperties => ({ ...small, color, border: `1px solid ${color}` });

export function VitalsStrip({ vitals, open, onToggle }: { vitals: SheetVitals; open: boolean; onToggle: () => void }) {
  const { token, system, authToken, socket, reload } = vitals;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // A custom system's model, as HEALTH reads it: null for the built-in games, which are one pool.
  const view = useHealthView(socket, token?.id, isCustomSystem(system));
  const word = useWords(system);
  const hp = word('hp', 'short', 'HP').toUpperCase();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };

  if (!token) {
    // As HEALTH's CREATE HEALTH RECORD: the player's token row, then the sheet asked for again with it.
    const create = () => createPlayerTokenRow({ fetch: (url, init) => fetch(url, init), authToken, refreshLocations: reload }, vitals.owner);
    return (
      <div role="group" aria-label="Vitals" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
        <span style={{ opacity: 0.7 }}>NO TOKEN ON THE MAP</span>
        <button type="button" onClick={() => { void create(); }} style={button('var(--green)')}>CREATE HEALTH RECORD</button>
      </div>
    );
  }
  if (!hasHealth(view?.model)) return null;

  const send = async (action: VitalsAction) => {
    const n = amountOf(amount);
    if (action !== 'set_temp' && n === 0) return;
    setBusy(true);
    setRefused(null);
    try {
      const res = await fetch(`/api/locations/${token.id}/health`, { method: 'PUT', headers, body: JSON.stringify(healthBody(action, n)) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRefused(body?.error ?? 'NOT CHANGED');
        return;
      }
      // The server tells every open sheet (sheetUpdated), this one with them: the bar and TEMP follow.
      setAmount('');
    } catch {
      setRefused('NOT CHANGED: NO CONNECTION');
    } finally {
      setBusy(false);
    }
  };

  const amountTaken = takesAnAmount(view?.model);
  const temp = token.hp_temp ?? 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
      <div role="group" aria-label="Vitals" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', fontSize: '0.6rem', letterSpacing: '1px' }}>
        {amountTaken && (
          <>
            <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
              <input
                className="sheet-input" type="number" min={0} inputMode="numeric" placeholder="0" aria-label={`Amount of ${hp}`}
                value={amount} onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void send('damage'); }}
                style={{ width: '44px', fontSize: '0.7rem', padding: '1px 4px', background: 'color-mix(in srgb, var(--black) 50%, transparent)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit' }}
              />
              <button type="button" disabled={busy} onClick={() => { void send('damage'); }} style={button('var(--danger)')}>DAMAGE</button>
              <button type="button" disabled={busy} onClick={() => { void send('heal'); }} style={button('var(--green)')}>HEAL</button>
              {hasStim(system) && (
                <button type="button" disabled={busy} onClick={() => { void send('stim_heal'); }}
                  title="Field healing (stims, medkits): heals and adds +1 System Strain. Refused when strain is maxed. HEAL is natural or rest healing."
                  style={button('var(--warning)')}>STIM +1 STRAIN</button>
              )}
            </span>
            <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ opacity: 0.7 }}>TEMP</span>
              <span aria-label={`Temp ${hp}`} style={{ color: 'var(--cyan)' }}>+{temp}</span>
              <button type="button" disabled={busy} title={`Set temp ${hp} to the amount`} aria-label="Set temp to the amount"
                onClick={() => { void send('set_temp'); }} style={{ ...button('var(--cyan)'), borderStyle: 'dashed' }}>SET</button>
            </span>
          </>
        )}
        <button type="button" aria-expanded={open} onClick={onToggle}
          style={{ ...button('var(--green)'), borderStyle: open ? 'solid' : 'dashed', background: open ? 'var(--green)' : 'none', color: open ? 'var(--black)' : 'var(--green)' }}>
          HEALTH {open ? '▴' : '▾'}
        </button>
        {refused && <span role="alert" style={{ color: 'var(--danger)' }}>{refused}</span>}
      </div>
      {open && (
        <div role="region" aria-label="Health" style={{ border: '1px solid var(--dark-green)', padding: '8px 10px' }}>
          {/* Without what the strip already has: one set of DAMAGE, HEAL and TEMP, not two. */}
          <HitPointsPanel target={token as unknown as Location} token={authToken} refreshLocations={reload} gameSystem={system} socket={socket} underStrip />
        </div>
      )}
    </div>
  );
}
