import { useEffect, useState } from 'react';
import { isOpen } from '../sheets/restCalls';

// Whether the GM has spending recovery dice open (R2b): the game-wide recovery_open setting (backend
// recovery.js OPEN_SETTING, sheets/restCalls.ts isOpen), read from /api/settings and again whenever
// the GM changes a setting, as the sheets' house rules are. It only matters in a system leaving
// spending to the GM.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's socket is untyped throughout
export function useRecoveryOpen(socket: any, fetcher: typeof fetch = fetch): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => {
      fetcher('/api/settings').then((r) => r.json()).then((rows) => { if (live) setOpen(isOpen(rows)); }).catch(() => {});
    };
    read();
    socket?.on('settingsUpdated', read);
    return () => { live = false; socket?.off('settingsUpdated', read); };
  }, [socket, fetcher]);
  return open;
}
