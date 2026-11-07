import React, { useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { getTemplate } from '../sheets';
import { isCustomSystem } from '../sheets/customTemplates';
import { wordFor } from '../sheets/words';

// Awarding and taking back experience.
//
// Its own file rather than a second window inside BankWindows, because it is not banking.
// It borrows that window's shape - a list of who is online, a number, a button - and
// differs in the one way that matters: money is a pot the GM splits between whoever was on
// the job, experience is per character. CWN p44 awards "3 experience points" to a
// character for a session, not three shared between four of them; divided, a full party
// would earn less each than a pair, which is the opposite of the rule.
//
// So there is no DIVIDE button here, and the label says EACH.
//
// A custom system (7d2a; approved mockup docs/mockups/level-up.html) earns XP however its game does, so it
// has EACH by default and SPLIT beside it, and SET XP TO to put a mistake right.

export interface XpAwardResult {
  ok: boolean;
  reason?: string;
  amount?: number;
  /** What a split couldn't divide. */
  left?: number;
  levelChange?: number;
  results?: { username: string; ok: boolean; xp?: number; level?: number; reason?: string }[];
}

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: { emit: (event: string, payload: unknown) => void;
    on: (event: string, fn: (data: XpAwardResult) => void) => void;
    off: (event: string, fn: (data: XpAwardResult) => void) => void } | null;
  token: string;
  activeUsers: { userName?: string; isNPC?: boolean; isAdmin?: boolean; isTemporaryAdmin?: boolean }[];
  /** The active game system, so a system with no experience says so instead of failing. */
  system?: string;
}

/** Systems that have an experience field. Mirrors XP_FIELD in backend/sheets/awardXp.js. */
const SYSTEMS_WITH_XP = ['cities_without_number'];

/**
 * Whether to offer experience at all on this system.
 *
 * Exported so the admin panel can hide the button rather than offering one that opens a
 * window saying no. The window keeps its own check anyway - the button is a courtesy, not
 * the gate.
 */
export const xpAvailable = (system: string | undefined | null): boolean =>
  SYSTEMS_WITH_XP.includes(String(system ?? '')) || (isCustomSystem(String(system ?? '')) && !!getTemplate(String(system)).levels);

