// Calling a rest from the GAME tab, as logic and requests (4f5; approved mockup
// docs/mockups/builder-rests.html, 2026-10-09, stage 3). The server works each character out and
// writes it (backend/sheets/rests.js, GET /api/sheets/rests and POST /api/sheets/rest); this says
// who is on the map, who is chosen, and how a change reads.

import type { Answer } from './systemsApi';

/** One value a rest changes: to a number, or still waiting on dice in a preview. */
export interface RestChange { what: string; label: string; from: number; to: number | null; pending?: string[] }
/** One character a rest reaches, as the server answers. */
export interface Rested {
  kind: 'player' | 'npc';
  username?: string;
  location_id?: number;
  name: string;
  changes: RestChange[];
  /** The names of the conditions that wear off. */
  gone: string[];
  /** The dice-log line, once called. */
  line?: string;
}
export interface RestAnswer { rest: { id: string; name: string }; preview: boolean; characters: Rested[] }

/** Who rests: every player character; them and the NPCs on the map being viewed; or the ones ticked. */
export type Who = 'players' | 'map' | 'choose';
export const WHO_LABELS: Record<Who, string> = {
  players: 'EVERY PLAYER CHARACTER',
  map: 'PLAYERS AND THE NPCS ON THIS MAP',
  choose: 'CHOOSE',
};

const UNREACHABLE = 'Could not reach the server.';

export const restCalls = (token: string, fetcher: typeof fetch = fetch) => {
  const ask = async <T>(url: string, body?: unknown): Promise<Answer<T>> => {
    let res: Response;
    try {
      res = await fetcher(url, body === undefined
        ? { headers: { Authorization: `Bearer ${token}` } }
        : { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, error: UNREACHABLE, status: 0 };
    }
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, value: json as T };
    return { ok: false, status: res.status, error: json && typeof json.error === 'string' ? json.error : UNREACHABLE };
  };
  return {
    /** The running game's rests that are on; none for a built-in game. */
    list: () => ask<{ system: string; rests: { id: string; name: string }[] }>('/api/sheets/rests'),
    /** What a rest would do: nothing rolled or written. */
    preview: (rest: string, players: true | string[] | false, npcs: number[]) => ask<RestAnswer>('/api/sheets/rest', { rest, players, npcs, preview: true }),
    /** Call it: rolled, written, and one dice-log line each. */
    call: (rest: string, players: true | string[] | false, npcs: number[]) => ask<RestAnswer>('/api/sheets/rest', { rest, players, npcs }),
  };
};

const NPC_SHAPES = ['enemy_rhombus', 'friendly_rhombus'];

/**
 * The NPC tokens on the map being viewed: on a battle map, the ones on its floor shown; otherwise
 * those on the city map. The same rule the map's own controls use (Sidebar's own token).
 */
export const npcsOnMap = (
  locations: { id: number; name?: string; shape?: string; battle_map_id?: number | null; floor_index?: number | null }[],
  view: string | undefined,
  battle: { locationId: number; currentFloorIndex: number } | null | undefined,
): { id: number; name: string }[] => locations
  .filter((l) => NPC_SHAPES.includes(String(l.shape)))
  .filter((l) => (view === 'battle_map' && battle
    ? Number(l.battle_map_id) === Number(battle.locationId) && Number(l.floor_index ?? 0) === Number(battle.currentFloorIndex)
    : l.battle_map_id == null))
  .map((l) => ({ id: l.id, name: l.name || 'NPC' }));

/** A character's key, for ticking and lists. */
export const keyOf = (r: Pick<Rested, 'kind' | 'username' | 'location_id'>) => (r.kind === 'player' ? `player:${r.username}` : `npc:${r.location_id}`);

/** The characters `who` picks out of everyone the panel previewed. */
export const chosenOf = (everyone: Rested[], who: Who, ticked: Set<string>): Rested[] => {
  if (who === 'players') return everyone.filter((r) => r.kind === 'player');
  if (who === 'map') return everyone;
  return everyone.filter((r) => ticked.has(keyOf(r)));
};

/** What the server is asked for, for `who`: players by name only when chosen by hand. */
export const requestFor = (who: Who, chosen: Rested[], mapNpcs: number[]): { players: true | string[] | false; npcs: number[] } => {
  if (who === 'players') return { players: true, npcs: [] };
  if (who === 'map') return { players: true, npcs: mapNpcs };
  const names = chosen.filter((r) => r.kind === 'player').map((r) => r.username!);
  return { players: names.length ? names : false, npcs: chosen.filter((r) => r.kind === 'npc').map((r) => r.location_id!) };
};

/** A change as the panel says it: "HP 9 → 22", or "HP 9 + 1d8 + @con_mod" before the dice. */
export const changeText = (c: RestChange) => (c.to === null
  ? `${c.label.toUpperCase()} ${c.from} + ${(c.pending ?? []).join(' + ')}`
  : `${c.label.toUpperCase()} ${c.from} → ${c.to}`);
