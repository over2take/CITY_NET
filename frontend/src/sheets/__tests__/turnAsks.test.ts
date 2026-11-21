import { describe, it, expect } from 'vitest';
import { npcAsksOn, waitingLine, beginOffered, asksOnToken, askHeading, askButton, type TurnAsk } from '../turnAsks';

// A condition's EACH TURN at the tracker (8a9c; approved mockup docs/mockups/condition-turn-effects.html).

const ask = (over: Partial<TurnAsk>): TurnAsk => ({
  id: 1, sceneKey: 'city:0', locationId: 7, player: null, who: 'GANGER (NPC)', named: 'POISONED SAVE',
  condition: { id: 'poisoned', name: 'Poisoned' }, says: 'POISONED SAVE, END OF ITS TURN: d20, 13 or more ends it', moment: 'turn_end',
  effect: { when: 'turn_end', does: 'roll_to_end', roll: 'd20', ends_on: 13, rolled_by: 'player' }, yours: 'End of your turn: d20, 13 or more ends it.', mine: false, ...over,
});

describe('npcAsksOn', () => {
  it('an NPC\'s own, in this scene: not a player\'s, not another token\'s, not another fight\'s', () => {
    const asks = [
      ask({ id: 1 }),
      ask({ id: 2, named: 'BURNING' }),
      ask({ id: 3, locationId: 8 }),
      ask({ id: 4, sceneKey: '5:0' }),
      ask({ id: 5, player: 'kes', who: 'KES', locationId: 7 }),
    ];
    expect(npcAsksOn(asks, 'npc:7', 'city:0').map((a) => a.id)).toEqual([1, 2]);
    expect(npcAsksOn(asks, 'npc:8', 'city:0').map((a) => a.id)).toEqual([3]);
    expect(npcAsksOn(asks, 'player:kes', 'city:0')).toEqual([]);
    expect(npcAsksOn(asks, 'npc:7', null)).toEqual([]);
  });
});

describe('waitingLine', () => {
  it('this scene\'s asks of players, each by whose and what; none, nothing', () => {
    const asks = [
      ask({ id: 1, player: 'kes', who: 'KES' }),
      ask({ id: 2 }),
      ask({ id: 3, player: 'vex', who: 'VEX', named: 'BURNING', sceneKey: '5:0' }),
      ask({ id: 4, player: 'jade', who: 'JADE', named: 'DOOMED' }),
    ];
    expect(waitingLine(asks, 'city:0')).toBe("WAITING ON KES'S POISONED SAVE, JADE'S DOOMED");
    expect(waitingLine(asks, '5:0')).toBe("WAITING ON VEX'S BURNING");
    expect(waitingLine([ask({})], 'city:0')).toBeNull();
    expect(waitingLine([], 'city:0')).toBeNull();
  });
});

describe('beginOffered', () => {
  it('only where the game acts on turns, not begun, and not while everyone must roll again', () => {
    expect(beginOffered({ turnEffects: true, begun: false })).toBe(true);
    expect(beginOffered({ turnEffects: true, begun: true })).toBe(false);
    expect(beginOffered({ turnEffects: false, begun: false })).toBe(false);
    expect(beginOffered({ turnEffects: true, begun: false, newRound: true })).toBe(false);
    // A server from before 8a9c, or no fight: NEXT as always.
    expect(beginOffered({ begun: false })).toBe(false);
    expect(beginOffered({ turnEffects: true })).toBe(false);
    expect(beginOffered(null)).toBe(false);
  });
});

describe('on the sheet (8a9c2)', () => {
  const save = { when: 'turn_end' as const, does: 'roll_to_end' as const, roll: 'd20', ends_on: 13, rolled_by: 'player' as const };
  const burn = { when: 'turn_start' as const, does: 'damage' as const, roll: '1d4', rolled_by: 'player' as const };
  it('this token\'s asks, in the order asked; no token, none', () => {
    const asks = [ask({ id: 1, locationId: 7 }), ask({ id: 2, locationId: 8 }), ask({ id: 3, locationId: 7 })];
    expect(asksOnToken(asks, 7).map((a) => a.id)).toEqual([1, 3]);
    expect(asksOnToken(asks, 9)).toEqual([]);
    expect(asksOnToken(asks, null)).toEqual([]);
    expect(asksOnToken(asks, undefined)).toEqual([]);
  });
  it('YOUR SAVE for the one asked, KES\'S on a player\'s sheet as the GM sees it; a roll that isn\'t a save, ROLL', () => {
    expect(askHeading(ask({ effect: save, mine: true }))).toBe('POISONED · YOUR SAVE');
    expect(askHeading(ask({ effect: save, mine: false, who: 'KES' }))).toBe("POISONED · KES'S SAVE");
    expect(askHeading(ask({ effect: burn, mine: true, condition: { id: 'burning', name: 'Burning' } }))).toBe('BURNING · YOUR ROLL');
    expect(askButton(ask({ effect: save }))).toBe('ROLL SAVE');
    expect(askButton(ask({ effect: burn }))).toBe('ROLL');
  });
});
