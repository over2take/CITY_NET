import { describe, it, expect } from 'vitest';
import { sendOf, sendTargets, sendHeading, sentWords, picksToTargets, withTicked, inChunks, withSendNews, MOST_AT_ONCE, type RollSend } from '../sendTo';

/** SEND TO in the GM's tray (8b7b; mockup send-to, approved 2026-11-26): who the picker offers, and its words. */

const FIRE: RollSend = { rollId: 7, what: 'Fireball', from: 'Mira', total: 28, types: ['FIRE'], sent: [] };

describe('who the picker offers', () => {
  const locations = [
    { id: 1, name: 'Goblin A', shape: 'enemy_rhombus', battle_map_id: 5, floor_index: 0 },
    { id: 2, name: 'Powder Barrel', shape: 'enemy_rhombus', battle_map_id: 5, floor_index: 0 },
    { id: 3, name: 'Kes', shape: 'rhombus', owner: 'kes', battle_map_id: 5, floor_index: 0 },
    { id: 4, name: '', shape: 'rhombus', owner: 'ash', battle_map_id: 5, floor_index: 0 },
    { id: 5, name: 'Upstairs', shape: 'enemy_rhombus', battle_map_id: 5, floor_index: 1 },
    { id: 6, name: 'Elsewhere', shape: 'friendly_rhombus', battle_map_id: 9, floor_index: 0 },
    { id: 7, name: 'Street Rat', shape: 'friendly_rhombus', battle_map_id: null },
    { id: 8, name: 'Vic\'s Arms', shape: 'building', battle_map_id: 5, floor_index: 0 },
    { id: 9, name: 'Ground', shape: 'enemy_rhombus', battle_map_id: 5 },
  ];

  it('every token on the GM\'s map and floor, named as the log names them; a fight\'s first, each in map order', () => {
    const fight = [{ id: 'kes' }, { id: 'npc:2' }, { id: 'npc:6' }];
    expect(sendTargets(locations, { battleMapId: 5, floorIndex: 0 }, fight)).toEqual([
      { id: 2, name: 'POWDER BARREL', inFight: true },
      { id: 3, name: 'KES', inFight: true },
      { id: 1, name: 'GOBLIN A', inFight: false },
      { id: 4, name: 'ASH', inFight: false },
      { id: 9, name: 'GROUND', inFight: false },
    ]);
    expect(sendTargets(locations, { battleMapId: 5, floorIndex: 1 }).map((t) => t.id)).toEqual([5]);
    expect(sendTargets(locations, { battleMapId: null, floorIndex: null }, null)).toEqual([{ id: 7, name: 'STREET RAT', inFight: false }]);
    // A player's name in the fight counts for their own token only; an NPC's id only for that token.
    expect(sendTargets([{ id: 3, name: 'kes', shape: 'enemy_rhombus', owner: 'kes', battle_map_id: null }], { battleMapId: null, floorIndex: null }, [{ id: 'kes' }, { id: 'npc:4' }])[0].inFight).toBe(false);
    expect(sendTargets([{ id: 10, shape: 'enemy_rhombus' }], { battleMapId: null, floorIndex: null })[0].name).toBe('TOKEN');
  });
});

describe('its words and what it sends', () => {
  it('the head, and where it went', () => {
    expect(sendHeading(FIRE)).toBe('SEND FIREBALL (28 FIRE) TO');
    expect(sendHeading({ ...FIRE, what: 'Arcane Bolt', total: 12, types: [] })).toBe('SEND ARCANE BOLT (12, NO TYPE) TO');
    expect(sendHeading({ ...FIRE, total: 10, types: ['SLASHING', 'FIRE'] })).toBe('SEND FIREBALL (10 SLASHING + FIRE) TO');
    expect(sentWords(FIRE)).toBe('');
    expect(sentWords({ ...FIRE, sent: ['GOBLIN A', 'FIRE IMP'] })).toBe('SENT → GOBLIN A, FIRE IMP');
  });

  it('ticked FULL first, then unticked; sent in the picker\'s order', () => {
    let picks = withTicked({}, 4);
    expect(picks).toEqual({ 4: 'full' });
    picks = withTicked({ ...picks, 4: 'half' }, 2);
    expect(picks).toEqual({ 4: 'half', 2: 'full' });
    expect(withTicked(picks, 4)).toEqual({ 2: 'full' });
    const listed = [{ id: 4, name: 'A', inFight: true }, { id: 9, name: 'B', inFight: false }, { id: 2, name: 'C', inFight: false }];
    expect(picksToTargets(picks, listed)).toEqual([{ locationId: 4, half: true }, { locationId: 2, half: false }]);
    expect(picksToTargets({ 99: 'full' }, listed)).toEqual([]);
  });

  it('asked in pieces the server takes', () => {
    expect(MOST_AT_ONCE).toBe(30);
    const ids = Array.from({ length: 61 }, (_, i) => i + 1);
    expect(inChunks(ids).map((c) => c.length)).toEqual([30, 30, 1]);
    expect(inChunks([])).toEqual([]);
    expect(inChunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it('a line\'s kept roll, and where it went told on its lines alone', () => {
    expect(sendOf({ historyString: 'x', send: FIRE })).toBe(FIRE);
    for (const none of [{ historyString: 'x' }, { send: { rollId: 'x' } }, { send: null }, null, 'line']) expect(sendOf(none)).toBeNull();
    const lines = [{ historyString: 'a', send: FIRE }, { historyString: 'b' }, { historyString: 'c', send: { ...FIRE, rollId: 8 } }];
    const news = { ...FIRE, sent: ['GOBLIN A'] };
    expect(withSendNews(lines, news)).toEqual([{ historyString: 'a', send: news }, { historyString: 'b' }, lines[2]]);
  });
});
