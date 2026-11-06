import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { buyNumbers, buyPreset, buyWith, buyWithCost, climbingCosts, creationOn, creationSteps, groupLeftOut, orderNotes, parseNumbers, parseStatRoll, statsByGroup, stepGroup, stepList, stepName, stepWayProblems, wayOfStep, withCreationOn, withStatsByGroup, withStepMoved, withStepOff, withStepWay } from '../sheets/newCharacter';
import { isStatsStep } from '../sheets/newCharacterFlow';
import { statGroups } from '../sheets/statsRules';
import { pickedOf } from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
import { buyCost, type BuyWay, type StatWay } from '../sheets/newCharacterFlow';
import { KitsPanel } from './KitsPanel';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';

// The builder's NEW CHARACTER page (7c1; approved mockup docs/mockups/new-character.html, 2026-11-03):
// GUIDED NEW CHARACTER, off to start, and the steps in the GM's order, each on or off, with what it
// asks. What it reads and writes is sheets/newCharacter.ts; every change goes through the builder's
// `edit`. The stats are ONE WAY FOR ALL or GROUP BY GROUP, and a group can be left out (7c3a). What each
// step can be set to comes with its piece (7c3, 7c4); players get the steps in NEW_CHARACTER.EXE (7c2).

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** Where a list's step goes to be changed: its list on CHOICES. */
  onGoTo?: (page: BuilderPage, list?: string) => void;
  /** For a kit's requirement: the same box as a list's. */
  api?: Pick<ReturnType<typeof systemsApi>, 'previewFormulas'>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const mini: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '0 6px', background: 'none', color: 'var(--green)', border: '1px solid var(--dark-green)', cursor: 'pointer' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 8px', cursor: 'pointer',
});
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
/** How many of something, in words. */
const statCount = (n: number): string => `${n} ${n === 1 ? 'stat' : 'stats'}`;
/** How a stats step can be set, as the page offers it, with what each means (7c3b). */
const WAYS = [
  { id: 'typed', label: 'TYPED IN', why: 'They type what they have, as the sheet does.' },
  { id: 'roll', label: 'ROLL', why: 'The server rolls, the table sees it in the log, and what comes up is kept.' },
  { id: 'buy', label: 'POINT BUY', why: 'Points to spend, each number with its cost. Each stat starts at the lowest.' },
  { id: 'array', label: 'A FIXED ARRAY', why: 'The same numbers for everyone, placed as they like.' },
] as const;
/** A way as it starts when the GM picks it, keeping what it already has. */
const startWay = (id: StatWay['way'], now: StatWay): StatWay => {
  if (id === now.way) return now;
  if (id === 'array') return { way: 'array', numbers: [] };
  if (id === 'buy') return { way: 'buy', points: 20, lowest: 8, highest: 15, costs: climbingCosts(8, 15) };
  return id === 'roll' ? { way: 'roll', each: '4d6 drop lowest', placed: 'arrange' } : { way: 'typed' };
};
/** What a stats step's way does, for the line saying what the step asks. */
const howSet = (definition: Definition, id: string): string => {
  const way = wayOfStep(definition, id);
  if (way.way === 'array') return 'placed from a fixed array.';
  if (way.way === 'roll') return `rolled with ${way.each}, ${way.placed === 'arrange' ? 'then placed as they like' : 'in order'}.`;
  if (way.way === 'buy') return `bought with ${way.points} points, from ${way.lowest} to ${way.highest}.`;
  return 'typed in by the player.';
};

