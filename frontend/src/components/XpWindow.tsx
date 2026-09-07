import React, { useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';

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

export interface XpAwardResult {
  ok: boolean;
  reason?: string;
  amount?: number;
  results?: { username: string; ok: boolean; xp?: number; reason?: string }[];
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

export function AdminXpWindow({ pos, setPos, onClose, socket, token, activeUsers, system }: Props) {
  const [amount, setAmount] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<XpAwardResult | null>(null);

  const supported = SYSTEMS_WITH_XP.includes(String(system ?? ''));

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

  const send = (who: string[]) => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || who.length === 0) return;
    setOutcome(null);
    socket?.emit('adminAwardXp', { token, usernames: who, amount: n });
  };

  const n = Number(amount);
  const valid = Number.isInteger(n) && n !== 0;
  const verb = n < 0 ? 'TAKE' : 'AWARD';

  return (
    <DraggableWindow title="ADMIN // EXPERIENCE" pos={pos} setPos={setPos} onClose={onClose} windowStyle={{ width: '300px' }}>
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
              POINTS_EACH
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
              Each selected character gets this many. Negative takes it back.
            </div>

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

            {outcome && (
              <div style={{ marginTop: '10px', fontSize: '11px', borderTop: '1px solid var(--dark-green)', paddingTop: '8px' }}>
                {!outcome.ok ? (
                  <div style={{ color: 'var(--danger)' }}>{outcome.reason}</div>
                ) : (
                  <>
                    {(outcome.results ?? []).map((r) => (
                      <div key={r.username} style={{ color: r.ok ? undefined : 'var(--danger)' }}>
                        {r.username}: {r.ok ? `${r.xp} XP` : (r.reason ?? 'no sheet')}
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
