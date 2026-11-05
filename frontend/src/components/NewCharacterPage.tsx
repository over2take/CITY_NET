import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { creationOn, creationSteps, groupLeftOut, orderNotes, parseNumbers, statsByGroup, stepGroup, stepList, stepName, stepWayProblems, wayOfStep, withCreationOn, withStatsByGroup, withStepMoved, withStepOff, withStepWay } from '../sheets/newCharacter';
import { isStatsStep } from '../sheets/newCharacterFlow';
import { statGroups } from '../sheets/statsRules';
import { pickedOf } from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
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
  { id: 'typed', label: 'TYPED IN', why: 'They type what they have, as the sheet does. Rolling and point buy come next.' },
  { id: 'array', label: 'A FIXED ARRAY', why: 'The same numbers for everyone, placed as they like.' },
] as const;
/** What a stats step's way does, for the line saying what the step asks. */
const howSet = (definition: Definition, id: string): string => (wayOfStep(definition, id).way === 'array'
  ? 'placed from a fixed array.' : 'typed in by the player. Rolling and point buy come next.');

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
  if (id === 'kits') return 'Named kits of items the character starts with. They are made here next: until then, players aren\'t asked.';
  if (id === 'money') return 'What they start with in the bank. It is set here next, a number, a roll, or typed in: until then, players aren\'t asked.';
  const c = stepList(definition, id);
  if (!c) return '';
  return `From CHOICES: ${(c.many || c.id).toUpperCase()}. Its own settings there say how many and how they are picked.${pickedOf(c) === 'both' ? ' Those a feature opens are picked under that feature, at the level it unlocks.' : ''}`;
};

export function NewCharacterPage({ definition, edit, onGoTo }: Props) {
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
                  onClick={() => edit(withStepWay(definition, step.id, w.id === 'array' ? { way: 'array', numbers: way.way === 'array' ? way.numbers : [] } : { way: 'typed' }))}>{w.label}</button>
              ))}
            </span>
            <span />
            <span style={{ ...why, fontSize: 11, opacity: 0.7 }}>{WAYS.find((w) => w.id === way.way)?.why}</span>
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
