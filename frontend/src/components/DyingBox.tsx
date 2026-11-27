import React, { useState } from 'react';
import { boxOf, downOf, downWord, type DyingShown } from '../sheets/dyingBox';

// The sheet's DYING box (8c3; approved mockup docs/mockups/rule-library.html, section 2, answers 3 and 5): under the vitals
// box, on SHEET.EXE and the sheet's own tab alike, while the token is down under its game's dying rule. The word, where the
// count stands, and DEATH SAVE, lit when their turn has come in a fight (the tray says so too); the GM's A TURN GOES BY where
// turns are counted with no roll. The roll and the turn are the server's (sockets 'deathSave' and 'dyingTurn'); what it
// refuses is said here. What it shows is sheets/dyingBox.ts.

interface Props {
  rule: DyingShown;
  /** The token's `dying`, as kept. */
  dying: string | null | undefined;
  locationId: number;
  gm: boolean;
  socket: { emit: (event: string, ...args: unknown[]) => unknown } | null;
}

const tone = { dying: 'var(--danger)', stable: 'var(--cyan)', dead: 'var(--green)' } as const;
const label: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '2px', opacity: 0.75 };
const btn = (color: string, lit = false): React.CSSProperties => ({
  background: lit ? color : 'none', color: lit ? 'var(--black)' : color, border: `1px solid ${color}`, fontFamily: 'inherit', fontSize: '0.65rem',
  letterSpacing: '2px', padding: '3px 12px', cursor: 'pointer', fontWeight: 'bold',
});

/** A count as boxes, filled for those made; said as words too, never by color alone. */
function Pips({ name, made, of, color }: { name: string; made: number; of: number; color: string }) {
  return (
    <span role="img" aria-label={`${name} ${made} of ${of}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.6rem', letterSpacing: '1px' }}>
      <span style={{ opacity: 0.8 }}>{name}</span>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} style={{ width: '9px', height: '9px', border: `1px solid ${color}`, background: i < made ? color : 'none', boxSizing: 'border-box' }} />
      ))}
      <span style={{ opacity: 0.8 }}>{made}/{of}</span>
    </span>
  );
}

export function DyingBox({ rule, dying, locationId, gm, socket }: Props) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const down = downOf(dying);
  if (!down) return null;
  // Sent only the word (not this token's player, nor the GM): the word alone.
  if (!down.full) return <DownWord rule={rule} dying={dying} />;
  const box = boxOf(rule, down, { gm });
  const color = tone[box.state];
  const ask = (event: 'deathSave' | 'dyingTurn') => {
    if (!socket || busy) return;
    setBusy(true);
    setRefused(null);
    socket.emit(event, { locationId }, (answer: { ok: boolean; error?: string } | undefined) => {
      setBusy(false);
      if (!answer?.ok) setRefused(answer?.error ?? 'Not done');
    });
  };

  return (
    <section aria-label={box.word} style={{ border: `1px solid ${color}`, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span role="status" style={{ color, letterSpacing: '3px', fontSize: '0.75rem', fontWeight: 'bold' }}>⚠ {box.word}</span>
      {(box.saves || box.turnsLeft) && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
          {box.saves && <Pips name="SAVES" made={box.saves.made} of={box.saves.of} color="var(--cyan)" />}
          {box.fails && <Pips name="FAILS" made={box.fails.made} of={box.fails.of} color="var(--danger)" />}
          {box.turnsLeft && <Pips name="TURNS LEFT" made={box.turnsLeft.left} of={box.turnsLeft.of} color="var(--warning)" />}
        </span>
      )}
      {box.madeIt !== undefined && box.madeIt > 0 && <span style={label}>MADE IT {box.madeIt} {box.madeIt === 1 ? 'TURN' : 'TURNS'}</span>}
      {(box.save || box.turnButton) && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'center' }}>
          {box.save && <span style={{ ...label, opacity: 0.9 }}>{box.save.words}</span>}
          {box.save && (
            <button type="button" disabled={busy || !socket} onClick={() => ask('deathSave')} aria-describedby={box.save.lit ? `dying-due-${locationId}` : undefined}
              style={btn('var(--warning)', box.save.lit)}>DEATH SAVE</button>
          )}
          {box.save?.lit && <span id={`dying-due-${locationId}`} style={{ ...label, color: 'var(--warning)', opacity: 1 }}>THEIR TURN</span>}
          {box.turnButton && (
            <button type="button" disabled={busy || !socket} onClick={() => ask('dyingTurn')} title="Out of a fight: a turn of theirs has gone by. In one, the tracker counts them."
              style={{ ...btn('var(--green)'), borderStyle: 'dashed' }}>A TURN GOES BY</button>
          )}
        </span>
      )}
      <span style={{ fontSize: '0.6rem', opacity: 0.75, lineHeight: 1.4 }}>{box.note}</span>
      {refused && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.6rem', letterSpacing: '1px' }}>{refused.toUpperCase()}</span>}
    </section>
  );
}

/** The word on a token down, beside its conditions (TOKEN.EXE · HEALTH): everyone sees it, never the count. */
export function DownWord({ rule, dying }: { rule: Pick<DyingShown, 'word'> | null | undefined; dying: string | null | undefined }) {
  const down = downOf(dying);
  if (!down) return null;
  const color = tone[down.state];
  const word = downWord(rule, down);
  return (
    <span role="status" aria-label={`Down: ${word}`}
      style={{ alignSelf: 'flex-start', border: `1px solid ${color}`, color, padding: '2px 8px', fontSize: '10px', letterSpacing: '2px', fontWeight: 'bold' }}>
      ⚠ {word}
    </span>
  );
}
