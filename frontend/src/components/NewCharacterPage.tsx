import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { creationOn, creationSteps, orderNotes, stepList, stepName, withCreationOn, withStepMoved, withStepOff } from '../sheets/newCharacter';
import { pickedOf } from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';

// The builder's NEW CHARACTER page (7c1; approved mockup docs/mockups/new-character.html, 2026-11-03):
// GUIDED NEW CHARACTER, off to start, and the steps in the GM's order, each on or off, with what it
// asks. What it reads and writes is sheets/newCharacter.ts; every change goes through the builder's
// `edit`. What each step can be set to comes with its piece (7c3, 7c4), and the player's window with 7c2.

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

/** What a step asks of a player, in the page's words. */
const asks = (definition: Definition, id: string): string => {
  if (id === 'who') return 'NAME, CONCEPT and DESCRIPTION, the sheet\'s own. A character needs a name, so this one is always asked.';
  if (id === 'stats') return 'Every stat, typed in by the player. Rolling, point buy and a fixed array come next.';
  if (id === 'kits') return 'Named kits of items the character starts with. They are made here next.';
  if (id === 'money') return 'What they start with in the bank. It is set here next: a number, a roll, or typed in.';
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
  return (
    <div data-testid="new-character-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 420px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1000 }}>
      <section aria-label="The flow" style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <FieldName hint={HINTS['creation.on']} style={small}>A NEW CHARACTER</FieldName>
          <ToggleSwitch label="GUIDED NEW CHARACTER" on={on} onChange={(next) => edit(withCreationOn(definition, next))} />
        </div>
        <p style={why}>{on
          ? 'A player opening a blank sheet is walked through these steps. Anyone with a sheet already is never asked.'
          : 'Off: a player gets a blank sheet, as always. These steps stay set for when it is on.'}</p>
        <p style={{ ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 }}>The window players get comes next: nothing changes at the table yet.</p>
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
      </section>
    </div>
  );
}
