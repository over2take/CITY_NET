import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Kind } from '../sheets/damageTypes';
import { IconLook } from './IconLook';
import { popoverPlace, POP_WIDTH } from './HelpHint';
import { themeRoot } from '../utils/themeRoot';
import { useTokenResistances } from '../hooks/useTokenResistances';
import {
  chipsOf, showVulnerabilities, showResistances, handRowOf, mayTakeOff, pickable, withAdded, withTakenOff, chipWords, ALL,
  revealing, isRevealed, withRevealed, withAllRevealed, fromWords, helperLines,
  type Chip, type ResistanceView,
} from '../sheets/resistanceChips';

// RESISTANCES and VULNERABILITIES on a token's HEALTH (8b3c2b; the user, 2026-11-24: "below Conditions", "use a system
// like conditions", "Resistances | Vulnerability"; draft 2 approved): two rows of chips under CONDITIONS in the HEALTH
// window, under INJURIES in the sheet's drawer. Each chip a type's picture in a ring (RESIST a ring, IMMUNE filled,
// VULNERABLE dashed), clicked open to say what it means here and where each part comes from, with TAKE OFF BY HAND where
// the one looking added it (or is the GM). + RESISTANCE (RESIST or IMMUNE) for the GM and a player on their own character
// or an NPC given them; + VULNERABILITY the GM's alone, and the row shown to a player only where their character has one.
// The rules are sheets/resistanceChips.ts; the server says who may do what.
//
// REVEAL (8b4b; the user, 2026-11-24; mockup damage-pipeline.html): on an NPC, the GM's chips players don't see yet are
// drawn dotted with a GM mark, opened to REVEAL (or HIDE AGAIN), with REVEAL ALL under the rows. Players see an NPC's
// revealed chips only, to read, and nothing until one is. Every chip has its helper on hover, keyboard focus or a tap.

const label: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '2px', opacity: 0.75 };
const small: React.CSSProperties = { fontSize: '0.6rem', padding: '2px 8px' };
const chipStyle = (color: string, on: boolean, hidden = false): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '5px', border: `1px ${hidden ? 'dotted' : 'solid'} currentColor`, color, padding: '2px 6px', fontSize: '10px',
  position: 'relative', opacity: hidden ? 0.75 : 1,
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

/** A chip players don't see yet: the GM's mark at its corner, as the mockup drew it. */
const gmMark: React.CSSProperties = {
  position: 'absolute', right: -5, bottom: -6, fontSize: '7px', letterSpacing: 0, lineHeight: 1, padding: '1px 2px',
  background: 'var(--black)', border: '1px dotted currentColor',
};