/** A whole number: kept as typed, written once it reads as one, and showing a change made from elsewhere. */
function WholeBox({ value, label, width = 64, onChange }: { value: number; label: string; width?: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(value));
  const read = /^-?\d+$/.test(text.trim()) ? Number(text) : null;
  return (
    <input type="text" inputMode="numeric" aria-label={label} value={read === null || read === value ? text : String(value)} aria-invalid={read === null ? true : undefined}
      style={{ fontFamily: 'monospace', fontSize: 12, padding: '3px 5px', width, background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', textAlign: 'center' }}
      onChange={(e) => { setText(e.target.value); if (/^-?\d+$/.test(e.target.value.trim())) onChange(Number(e.target.value)); }} />
  );
}

/** A point buy's points, range and costs, with the presets for those. */
function BuySettings({ way, onChange }: { way: BuyWay; onChange: (next: BuyWay) => void }) {
  const preset = buyPreset(way);
  return (
    <>
      <FieldName beside hint={HINTS['creation.points']} style={small}>POINTS</FieldName>
      <span style={{ justifySelf: 'start' }}><WholeBox label="Points" value={way.points} onChange={(points) => onChange(buyWith(way, { points }))} /></span>
      <FieldName beside hint={HINTS['creation.buyRange']} style={small}>FROM / TO</FieldName>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifySelf: 'start' }}>
        <WholeBox label="Lowest" value={way.lowest} onChange={(lowest) => onChange(buyWith(way, { lowest }))} />
        <WholeBox label="Highest" value={way.highest} onChange={(highest) => onChange(buyWith(way, { highest }))} />
      </span>
      <FieldName beside hint={HINTS['creation.costs']} style={small}>COSTS</FieldName>
      <span role="group" aria-label="Costs" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' }}>
        <button type="button" aria-pressed={preset === 'flat'} style={seg(preset === 'flat')} onClick={() => onChange({ way: 'buy', points: way.points, lowest: way.lowest, highest: way.highest })}>1 FOR 1</button>
        <button type="button" aria-pressed={preset === 'climbing'} style={seg(preset === 'climbing')} onClick={() => onChange({ ...way, costs: climbingCosts(way.lowest, way.highest) })}>CLIMBING</button>
      </span>
      <span />
      <span role="group" aria-label="Cost of each number" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {buyNumbers(way).map((n) => (
          <label key={n} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={small}>{n}</span>
            <WholeBox label={`Cost of ${n}`} width={40} value={buyCost(way, n)} onChange={(cost) => onChange(buyWithCost(way, n, cost))} />
          </label>
        ))}
      </span>
    </>
  );
}

