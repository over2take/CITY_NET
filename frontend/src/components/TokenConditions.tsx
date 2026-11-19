import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Location } from '../types';
import { useConditionList, useConditionDetail } from '../hooks/useConditionList';
import { parseOnToken, shownConditions, withPutOn, withTakenOff, notOnYet, modifierText, roundsText, chipsThatFit } from '../sheets/tokenConditions';
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
  /** The compact form: what sits on + CONDITION's line after it (the strip's AC and REST ▾, 8a6c). */
  beside?: React.ReactNode;
}

const small: React.CSSProperties = { fontSize: '9px', letterSpacing: '2px', opacity: 0.75 };
/** The gap between the strip's chips, in pixels: drawn and measured with the same. */
const GAP = 5;
/** `opened` while "+N"'s list is open. */
const MORE = '+more';

export function TokenConditions({ location, gameSystem, socket, canChange, authToken, onChanged, compact = false, pickerHost, beside }: Props) {
  const raw = location.conditions ?? '[]';
  const game = useConditionList(gameSystem, authToken);
  const detail = useConditionDetail(socket, location.id, raw);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onToken = parseOnToken(raw);
  const shown = shownConditions(onToken, game, detail);
  // The strip's row (8a6c): the chip opened under it (or "+N"'s list), and how many fit in two lines, measured.
  const [opened, setOpened] = useState<string | null>(null);
  const [keep, setKeep] = useState(Infinity);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const showing = shown.map((s) => `${s.condition.id}:${s.condition.short}:${s.left ?? ''}`).join(',');
  useLayoutEffect(() => {
    if (!compact) return;
    const fit = () => {
      const row = rowRef.current;
      const sizes = measureRef.current ? [...measureRef.current.children].map((el) => (el as HTMLElement).offsetWidth) : [];
      // Not laid out (hidden, or a test's DOM): all of them.
      if (!row || !row.clientWidth || !sizes.length) { setKeep(Infinity); return; }
      const plus = sizes.pop()!;
      setKeep(chipsThatFit(sizes, row.clientWidth, GAP, () => plus));
    };
    fit();
    if (typeof ResizeObserver === 'undefined' || !rowRef.current) return;
    const watch = new ResizeObserver(fit);
    watch.observe(rowRef.current);
    return () => watch.disconnect();
  }, [compact, showing]);

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
  // The vitals strip's chips (8a6c; approved mockup docs/mockups/sheet-condition-row.html, A): a row of their own over
  // + CONDITION and what is `beside` it, there only while one is on; two lines at most, then "+N" (the user: "max 2 rows then
  // +N"). A click opens one under the row, what it does and TAKE OFF, where the × was (the user: "yes").
  if (compact) {
    const kept = Math.min(keep, shown.length);
    const hidden = shown.length - kept;
    const tinted = (on: boolean): React.CSSProperties => ({ ...chip, flexShrink: 0, cursor: 'pointer', fontFamily: 'inherit', background: on ? 'color-mix(in srgb, var(--warning) 20%, transparent)' : 'none' });
    const face = ({ condition: c, left }: typeof shown[number]) => (
      <>
        <ConditionIcon icon={c.icon} size={13} />
        <span>{c.short}</span>
        {left !== undefined && <span style={{ opacity: 0.75 }}>{left}R</span>}
      </>
    );
    const open = opened === MORE ? null : shown.find((s) => s.condition.id === opened);
    const box: React.CSSProperties = { border: '1px solid var(--warning)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.7rem', lineHeight: 1.4, textAlign: 'left' };
    // Escape closes what is open, from a chip or from inside it (a portal's keys come up through React too).
    const closeOnEscape = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && opened !== null) setOpened(null); };
    const drawer = open ? (
      <div role="group" aria-label={open.condition.name} style={box}>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--warning)', letterSpacing: '1px' }}>
          <ConditionIcon icon={open.condition.icon} size={15} />
          <b>{open.condition.name.toUpperCase()}</b>
          {open.left !== undefined && <span style={{ opacity: 0.75 }}>· {roundsText(open.left)}</span>}
        </span>
        {open.condition.description && <span>{open.condition.description}</span>}
        {open.modifiers.length > 0 && <span style={{ color: 'var(--cyan)' }}>{open.modifiers.map(modifierText).join(' · ')}</span>}
        <span style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button type="button" className="utility-btn" style={{ fontSize: '0.55rem', padding: '1px 8px' }} onClick={() => setOpened(null)}>CLOSE</button>
          {canChange && (
            <button type="button" className="utility-btn" aria-label={`Take ${open.condition.name} off`} disabled={busy}
              onClick={() => { setOpened(null); void send(withTakenOff(onToken, detail, open.condition.id)); }}
              style={{ fontSize: '0.55rem', padding: '1px 8px', color: 'var(--danger)', borderColor: 'var(--danger)' }}>TAKE OFF</button>
          )}
        </span>
      </div>
    ) : opened === MORE && hidden > 0 ? (
      <div role="group" aria-label="More conditions" style={{ ...box, padding: 0, gap: 0 }}>
        {shown.slice(kept).map((s) => (
          <button key={s.condition.id} type="button" onClick={() => setOpened(s.condition.id)}
            style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 8px', background: 'none', border: 0, borderBottom: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)', color: 'var(--warning)', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', cursor: 'pointer', textAlign: 'left' }}>
            <ConditionIcon icon={s.condition.icon} size={15} />
            {s.condition.name.toUpperCase()}{s.left !== undefined ? ` · ${s.left}R` : ''}
          </button>
        ))}
      </div>
    ) : null;
    const under = picker || drawer;
    return (
      <section aria-label="Conditions" onKeyDown={closeOnEscape} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {shown.length > 0 && (
          <div ref={rowRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: `${GAP}px`, alignItems: 'center', minWidth: 0 }}>
            {shown.slice(0, kept).map((s) => (
              <button key={s.condition.id} type="button" aria-label={s.condition.name} aria-expanded={opened === s.condition.id}
                title={[s.condition.name.toUpperCase() + (s.left !== undefined ? ` · ${roundsText(s.left)}` : ''), s.condition.description, s.modifiers.map(modifierText).join(' · ')].filter(Boolean).join('\n')}
                onClick={() => { setPicking(false); setOpened((o) => (o === s.condition.id ? null : s.condition.id)); }}
                style={tinted(opened === s.condition.id)}>
                {face(s)}
              </button>
            ))}
            {hidden > 0 && (
              <button type="button" aria-label={`${hidden} more conditions`} aria-expanded={opened === MORE}
                onClick={() => { setPicking(false); setOpened((o) => (o === MORE ? null : MORE)); }}
                style={{ ...tinted(opened === MORE), borderStyle: 'dashed' }}>+{hidden}</button>
            )}
            {/* Every chip at its own width, unseen, for what fits; and the widest "+N" there could be. */}
            <div ref={measureRef} aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, height: 0, overflow: 'hidden', visibility: 'hidden', display: 'flex', gap: `${GAP}px`, width: 'max-content', pointerEvents: 'none' }}>
              {shown.map((s) => <span key={s.condition.id} style={{ ...chip, flexShrink: 0 }}>{face(s)}</span>)}
              <span style={{ ...chip, flexShrink: 0 }}>+{shown.length}</span>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          {canChange && (
            // Opened and closed as the strip's REST ▾ and HIT POINTS ▾ are (the user, 2026-11-17): the same name, ▾ / ▴.
            <button type="button" aria-label="Put on a condition" aria-expanded={picking} disabled={busy}
              title="Put on a condition" onClick={() => { setOpened(null); setPicking((p) => !p); }}
              style={{
                ...chip, cursor: 'pointer', fontFamily: 'inherit', borderStyle: 'solid', borderColor: 'var(--green)',
                background: picking ? 'var(--green)' : 'none', color: picking ? 'var(--black)' : 'var(--green)',
              }}>
              + CONDITION {picking ? '▴' : '▾'}
            </button>
          )}
          {beside}
        </div>
        {under && pickerHost ? createPortal(under, pickerHost) : under}
        {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.7rem' }}>{error}</span>}
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
