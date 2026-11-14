import React, { useState } from 'react';
import { restSection, type ChoicesAction, type RestingShown } from '../sheets/choicesShown';
import { RecoveryDice } from './RecoveryDice';

// A character sheet's RESTS section (R3b; approved mockup docs/mockups/rest-on-sheet.html, and the
// user's calls of 2026-10-30 and -31): a button for each of the game's rests, where rests are
// finished on each sheet (the GM's always), each asking first ("so no miss clicks happen"). A rest
// with recovery dice to spend opens its panel: the dice, then FINISH, which asks too; one with none
// applies once asked. A rest the GM called on this sheet opens its panel by itself, until finished.
// The dice spent any time (or where rests are at the GM's call) show here always. The server does
// the rest (backend sheets/rests.js takeRest), and the sheet saved again closes the panel.

interface Props {
  resting?: RestingShown;
  data: Record<string, unknown>;
  readOnly: boolean;
  gm?: boolean;
  /** Ticks the dice (the picks' own socket action). */
  onChoices?: (action: ChoicesAction) => void;
  onRecoverySpend?: (pool: string, count: number) => void;
  recoveryOpen?: boolean;
  /** Takes one of the game's rests on this character. Absent: no rest buttons. */
  onRestTake?: (rest: string) => void;
  /** Why the server last said no, to show under the section. */
  refused?: string | null;
}

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.7 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '2px 8px',
};
const go: React.CSSProperties = { ...btn, borderColor: 'var(--cyan)', color: 'var(--cyan)' };
const ask: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.62rem' };

export function RestSection({ resting, data, readOnly, gm = false, onChoices, onRecoverySpend, recoveryOpen = false, onRestTake, refused }: Props) {
  const view = restSection(resting, data, gm);
  const can = !readOnly && !!onRestTake;
  const [asking, setAsking] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const rests = resting?.rests ?? [];
  // The rest open here: the one the GM called, else the one this viewer opened.
  const open = view.call ?? rests.find((r) => r.id === opened) ?? null;
  const spendsIn = (r: { spends: boolean }) => r.spends && !!view.recovery && !view.diceAlways;
  const dice = (key: string) => view.recovery && (
    <RecoveryDice key={key} recovery={view.recovery} can={!readOnly && !!onChoices} gm={gm} open={recoveryOpen} ask={(a) => onChoices?.(a)} onSpend={onRecoverySpend} />
  );
  const take = (id: string) => { onRestTake?.(id); setOpened(null); setFinishing(false); };
  const asked = rests.find((r) => r.id === asking);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {view.diceAlways && dice('always')}
      {can && view.buttons.length > 0 && !open && (
        <div role="group" aria-label="Rests" style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
          {view.buttons.map((r) => <button key={r.id} type="button" style={btn} onClick={() => setAsking(r.id)}>{r.name.toUpperCase()}</button>)}
        </div>
      )}
      {asked && !open && (
        <div role="group" aria-label={`Take a ${asked.name}?`} style={ask}>
          <span style={{ color: 'var(--warning)' }}>TAKE A {asked.name.toUpperCase()}?</span>
          <span style={small}>{spendsIn(asked) ? `It opens: spend ${view.recovery!.name} first, then FINISH.` : 'It applies now: what it refills, and what it gives back.'}</span>
          <button type="button" style={go} onClick={() => { setAsking(null); if (spendsIn(asked)) setOpened(asked.id); else take(asked.id); }}>REST</button>
          <button type="button" style={btn} onClick={() => setAsking(null)}>CANCEL</button>
        </div>
      )}
      {open && (
        <section aria-label={`${open.name} panel`} style={{ border: '1px solid var(--cyan)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <b style={{ fontSize: '0.7rem', letterSpacing: '1px' }}>{open.name.toUpperCase()}</b>
            {view.call && <span style={small}>CALLED BY THE GM</span>}
          </div>
          {spendsIn(open) && dice('panel')}
          {can && (finishing ? (
            <div role="group" aria-label={`Finish the ${open.name}?`} style={ask}>
              <span style={{ color: 'var(--warning)' }}>FINISH THE {open.name.toUpperCase()}?</span>
              <span style={small}>It applies now: what it refills, and what it gives back.</span>
              <button type="button" style={go} onClick={() => take(open.id)}>FINISH</button>
              <button type="button" style={btn} onClick={() => setFinishing(false)}>NOT YET</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <button type="button" style={go} onClick={() => setFinishing(true)}>FINISH {open.name.toUpperCase()}</button>
              {!view.call && <button type="button" style={btn} onClick={() => setOpened(null)}>CANCEL</button>}
            </div>
          ))}
          {!can && <span style={small}>Waiting for this character to finish it.</span>}
        </section>
      )}
      {!open && !view.buttons.length && <span style={small}>Rests are taken when the GM calls them.</span>}
      {refused && <div role="alert" style={{ fontSize: '0.62rem', color: 'var(--warning)' }}>{refused}</div>}
    </div>
  );
}
