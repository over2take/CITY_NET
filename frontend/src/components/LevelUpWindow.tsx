import React, { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { TerminalWindow, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { usePlayerSheet } from '../hooks/usePlayerSheet';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { levelUpOffer, type LevelTarget, type LevelUpIncreases, type LevelUpPick } from '../sheets/xpMeter';
import {
  LEVEL_UP_STEP_NAMES, canRaise, chosenTarget, healthGain, healthRolledFor, increasesSpent, insteadAsked, insteadTaken, levelUpSteps, levelUpTitle, newClasses, picksAsked, picksMade, picksWanted,
  pointsLeft, statNow, unlockedBy, withPickToggled, withRaised, withoutSpread,
} from '../sheets/levelUpFlow';

// LEVEL_UP.EXE (7d3a; approved mockup docs/mockups/level-up.html, 2026-11-07): the same kind of window as
// NEW_CHARACTER.EXE. WHICH CLASS when there's a choice, a class not held yet among them (7d3b), then WHAT IT
// UNLOCKS at the new level, with the picks it opens made right there, FINISH waiting for them. Nothing changes
// until FINISH. Closing it, or LEAVE FOR NOW, loses nothing: which class is kept on the sheet, which then says
// LEVELING UP · CONTINUE. What it shows is sheets/levelUpFlow.ts; going up is the server's (backend levelUp.js).
// ABILITY INCREASE (7d6b): each INCREASE the new level unlocks, its points spread with − and +, FINISH waiting for all;
// or (7d6c) OR A FEAT INSTEAD, a pick from the list it offers, and USE THE POINTS INSTEAD back again.

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
const statBox: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '5px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: 72 };
const mini: React.CSSProperties = { ...btn, padding: '1px 8px', fontSize: '0.75rem' };

export function LevelUpWindow({ pos, setPos, socket, userName, onLeave, onDone, raiseOn }: Props) {
  const { sheet, template } = usePlayerSheet(socket, userName);
  const refused = useChoicesRefused(socket);
  const data = sheet?.data;
  const offer = levelUpOffer(template, data);
  const [step, setStep] = useState(0);
  const joinable = offer ? newClasses(template, data, offer) : [];
  // Which is going up, and the picks made, ahead of the server's answer so a click shows at once. Null: as the sheet says.
  const [picked, setPicked] = useState<LevelTarget | null>(null);
  const [made, setMade] = useState<LevelUpPick[] | null>(null);
  const [raised, setRaised] = useState<LevelUpIncreases | null>(null);
  // Which increases are being taken as a pick instead (7d6c), ahead of one being picked.
  const [insteadOn, setInsteadOn] = useState<Record<string, boolean>>({});
  const target = picked ?? (offer ? chosenTarget(offer, joinable) : null);
  const picks = made ?? offer?.leveling?.picks ?? [];
  const spreads = raised ?? offer?.leveling?.increases ?? {};
  const name = String((data?.name as string) || userName);
  const place = (t: LevelTarget, p: LevelUpPick[] = [], inc: LevelUpIncreases = {}) => socket?.emit('levelAction', {
    kind: 'place', ...(t.list ? { list: t.list, option: t.option } : {}), ...(p.length ? { picks: p } : {}), ...(Object.keys(inc).length ? { increases: inc } : {}),
  });

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

  const gain = healthGain(template, data, target);
  const unlocked = unlockedBy(template, data, target);
  const raising = unlocked.filter((u) => u.increase);
  const steps = levelUpSteps(offer, joinable.length, !!gain, raising.length > 0);
  const asked = picksAsked(template, data, unlocked);
  const allMade = picksMade(asked, picks);
  const allSpent = increasesSpent(unlocked, spreads, picks);
  // ROLL or THE PLAYER CHOOSES (7d5b): settled once rolled, or the average taken.
  const healthSettled = !gain || gain.gained !== null;
  const index = Math.min(step, steps.length - 1);
  const open = steps[index];
  const last = index === steps.length - 1;
  const folders: TerminalFolder[] = steps.map((id) => ({ id, label: LEVEL_UP_STEP_NAMES[id], name: LEVEL_UP_STEP_NAMES[id] }));
  const actions: TerminalAction[] = [
    { key: 'back', label: 'BACK', disabled: index === 0, onClick: () => setStep(index - 1) },
    { key: 'leave', label: 'LEAVE FOR NOW', onClick: onLeave },
    {
      key: 'next', label: last ? 'FINISH' : 'NEXT', tone: 'primary', disabled: (last && (!allMade || !allSpent)) || ((last || open === 'health') && !healthSettled),
      title: (last || open === 'health') && !healthSettled ? (gain?.by === 'choose' ? 'Take the average or roll first' : 'Roll for health first')
        : last && !allMade ? 'Make the picks first' : last && !allSpent ? 'Spend the points first' : undefined,
      onClick: () => {
        if (!last) return setStep(index + 1);
        socket?.emit('levelAction', { kind: 'up', ...(target.list ? { list: target.list, option: target.option } : {}), ...(picks.length ? { picks } : {}), ...(Object.keys(spreads).length ? { increases: spreads } : {}) });
        return onDone();
      },
    },
  ];
  const choose = (t: LevelTarget) => { setPicked(t); setMade([]); setRaised({}); place(t); };
  const health = (kind: 'healthRoll' | 'healthAverage') => socket?.emit('levelAction', { kind, ...(target.list ? { list: target.list, option: target.option } : {}) });
  const lockedTo = healthRolledFor(offer, [...offer.targets, ...joinable], target) ?? (gain?.rolled !== null && gain?.rolled !== undefined ? target.name : null);
  const toggle = (a: (typeof asked)[number], option: string) => { const next = withPickToggled(picks, a, option); setMade(next); place(target, next, spreads); };
  const raise = (feature: string, stat: string, by: 1 | -1) => { const next = withRaised(spreads, feature, stat, by); setRaised(next); place(target, picks, next); };
  // The points or a pick in their place (7d6c): switching drops what the other way had.
  const takeInstead = (u: (typeof unlocked)[number], on: boolean) => {
    setInsteadOn({ ...insteadOn, [u.id]: on });
    const nextSpreads = on ? withoutSpread(spreads, u.id) : spreads;
    const nextPicks = on ? picks : picks.filter((p) => !(p.from === u.id && p.list === u.increase?.instead));
    setRaised(nextSpreads);
    setMade(nextPicks);
    place(target, nextPicks, nextSpreads);
  };
  const pickInstead = (a: NonNullable<ReturnType<typeof insteadAsked>>, option: string) => { const next = withPickToggled(picks, a, option); setMade(next); place(target, next, spreads); };

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
                  <button key={t.option ?? 'level'} type="button" aria-pressed={on} disabled={!!lockedTo && !on} onClick={() => choose(t)}
                    style={{ ...btn, ...(on ? { background: 'var(--green)', color: 'var(--black)', borderColor: 'var(--green)' } : {}) }}>
                    {t.name.toUpperCase()} {t.level} → {t.level + 1}
                  </button>
                );
              })}
            </div>
            {lockedTo && <p style={{ ...why, color: 'var(--warning)', opacity: 1 }}>Health was rolled for {lockedTo.toUpperCase()}, and kept: your GM can clear it to change class.</p>}
            {joinable.length > 0 && (
              <>
                <p style={why}>Or take up one they don&apos;t have, at level 1:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="group" aria-label="Or a new class">
                  {joinable.map((t) => {
                    const on = t.list === target.list && t.option === target.option;
                    return (
                      <span key={`${t.list}-${t.option}`} style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
                        <button type="button" aria-pressed={on} disabled={!!t.unmet || (!!lockedTo && !on)} onClick={() => choose(t)}
                          style={{ ...btn, ...(on ? { background: 'var(--green)', color: 'var(--black)', borderColor: 'var(--green)' } : {}), ...(t.unmet ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}>
                          NEW: {t.name.toUpperCase()} 1
                        </button>
                        {t.unmet && <span style={{ ...why, fontSize: '0.6rem' }}>NEEDS {t.unmet.toUpperCase()}</span>}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        {open === 'health' && gain && (
          <>
            <span style={{ fontSize: '0.75rem' }}>HEALTH · {gain.by === 'beat' && gain.beat?.way === 'pool' ? `ROLL ${gain.beat.count}D${gain.beat.die} TO BEAT ${gain.max}`
              : gain.by === 'beat' && gain.die ? `EVERY LEVEL: ${gain.dice} DICE${gain.adds ? ` ${gain.adds > 0 ? '+' : '−'} ${Math.abs(gain.adds * gain.dice)}` : ''} TO BEAT ${gain.max}`
              : gain.by === 'reroll' && gain.die ? `EVERY LEVEL: ${gain.dice} DICE${gain.adds ? ` ${gain.adds > 0 ? '+' : '−'} ${Math.abs(gain.adds * gain.dice)}` : ''}` : <>{gain.die ? `d${gain.die}` : 'NO DIE'}{gain.adds ? ` ${gain.adds > 0 ? '+' : '−'} ${Math.abs(gain.adds)}` : ''}</>}</span>
            {gain.by === 'reroll' && gain.gained !== null && gain.rolled !== null && (
              <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>
                +{gain.gained}: ROLLED {gain.rolled}, {gain.over ? `OVER ${gain.max}: THE NEW MAXIMUM` : `NOT OVER ${gain.max}: +1`}
              </span>
            )}
            {gain.by === 'beat' && gain.gained !== null && gain.rolled !== null && (
              <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>
                +{gain.gained}: ROLLED {gain.rolled}, {gain.over ? `OVER ${gain.max}: GAINED ${gain.gained}` : `NOT OVER ${gain.max}: NOTHING GAINED`}
              </span>
            )}
            {gain.gained !== null && !((gain.by === 'reroll' || gain.by === 'beat') && gain.rolled !== null) && (
              <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>
                +{gain.gained}: {gain.rolled !== null ? `ROLLED ${gain.rolled}` : `${gain.average} AVERAGE`}{gain.adds ? `, ${gain.adds > 0 ? '+' : '−'}${Math.abs(gain.adds)} EACH LEVEL` : ''}{(gain.rolled ?? gain.average) + gain.adds < 1 ? ', AT LEAST 1' : ''}
              </span>
            )}
            {gain.gained === null && (gain.die || gain.beat?.way === 'pool') && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="group" aria-label="Health this level">
                {gain.by === 'choose' && <button type="button" style={btn} onClick={() => health('healthAverage')}>TAKE {gain.average}{gain.adds ? ` ${gain.adds > 0 ? '+' : '−'} ${Math.abs(gain.adds)}` : ''}</button>}
                <button type="button" style={{ ...btn, borderColor: 'var(--warning)', color: 'var(--warning)' }} onClick={() => health('healthRoll')}>{gain.by === 'reroll' ? 'ROLL THEM ALL' : gain.by === 'beat' ? 'ROLL TO BEAT' : `ROLL D${gain.die}`}</button>
              </div>
            )}
            {gain.tookAverage && gain.die && (
              <div style={{ display: 'flex', gap: '6px' }}><button type="button" style={btn} onClick={() => health('healthRoll')}>ROLL D{gain.die} INSTEAD</button></div>
            )}
            <p style={why}>{gain.by === 'beat' && gain.rolled === null ? (gain.beat?.way === 'pool' ? `Beat ${gain.max} and gain a d${gain.beat.gain}. Otherwise nothing.` : `Beat ${gain.max} and gain the new level's die again, and what each level adds. Otherwise nothing.`)
              : !gain.die && gain.beat?.way !== 'pool' ? `${target.name} has no HIT DIE, so only what each level adds.`
              : gain.rolled !== null ? 'Rolled, and kept. Your GM can clear it for another go.'
                : gain.by === 'reroll' ? `Every level rolled again. Over ${gain.max} and it becomes your new maximum. Otherwise you gain 1.`
                : gain.by === 'average' ? 'Fixed in this game. Nothing to roll.'
                  : gain.by === 'choose' ? (gain.tookAverage ? 'The average, taken. You can still roll instead, and keep what comes up.' : 'Take the average, or roll and keep what comes up.')
                    : 'Thrown in the tray, for the table to see. Kept once it\'s rolled.'}</p>
          </>
        )}
        {open === 'unlocks' && (
          <>
            <p style={why}>{target.option ? `${target.name} ${target.level + 1}` : `Level ${target.level + 1}`}{unlocked.length ? ' brings:' : '. Nothing new comes with it.'}</p>
            {unlocked.map((u) => {
              const a = asked.find((x) => x.feature === u.id);
              const wanted = a ? picksWanted(a) : 0;
              return (
                <div key={`${u.from}-${u.id}`} style={card}>
                  <span style={{ fontSize: '0.75rem' }}>{u.label.toUpperCase()} <span style={{ ...why, display: 'inline' }}>· {u.from}</span></span>
                  {u.text && <span style={why}>{u.text}</span>}
                  {a && a.rolled && <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>The {a.list.many} are rolled for: ROLL FOR IT on your sheet once you finish.</span>}
                  {a && !a.rolled && wanted === 0 && <span style={why}>Nothing left to pick from the {a.list.many}.</span>}
                  {a && !a.rolled && wanted > 0 && (
                    <>
                      <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>{wanted === 1 ? `Pick a ${a.list.one}.` : `Pick ${wanted} ${a.list.many}.`}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="group" aria-label={`Pick a ${a.list.one}`}>
                        {a.options.map(({ option, unmet }) => {
                          const on = picks.some((p) => p.from === a.feature && p.list === a.list.id && p.option === option.id);
                          return (
                            <span key={option.id} style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
                              <button type="button" aria-pressed={on} disabled={!!unmet && !on} onClick={() => toggle(a, option.id)}
                                style={{ ...btn, ...(on ? { background: 'var(--green)', color: 'var(--black)', borderColor: 'var(--green)' } : {}), ...(unmet && !on ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}>
                                {option.label.toUpperCase()}
                              </button>
                              {unmet && <span style={{ ...why, fontSize: '0.6rem' }}>NEEDS {unmet.toUpperCase()}</span>}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {u.opens && !a && <span style={why}>Opens the {u.opens}: picked on its own, on your sheet.</span>}
                  {u.increase && <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>{u.increase.points} {u.increase.points === 1 ? 'point' : 'points'} to spend{insteadAsked(template, data, u) ? `, or a ${insteadAsked(template, data, u)!.list.one}` : ''}, in {LEVEL_UP_STEP_NAMES.increase}.</span>}
                </div>
              );
            })}
          </>
        )}
        {open === 'increase' && raising.map((u) => {
          const inc = u.increase!;
          const spread = spreads[u.id] ?? {};
          const left = pointsLeft(u, spread);
          const other = insteadAsked(template, data, u);
          const featWay = !!other && (insteadOn[u.id] ?? insteadTaken(picks, u));
          if (other && featWay) {
            return (
              <div key={u.id} style={card} role="group" aria-label={`Spend ${u.label}`}>
                <span style={{ fontSize: '0.75rem' }}>{u.label.toUpperCase()} <span style={{ ...why, display: 'inline' }}>· {u.from}</span></span>
                <span style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>A {other.list.one.toUpperCase()} INSTEAD OF THE POINTS</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="group" aria-label={`Pick a ${other.list.one} instead`}>
                  {other.options.map(({ option, unmet }) => {
                    const on = picks.some((p) => p.from === u.id && p.list === other.list.id && p.option === option.id);
                    return (
                      <span key={option.id} style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
                        <button type="button" aria-pressed={on} disabled={!!unmet && !on} onClick={() => pickInstead(other, option.id)}
                          style={{ ...btn, ...(on ? { background: 'var(--green)', color: 'var(--black)', borderColor: 'var(--green)' } : {}), ...(unmet && !on ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}>
                          {option.label.toUpperCase()}
                        </button>
                        {unmet && <span style={{ ...why, fontSize: '0.6rem' }}>NEEDS {unmet.toUpperCase()}</span>}
                      </span>
                    );
                  })}
                </div>
                <div><button type="button" style={btn} onClick={() => takeInstead(u, false)}>USE THE POINTS INSTEAD</button></div>
              </div>
            );
          }
          return (
            <div key={u.id} style={card} role="group" aria-label={`Spend ${u.label}`}>
              <span style={{ fontSize: '0.75rem' }}>{u.label.toUpperCase()} <span style={{ ...why, display: 'inline' }}>· {u.from}</span></span>
              <span style={{ ...why, color: left ? 'var(--cyan)' : 'var(--green)', opacity: 1 }}>
                {left} {left === 1 ? 'POINT' : 'POINTS'} LEFT{inc.points > 1 ? ` · AT MOST ${inc.most} ON ONE` : ''}{inc.cap !== undefined ? ` · STOPS AT ${inc.cap}` : ''}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {inc.stats.map((s) => {
                  const on = spread[s.id] ?? 0;
                  return (
                    <div key={s.id} style={statBox}>
                      <span style={{ fontSize: '0.6rem', letterSpacing: '1px', opacity: 0.8 }}>{s.label.toUpperCase()}</span>
                      <b aria-label={`${s.label} with the points`} style={{ fontSize: '0.9rem', color: on ? 'var(--cyan)' : 'var(--green)' }}>{statNow(data, s.id) + on}</b>
                      <span style={{ display: 'flex', gap: '4px' }}>
                        <button type="button" style={mini} aria-label={`Less ${s.label}`} disabled={!on} onClick={() => raise(u.id, s.id, -1)}>−</button>
                        <button type="button" style={mini} aria-label={`More ${s.label}`} disabled={!canRaise(data, u, spread, s.id)} onClick={() => raise(u.id, s.id, 1)}>+</button>
                      </span>
                    </div>
                  );
                })}
              </div>
              {other && <div><button type="button" style={btn} onClick={() => takeInstead(u, true)}>OR A {other.list.one.toUpperCase()} INSTEAD</button></div>}
              {u.text && <span style={why}>{u.text}</span>}
            </div>
          );
        })}
        {refused && <p role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1 }}>{refused}</p>}
      </div>
    </TerminalWindow>
  );
}
