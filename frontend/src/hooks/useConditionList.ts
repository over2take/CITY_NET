import { useEffect, useState } from 'react';
import type { GameCondition, OnToken } from '../sheets/tokenConditions';

// The running game's conditions (4e2b1): GET /api/systems/conditions/:system, public, with each
// condition's modifiers only when the GM's login is sent. Fetched again when the system changes, or
// when a published system changes (the server's customSystemChanged, relayed by useSocket).

export const CONDITIONS_CHANGED_EVENT = 'citynet:conditions-changed';

/**
 * One request per game and login, shared: every token on the map draws its condition icons from
 * the same list (4e2b2), so dozens of tokens ask once. A failed request isn't kept, so the next
 * one asks again; a published system changing forgets them all.
 */
const asked = new Map<string, Promise<GameCondition[]>>();
const listFor = (system: string, authToken?: string) => {
  const key = `${system}\n${authToken ?? ''}`;
  if (!asked.has(key)) {
    const request = fetch(`/api/systems/conditions/${encodeURIComponent(system)}`, authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((body) => (Array.isArray(body) ? body as GameCondition[] : []))
      .catch(() => { asked.delete(key); return [] as GameCondition[]; });
    asked.set(key, request);
  }
  return asked.get(key)!;
};

/** Forget every list asked for (a system changed; and tests, between cases). */
export const forgetConditionLists = () => asked.clear();

// Once, when this module loads: listening before any hook does, so the lists are forgotten before
// the hooks ask again and they all share the one new request.
if (typeof window !== 'undefined') window.addEventListener(CONDITIONS_CHANGED_EVENT, forgetConditionLists);

export function useConditionList(system: string | undefined, authToken?: string): GameCondition[] {
  const [list, setList] = useState<GameCondition[]>([]);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const again = () => setRound((n) => n + 1);
    window.addEventListener(CONDITIONS_CHANGED_EVENT, again);
    return () => window.removeEventListener(CONDITIONS_CHANGED_EVENT, again);
  }, []);
  useEffect(() => {
    if (!system) { setList([]); return undefined; }
    let live = true;
    listFor(system, authToken).then((body) => { if (live) setList(body); });
    return () => { live = false; };
  }, [system, authToken, round]);
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
