import React, { useState } from 'react';
import type { Location } from '../types';
import { HitPointsPanel } from './HitPoints';
import { useHealthView } from '../hooks/useHealthView';
import { isCustomSystem } from '../sheets';
import { useWords } from '../sheets/words';
import { amountOf, healthBody, takesAnAmount, hasHealth, hasStim, type SheetVitals, type VitalsAction } from '../sheets/vitals';
import { createPlayerTokenRow } from './tokenActions';

// The vitals strip (8s3b; mockup docs/mockups/vitals-strip.html, approved 2026-11-17), in the sheet header on every tab of
// SHEET.EXE and the standalone tab alike. For one pool of hit points, a box under the HP bar (the user, 2026-11-17: the bar
// kept, the boxes laid out like D&D Beyond's): HEAL, the amount and DAMAGE stacked on the left; CURRENT / MAX and TEMP large beside them,
// TEMP set by clicking it; the system's word for hit points under them, opening the HEALTH window's own panel right here
// for everything else. The same route as HEALTH, so the token, the map and every open sheet move together; the map's
// HEALTH window is unchanged. Another health model has HEALTH ▾ to change it.

const small: React.CSSProperties = {
  background: 'none', fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '2px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
};
const button = (color: string): React.CSSProperties => ({ ...small, color, border: `1px solid ${color}` });
const label: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '2px', opacity: 0.7 };
const big: React.CSSProperties = { fontSize: '1.6rem', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' };

export function VitalsStrip({ vitals, open, onToggle }: { vitals: SheetVitals; open: boolean; onToggle: () => void }) {
  const { token, system, authToken, socket, reload } = vitals;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  /** TEMP being typed, after a click on it; null while it shows. */
  const [tempText, setTempText] = useState<string | null>(null);
  // A custom system's model, as HEALTH reads it: null for the built-in games, which are one pool.
  const view = useHealthView(socket, token?.id, isCustomSystem(system));
  const word = useWords(system);
  const hp = word('hp', 'short', 'HP').toUpperCase();
  const hitPoints = word('hp', 'plural', 'HIT POINTS').toUpperCase();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };

  if (!token) {
    // As HEALTH's CREATE HEALTH RECORD: the player's token row, then the sheet asked for again with it.
    const create = () => createPlayerTokenRow({ fetch: (url, init) => fetch(url, init), authToken, refreshLocations: reload }, vitals.owner);
    return (
      <>
        <div role="group" aria-label="Vitals" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
          <span style={{ opacity: 0.7 }}>NO TOKEN ON THE MAP</span>
          <button type="button" onClick={() => { void create(); }} style={button('var(--green)')}>CREATE HEALTH RECORD</button>
        </div>
      </>
    );
  }
  if (!hasHealth(view?.model)) return null;

  const send = async (action: VitalsAction, n: number) => {
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
      // The server tells every open sheet (sheetUpdated), this one with them: the numbers follow.
      if (action === 'set_temp') setTempText(null); else setAmount('');
    } catch {
      setRefused('NOT CHANGED: NO CONNECTION');
    } finally {
      setBusy(false);
    }
  };
  const byAmount = (action: VitalsAction) => { void send(action, amountOf(amount)); };

  const panel = open && (
    <div role="region" aria-label="Health" style={{ border: '1px solid var(--dark-green)', padding: '8px 10px' }}>
      {/* Without what the strip already has: one set of DAMAGE, HEAL and TEMP, not two. */}
      <HitPointsPanel target={token as unknown as Location} token={authToken} refreshLocations={reload} gameSystem={system} socket={socket} underStrip />
    </div>
  );
  const alert = refused && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.6rem', letterSpacing: '1px' }}>{refused}</span>;

  // Another model: its own editor, in HEALTH ▾.
  if (!takesAnAmount(view?.model)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
        <div role="group" aria-label="Vitals" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" aria-expanded={open} onClick={onToggle}
            style={{ ...button('var(--green)'), borderStyle: open ? 'solid' : 'dashed', background: open ? 'var(--green)' : 'none', color: open ? 'var(--black)' : 'var(--green)' }}>
            HEALTH {open ? '▴' : '▾'}
          </button>
          {alert}
        </div>
        {panel}
      </div>
    );
  }

  const cur = token.hp_current ?? 0;
  const max = token.hp_max ?? 0;
  const temp = token.hp_temp ?? 0;
  const ratio = max > 0 ? Math.max(0, Math.min(cur, max)) / max : 0;
  // As the header's bar colors it.
  const hpColor = ratio > 0.5 ? 'var(--green)' : ratio > 0.25 ? 'var(--warning)' : 'var(--danger)';
  const setTemp = () => { if (tempText !== null) void send('set_temp', amountOf(tempText)); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
      <div role="group" aria-label="Vitals" style={{
        position: 'relative', display: 'flex', gap: '10px', alignItems: 'stretch', border: '1px solid var(--green)', padding: '6px 8px',
        background: 'color-mix(in srgb, var(--black) 40%, transparent)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '64px', flexShrink: 0 }}>
          <button type="button" disabled={busy} onClick={() => byAmount('heal')} style={button('var(--green)')}>HEAL</button>
          <input
            className="sheet-input" type="number" min={0} inputMode="numeric" placeholder="0" aria-label={`Amount of ${hp}`}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') byAmount('damage'); }}
            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: '0.75rem', padding: '1px 4px', background: 'color-mix(in srgb, var(--black) 50%, transparent)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit' }}
          />
          <button type="button" disabled={busy} onClick={() => byAmount('damage')} style={button('var(--danger)')}>DAMAGE</button>
          {hasStim(system) && (
            <button type="button" disabled={busy} onClick={() => byAmount('stim_heal')}
              title="Field healing (stims, medkits): heals and adds +1 System Strain. Refused when strain is maxed. HEAL is natural or rest healing."
              style={button('var(--warning)')}>STIM +1 STRAIN</button>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center', justifyItems: 'center', rowGap: '2px' }}>
          <span style={label}>CURRENT</span><span />
          <span style={label}>MAX</span>
          <span style={label}>TEMP</span>
          <span aria-label={`Current ${hp}`} style={{ ...big, color: hpColor, transition: 'color 0.3s' }}>{cur}</span>
          <span style={{ ...big, opacity: 0.6, padding: '0 2px' }}>/</span>
          <span aria-label={`Max ${hp}`} style={big}>{max}</span>
          {tempText === null ? (
            <button type="button" disabled={busy} onClick={() => setTempText(temp ? String(temp) : '')}
              aria-label={`Temp ${hp}: ${temp}. Click to set it`} title={`Click to set temp ${hp}`}
              style={{ ...big, background: 'none', border: '1px dashed transparent', color: 'var(--cyan)', cursor: 'pointer', fontFamily: 'inherit', padding: '0 4px' }}>
              {temp ? temp : '--'}
            </button>
          ) : (
            <input
              autoFocus className="sheet-input" type="number" min={0} inputMode="numeric" aria-label={`Temp ${hp}`}
              value={tempText} onChange={(e) => setTempText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setTemp(); if (e.key === 'Escape') setTempText(null); }}
              onBlur={setTemp}
              style={{ width: '3.2em', textAlign: 'center', fontSize: '1rem', background: 'color-mix(in srgb, var(--black) 50%, transparent)', color: 'var(--cyan)', border: '1px solid var(--cyan)', fontFamily: 'inherit' }}
            />
          )}
          {/* Room for the caption, which is centered on the whole box rather than this column (the user, 2026-11-17). */}
          <span aria-hidden="true" style={{ gridColumn: '1 / -1', height: '1.1rem' }} />
        </div>
        <button type="button" aria-expanded={open} onClick={onToggle} title={`Open HEALTH here: max ${hp}, injuries, conditions`}
          style={{
            position: 'absolute', left: '50%', bottom: '6px', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
            background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '2px', fontWeight: 'bold',
          }}>
          {hitPoints} {open ? '▴' : '▾'}
        </button>
      </div>
      {alert}
      {panel}
    </div>
  );
}