export function AdminXpWindow({ pos, setPos, onClose, socket, token, activeUsers, system }: Props) {
  const [amount, setAmount] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<XpAwardResult | null>(null);

  const [split, setSplit] = useState(false);
  const [setTo, setSetTo] = useState('');

  const supported = xpAvailable(system);
  const custom = isCustomSystem(String(system ?? ''));
  const word = custom ? wordFor(system, 'xp', 'short', 'XP').toUpperCase() : 'XP';

  const players = (activeUsers || [])
    .filter((u) => !u.isNPC && !(u.isAdmin && !u.isTemporaryAdmin))
    .map((u) => u.userName)
    .filter((u): u is string => Boolean(u));

  // The result comes back rather than being assumed: a name with no sheet does nothing,
  // and a GM awarding the party should be told which one it was.
  useEffect(() => {
    if (!socket) return;
    const onResult = (data: XpAwardResult) => setOutcome(data);
    socket.on('xpAwardResult', onResult);
    return () => socket.off('xpAwardResult', onResult);
  }, [socket]);

  const toggle = (u: string) =>
    setSelected((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]));

  /**
   * Levelling is its own message, not an award of some XP figure.
   *
   * XP records what was earned; a level is a decision made from it. A GM fixing a level
   * should not have to work out what XP total would produce it, and taking XP back does
   * not un-level anyone - the skill points and Focus that came with the level do not undo
   * themselves.
   */
  const changeLevel = (delta: number) => {
    if (selected.length === 0) return;
    setOutcome(null);
    socket?.emit('adminAdjustLevel', { token, usernames: selected, delta });
  };

  const send = (who: string[]) => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || who.length === 0) return;
    setOutcome(null);
    socket?.emit('adminAwardXp', { token, usernames: who, amount: n, ...(custom && split ? { split: true } : {}) });
  };

  const setToNumber = Number(setTo);
  const setToValid = setTo.trim() !== '' && Number.isInteger(setToNumber) && setToNumber >= 0;
  const sendSet = () => {
    setOutcome(null);
    socket?.emit('adminSetXp', { token, usernames: selected, value: setToNumber });
  };

  const n = Number(amount);
  const valid = Number.isInteger(n) && n !== 0;
  const verb = n < 0 ? 'TAKE' : 'AWARD';

  return (
    <DraggableWindow title={`${word}.EXE`} pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
      <div style={{ padding: '10px' }}>
        {!supported ? (
          // Cyberpunk RED spends Improvement Points and Shadowrun spends Karma. Both are
          // real and neither is this, so the window says so rather than doing nothing.
          <div style={{ fontSize: '12px', opacity: 0.8 }}>
            This system does not track experience points.
          </div>
        ) : (
          <>
            <label htmlFor="xp-amount" style={{ display: 'block', marginBottom: '5px', color: 'var(--green)' }}>
              {custom && split ? 'POINTS_TO_SPLIT' : 'POINTS_EACH'}
            </label>
            <input
              id="xp-amount" type="number" step="1" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="3"
              style={{ width: '100%', padding: '5px', marginBottom: '4px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)' }}
            />
            {/* Said plainly, because the button beside it in PAY_PLAYERS does the
                opposite and muscle memory is a real thing. */}
            <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '12px' }}>
              {custom
                ? (split ? 'Shared between those selected, in whole points. Negative takes points back, but never a level.' : 'Each selected character gets this many. Negative takes points back, but never a level.')
                : 'Each selected character gets this many, and levels up if the total earns it. Negative takes points back, but never a level.'}
            </div>
            {custom && (
              <div role="group" aria-label="How it is given" style={{ display: 'inline-flex', border: '1px solid var(--green)', marginBottom: '12px' }}>
                {([[false, 'EACH'], [true, 'SPLIT']] as const).map(([on, label]) => (
                  <button key={label} type="button" aria-pressed={split === on} onClick={() => setSplit(on)}
                    style={{ background: split === on ? 'var(--green)' : 'none', color: split === on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: '11px', padding: '3px 10px', cursor: 'pointer' }}>{label}</button>
                ))}
              </div>
            )}

            <div className="crt-scroll" style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--dark-green)', padding: '5px', marginBottom: '10px', background: 'color-mix(in srgb, var(--black) 50%, transparent)' }}>
              {players.length === 0 ? (
                <div style={{ opacity: 0.5, fontSize: '12px' }}>No players online.</div>
              ) : players.map((u) => (
                <label key={u} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.includes(u)} onChange={() => toggle(u)} aria-label={u} />
                  <span>{u}</span>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="utility-btn" style={{ flex: 1 }}
                disabled={!valid || selected.length === 0}
                onClick={() => send(selected)}
              >{verb}_SELECTED</button>
              <button
                className="utility-btn" style={{ flex: 1 }}
                disabled={!valid || players.length === 0}
                onClick={() => send(players)}
              >{verb}_ALL</button>
            </div>

            {custom && (
              <div style={{ marginTop: '10px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
                <label htmlFor="xp-set" style={{ display: 'block', fontSize: '11px', opacity: 0.6, marginBottom: '5px' }}>
                  Replace what the selected characters have with another number. Their level stays.
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input id="xp-set" type="number" min="0" step="1" value={setTo} onChange={(e) => setSetTo(e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: '5px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                  <button className="utility-btn" style={{ flex: 1 }} disabled={!setToValid || selected.length === 0} onClick={sendSet}>SET_{word}_TO</button>
                </div>
              </div>
            )}

            {!custom && <div style={{ marginTop: '10px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
              <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '5px' }}>
                Levels for the selected characters, if one needs correcting.
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="utility-btn" style={{ flex: 1 }}
                  disabled={selected.length === 0}
                  onClick={() => changeLevel(-1)}
                >LEVEL_DOWN</button>
                <button
                  className="utility-btn" style={{ flex: 1 }}
                  disabled={selected.length === 0}
                  onClick={() => changeLevel(1)}
                >LEVEL_UP</button>
              </div>
            </div>}

            {outcome && (
              <div style={{ marginTop: '10px', fontSize: '11px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
                {!outcome.ok ? (
                  <div style={{ color: 'var(--danger)' }}>{outcome.reason}</div>
                ) : (
                  <>
                    {!!outcome.left && <div style={{ color: 'var(--warning)' }}>{outcome.left} LEFT OVER: IT WOULDN&apos;T DIVIDE</div>}
                    {(outcome.results ?? []).map((r) => (
                      <div key={r.username} style={{ color: r.ok ? undefined : 'var(--danger)' }}>
                        {r.username}: {!r.ok
                          ? (r.reason ?? 'no sheet')
                          : r.xp === undefined ? `level ${r.level}`
                          : r.level === undefined ? `${r.xp} ${word}`
                          : `${r.xp} ${word} · level ${r.level}`}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DraggableWindow>
  );
}
