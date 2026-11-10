import React, { useState } from 'react';
import type { SheetTemplate } from '../sheets/types';
import { levelRecord, levelTools, recordHead, type RecordIncrease, type RecordLevel } from '../sheets/levelRecord';
import { canRaise, pointsLeft, statNow, withRaised, type Unlocked } from '../sheets/levelUpFlow';
import type { LevelUpIncreases } from '../sheets/xpMeter';

// WHAT EACH LEVEL GAINED (7d7b2; approved mockup docs/mockups/level-record.html, 2026-11-09): on CHARACTER, under
// the class picks, folded shut to start. Each level's health and how it was kept, and each INCREASE unlocked. The
// player rolls a level the GM cleared (ROLL D10) and spends an increase left open, with − and + as LEVEL_UP.EXE.
// The GM, on a player's sheet, has CLEAR THE ROLL on a past roll, SET TO on any level with a die, CLEAR on one set
// (back to the average, level 1 to the full die) and CLEAR on an increase spent, each on a line of its own. What it
// says is sheets/levelRecord.ts; every change is the server's (backend levelUp.js), asked with a levelAction.

interface Props {
  template: SheetTemplate;
  data: Record<string, unknown>;
  /** The viewer is the GM: the tools to put it right. */
  gm?: boolean;
  /** Asks the server (a levelAction). Absent: the record is only read. */
  onLevel?: (action: Record<string, unknown>) => void;
}

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.7 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '1px 7px', whiteSpace: 'nowrap',
};
const hot: React.CSSProperties = { ...btn, borderColor: 'var(--warning)', color: 'var(--warning)' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr)', gap: '3px 8px', padding: '4px 7px', borderTop: '1px solid var(--dark-green)', fontSize: '0.68rem' };
const line: React.CSSProperties = { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', minWidth: 0 };
// The GM's tools: a line of their own under what the level says.
const tools: React.CSSProperties = { ...line, gridColumn: 2, paddingLeft: '7px', borderLeft: '2px solid var(--dark-green)' };
const field: React.CSSProperties = { background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'inherit', fontSize: '0.65rem', padding: '1px 4px', width: 46 };
const statBox: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '3px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: 60 };

function Level({ l, gm, ask }: { l: RecordLevel; gm: boolean; ask?: (action: Record<string, unknown>) => void }) {
  const [to, setTo] = useState('');
  const can = levelTools(l, gm);
  const set = () => {
    const took = Number(to);
    if (to.trim() === '' || !Number.isFinite(took)) return;
    ask?.({ kind: 'setLevel', level: l.level, took: Math.trunc(took) });
    setTo('');
  };
  return (
    <div role="group" aria-label={`Level ${l.level}`} style={row}>
      <span style={{ ...small, fontSize: '0.65rem', fontVariantNumeric: 'tabular-nums' }}>L{l.level}</span>
      <span style={line}>
        {l.kept === 'cleared' && !gm && ask && can.roll
          ? <><button type="button" style={hot} onClick={() => ask({ kind: 'rollLevel', level: l.level })}>ROLL D{l.die}</button><span style={small}>YOUR GM CLEARED IT FOR ANOTHER GO · {l.words}</span></>
          : <>
            <span style={{ color: 'var(--cyan)' }}>HEALTH +{l.gained}</span>
            <span style={small}>{l.words}</span>
            {l.kept === 'cleared' && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>{gm ? 'TO ROLL AGAIN: THE PLAYER ROLLS IT ON THEIR SHEET' : 'TO ROLL AGAIN'}</span>}
          </>}
      </span>
      {ask && can.clear && (
        <span style={tools}>
          <button type="button" style={btn} aria-label={`Clear level ${l.level}'s roll`} onClick={() => ask({ kind: 'clearLevel', level: l.level })}>CLEAR THE ROLL</button>
          <span style={small}>THE PLAYER ROLLS IT AGAIN</span>
        </span>
      )}
      {ask && can.back && (
        <span style={tools}>
          <button type="button" style={btn} aria-label={`Level ${l.level} back to ${l.level === 1 ? 'the full die' : 'the average'}`} onClick={() => ask({ kind: 'setLevel', level: l.level, took: null })}>CLEAR</button>
          <span style={small}>BACK TO {l.level === 1 ? 'THE FULL DIE' : 'THE AVERAGE'}</span>
        </span>
      )}
      {ask && can.set && (
        <span style={tools}>
          <span style={small}>SET TO</span>
          <input type="number" min={1} max={l.die ?? undefined} value={to} style={field} aria-label={`Level ${l.level}: set the die's part to`}
            onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set(); }} />
          <button type="button" style={btn} aria-label={`Set level ${l.level}`} disabled={to.trim() === ''} onClick={set}>OK</button>
          <span style={small}>THE DIE&apos;S PART, 1 TO {l.die}</span>
        </span>
      )}
    </div>
  );
}

