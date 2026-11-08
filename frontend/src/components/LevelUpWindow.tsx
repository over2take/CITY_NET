import React, { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { TerminalWindow, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { usePlayerSheet } from '../hooks/usePlayerSheet';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { levelUpOffer, type LevelTarget } from '../sheets/xpMeter';
import { LEVEL_UP_STEP_NAMES, chosenTarget, levelUpSteps, levelUpTitle, unlockedBy } from '../sheets/levelUpFlow';

// LEVEL_UP.EXE (7d3a; approved mockup docs/mockups/level-up.html, 2026-11-07): the same kind of window as
// NEW_CHARACTER.EXE. WHICH CLASS when they hold several, then WHAT IT UNLOCKS at the new level. Nothing changes
// until FINISH. Closing it, or LEAVE FOR NOW, loses nothing: which class is kept on the sheet, which then says
// LEVELING UP · CONTINUE. What it shows is sheets/levelUpFlow.ts; going up is the server's (backend levelUp.js).

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  socket: Socket | null;
  userName: string;
  /** Closed before FINISH: their place is kept. */
  onLeave: () => void;
  /** Finished: it closes on their sheet. */
  onDone: () => void;
  raiseOn?: number;
}

const why: React.CSSProperties = { fontSize: '0.7rem', lineHeight: 1.45, opacity: 0.85, margin: 0 };
const page: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '10px' };
const head: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.8 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--dark-green)', color: 'var(--green)', cursor: 'pointer', whiteSpace: 'nowrap',
  fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '5px 12px', lineHeight: 'normal',
};
const card: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '3px' };

export function LevelUpWindow({ pos, setPos, socket, userName, onLeave, onDone, raiseOn }: Props) {
  const { sheet, template } = usePlayerSheet(socket, userName);
  const refused = useChoicesRefused(socket);
  const data = sheet?.data;
  const offer = levelUpOffer(template, data);
  const [step, setStep] = useState(0);
  // Which is going up, ahead of the server's answer so a click shows at once. Null: as the sheet says.
  const [picked, setPicked] = useState<LevelTarget | null>(null);
  const target = picked ?? (offer ? chosenTarget(offer) : null);
  const name = String((data?.name as string) || userName);
  const place = (t: LevelTarget) => socket?.emit('levelAction', { kind: 'place', ...(t.list ? { list: t.list, option: t.option } : {}) });

  // Opened, their place is kept from the start: closing it is leaving it.
  const kept = !!offer?.leveling;
  const ready = !!offer?.ready && !offer.firstPick && !!target;
  useEffect(() => { if (ready && !kept && target) place(target); }, [ready, kept]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = levelUpTitle(name, ready ? target : null);
  if (!offer || !ready || !target) {
    return (
      <TerminalWindow title={title} pos={pos} setPos={setPos} onClose={onLeave} panelMode="controls" raiseOn={raiseOn}
        folders={[{ id: 'none', label: 'LEVEL UP' }]} open="none" onOpen={() => {}} label="Leveling up"
        actions={[{ key: 'close', label: 'CLOSE', onClick: onLeave }]}>
        <span style={why}>{!sheet ? 'ACCESSING RECORD...' : offer?.firstPick ? `Pick a ${offer.firstPick} first, on your sheet.` : 'Nothing to level up right now.'}</span>
      </TerminalWindow>
    );
  }

  const steps = levelUpSteps(offer);
  const index = Math.min(step, steps.length - 1);
  const open = steps[index];
  const last = index === steps.length - 1;
  const folders: TerminalFolder[] = steps.map((id) => ({ id, label: LEVEL_UP_STEP_NAMES[id], name: LEVEL_UP_STEP_NAMES[id] }));
  const actions: TerminalAction[] = [
    { key: 'back', label: 'BACK', disabled: index === 0, onClick: () => setStep(index - 1) },
    { key: 'leave', label: 'LEAVE FOR NOW', onClick: onLeave },
    {
      key: 'next', label: last ? 'FINISH' : 'NEXT', tone: 'primary',
      onClick: () => {
        if (!last) return setStep(index + 1);
        socket?.emit('levelAction', { kind: 'up', ...(target.list ? { list: target.list, option: target.option } : {}) });
        return onDone();
      },
    },
  ];
  const unlocked = unlockedBy(template, data, target);

  return (
    <TerminalWindow raiseOn={raiseOn} title={title} pos={pos} setPos={setPos} onClose={onLeave} panelMode="controls"
      folders={folders} open={open} onOpen={(id) => setStep(steps.indexOf(id as typeof open))} actions={actions} label="Leveling up">
      <div style={page}>
        <div style={head}>{LEVEL_UP_STEP_NAMES[open]} · STEP {index + 1} OF {steps.length}</div>
        {open === 'which' && (
          <>
            <p style={why}>Which goes up? One level, from one pool.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="group" aria-label="Which class goes up">
              {offer.targets.map((t) => {
                const on = t.list === target.list && t.option === target.option;
                return (
                  <button key={t.option ?? 'level'} type="button" aria-pressed={on} onClick={() => { setPicked(t); place(t); }}
                    style={{ ...btn, ...(on ? { background: 'var(--green)', color: 'var(--black)', borderColor: 'var(--green)' } : {}) }}>
                    {t.name.toUpperCase()} {t.level} → {t.level + 1}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {open === 'unlocks' && (
          <>
            <p style={why}>{target.option ? `${target.name} ${target.level + 1}` : `Level ${target.level + 1}`}{unlocked.length ? ' brings:' : '. Nothing new comes with it.'}</p>
            {unlocked.map((u) => (
              <div key={`${u.from}-${u.id}`} style={card}>
                <span style={{ fontSize: '0.75rem' }}>{u.label.toUpperCase()} <span style={{ ...why, display: 'inline' }}>· {u.from}</span></span>
                {u.text && <span style={why}>{u.text}</span>}
                {u.opens && <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>Opens a pick of {u.opens}. Make it on your sheet once you finish.</span>}
              </div>
            ))}
          </>
        )}
        {refused && <p role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1 }}>{refused}</p>}
      </div>
    </TerminalWindow>
  );
}