/** The numbers of an array: kept as typed, written once they read as numbers. */
function NumbersBox({ numbers, onChange }: { numbers: number[]; onChange: (next: number[]) => void }) {
  const [text, setText] = useState(numbers.join(', '));
  const parsed = parseNumbers(text);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <input type="text" aria-label="The numbers" placeholder="15, 14, 13, 12" value={text} aria-invalid={parsed ? undefined : true}
        style={{ fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', minWidth: 0 }}
        onChange={(e) => { setText(e.target.value); const next = parseNumbers(e.target.value); if (next) onChange(next); }} />
      {!parsed && <span role="note" style={{ ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 }}>Whole numbers, with commas between them.</span>}
    </span>
  );
}

/** What a step asks of a player, in the page's words. */
const asks = (definition: Definition, id: string): string => {
  if (id === 'who') return 'NAME, CONCEPT and DESCRIPTION, the sheet\'s own. A character needs a name, so this one is always asked.';
  if (id === 'stats') {
    const out = statGroups(definition).filter((g) => g.stats.length && groupLeftOut(definition, g.id));
    const all = statGroups(definition).filter((g) => g.stats.length);
    if (out.length === all.length) return 'Every group is left out, so there is nothing to ask.';
    return `Every stat${out.length ? ` but ${out.map((g) => (g.label || g.id).toUpperCase()).join(', ')}` : ''}, ${howSet(definition, id)}`;
  }
  const group = stepGroup(definition, id);
  if (group) return `${statCount(group.stats.length)}, ${howSet(definition, id)}`;
  if (id === 'kits') return 'Named kits of items the character starts with, in their inventory once they finish. With none for players to get, this step isn\'t asked.';
  if (id === 'money') return 'What they start with in the bank. It is set here next, a number, a roll, or typed in: until then, players aren\'t asked.';
  const c = stepList(definition, id);
  if (!c) return '';
  return `From CHOICES: ${(c.many || c.id).toUpperCase()}. Its own settings there say how many and how they are picked.${pickedOf(c) === 'both' ? ' Those a feature opens are picked under that feature, at the level it unlocks.' : ''}`;
};

export function NewCharacterPage({ definition, edit, onGoTo, api }: Props) {
  const on = creationOn(definition);
  const steps = creationSteps(definition);
  const [picked, setPicked] = useState(steps[0].id);
  const step = steps.find((s) => s.id === picked) ?? steps[0];
  const list = stepList(definition, step.id);
  const notes = orderNotes(definition);
  const byGroup = statsByGroup(definition);
  const way = wayOfStep(definition, step.id);
  /** ONE WAY FOR ALL or GROUP BY GROUP, staying on the stats. */
  const askStats = (next: boolean) => {
    const after = withStatsByGroup(definition, next);
    setPicked(creationSteps(after).find((s) => isStatsStep(s.id))?.id ?? picked);
    edit(after);
  };
  return (
    <div data-testid="new-character-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 370px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1000 }}>
      <section aria-label="The flow" style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <FieldName hint={HINTS['creation.on']} style={small}>A NEW CHARACTER</FieldName>
          <ToggleSwitch label="GUIDED NEW CHARACTER" on={on} onChange={(next) => edit(withCreationOn(definition, next))} />
        </div>
        <p style={why}>{on
          ? 'A player opening a blank sheet is walked through these steps. Anyone with a sheet already is never asked.'
          : 'Off: a player gets a blank sheet, as always. These steps stay set for when it is on.'}</p>
        <FieldName hint={HINTS['creation.steps']} style={small}>THE STEPS, IN YOUR ORDER</FieldName>
        <ul aria-label="The steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {steps.map((s, i) => {
            const name = stepName(definition, s.id);
            return (
              <li key={s.id} aria-label={name} style={{
                display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)',
                background: s.id === step.id ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', boxShadow: s.id === step.id ? 'inset 3px 0 0 var(--green)' : 'none',
              }}>
                <button type="button" style={{ ...mini, opacity: i === 0 ? 0.3 : 1 }} aria-label={`${name} up`} disabled={i === 0} onClick={() => edit(withStepMoved(definition, s.id, -1))}>↑</button>
                <button type="button" style={{ ...mini, opacity: i === steps.length - 1 ? 0.3 : 1 }} aria-label={`${name} down`} disabled={i === steps.length - 1} onClick={() => edit(withStepMoved(definition, s.id, 1))}>↓</button>
                <button type="button" aria-current={s.id === step.id || undefined} onClick={() => setPicked(s.id)}
                  style={{ flex: 1, minWidth: 0, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, color: 'var(--green)', opacity: s.off ? 0.4 : 1, textDecoration: s.off ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </button>
                {s.id === 'who'
                  ? <span style={small}>ALWAYS</span>
                  : <ToggleSwitch on={!s.off} name={`${name} on`} onChange={(next) => edit(withStepOff(definition, s.id, !next))} />}
              </li>
            );
          })}
        </ul>
        {notes.map((n) => <p key={n} role="note" style={{ ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 }}>{n}</p>)}
      </section>
      <section aria-label={`${stepName(definition, step.id)} step`} style={panel}>
        <span style={small}>THE STEP · {stepName(definition, step.id)}</span>
        <p style={why}>{asks(definition, step.id)}</p>
        {step.off && <p style={{ ...why, color: 'var(--warning)', opacity: 1 }}>Off: players aren&apos;t asked.</p>}
        {list && onGoTo && <div><button type="button" className="utility-btn" style={btn} onClick={() => onGoTo('choices', list.id)}>GO TO CHOICES</button></div>}
        {step.id === 'kits' && <KitsPanel definition={definition} edit={edit} api={api} />}
        {isStatsStep(step.id) && (
          <div style={grid}>
            <FieldName beside hint={HINTS['creation.statsBy']} style={small}>ASKED</FieldName>
            <span role="group" aria-label="How the stats are asked" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' }}>
              <button type="button" aria-pressed={!byGroup} style={seg(!byGroup)} onClick={() => askStats(false)}>ONE WAY FOR ALL</button>
              <button type="button" aria-pressed={byGroup} style={seg(byGroup)} onClick={() => askStats(true)}>GROUP BY GROUP</button>
            </span>
            <span />
            <span style={{ ...why, fontSize: 11, opacity: 0.7 }}>{byGroup
              ? 'Each stats group is a step of its own in the list. Switch one off there to leave it out.'
              : 'One step for every stat. Leave a group out for numbers nobody sets at creation.'}</span>
            {!byGroup && <>
              <FieldName beside hint={HINTS['creation.statsGroups']} style={small}>GROUPS</FieldName>
              <ul aria-label="Groups asked" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {statGroups(definition).filter((g) => g.stats.length).map((g) => {
                  const label = (g.label || g.id).toUpperCase();
                  return (
                    <li key={g.id} aria-label={label} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, opacity: groupLeftOut(definition, g.id) ? 0.5 : 1 }}>{label} · {statCount(g.stats.length).toUpperCase()}</span>
                      <ToggleSwitch on={!groupLeftOut(definition, g.id)} name={`${label} asked`} onChange={(next) => edit(withStepOff(definition, `stats:${g.id}`, !next))} />
                    </li>
                  );
                })}
              </ul>
            </>}
            <FieldName beside hint={HINTS['creation.way']} style={small}>HOW THEY ARE SET</FieldName>
            <span role="group" aria-label="How they are set" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' }}>
              {WAYS.map((w) => (
                <button key={w.id} type="button" aria-pressed={way.way === w.id} title={w.why} style={seg(way.way === w.id)}
                  onClick={() => edit(withStepWay(definition, step.id, startWay(w.id, way)))}>{w.label}</button>
              ))}
            </span>
            <span />
            <span style={{ ...why, fontSize: 11, opacity: 0.7 }}>{WAYS.find((w) => w.id === way.way)?.why}</span>
            {way.way === 'roll' && <>
              <FieldName beside hint={HINTS['creation.each']} style={small}>EACH IS</FieldName>
              <input type="text" aria-label="Each is" value={way.each} maxLength={60} aria-invalid={parseStatRoll(way.each) ? undefined : true}
                style={{ fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', minWidth: 0 }}
                onChange={(e) => edit(withStepWay(definition, step.id, { ...way, each: e.target.value }))} />
              <FieldName beside hint={HINTS['creation.placed']} style={small}>PLACED</FieldName>
              <span role="group" aria-label="Placed" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' }}>
                <button type="button" aria-pressed={way.placed !== 'arrange'} style={seg(way.placed !== 'arrange')} onClick={() => edit(withStepWay(definition, step.id, { ...way, placed: 'order' }))}>IN ORDER</button>
                <button type="button" aria-pressed={way.placed === 'arrange'} style={seg(way.placed === 'arrange')} onClick={() => edit(withStepWay(definition, step.id, { ...way, placed: 'arrange' }))}>ARRANGE</button>
              </span>
            </>}
            {way.way === 'buy' && <BuySettings key={step.id} way={way} onChange={(next) => edit(withStepWay(definition, step.id, next))} />}
            {way.way === 'array' && <>
              <FieldName beside hint={HINTS['creation.numbers']} style={small}>THE NUMBERS</FieldName>
              <NumbersBox key={step.id} numbers={way.numbers} onChange={(numbers) => edit(withStepWay(definition, step.id, { way: 'array', numbers }))} />
            </>}
            {stepWayProblems(definition, step.id).map((p) => (
              <React.Fragment key={p}><span /><span role="note" style={{ ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 }}>{p}</span></React.Fragment>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
