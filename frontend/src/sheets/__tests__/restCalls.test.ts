import { describe, it, expect, vi } from 'vitest';
import { restCalls, npcsOnMap, chosenOf, requestFor, changeText, keyOf, type Rested } from '../restCalls';

/**
 * Calling a rest from the GAME tab, as logic and requests (4f5). Approved mockup builder-rests, stage 3
 * (2026-10-09): who is on the map being viewed, who is chosen, what the server is asked, and how a
 * change reads before and after the dice.
 */

const VEX: Rested = { kind: 'player', username: 'vex', name: 'Vex', changes: [], gone: [] };
const ASH: Rested = { kind: 'player', username: 'ash', name: 'Ash', changes: [], gone: [] };
const GANGER: Rested = { kind: 'npc', location_id: 7, name: 'GANGER', changes: [], gone: [] };
const EVERYONE = [ASH, VEX, GANGER];

describe('the NPCs on the map being viewed', () => {
  const LOCATIONS = [
    { id: 1, name: 'GANGER', shape: 'enemy_rhombus', battle_map_id: null },
    { id: 2, name: 'DOG', shape: 'friendly_rhombus' },
    { id: 3, name: 'VEX', shape: 'rhombus', battle_map_id: null },
    { id: 4, name: 'SHOP', shape: 'box', battle_map_id: null },
    { id: 5, name: 'GUARD', shape: 'enemy_rhombus', battle_map_id: 40, floor_index: 0 },
    { id: 6, name: 'BOSS', shape: 'enemy_rhombus', battle_map_id: 40, floor_index: 1 },
    { id: 7, shape: 'friendly_rhombus', battle_map_id: 40, floor_index: 1 },
    { id: 8, name: 'ELSEWHERE', shape: 'enemy_rhombus', battle_map_id: 41, floor_index: 1 },
  ];

  it('are the enemy and friendly tokens on the city map when no battle map is open', () => {
    expect(npcsOnMap(LOCATIONS, 'list', null)).toEqual([{ id: 1, name: 'GANGER' }, { id: 2, name: 'DOG' }]);
    // A battle-map view with no battle map loaded yet is the city; so is the city with one still loaded.
    expect(npcsOnMap(LOCATIONS, 'battle_map', null)).toEqual([{ id: 1, name: 'GANGER' }, { id: 2, name: 'DOG' }]);
    expect(npcsOnMap(LOCATIONS, 'list', { locationId: 40, currentFloorIndex: 1 })).toEqual([{ id: 1, name: 'GANGER' }, { id: 2, name: 'DOG' }]);
  });

  it('are the ones on the floor shown of the battle map open, a nameless one called NPC', () => {
    expect(npcsOnMap(LOCATIONS, 'battle_map', { locationId: 40, currentFloorIndex: 1 })).toEqual([{ id: 6, name: 'BOSS' }, { id: 7, name: 'NPC' }]);
    expect(npcsOnMap(LOCATIONS, 'battle_map', { locationId: 40, currentFloorIndex: 0 })).toEqual([{ id: 5, name: 'GUARD' }]);
  });
});

describe('who rests', () => {
  it('is every player character, them and the map\'s NPCs, or the ones ticked', () => {
    expect(chosenOf(EVERYONE, 'players', new Set())).toEqual([ASH, VEX]);
    expect(chosenOf(EVERYONE, 'map', new Set())).toEqual(EVERYONE);
    expect(chosenOf(EVERYONE, 'choose', new Set(['player:vex', 'npc:7']))).toEqual([VEX, GANGER]);
    expect(chosenOf(EVERYONE, 'choose', new Set())).toEqual([]);
    expect(keyOf(VEX)).toBe('player:vex');
    expect(keyOf(GANGER)).toBe('npc:7');
  });

  it('is asked for by name only when chosen by hand', () => {
    expect(requestFor('players', [ASH, VEX], [7, 9])).toEqual({ players: true, npcs: [] });
    expect(requestFor('map', EVERYONE, [7, 9])).toEqual({ players: true, npcs: [7, 9] });
    expect(requestFor('choose', [VEX, GANGER], [7, 9])).toEqual({ players: ['vex'], npcs: [7] });
    expect(requestFor('choose', [GANGER], [7])).toEqual({ players: false, npcs: [7] });
  });
});

describe('a change', () => {
  it('reads as a value moved, or one still waiting on dice', () => {
    expect(changeText({ what: 'health', label: 'HP', from: 9, to: 22 })).toBe('HP 9 → 22');
    expect(changeText({ what: 'slots', label: 'Spell slots', from: 0, to: 4 })).toBe('SPELL SLOTS 0 → 4');
    expect(changeText({ what: 'health', label: 'HP', from: 9, to: null, pending: ['1d8 + @con_mod', '-1'] })).toBe('HP 9 + 1d8 + @con_mod + -1');
    expect(changeText({ what: 'health', label: 'HP', from: 9, to: null })).toBe('HP 9 + ');
  });
});

describe('the requests', () => {
  const answering = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body }) as Response);

  it('list, preview and call the routes with the GM\'s login', async () => {
    const fetcher = answering(200, { ok: 1 });
    const api = restCalls('admintoken', fetcher);
    await api.list();
    await api.preview('long_rest', true, [7]);
    await api.call('long_rest', ['vex'], []);
    expect(fetcher.mock.calls).toEqual([
      ['/api/sheets/rests', { headers: { Authorization: 'Bearer admintoken' } }],
      ['/api/sheets/rest', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admintoken' }, body: JSON.stringify({ rest: 'long_rest', players: true, npcs: [7], preview: true }) }],
      ['/api/sheets/rest', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admintoken' }, body: JSON.stringify({ rest: 'long_rest', players: ['vex'], npcs: [] }) }],
    ]);
    expect(await api.list()).toEqual({ ok: true, value: { ok: 1 } });
  });

  it('give the server\'s own words for a refusal, and say when it can\'t be reached', async () => {
    expect(await restCalls('t', answering(400, { error: 'Not one of this game\'s rests' })).call('nap', true, []))
      .toEqual({ ok: false, status: 400, error: 'Not one of this game\'s rests' });
    expect(await restCalls('t', answering(500, null)).list()).toEqual({ ok: false, status: 500, error: 'Could not reach the server.' });
    expect(await restCalls('t', vi.fn(async () => { throw new Error('down'); })).list()).toEqual({ ok: false, status: 0, error: 'Could not reach the server.' });
  });
});
