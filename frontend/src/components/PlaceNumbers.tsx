import React, { useState } from 'react';
import { placedFrom, type CreationShown } from '../sheets/newCharacterFlow';

// A pool of numbers placed on stats, in NEW_CHARACTER.EXE (7c3b; approved mockup new-character): pick a
// number, then the stat it goes on; a stat with a number takes it back when clicked with none held. A
// stat holding one takes the new one, its old one going back in the pool. Which number is where is on
// the sheet, worked out by placedFrom, and each move is asked of the server (backend creation.js).
// `fixed` shows what the stats hold with nothing to place: before a ROLL, and after one in order (7c3c).

interface Props {
  groups: CreationShown['stats'];
  numbers: number[];
  data: Record<string, unknown> | null | undefined;
  /** Each group's name over its stats, when there can be several. */
  named: boolean;
  fixed?: boolean;
  onPlace: (stat: string, value: number | null) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.8 };
const chip = (held: boolean): React.CSSProperties => ({
  minWidth: 36, padding: '4px 8px', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
  border: '1px solid var(--green)', background: held ? 'var(--green)' : 'none', color: held ? 'var(--black)' : 'var(--green)',
});

export function PlaceNumbers({ groups, numbers, data, named, fixed = false, onPlace }: Props) {
  // Which of those left is held, by its place among them: the same number can be there twice.
  const [held, setHeld] = useState<number | null>(null);
  const { placed, left } = placedFrom(numbers, groups.flatMap((g) => g.stats), data);
  const value = held === null ? undefined : left[held];
  const onStat = (stat: string) => {
    if (value !== undefined) onPlace(stat, value);
    else if (placed[stat] !== undefined) onPlace(stat, null);
    setHeld(null);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!fixed && <>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.85 }}>Pick a number, then the stat it goes on. Click a stat to take its number back.</p>
        <div role="group" aria-label="Numbers to place" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 30 }}>
          {left.map((n, i) => (
            <button key={i} type="button" aria-pressed={held === i} style={chip(held === i)} onClick={() => setHeld(held === i ? null : i)}>{n}</button>
          ))}
          {!left.length && <span style={small}>EVERY NUMBER IS PLACED</span>}
        </div>
      </>}
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {named && <span style={small}>{g.label.toUpperCase()}</span>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 6 }}>
            {g.stats.map((s) => (fixed ? (
              <div key={s.id} role="group" aria-label={`${s.label}: ${placed[s.id] ?? 'no number yet'}`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, minHeight: 52, border: '1px solid var(--green)' }}>
                <span style={small}>{s.label}</span>
                <span style={{ fontSize: 16 }}>{placed[s.id] ?? ''}</span>
              </div>
            ) : (
              <button key={s.id} type="button" aria-label={`${s.label}: ${placed[s.id] ?? 'no number yet'}`} onClick={() => onStat(s.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, minHeight: 52, fontFamily: 'inherit', background: 'none', color: 'var(--green)', border: `1px ${value !== undefined ? 'dashed' : 'solid'} var(--green)`, cursor: value !== undefined || placed[s.id] !== undefined ? 'pointer' : 'default' }}>
                <span style={small}>{s.label}</span>
                <span style={{ fontSize: 16 }}>{placed[s.id] ?? ''}</span>
              </button>
            )))}
          </div>
        </section>
      ))}
    </div>
  );
}
