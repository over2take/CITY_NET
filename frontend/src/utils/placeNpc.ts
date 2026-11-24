import { placedToken, type NpcRow, type PlaceAs, type BattleShown } from './npcLibrary';

// PLACE in NPC_LIBRARY.EXE (2026-11-24): a new token for the NPC where the view is (utils/npcLibrary.ts placedToken), then
// linked to its sheet, as ATTACH links one, and the map asked again. What it needs is handed in, so it is tested without App.

export interface PlaceDeps {
  fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  authToken: string;
  refresh: () => void;
}

/** Null once placed and linked; otherwise what went wrong, in words. */
export const placeNpc = async (deps: PlaceDeps, npc: NpcRow, as: PlaceAs, at: { tx: number; tz: number }, battle?: BattleShown | null): Promise<string | null> => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.authToken}` };
  try {
    const made = await deps.fetch('/api/locations', { method: 'POST', headers, body: JSON.stringify(placedToken(npc, as, at, battle)) });
    const body = (await made.json().catch(() => null)) as { data?: { id?: number }[] } | null;
    // A refusal carries no token: no id, nothing to link.
    const id = body?.data?.[0]?.id;
    if (!id) return 'NOT PLACED: THE TOKEN WASN\'T MADE';
    const linked = await deps.fetch(`/api/sheets/npcs/${npc.id}/link`, { method: 'POST', headers, body: JSON.stringify({ location_id: id }) });
    deps.refresh();
    return linked.ok ? null : 'PLACED, BUT NOT LINKED TO ITS SHEET: ATTACH IT';
  } catch {
    return 'NOT PLACED: NO CONNECTION';
  }
};