/** A chip's helper, on hover or keyboard focus: drawn in the theme's root beside the chip, so a scrolling panel can't clip it. */
function Helper({ lines, at }: { lines: string[]; at: { left: number; top: number } }) {
  return createPortal(
    <span role="tooltip" style={{
      position: 'fixed', left: at.left, top: at.top, width: POP_WIDTH, zIndex: 3000, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 2,
      background: 'var(--black)', border: '1px solid var(--cyan)', color: 'var(--text)', padding: '6px 8px',
      fontSize: 11, lineHeight: 1.45, letterSpacing: 0, textAlign: 'left', textTransform: 'none', pointerEvents: 'none',
      boxShadow: '0 4px 18px color-mix(in srgb, var(--black) 70%, transparent)',
    }}>
      {lines.map((l, i) => <span key={i} style={i === 0 ? { color: 'var(--cyan)', letterSpacing: '1px' } : i > 1 ? { opacity: 0.8 } : undefined}>{l}</span>)}
    </span>,
    themeRoot(),
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
  const [helper, setHelper] = useState<{ id: string; at: { left: number; top: number } } | null>(null);
  if (!view || !view.on) return null;

  const send = async (what: 'resistances' | 'revealed', list: unknown[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${locationId}/${what}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ [what]: list }),
      });
      if (!res.ok) setError((await res.json().catch(() => null))?.error ?? 'NOT CHANGED');
      else if (what === 'resistances') { setPicking(null); setOpened(null); }
    } catch {
      setError('NOT CHANGED: NO CONNECTION');
    } finally {
      setBusy(false);
      reload();
    }
  };

  const { resist, vulnerable } = chipsOf(view);
  const gmReveals = revealing(view);
  const unrevealed = [...resist, ...vulnerable].filter((c) => !isRevealed(view, c));
  const showHelper = (id: string, el: HTMLElement) => setHelper({ id, at: popoverPlace(el.getBoundingClientRect(), window.innerWidth) });
  const helped = helper && [...resist, ...vulnerable].find((c) => c.id === helper.id);
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
              {chips.map((c) => {
                const hidden = !isRevealed(view, c);
                return (
                  <button key={c.id} type="button" aria-label={hidden ? `${chipWords(c)}, not revealed` : chipWords(c)} aria-expanded={opened === c.id}
                    onMouseEnter={(e) => showHelper(c.id, e.currentTarget)} onMouseLeave={() => setHelper(null)}
                    onFocus={(e) => showHelper(c.id, e.currentTarget)} onBlur={() => setHelper(null)}
                    onKeyDown={(e) => { if (e.key === 'Escape' && (helper || opened)) { e.stopPropagation(); setHelper(null); setOpened(null); } }}
                    onClick={() => { setPicking(null); setOpened((o) => (o === c.id ? null : c.id)); }} style={chipStyle(color, opened === c.id, hidden)}>
                    <Ring kind={c.kind} chip={c} />{c.name}
                    {hidden && <span aria-hidden="true" style={gmMark}>GM</span>}
                  </button>
                );
              })}
            </div>
          )}
        {picking === which && <Picker view={view} which={which} kind={pickKind} onKind={setPickKind} busy={busy} color={color}
          onPick={(type) => { void send('resistances', withAdded(view, which === 'vulnerable' ? 'vulnerable' : pickKind, type)); }} />}
        {open && (
          <div role="group" aria-label={chipWords(open)} style={{ border: `1px solid ${color}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.7rem', lineHeight: 1.4 }}>
            <span style={{ display: 'flex', gap: '6px', alignItems: 'center', letterSpacing: '1px' }}><Ring kind={open.kind} chip={open} /><b>{chipWords(open)}</b></span>
            <span>{open.kind === null ? 'Taken as rolled.' : view.means?.[open.kind]}</span>
            {fromWords(open) && <span style={{ opacity: 0.85 }}>FROM: {fromWords(open)}</span>}
            {open.description && <span style={{ opacity: 0.85 }}>{open.name}: {open.description}</span>}
            {gmReveals && <span style={{ opacity: 0.85 }}>{isRevealed(view, open) ? 'Players see it.' : 'Players don\'t see it yet.'}</span>}
            <span style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="utility-btn" style={{ fontSize: '0.55rem', padding: '1px 8px' }} onClick={() => setOpened(null)}>CLOSE</button>
              {gmReveals && (
                <button type="button" className="utility-btn" disabled={busy} aria-label={`${isRevealed(view, open) ? 'Hide' : 'Reveal'} ${chipWords(open)} to players`}
                  onClick={() => { void send('revealed', withRevealed(view, open.id, !isRevealed(view, open))); }}
                  style={{ fontSize: '0.55rem', padding: '1px 8px' }}>{isRevealed(view, open) ? 'HIDE AGAIN' : 'REVEAL'}</button>
              )}
              {mayTakeOff(view, hand) && (
                <button type="button" className="utility-btn" aria-label={`Take ${chipWords(open)} off, by hand`} disabled={busy}
                  onClick={() => { void send('resistances', withTakenOff(view, open.id)); }}
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
      {showResistances(view, resist) && row('resist', resist, 'var(--cyan)', 'Resistances', '+ RESISTANCE', !!view.may?.add)}
      {showVulnerabilities(view, vulnerable) && row('vulnerable', vulnerable, 'var(--danger)', 'Vulnerabilities', '+ VULNERABILITY', !!view.may?.vulnerable)}
      {gmReveals && (resist.length > 0 || vulnerable.length > 0) && (
        <div role="group" aria-label="What players see" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', fontSize: '0.6rem', letterSpacing: '1px', opacity: 0.85 }}>
          <span>{unrevealed.length ? 'PLAYERS SEE ONLY WHAT YOU REVEAL' : 'PLAYERS SEE ALL OF THESE'}</span>
          {unrevealed.length > 0 && (
            <button type="button" className="utility-btn" style={small} disabled={busy}
              onClick={() => { void send('revealed', withAllRevealed(view, [...resist, ...vulnerable])); }}>REVEAL ALL</button>
          )}
        </div>
      )}
      {helper && helped && opened !== helped.id && <Helper lines={helperLines(view, helped)} at={helper.at} />}
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
