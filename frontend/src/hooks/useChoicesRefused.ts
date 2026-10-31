import { useEffect, useState } from 'react';

// Why the server last said no to a pick, a level or a use (7a3b1, 7a3b2: backend sockets/choices.js
// sends 'choicesRefused'), for a sheet window to show under its CHOICES block. It shows for a few
// seconds and then goes, as a status line does. Spending recovery dice (R2b) is refused the same way,
// as 'recoveryRefused'.

/** How long a refusal stays on the sheet. */
export const REFUSED_MS = 6000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's socket is untyped throughout
export function useChoicesRefused(socket: any): string | null {
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (!socket) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onRefused = (e: { error?: string }) => {
      setRefused(typeof e?.error === 'string' ? e.error : null);
      clearTimeout(timer);
      timer = setTimeout(() => setRefused(null), REFUSED_MS);
    };
    socket.on('choicesRefused', onRefused);
    socket.on('recoveryRefused', onRefused);
    return () => { socket.off('choicesRefused', onRefused); socket.off('recoveryRefused', onRefused); clearTimeout(timer); };
  }, [socket]);
  return refused;
}
