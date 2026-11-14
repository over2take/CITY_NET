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
  /** Opened on their sheet for them to finish, nothing changed yet (rests on each sheet, R3b). */
  called?: true;
}
export interface RestAnswer { rest: { id: string; name: string }; preview: boolean; characters: Rested[] }

/** One player in a rest called on the sheets (R4): finished (by them or the GM), resting, or waiting. */
export interface CalledPlayer {
  username: string;
  name: string;
  state: 'finished' | 'resting' | 'waiting';
  by?: 'player' | 'gm';
  /** What finishing it changed. */
  changes: RestChange[];
  /** Recovery dice spent since it was called. */
  spent: number;
}
/** The latest rest called on the players' sheets, as the server sees it (backend recovery.js restCallsShown). */
export interface CalledRest { id: string; rest: string; name: string; at: string; npcs: number; players: CalledPlayer[]; waiting: number }

/**
 * What CALL's confirm says will happen (R3b): at the GM's call it applies now; on each sheet it opens
 * on the players' sheets for them to finish, and the NPCs rest at once.
 */
export const confirmText = (finish: 'call' | 'sheet', players: number, npcs: number): string => {
  if (finish !== 'sheet') return 'It applies now, dice rolled for each.';
  const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    players ? `It opens on ${s(players, 'player\'s sheet', 'players\' sheets')} for them to finish.` : '',
    npcs ? `${s(npcs, 'NPC rests', 'NPCs rest')} at once.` : '',
  ].filter(Boolean).join(' ');
};

/** What the panel says once a rest is called: those it reached, and those it opened on a sheet. */
export const calledText = (rest: string, characters: Rested[]): string => {
  const opened = characters.filter((c) => c.called).length;
  const rested = characters.length - opened;
  const n = (k: number, what: string) => `${k} ${what}${k === 1 ? '' : 'S'}`;
  if (!opened) return `${rest.toUpperCase()} CALLED · ${n(rested, 'CHARACTER')}`;
  return `${rest.toUpperCase()} CALLED · OPEN ON ${n(opened, 'SHEET')}${rested ? ` · ${n(rested, 'NPC')} RESTED` : ''}`;
};

/** Who rests: every player character; them and the NPCs on the map being viewed; or the ones ticked. */
export type Who = 'players' | 'map' | 'choose';
export const WHO_LABELS: Record<Who, string> = {
  players: 'EVERY PLAYER CHARACTER',
  map: 'PLAYERS AND THE NPCS ON THIS MAP',
  choose: 'CHOOSE',
};

const UNREACHABLE = 'Could not reach the server.';

/** The game-wide setting the GM opens spending recovery dice with (backend recovery.js OPEN_SETTING). */
export const OPEN_SETTING = 'recovery_open';

/** Whether rows from /api/settings have spending recovery dice open. */
export const isOpen = (rows: unknown): boolean => Array.isArray(rows)
  && rows.some((r) => !!r && typeof r === 'object' && (r as { key?: unknown }).key === OPEN_SETTING && (r as { value?: unknown }).value === '1');

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
    /** The running game's rests that are on, none for a built-in game; and its recovery dice's name and who says when they're spent (R2b). */
    list: () => ask<{ system: string; rests: { id: string; name: string }[]; recovery?: { name: string; spend: 'any' | 'gm' } | null; finish?: 'call' | 'sheet'; call?: CalledRest | null }>('/api/sheets/rests'),
    /** Finish the latest called rest for those named still resting, or everyone left (R4). */
    finish: (players: true | string[]) => ask<{ finished: number; call: CalledRest | null }>('/api/sheets/rest/finish', { players }),
    /** Whether the GM has spending recovery dice open (R2b): the recovery_open setting. */
    spendingOpen: async () => {
      const r = await ask<unknown>('/api/settings');
      return r.ok ? { ok: true as const, value: isOpen(r.value) } : r;
    },
    /** Opens or closes spending recovery dice for players. */
    setSpending: (open: boolean) => ask<unknown>('/api/settings', { key: OPEN_SETTING, value: open ? '1' : '0' }),
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

/** How many are left of a called rest (R4): "WAITING ON 1 OF 3", or "EVERYONE FINISHED". */
export const waitingText = (c: CalledRest) => (c.waiting ? `WAITING ON ${c.waiting} OF ${c.players.length}` : 'EVERYONE FINISHED');

/**
 * One player's line in a called rest (R4; approved mockup rest-on-sheet, pane 4): "finished · HP 9 →
 * 11 · 1 die spent", "finished by the GM · no dice spent", "resting · 1 die spent", or "not finished
 * yet". Dice are named only in a game that has recovery dice.
 */
export const calledLine = (p: CalledPlayer, dice: boolean): string => {
  const spent = p.spent ? `${p.spent} ${p.spent === 1 ? 'die' : 'dice'} spent` : dice ? 'no dice spent' : '';
  if (p.state === 'finished') return [p.by === 'gm' ? 'finished by the GM' : 'finished', ...p.changes.map(changeText), spent].filter(Boolean).join(' · ');
  if (p.state === 'resting') return `resting · ${spent}`;
  return 'not finished yet';
};
