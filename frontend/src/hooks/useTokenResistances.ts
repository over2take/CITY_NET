import { useEffect, useState } from 'react';
import type { ResistanceView } from '../sheets/resistanceChips';

// What a token's character resists, as the server lets this viewer see it (GET /api/locations/:id/resistances, 8b3c2a),
// asked again whenever a sheet or the map changes (a ring worn, a condition put on), when `key` changes, and on `reload`.

/** As much of the socket as this needs. */
interface Listens { on: (event: string, fn: () => void) => void; off: (event: string, fn: () => void) => void }

export function useTokenResistances(socket: Listens | null | undefined, locationId: number | null | undefined, authToken: string | undefined, key = '') {
  const [view, setView] = useState<ResistanceView | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (locationId === null || locationId === undefined || locationId < 0) return undefined;
    let live = true;
    const ask = () => {
      fetch(`/api/locations/${locationId}/resistances`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} })
        .then((res) => (res.ok ? res.json() : null))
        .then((v: ResistanceView | null) => { if (live) setView(v); })
        .catch(() => { /* kept as it was: asked again on the next change */ });
    };
    ask();
    socket?.on('sheetUpdated', ask);
    socket?.on('dataUpdated', ask);
    return () => {
      live = false;
      socket?.off('sheetUpdated', ask);
      socket?.off('dataUpdated', ask);
    };
  }, [socket, locationId, authToken, key, tick]);
  return { view, reload: () => setTick((t) => t + 1) };
}
