import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { HINTS } from '../sheets/builderHelp';
import {
  MOST_LEVEL, MULTIPLIERS, advancesBy, anyTyped, canAddRange, firstAsTyped, isTyped, topAsTyped, levelNotes, levelTable, levelsSet, withAdvancement, withFilledAgain,
  withFirst, withRangeAdded, withRangeOff, withRangeTo, withRangeX, withTop, withTyped, xpWord,
} from '../sheets/levels';
import { FieldName } from './HelpHint';
import { WholeBox } from './WholeBox';

// The builder's LEVELS page (7d1; approved mockup docs/mockups/level-up.html, 2026-11-07): how a system's
// characters advance, the highest level, and the XP table, filled from what level 2 costs and a multiplier per
// range of levels, with any level typed over. What it reads and writes is sheets/levels.ts, and every change
// goes through the builder's `edit`. The meter (7d2), the window (7d3), health and increases come with their pieces.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** Where the XP word is changed. */
  onGoTo?: (page: BuilderPage) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const mini: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '0 6px', background: 'none', color: 'var(--green)', border: '1px solid var(--dark-green)', cursor: 'pointer' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
const segGroup: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' };
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 10px', cursor: 'pointer',
});
const note: React.CSSProperties = { ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 };

/** The width of a range's end, a box or not, so the multipliers line up. */
const RANGE_END = 48;

