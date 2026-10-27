import React, { useState } from 'react';
import { SEEN_LEVELS, seenLine, exampleRoll, HIDES, type Seen } from '../sheets/targetSeen';

// HELP's WHO SEES THE TARGET (6c4h; approved mockup docs/mockups/players-see-target.html, 2026-10-24):
// one roll as a player's tray and the GM's show it, side by side, at the setting picked, and what each
// setting keeps from players. The user asked for the mockup's examples in the builder, "it explains
// what they mean so well". The words come from sheets/targetSeen.ts, which the tests hold to the server.

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const cell: React.CSSProperties = { textAlign: 'left', padding: '5px 10px 5px 0', borderBottom: '1px solid var(--dark-green)', verticalAlign: 'top' };
const choice = (on: boolean): React.CSSProperties => ({ background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 11, padding: '3px 9px', cursor: 'pointer' });

/** A tray: its board's two lines of 16, as the tray's character display draws them, and its history line. */
function Tray({ name, board, line }: { name: string; board: string[]; line: string }) {
  return (
    <section aria-label={name} style={{ border: '1px solid var(--green)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--green)', color: 'var(--black)', fontSize: 11, letterSpacing: 2, padding: '3px 8px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>DICE_TRAY.EXE</span><span>{name}</span>
      </div>
      <div style={{ padding: '12px 8px', display: 'flex', justifyContent: 'center', borderBottom: '1px solid var(--dark-green)', overflowX: 'auto' }}>
        <div role="img" aria-label={board.map((l) => l.trim()).filter(Boolean).join(' / ')}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1.05em)', gap: '3px 2px', padding: '6px 8px', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 16 }}>
          {board.join('').split('').map((c, i) => (
            <span key={i} style={{ textAlign: 'center', color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 7%, transparent)', textShadow: '0 0 4px var(--green)' }}>{c === ' ' ? '\u00a0' : c}</span>
          ))}
        </div>
      </div>
      <div style={{ ...small, padding: '6px 8px 0' }}>HISTORY</div>
      <p data-testid="tray-line" style={{ margin: 0, padding: '4px 8px 10px', fontSize: 12, lineHeight: 1.5 }}>{line}</p>
    </section>
  );
}

export function TargetSeenExample() {
  const [seen, setSeen] = useState<Seen>('gm');
  const [d20, setD20] = useState(11);
  const made = exampleRoll(seen, d20);
  // Another face, never the same one, so a click always shows a new roll (and a failure now and then).
  const again = () => setD20((n) => { let next = n; while (next === n) next = 1 + Math.floor(Math.random() * 20); return next; });
  return (
    <div data-testid="target-seen-example" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <div role="group" aria-label="Players see" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {SEEN_LEVELS.map((l) => <button key={l.id} type="button" aria-pressed={seen === l.id} onClick={() => setSeen(l.id)} style={choice(seen === l.id)}>{l.label}</button>)}
        </div>
        <button type="button" className="utility-btn" style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 10px' }} onClick={again}>ROLL AGAIN</button>
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{seenLine(seen)}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <Tray name="A PLAYER" board={made.player.board} line={made.player.line} />
        <Tray name="YOU, THE GM" board={made.gm.board} line={made.gm.line} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table aria-label="What each setting keeps from players" style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead><tr>
            <th scope="col" style={{ ...cell, ...small, fontWeight: 'normal' }}>PLAYERS SEE</th>
            {SEEN_LEVELS.map((l) => <th key={l.id} scope="col" style={{ ...cell, ...small, fontWeight: 'normal' }}>{l.label}</th>)}
          </tr></thead>
          <tbody>
            {HIDES.map((h) => (
              <tr key={h.what}>
                <td style={cell}>{h.what}</td>
                {SEEN_LEVELS.map((l) => <td key={l.id} style={{ ...cell, opacity: h.seen[l.id] ? 1 : 0.5 }}>{h.seen[l.id] ? 'yes' : '— hidden'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>You always see everything, with HIDDEN FROM PLAYERS on the line when something was kept back.</p>
    </div>
  );
}
