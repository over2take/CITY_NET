import React, { useState } from 'react';
import type { Kind } from '../sheets/damageTypes';
import { IconLook } from './IconLook';
import { useTokenResistances } from '../hooks/useTokenResistances';
import {
  chipsOf, showVulnerabilities, handRowOf, mayTakeOff, pickable, withAdded, withTakenOff, chipWords, sourceWords, ALL,
  type Chip, type ResistanceView,
} from '../sheets/resistanceChips';

// RESISTANCES and VULNERABILITIES on a token's HEALTH (8b3c2b; the user, 2026-11-24: "below Conditions", "use a system
// like conditions", "Resistances | Vulnerability"; draft 2 approved): two rows of chips under CONDITIONS in the HEALTH
// window, under INJURIES in the sheet's drawer. Each chip a type's picture in a ring (RESIST a ring, IMMUNE filled,
// VULNERABLE dashed), clicked open to say what it means here and where each part comes from, with TAKE OFF BY HAND where
// the one looking added it (or is the GM). + RESISTANCE (RESIST or IMMUNE) for the GM and a player on their own character
// or an NPC given them; + VULNERABILITY the GM's alone, and the row shown to a player only where their character has one.
// The rules are sheets/resistanceChips.ts; the server says who may do what.

const label: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '2px', opacity: 0.75 };
const small: React.CSSProperties = { fontSize: '0.6rem', padding: '2px 8px' };
const chipStyle = (color: string, on: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '5px', border: '1px solid currentColor', color, padding: '2px 6px', fontSize: '10px',
  letterSpacing: '1px', lineHeight: 1.2, minHeight: '20px', cursor: 'pointer', fontFamily: 'inherit',
  background: on ? `color-mix(in srgb, ${color} 20%, transparent)` : 'none',
});

/** A type's picture in its kind's ring: RESIST a ring, IMMUNE filled, VULNERABLE dashed; two that cancel, dotted. */
function Ring({ kind, chip, size = 17 }: { kind: Kind | null; chip: Pick<Chip, 'icon' | 'drawn' | 'id'>; size?: number }) {
  const filled = kind === 'immune';
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      border: `1.5px ${kind === 'vulnerable' ? 'dashed' : kind === null ? 'dotted' : 'solid'} currentColor`, background: filled ? 'currentColor' : 'none',
    }}>
      <span style={{ display: 'inline-flex', color: filled ? 'var(--black)' : 'inherit' }}>
        {/* ALL has no picture of its own: its ring, the word beside it. */}
        {chip.id === ALL ? null : <IconLook icon={chip.icon} drawn={chip.drawn} size={size - 6} />}
      </span>
    </span>
  );
}

