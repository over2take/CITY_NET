import React, { useState } from 'react';
import { picksToTargets, sendHeading, sentWords, withTicked, type RollSend, type SendPicks, type SendTarget } from '../sheets/sendTo';
import { previewKey, useSendTo, type SendSocketRef } from '../hooks/useSendTo';

const small: React.CSSProperties = { fontSize: '0.6rem', padding: '1px 6px', letterSpacing: '1px', whiteSpace: 'nowrap' };

/**
 * SEND TO under a line of the GM's tray (8b7b; approved mockup docs/mockups/send-to.html, sections 1 and 2): the button,
 * where it went (SENT → GOBLIN A, FIRE IMP), and, opened, the picker under it: the tokens on the GM's map and floor, a fight's
 * first, each ticked FULL or HALF, with what each would take as the server works it out (its resistances), SEND and CANCEL.
 * A token it went to already is said SENT and can't be ticked. Only the GM's tray is told a line may be sent.
 */
export function SendTo({ send, targets, socketRef, open, onOpen, onClose }: {
  send: RollSend;
  targets: SendTarget[];
  socketRef: SendSocketRef;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<SendPicks>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const { previews, send: sendOn } = useSendTo(socketRef, send.rollId, targets, open, send.sent.length);
  const went = sentWords(send);
  const close = () => { setPicks({}); setSaid(null); onClose(); };
  const ticked = picksToTargets(picks, targets);
  const go = async () => {
    setBusy(true);
    const answer = await sendOn(ticked);
    setBusy(false);
    if (!answer.ok) { setSaid(answer.error); return; }
    close();
  };
  const fighting = targets.filter((t) => t.inFight);
  const others = targets.filter((t) => !t.inFight);
  const row = (t: SendTarget) => {
    const pick = picks[t.id];
    const full = previews[previewKey(t.id, false)];
    const shown = previews[previewKey(t.id, pick === 'half')];
    const done = !!full?.sent;
    return (
      <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: '2px 6px', alignItems: 'center' }}>
        <input type="checkbox" aria-label={t.name} checked={!!pick} disabled={done || busy} onChange={() => setPicks((p) => withTicked(p, t.id))} style={{ accentColor: 'var(--green)', margin: 0 }} />
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t.name}</span>
        <span role="group" aria-label={`${t.name} full or half`} style={{ display: 'inline-flex', border: '1px solid var(--green)' }}>
          {(['full', 'half'] as const).map((k) => (
            <button key={k} type="button" disabled={!pick || busy} aria-pressed={pick === k} onClick={() => setPicks((p) => ({ ...p, [t.id]: k }))}
              style={{ ...small, border: 0, cursor: pick ? 'pointer' : 'default', fontFamily: 'inherit', opacity: pick ? 1 : 0.4,
                background: pick === k ? 'var(--green)' : 'none', color: pick === k ? 'var(--black)' : 'var(--green)' }}>{k.toUpperCase()}</button>
          ))}
        </span>
        {(done || (pick && shown)) && (
          <span data-testid="send-would" style={{ gridColumn: '2 / 4', fontSize: '0.6rem', color: done ? 'var(--cyan)' : 'var(--green)', opacity: done ? 1 : 0.85 }}>
            {done ? 'SENT' : shown!.words}
          </span>
        )}
      </div>
    );
  };
  const group = (label: string, list: SendTarget[]) => (
    <>
      <span style={{ fontSize: '0.55rem', letterSpacing: '2px', opacity: 0.7, marginTop: '4px' }}>{label}</span>
      {list.map(row)}
    </>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="utility-btn" aria-expanded={open} aria-label={`Send ${send.what} to`} onClick={open ? close : onOpen} style={small}>
          SEND TO {open ? '▴' : '▾'}
        </button>
        {went && <span data-testid="sent-to" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--cyan)', overflowWrap: 'anywhere' }}>{went}</span>}
      </div>
      {open && (
        <div role="group" aria-label={sendHeading(send)}
          style={{ border: '1px solid var(--cyan)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '5px', color: 'var(--green)',
            background: 'color-mix(in srgb, var(--cyan) 5%, var(--panel-bg))', textShadow: 'none' }}>
          <span style={{ fontSize: '0.65rem', letterSpacing: '1px' }}>{sendHeading(send)}</span>
          {targets.length === 0 && <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>No tokens on this map.</span>}
          {fighting.length > 0 && others.length > 0
            ? <>{group('IN THE FIGHT', fighting)}{group('ALSO ON THIS MAP', others)}</>
            : targets.map(row)}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: '2px' }}>
            <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>{ticked.length ? `${ticked.length} ticked` : 'Tick each one in the blast.'}</span>
            <span style={{ display: 'flex', gap: '6px' }}>
              <button type="button" className="utility-btn" onClick={close} disabled={busy} style={{ ...small, opacity: 0.75 }}>CANCEL</button>
              <button type="button" className="utility-btn" onClick={go} disabled={busy || !ticked.length} style={small}>SEND</button>
            </span>
          </div>
          {said && <span role="alert" style={{ color: 'var(--warning)', fontSize: '0.6rem' }}>{said}</span>}
        </div>
      )}
    </div>
  );
}
