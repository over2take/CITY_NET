import { useCallback, useEffect, useState } from 'react';
import type { WaitingView } from '../sheets/waitingHits';

/** What APPLY, DISMISS and APPLY ALL send (sockets waitingHitAct). */
export type WaitingAct = { act: 'apply' | 'dismiss'; hitId: number } | { act: 'apply_all' };
/** The server's answer: how many it did, or why not. */
export type WaitingActAnswer = { ok: true; done: number } | { ok: false; error: string; done?: number };

/** What the hook needs of a socket: to ask, with an answer, and to hear what the server says changed. */
export type WaitingSocket = {
  emit: (event: string, payload: unknown, ack?: (answer: never) => void) => void;
  on: (event: string, fn: () => void) => void;
  off: (event: string, fn: () => void) => void;
} | null | undefined;

/**
 * A token's hits waiting under CONFIRM (8b6b2; sockets waitingHits), as the server shows them to this viewer, read again
 * whenever any change (waitingHitsChanged: a player's character's may be kept on another copy of their token). Null until
 * read, for another token, or where `on` is false (a built-in game has none). `act` APPLYs, DISMISSes or APPLIES ALL.
 */
export function useWaitingHits(socket: WaitingSocket, locationId: number | null | undefined, on: boolean) {
  const [got, setGot] = useState<{ id: number; view: WaitingView } | null>(null);
  const [asked, setAsked] = useState(0);
  const asking = on && !!socket && locationId !== null && locationId !== undefined;
  useEffect(() => {
    if (!asking) return undefined;
    let live = true;
    socket!.emit('waitingHits', { locationId }, (view: WaitingView) => { if (live && view) setGot({ id: locationId as number, view }); });
    return () => { live = false; };
  }, [asking, socket, locationId, asked]);
  useEffect(() => {
    if (!asking) return undefined;
    const again = () => setAsked((n) => n + 1);
    socket!.on('waitingHitsChanged', again);
    return () => { socket!.off('waitingHitsChanged', again); };
  }, [asking, socket]);
  const act = useCallback((payload: WaitingAct) => new Promise<WaitingActAnswer>((resolve) => {
    if (!socket || locationId === null || locationId === undefined) { resolve({ ok: false, error: 'Not connected' }); return; }
    socket.emit('waitingHitAct', { locationId, ...payload }, (answer: WaitingActAnswer) => resolve(answer ?? { ok: false, error: 'No answer from the server' }));
  }), [socket, locationId]);
  return { view: asking && got && got.id === locationId ? got.view : null, act };
}
