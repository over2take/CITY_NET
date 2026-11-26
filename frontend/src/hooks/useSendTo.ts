import { useCallback, useEffect, useState } from 'react';
import { inChunks, type SendPreview, type SendTarget } from '../sheets/sendTo';

/** What the hook needs of a socket: to ask, with an answer. Held by a ref, read only when asking. */
export type SendSocket = { emit: (event: string, payload: unknown, ack?: (answer: never) => void) => void } | null | undefined;
export type SendSocketRef = { current: SendSocket };

/** The server's answer to a SEND: the tokens it reached, as the log names them, or why not. */
export type SendAnswer = { ok: true; sent: string[] } | { ok: false; error: string };

/** A preview's key: a token FULL or HALF. */
export const previewKey = (id: number, half: boolean) => `${id}:${half ? 'half' : 'full'}`;

/**
 * SEND TO's picker (8b7b; sockets sendRollPreview and sendRoll, 8b7a). While `open`, what each listed token would take of
 * the kept roll, FULL and HALF, and whether it went there already, asked again when where it went changes (`sentCount`).
 * `send` sends it on: { locationId, half } each.
 */
export function useSendTo(socketRef: SendSocketRef, rollId: number, targets: SendTarget[], open: boolean, sentCount: number) {
  const [previews, setPreviews] = useState<Record<string, SendPreview>>({});
  const ids = targets.map((t) => t.id).join(',');
  useEffect(() => {
    const socket = socketRef.current;
    if (!open || !socket || !ids) return undefined;
    for (const half of [false, true]) {
      for (const chunk of inChunks(ids.split(',').map(Number))) {
        socket.emit('sendRollPreview', { rollId, targets: chunk.map((locationId) => ({ locationId, half })) }, (answer: { ok: boolean; targets?: SendPreview[] }) => {
          if (!answer || !answer.targets) return;
          setPreviews((was) => ({ ...was, ...Object.fromEntries(answer.targets!.map((p) => [previewKey(p.locationId, p.half), p])) }));
        });
      }
    }
    return undefined;
  }, [open, socketRef, rollId, ids, sentCount]);
  const send = useCallback((targetsPicked: { locationId: number; half: boolean }[]) => new Promise<SendAnswer>((resolve) => {
    const socket = socketRef.current;
    if (!socket) { resolve({ ok: false, error: 'Not connected' }); return; }
    socket.emit('sendRoll', { rollId, targets: targetsPicked }, (answer: SendAnswer) => resolve(answer ?? { ok: false, error: 'No answer from the server' }));
  }), [socketRef, rollId]);
  return { previews, send };
}
