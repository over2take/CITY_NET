import { useState, useEffect, useCallback, useReducer } from 'react';
import type { TurnAsk } from '../../../sheets/turnAsks';

/** What the hook needs of the socket: the shape the sheet's HP box has it in (sheets/vitals.ts SheetVitals), App's fits too. */
export interface AskSocket {
  on: (event: string, fn: (...args: never[]) => void) => unknown;
  off: (event: string, fn: (...args: never[]) => void) => unknown;
  emit: (event: string, ...args: unknown[]) => unknown;
}

const NONE: TurnAsk[] = [];

/**
 * The rolls a condition's EACH TURN is waiting on (8a9c; backend sockets/turnAsks.js): every one for the GM, a player's own
 * for them, asked again whenever the server says they changed and on reconnecting. `roll` rolls one as the table would; a
 * refusal comes back in words, in `error`. Off (`enabled` false), it asks nothing and holds none.
 *
 * Takes the ref rather than the socket, as useInitiative does: a ref's `.current` is not reactive, so it waits for the socket.
 */
export function useTurnAsks(socketRef: { readonly current: unknown }, enabled = true) {
  const [asks, setAsks] = useState<TurnAsk[]>(NONE);
  const [error, setError] = useState<string | null>(null);
  const [rolling, setRolling] = useState<number[]>([]);
  const [socketReadyCount, forceReady] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!enabled) return;
    const s = socketRef.current as AskSocket | null;
    if (!s) {
      const interval = setInterval(() => { if (socketRef.current) { clearInterval(interval); forceReady(); } }, 200);
      return () => clearInterval(interval);
    }
    const ask = () => s.emit('requestTurnAsks');
    const onAsks = (list: unknown) => setAsks(Array.isArray(list) ? (list as TurnAsk[]) : NONE);
    s.on('turnAsks', onAsks);
    s.on('turnAsksChanged', ask);
    s.on('connect', ask);
    ask();
    return () => {
      s.off('turnAsks', onAsks);
      s.off('turnAsksChanged', ask);
      s.off('connect', ask);
    };
  }, [socketRef, enabled, socketReadyCount]);

  const roll = useCallback((id: number) => {
    const s = socketRef.current as AskSocket | null;
    if (!s) return;
    // Pressed once: the button waits for the answer, so a double click asks once.
    setRolling((now) => (now.includes(id) ? now : [...now, id]));
    s.emit('turnRoll', { id }, (res: unknown) => {
      const answer = res as { ok?: boolean; error?: string } | undefined;
      setRolling((now) => now.filter((x) => x !== id));
      setError(answer && answer.ok ? null : (answer?.error || 'That roll could not be made'));
    });
  }, [socketRef]);

  return { asks: enabled ? asks : NONE, roll, rolling, error };
}
