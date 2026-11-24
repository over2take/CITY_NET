import { describe, it, expect, vi } from 'vitest';
import { npcsFound, placedToken, type NpcRow } from '../npcLibrary';
import { placeNpc } from '../placeNpc';

/**
 * NPC_LIBRARY.EXE's FIND and PLACE (2026-11-24): every word matching a name or folder; a new enemy or friendly token where
 * the view is, on the battle map being looked at, named for the NPC, then linked to its sheet.
 */

const row = (id: number, npc_label: string, folder: string | null = null): NpcRow => ({ id, npc_label, folder, portrait_url: null, updated_at: '' });
const NPCS = [row(1, 'Gang Member', 'Tygers'), row(2, 'Gang Boss', 'Tygers'), row(3, 'Fixer'), row(4, 'Street Doc', 'Clinic')];

describe('FIND', () => {
  it('every word typed, in the name or the folder, any case; nothing typed, every NPC', () => {
    expect(npcsFound(NPCS, 'gang').map((n) => n.id)).toEqual([1, 2]);
    expect(npcsFound(NPCS, '  TYGERS boss ').map((n) => n.id)).toEqual([2]);
    expect(npcsFound(NPCS, 'clinic').map((n) => n.id)).toEqual([4]);
    expect(npcsFound(NPCS, 'fixer tygers')).toEqual([]);
    expect(npcsFound(NPCS, '   ')).toBe(NPCS);
  });
});

describe('PLACE', () => {
  it('a token named for the NPC where the view is, an enemy or a friendly, on the battle map and floor looked at', () => {
    expect(placedToken(NPCS[0], 'enemy', { tx: 4, tz: -2 }, { locationId: 9, currentFloorIndex: 1 })).toEqual({
      name: 'Gang Member', description: '', npcs: '', x: 4, y: 0, z: -2, width: 1.875, height: 1.875, depth: 1.875,
      shape: 'enemy_rhombus', color: 'var(--danger)', isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5,
      battle_map_id: 9, floor_index: 1,
    });
    expect(placedToken(NPCS[2], 'friendly', { tx: 0, tz: 0 })).toMatchObject({ name: 'Fixer', shape: 'friendly_rhombus', color: '#00ccff', battle_map_id: null, floor_index: null });
    // At full HP where the library knows its HP; none where it doesn't (not 0/0).
    expect(placedToken({ npc_label: 'Jack', hp_max: 18 }, 'enemy', { tx: 0, tz: 0 })).toMatchObject({ name: 'Jack', hp_current: 18, hp_max: 18 });
    expect(placedToken({ npc_label: 'Jack', hp_max: null }, 'enemy', { tx: 0, tz: 0 })).not.toHaveProperty('hp_max');
  });

  const server = (made = { ok: true, body: { data: [{ id: 77 }] } as unknown }, link = { ok: true }) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url === '/api/locations' ? { ok: made.ok, json: async () => made.body } : { ok: link.ok, json: async () => ({}) };
    });
    return { calls, deps: { fetch, authToken: 'tok', refresh: vi.fn() } };
  };

  it('made, then linked to the NPC\'s sheet, with the sign-in; the map asked again', async () => {
    const { calls, deps } = server();
    expect(await placeNpc(deps, NPCS[1], 'enemy', { tx: 1, tz: 2 })).toBeNull();
    expect(calls.map((c) => [c.url, c.init.method, JSON.parse(String(c.init.body))])).toEqual([
      ['/api/locations', 'POST', expect.objectContaining({ name: 'Gang Boss', shape: 'enemy_rhombus', x: 1, z: 2 })],
      ['/api/sheets/npcs/2/link', 'POST', { location_id: 77 }],
    ]);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('said in words where it went wrong: not made, made but not linked, no connection', async () => {
    const notMade = server({ ok: false, body: { error: 'no' } });
    expect(await placeNpc(notMade.deps, NPCS[0], 'enemy', { tx: 0, tz: 0 })).toBe('NOT PLACED: THE TOKEN WASN\'T MADE');
    expect(notMade.calls).toHaveLength(1);
    const noId = server({ ok: true, body: { data: [] } });
    expect(await placeNpc(noId.deps, NPCS[0], 'enemy', { tx: 0, tz: 0 })).toBe('NOT PLACED: THE TOKEN WASN\'T MADE');
    const notLinked = server(undefined, { ok: false });
    expect(await placeNpc(notLinked.deps, NPCS[0], 'enemy', { tx: 0, tz: 0 })).toBe('PLACED, BUT NOT LINKED TO ITS SHEET: ATTACH IT');
    expect(notLinked.deps.refresh).toHaveBeenCalledTimes(1);
    const down = { fetch: vi.fn(async () => { throw new Error('offline'); }), authToken: 'tok', refresh: vi.fn() };
    expect(await placeNpc(down, NPCS[0], 'enemy', { tx: 0, tz: 0 })).toBe('NOT PLACED: NO CONNECTION');
  });
});
