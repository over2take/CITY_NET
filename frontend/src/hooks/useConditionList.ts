import { useEffect, useState } from 'react';
import type { GameCondition, OnToken } from '../sheets/tokenConditions';

// The running game's conditions (4e2b1): GET /api/systems/conditions/:system, public, with each
// condition's modifiers only when the GM's login is sent. Fetched again when the system changes, or
// when a published system changes (the server's customSystemChanged, relayed by useSocket).

export const CONDITIONS_CHANGED_EVENT = 'citynet:conditions-changed';

export function useConditionList(system: string | undefined, authToken?: string): GameCondition[] {
  const [list, setList] = useState<GameCondition[]>([]);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const again = () => setAsked((n) => n + 1);
    window.addEventListener(CONDITIONS_CHANGED_EVENT, again);
    return () => window.removeEventListener(CONDITIONS_CHANGED_EVENT, again);
  }, []);
  useEffect(() => {
    if (!system) { setList([]); return undefined; }
    let live = true;
    fetch(`/api/systems/conditions/${encodeURIComponent(system)}`, authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined)
      .then((r) => (r.ok ? r.json() : []))
      .then((body) => { if (live) setList(Array.isArray(body) ? body : []); })
      .catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [system, authToken, asked]);
  return list;
}

/**
 * A token's conditions with their rounds left and modifiers, for a viewer the server sends them to
 * (requestTokenConditions): the GM, the token's owner, a player given a friendly NPC. Null for
 * anyone else, and until the answer comes. Asked again whenever the token's conditions change.
 */
export function useConditionDetail(socket: any, locationId: number | undefined, version: string): OnToken[] | null {
  const [detail, setDetail] = useState<OnToken[] | null>(null);
  useEffect(() => {
    if (!socket || locationId === undefined) { setDetail(null); return undefined; }
    const onReply = (data: { location_id: number; full: boolean; conditions: OnToken[] }) => {
      if (data && data.location_id === locationId) setDetail(data.full ? data.conditions : null);
    };
    socket.on('tokenConditions', onReply);
    socket.emit('requestTokenConditions', { location_id: locationId });
    return () => { socket.off('tokenConditions', onReply); };
  }, [socket, locationId, version]);
  return detail;
}