/** Where a range ends: written when it's left, so typing 12 doesn't pass through 1. */
function RangeEnd({ value, label, onChange }: { value: number; label: string; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => { if (/^\d+$/.test(text.trim())) onChange(Number(text)); else setText(String(value)); };
  return (
    <input type="text" inputMode="numeric" aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      style={{ fontFamily: 'monospace', fontSize: 12, padding: '3px 5px', width: RANGE_END, boxSizing: 'border-box', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', textAlign: 'center' }} />
  );
}

export function LevelsPage({ definition, edit, onGoTo }: Props) {
  const [asking, setAsking] = useState(false);
  const xp = advancesBy(definition, 'levels');
  const milestone = advancesBy(definition, 'milestone');
  const set = levelsSet(definition);
  const table = levelTable(definition);
  const word = xpWord(definition);
  const later = ['spend', 'use'].filter((id) => advancesBy(definition, id));
  return (
    <div data-testid="levels-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 400px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1000 }}>
      <section aria-label="How they advance" style={panel}>
        <div style={grid}>
          <FieldName beside hint={HINTS['levels.how']} style={small}>HOW THEY ADVANCE</FieldName>
          <span role="group" aria-label="How they advance" style={segGroup}>
            <button type="button" aria-pressed={xp} style={seg(xp)} onClick={() => edit(withAdvancement(definition, 'levels'))}>XP LEVELS</button>
            <button type="button" aria-pressed={milestone} style={seg(milestone)} onClick={() => edit(withAdvancement(definition, 'milestone'))}>MILESTONE</button>
          </span>
          <FieldName beside hint={HINTS['levels.top']} style={small}>HIGHEST LEVEL</FieldName>
          <WholeBox value={topAsTyped(definition)} label="Highest level" onChange={(top) => edit(withTop(definition, top))} />
          {xp && <>
            <FieldName beside hint={HINTS['levels.word']} style={small}>THE WORD</FieldName>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{word}</span>
              {onGoTo && <button type="button" className="utility-btn" style={btn} onClick={() => onGoTo('words')}>RENAME ON WORDS</button>}
            </span>
          </>}
        </div>
        {xp && milestone && <p style={why}>Both: the GM awards {word} and can also level up whoever they tick.</p>}
        {xp && !milestone && <p style={why}>The GM awards {word}, and the sheet counts toward the next level. What a level doesn&apos;t need carries into the next.</p>}
        {!xp && milestone && <p style={why}>No {word} is kept. The GM levels up whoever they tick.</p>}
        {!xp && !milestone && <p style={why}>Off: characters don&apos;t go up here. Levels stay what the GM or the player types.</p>}
        {later.length > 0 && <p role="note" style={{ ...why, fontSize: 11 }}>SETUP also picks {later.map((id) => (id === 'spend' ? 'SPEND XP' : 'IMPROVE BY USE')).join(' and ')}. {later.length === 1 ? 'That comes' : 'Those come'} later, as their own pieces.</p>}
      </section>
      {xp && (
        <section aria-label="The XP table" style={panel}>
          <div style={grid}>
            <FieldName beside hint={HINTS['levels.first']} style={small}>LEVEL 2 COSTS</FieldName>
            <WholeBox value={firstAsTyped(definition)} label="Level 2 costs" width={90} onChange={(first) => edit(withFirst(definition, first))} />
          </div>
          <FieldName hint={HINTS['levels.ranges']} style={small}>THEN EACH LEVEL COSTS THE LAST ONE&apos;S</FieldName>
          <ul aria-label="Ranges" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {set.ranges.map((r, i) => {
              const start = i ? set.ranges[i - 1].to + 1 : 1;
              const last = i === set.ranges.length - 1;
              const name = `Levels ${start} to ${r.to}`;
              return (
                <li key={i} aria-label={name} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 84 }}>LEVELS {start} TO</span>
                  {last
                    ? <span style={{ fontFamily: 'monospace', fontSize: 12, width: RANGE_END, textAlign: 'center' }}>{r.to}</span>
                    : <RangeEnd key={`${i}-${r.to}`} value={r.to} label={`${name} ends at`} onChange={(to) => edit(withRangeTo(definition, i, to))} />}
                  <span role="group" aria-label={`${name}, each level costs`} style={segGroup}>
                    {MULTIPLIERS.map((x) => <button key={x} type="button" aria-pressed={r.x === x} style={seg(r.x === x)} onClick={() => edit(withRangeX(definition, i, x))}>× {x}</button>)}
                  </span>
                  {set.ranges.length > 1 && <button type="button" style={mini} aria-label={`Take off ${name}`} onClick={() => edit(withRangeOff(definition, i))}>×</button>}
                </li>
              );
            })}
          </ul>
          <div><button type="button" className="utility-btn" style={btn} disabled={!canAddRange(definition)} onClick={() => edit(withRangeAdded(definition))}>+ ANOTHER RANGE</button></div>
          <FieldName hint={HINTS['levels.table']} style={small}>TOTAL {word} TO REACH EACH LEVEL. TYPE OVER ANY OF THEM.</FieldName>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 5 }}>
            {Object.entries(table).map(([level, total]) => (
              <label key={level} style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 10, letterSpacing: 1, opacity: 0.9 }}>
                <span>LEVEL {level}</span>
                <WholeBox value={total} width={84} label={`Level ${level} total`} style={isTyped(definition, Number(level)) ? { color: 'var(--cyan)', borderColor: 'var(--cyan)' } : undefined} onChange={(next) => edit(withTyped(definition, Number(level), next))} />
              </label>
            ))}
          </div>
          {levelNotes(definition).map((n) => <p key={n} role="note" style={note}>{n}</p>)}
          {anyTyped(definition) && !asking && <div><button type="button" className="utility-btn" style={btn} onClick={() => setAsking(true)}>FILL IT AGAIN</button></div>}
          {asking && (
            <div role="alertdialog" aria-label="Fill it again" style={{ border: '1px solid var(--warning)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={why}>Every level goes back to what the sums say. What you typed over is lost.</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="utility-btn" style={btn} onClick={() => { setAsking(false); edit(withFilledAgain(definition)); }}>FILL IT AGAIN</button>
                <button type="button" className="utility-btn" style={btn} onClick={() => setAsking(false)}>CANCEL</button>
              </div>
            </div>
          )}
          <p style={{ ...why, fontSize: 11, opacity: 0.7 }}>Up to level {MOST_LEVEL}.</p>
        </section>
      )}
    </div>
  );
}