export function TokenResistances({ locationId, authToken, socket, conditionsKey = '' }: {
  locationId: number;
  authToken?: string;
  socket?: Parameters<typeof useTokenResistances>[0];
  /** The token's conditions as stored: a change asks again, as one may resist. */
  conditionsKey?: string;
}) {
  const { view, reload } = useTokenResistances(socket, locationId, authToken, conditionsKey);
  const [opened, setOpened] = useState<string | null>(null);
  const [picking, setPicking] = useState<'resist' | 'vulnerable' | null>(null);
  const [pickKind, setPickKind] = useState<'resist' | 'immune'>('resist');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!view || !view.on) return null;

  const send = async (resistances: { kind: Kind; type: string }[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${locationId}/resistances`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ resistances }),
      });
      if (!res.ok) setError((await res.json().catch(() => null))?.error ?? 'NOT CHANGED');
      else { setPicking(null); setOpened(null); }
    } catch {
      setError('NOT CHANGED: NO CONNECTION');
    } finally {
      setBusy(false);
      reload();
    }
  };

  const { resist, vulnerable } = chipsOf(view);
  const row = (which: 'resist' | 'vulnerable', chips: Chip[], color: string, word: string, add: string, may: boolean) => {
    const open = chips.find((c) => c.id === opened);
    const hand = open && handRowOf(view, open);
    return (
      <section aria-label={word} style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', color }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={label}>{word.toUpperCase()}</span>
          {may && (
            <button type="button" className="utility-btn" style={small} aria-expanded={picking === which} disabled={busy}
              onClick={() => { setOpened(null); setError(null); setPicking((p) => (p === which ? null : which)); }}>
              {picking === which ? 'DONE' : add}
            </button>
          )}
        </div>
        {chips.length === 0
          ? <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>None.</span>
          : (
            <div role="group" aria-label={`${word} this character has`} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {chips.map((c) => (
                <button key={c.id} type="button" aria-label={chipWords(c)} aria-expanded={opened === c.id} title={chipWords(c)}
                  onClick={() => { setPicking(null); setOpened((o) => (o === c.id ? null : c.id)); }} style={chipStyle(color, opened === c.id)}>
                  <Ring kind={c.kind} chip={c} />{c.name}
                </button>
              ))}
            </div>
          )}
        {picking === which && <Picker view={view} which={which} kind={pickKind} onKind={setPickKind} busy={busy} color={color}
          onPick={(type) => { void send(withAdded(view, which === 'vulnerable' ? 'vulnerable' : pickKind, type)); }} />}
        {open && (
          <div role="group" aria-label={chipWords(open)} style={{ border: `1px solid ${color}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.7rem', lineHeight: 1.4 }}>
            <span style={{ display: 'flex', gap: '6px', alignItems: 'center', letterSpacing: '1px' }}><Ring kind={open.kind} chip={open} /><b>{chipWords(open)}</b></span>
            <span>{open.kind === null ? 'Taken as rolled.' : view.means?.[open.kind]}</span>
            <span style={{ opacity: 0.85 }}>FROM: {open.from.map((s) => sourceWords(open, s)).join(' · ')}</span>
            <span style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button type="button" className="utility-btn" style={{ fontSize: '0.55rem', padding: '1px 8px' }} onClick={() => setOpened(null)}>CLOSE</button>
              {mayTakeOff(view, hand) && (
                <button type="button" className="utility-btn" aria-label={`Take ${chipWords(open)} off, by hand`} disabled={busy}
                  onClick={() => { void send(withTakenOff(view, open.id)); }}
                  style={{ fontSize: '0.55rem', padding: '1px 8px', color: 'var(--danger)', borderColor: 'var(--danger)' }}>TAKE OFF BY HAND</button>
              )}
            </span>
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      {row('resist', resist, 'var(--cyan)', 'Resistances', '+ RESISTANCE', !!view.may?.add)}
      {showVulnerabilities(view, vulnerable) && row('vulnerable', vulnerable, 'var(--danger)', 'Vulnerabilities', '+ VULNERABILITY', !!view.may?.vulnerable)}
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.7rem' }}>{error}</span>}
    </>
  );
}

/** What + RESISTANCE or + VULNERABILITY puts on: RESIST or IMMUNE (resistances only), then ALL or a type, one click each. */
function Picker({ view, which, kind, onKind, onPick, busy, color }: {
  view: ResistanceView; which: 'resist' | 'vulnerable'; kind: 'resist' | 'immune'; onKind: (k: 'resist' | 'immune') => void;
  onPick: (type: string) => void; busy: boolean; color: string;
}) {
  const choice = (on: boolean): React.CSSProperties => ({ ...small, background: on ? color : 'none', color: on ? 'var(--black)' : color, border: `1px solid ${color}`, fontFamily: 'inherit', cursor: 'pointer' });
  return (
    <div role="group" aria-label={which === 'resist' ? 'Add a resistance' : 'Add a vulnerability'} style={{ border: '1px solid var(--dark-green)', padding: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {which === 'resist' && (
        <span role="group" aria-label="Kind" style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
          <button type="button" aria-pressed={kind === 'resist'} style={choice(kind === 'resist')} onClick={() => onKind('resist')}>RESIST</button>
          <button type="button" aria-pressed={kind === 'immune'} style={choice(kind === 'immune')} onClick={() => onKind('immune')}>IMMUNE</button>
        </span>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {pickable(view).map((t) => (
          <button key={t.id} type="button" disabled={busy} onClick={() => onPick(t.id)} style={chipStyle(color, false)}>
            <Ring kind={which === 'vulnerable' ? 'vulnerable' : kind} chip={t} />{t.name.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
