import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Location } from '../types';
import { useConditionList, useConditionDetail } from '../hooks/useConditionList';
import { parseOnToken, shownConditions, withPutOn, withTakenOff, notOnYet, modifierText, roundsText } from '../sheets/tokenConditions';
import { ConditionIcon } from './ConditionIcon';

// A token's CONDITIONS in its HEALTH folder (4e2b1; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09). Any number, as chips that wrap, each with its description below. Whoever may change
// the token's health (`canChange`) puts them on and takes them off, and sees the rounds left and the
// modifiers; everyone else sees which conditions and what they mean, as with injuries.
// The logic is sheets/tokenConditions.ts; the server checks every change (PUT /:id/conditions).

interface Props {
  location: Location & { conditions?: string };
  /** The running game system, whose conditions these are. */
  gameSystem?: string;
  socket?: any;
  /** Whoever may change the token's health may change its conditions. */
  canChange: boolean;
  /** The login sent with a change: the GM's, or the player's own. */
  authToken?: string;
  /** Called after a change lands, so the map redraws. */
  onChanged?: () => void;
  /**
   * Chips only, for the sheet's vitals strip (8s3c): no heading, nothing said with none, + to put one on; each one's
   * description and modifiers on hover rather than written out below.
   */
  compact?: boolean;
  /**
   * Where the compact form's list of conditions opens: the strip's full-width place under its row, as wide as REST's
   * drawer (the user, 2026-11-17); in the chips' own row without it.
   */
  pickerHost?: HTMLElement | null;
}

const small: React.CSSProperties = { fontSize: '9px', letterSpacing: '2px', opacity: 0.75 };

export function TokenConditions({ location, gameSystem, socket, canChange, authToken, onChanged, compact = false, pickerHost }: Props) {
  const raw = location.conditions ?? '[]';
  const game = useConditionList(gameSystem, authToken);
  const detail = useConditionDetail(socket, location.id, raw);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onToken = parseOnToken(raw);
  const shown = shownConditions(onToken, game, detail);

  const send = async (list: ReturnType<typeof withPutOn>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/locations/${location.id}/conditions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ conditions: list }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body && typeof body.error === 'string' ? body.error : 'The conditions could not be changed.'); return; }
      setError(null);
      onChanged?.();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (!shown.length && !canChange) return null;
  const offered = notOnYet(onToken, game);

  const picker = picking && canChange && (
    <div role="listbox" aria-label="Put on a condition" style={{ border: '1px solid var(--dark-green)', maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', ...(compact && !pickerHost ? { flexBasis: '100%' } : {}) }}
      className="cyber-scroll">
      {offered.length === 0
        ? <span style={{ fontSize: '0.7rem', opacity: 0.6, padding: '6px' }}>Every condition is on already.</span>
        : offered.map((c) => (
          <button key={c.id} type="button" role="option" aria-selected={false} disabled={busy} onClick={() => send(withPutOn(onToken, detail, c.id))}
            style={{
              display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gap: '8px', alignItems: 'center', padding: '4px 8px', textAlign: 'left',
              background: 'none', border: 0, borderBottom: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)',
              color: 'var(--green)', fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer',
            }}>
            <ConditionIcon icon={c.icon} size={15} />
            <span>{c.name.toUpperCase()}{c.ends === 'rounds' && c.rounds ? <span style={{ opacity: 0.6 }}> · {c.rounds}R</span> : null}</span>
          </button>
        ))}
    </div>
  );
  const takeOff = (c: { id: string; name: string }) => canChange && (
    <button type="button" aria-label={`Take ${c.name} off`} disabled={busy}
      onClick={() => send(withTakenOff(onToken, detail, c.id))}
      style={{ background: 'none', border: 0, color: 'var(--danger)', cursor: 'pointer', padding: '0 0 0 2px', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1 }}>×</button>
  );
  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px', border: '1px solid var(--warning)', color: 'var(--warning)',
    padding: '2px 6px', fontSize: '10px', letterSpacing: '1px', lineHeight: 1.2, boxSizing: 'border-box', minHeight: '20px',
  };

  // The vitals strip's chips (8s3c): what each means on hover, the + beside them.
  if (compact) {
    return (
      <section aria-label="Conditions" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
        {shown.map(({ condition: c, left, modifiers }) => (
          <span key={c.id} role="note" aria-label={c.name}
            title={[c.name.toUpperCase() + (left !== undefined ? ` · ${roundsText(left)}` : ''), c.description, modifiers.map(modifierText).join(' · ')].filter(Boolean).join('\n')}
            style={chip}>
            <ConditionIcon icon={c.icon} size={13} />
            <span>{c.short}</span>
            {left !== undefined && <span style={{ opacity: 0.75 }}>{left}R</span>}
            {takeOff(c)}
          </span>
        ))}
        {canChange && (
          // Opened and closed as the strip's REST ▾ and HIT POINTS ▾ are (the user, 2026-11-17): the same name, ▾ / ▴.
          <button type="button" aria-label="Put on a condition" aria-expanded={picking} disabled={busy}
            title="Put on a condition" onClick={() => setPicking((p) => !p)}
            style={{
              ...chip, cursor: 'pointer', fontFamily: 'inherit', borderStyle: 'solid', borderColor: 'var(--green)',
              background: picking ? 'var(--green)' : 'none', color: picking ? 'var(--black)' : 'var(--green)',
            }}>
            + CONDITION {picking ? '▴' : '▾'}
          </button>
        )}
        {picker && pickerHost ? createPortal(picker, pickerHost) : picker}
        {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.7rem', flexBasis: '100%' }}>{error}</span>}
      </section>
    );
  }

  return (
    <section aria-label="Conditions" style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={small}>CONDITIONS</span>
        {canChange && (
          <button type="button" className="utility-btn" style={{ fontSize: '0.6rem', padding: '2px 8px' }} aria-expanded={picking}
            disabled={busy} onClick={() => setPicking((p) => !p)}>
            {picking ? 'DONE' : '+ CONDITION'}
          </button>
        )}
      </div>
      {shown.length === 0
        ? <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>None.</span>
        : (
          <ul aria-label="On this token" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {shown.map(({ condition: c, left }) => (
              <li key={c.id} title={c.description} style={chip}>
                <ConditionIcon icon={c.icon} size={13} />
                <span>{c.short}</span>
                {left !== undefined && <span style={{ opacity: 0.75 }}>{left}R</span>}
                {takeOff(c)}
              </li>
            ))}
          </ul>
        )}
      {picker}
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.7rem' }}>{error}</span>}
      {shown.map(({ condition: c, left, modifiers }) => (
        <div key={c.id} data-testid={`condition-${c.id}`} style={{ fontSize: '0.7rem', lineHeight: 1.4 }}>
          <b style={{ color: 'var(--warning)', letterSpacing: '1px' }}>{c.name.toUpperCase()}</b>
          {left !== undefined && <span style={{ opacity: 0.6 }}> · {roundsText(left)}</span>}
          {c.description && <div style={{ opacity: 0.85 }}>{c.description}</div>}
          {modifiers.length > 0 && <div style={{ color: 'var(--cyan)' }}>{modifiers.map(modifierText).join(' · ')}</div>}
        </div>
      ))}
    </section>
  );
}