function Increase({ inc, gm, data, ask }: { inc: RecordIncrease; gm: boolean; data: Record<string, unknown>; ask?: (action: Record<string, unknown>) => void }) {
  const [spreads, setSpreads] = useState<LevelUpIncreases>({});
  const u: Unlocked = { id: inc.feature, label: inc.label, from: inc.from, increase: inc.increase };
  const spread = spreads[inc.feature] ?? {};
  const left = pointsLeft(u, spread);
  return (
    <div role="group" aria-label={inc.label} style={row}>
      <span />
      <span style={line}>
        <span style={{ color: inc.kept === 'open' ? 'var(--warning)' : 'var(--cyan)' }}>
          {inc.kept === 'instead' ? inc.words : `INCREASE ${inc.kept === 'spent' ? inc.words : `· ${inc.words}`}`}
        </span>
        <span style={small}>{inc.label.toUpperCase()} · {inc.from.toUpperCase()}</span>
      </span>
      {ask && gm && inc.kept === 'spent' && (
        <span style={tools}>
          <button type="button" style={btn} aria-label={`Clear ${inc.label}`} onClick={() => ask({ kind: 'clearIncrease', feature: inc.feature })}>CLEAR</button>
          <span style={small}>THE PLAYER SPENDS THE POINTS AGAIN</span>
        </span>
      )}
      {ask && inc.kept === 'open' && (
        <span style={{ ...line, gridColumn: 2 }}>
          {inc.increase.stats.map((s) => {
            const on = spread[s.id] ?? 0;
            return (
              <span key={s.id} style={statBox}>
                <span style={{ fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.8 }}>{s.label.toUpperCase()}</span>
                <b aria-label={`${s.label} with the points`} style={{ fontSize: '0.8rem', color: on ? 'var(--cyan)' : 'var(--green)' }}>{statNow(data, s.id) + on}</b>
                <span style={{ display: 'flex', gap: '3px' }}>
                  <button type="button" style={btn} aria-label={`Less ${s.label}`} disabled={!on} onClick={() => setSpreads(withRaised(spreads, inc.feature, s.id, -1))}>−</button>
                  <button type="button" style={btn} aria-label={`More ${s.label}`} disabled={!canRaise(data, u, spread, s.id)} onClick={() => setSpreads(withRaised(spreads, inc.feature, s.id, 1))}>+</button>
                </span>
              </span>
            );
          })}
          <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ ...small, color: left ? 'var(--cyan)' : 'var(--green)', opacity: 1 }}>
              {left} {left === 1 ? 'POINT' : 'POINTS'} LEFT{inc.increase.points > 1 ? ` · AT MOST ${inc.increase.most} ON ONE` : ''}{inc.increase.cap !== undefined ? ` · STOPS AT ${inc.increase.cap}` : ''}
            </span>
            <span><button type="button" style={btn} disabled={left !== 0} onClick={() => ask({ kind: 'spendIncrease', feature: inc.feature, spread })}>SPEND</button></span>
          </span>
        </span>
      )}
    </div>
  );
}

export function LevelRecord({ template, data, gm = false, onLevel }: Props) {
  const [open, setOpen] = useState(false);
  const record = levelRecord(template, data);
  if (!record) return null;
  return (
    <section aria-label="What each level gained" style={{ border: '1px solid var(--green)', display: 'flex', flexDirection: 'column', marginTop: '10px', textAlign: 'left', lineHeight: 1.4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', padding: '3px 7px' }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '2px', padding: 0, textAlign: 'left' }}>
          <span aria-hidden>{open ? '▾' : '▸'} </span>{recordHead(record)} · WHAT EACH GAINED
        </button>
      </div>
      {open && <>
        {record.health?.levels.map((l) => <Level key={l.level} l={l} gm={gm} ask={onLevel} />)}
        {record.increases.map((inc) => <Increase key={inc.feature} inc={inc} gm={gm} data={data} ask={onLevel} />)}
        {record.health && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '4px 7px', borderTop: '1px solid var(--green)', fontSize: '0.68rem' }}>
            <span style={small}>The token&apos;s maximum follows. A stat changing recounts what each level adds.</span>
            <span aria-label="Max health">{record.health.max}</span>
          </div>
        )}
      </>}
    </section>
  );
}
