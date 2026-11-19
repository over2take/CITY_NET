import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  parseOnToken, shownConditions, withPutOn, withTakenOff, notOnYet, modifierText, roundsText, mapIcons, MAP_ICONS, chipsThatFit, type GameCondition,
} from '../tokenConditions';

/**
 * A token's conditions in the windows, as logic (4e2b1). Approved mockup builder-conditions
 * (2026-10-09): any number on a token, drawn from the running game's list; the rounds left and
 * modifiers only where the server sent them; a change never resetting another condition's rounds.
 */

const { conditionsOf } = createRequire(import.meta.url)('../../../../backend/systemBuilder/conditions.js');
const { parseTokenConditions } = createRequire(import.meta.url)('../../../../backend/tokens/conditions.js');

const GAME: GameCondition[] = conditionsOf({
  conditions: {
    poisoned: { ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }] },
    glitching: { name: 'Glitching', icon: 'signal', modifiers: [{ target: 'dex_mod', amount: -2 }] },
    blinded: { on: false },
  },
});

describe('reading a token\'s conditions', () => {
  it('reads the column as the server does, whatever it holds', () => {
    for (const raw of ['[{"id":"prone"},{"id":"poisoned","left":2}]', '[{"id":"prone","left":0},{"id":"x","left":1.5}]', 'broken', '', null, '{}', '[1,{"left":2}]']) {
      expect(parseOnToken(raw), String(raw)).toEqual(parseTokenConditions(raw));
    }
  });
});

describe('what is drawn', () => {
  it('is each condition on the token the game has, in the token\'s order, with its rounds where known', () => {
    const shown = shownConditions([{ id: 'prone' }, { id: 'poisoned', left: 2 }], GAME);
    expect(shown.map((s) => [s.condition.id, s.left, s.modifiers])).toEqual([['prone', undefined, []], ['poisoned', 2, []]]);
  });

  it('takes rounds left and modifiers from the server\'s answer where this viewer was sent them', () => {
    const shown = shownConditions([{ id: 'poisoned' }, { id: 'glitching' }], GAME, [
      { id: 'poisoned', left: 1, modifiers: [{ target: 'all_rolls', amount: -1 }] },
      { id: 'glitching', modifiers: [{ target: 'dex_mod', amount: -2 }] },
    ]);
    expect(shown.map((s) => [s.condition.id, s.left, s.modifiers])).toEqual([
      ['poisoned', 1, [{ target: 'all_rolls', amount: -1 }]],
      ['glitching', undefined, [{ target: 'dex_mod', amount: -2 }]],
    ]);
  });

  it('leaves out one the game no longer has', () => {
    expect(shownConditions([{ id: 'blinded' }, { id: 'hungry' }, { id: 'prone' }], GAME).map((s) => s.condition.id)).toEqual(['prone']);
  });
});

describe('changing them', () => {
  const on = [{ id: 'prone' }, { id: 'poisoned' }];
  const detail = [{ id: 'prone' }, { id: 'poisoned', left: 2 }];

  it('puts one on at the end, every other keeping the rounds it has left', () => {
    expect(withPutOn(on, detail, 'glitching')).toEqual([{ id: 'prone' }, { id: 'poisoned', left: 2 }, { id: 'glitching' }]);
    // The GM's token list already carries the rounds: no answer needed.
    expect(withPutOn([{ id: 'poisoned', left: 2 }], null, 'prone')).toEqual([{ id: 'poisoned', left: 2 }, { id: 'prone' }]);
    // Putting on one already there starts it afresh.
    expect(withPutOn(on, detail, 'poisoned')).toEqual([{ id: 'prone' }, { id: 'poisoned' }]);
  });

  it('takes one off, the rest keeping theirs', () => {
    expect(withTakenOff(on, detail, 'prone')).toEqual([{ id: 'poisoned', left: 2 }]);
    expect(withTakenOff(on, detail, 'stunned')).toEqual(detail);
  });

  it('offers the game\'s conditions not on the token yet', () => {
    expect(notOnYet(on, GAME).map((c) => c.id)).toEqual(GAME.map((c) => c.id).filter((id) => id !== 'prone' && id !== 'poisoned'));
  });
});

describe('on the map', () => {
  const shown = (ids: string[]) => shownConditions(ids.map((id) => ({ id })), conditionsOf(null));

  it('draws the first four icons, and counts and names the rest', () => {
    expect(MAP_ICONS).toBe(4);
    const six = mapIcons(shown(['blinded', 'bleeding', 'poisoned', 'prone', 'stunned', 'grappled']));
    expect(six.icons.map((c) => c.id)).toEqual(['blinded', 'bleeding', 'poisoned', 'prone']);
    expect([six.more, six.moreNames]).toEqual([2, ['Stunned', 'Grappled']]);
  });

  it('has no +N up to four, and nothing at all for none', () => {
    expect(mapIcons(shown(['prone', 'stunned', 'grappled', 'bleeding']))).toMatchObject({ more: 0, moreNames: [] });
    expect(mapIcons([])).toEqual({ icons: [], more: 0, moreNames: [] });
  });
});

describe('what it says', () => {
  it('says a modifier and the rounds left as the HEALTH folder does', () => {
    expect(modifierText({ target: 'all_rolls', amount: -1 })).toBe('ALL ROLLS −1');
    expect(modifierText({ target: 'dex_mod', amount: 2 })).toBe('DEX MOD +2');
    expect(roundsText(1)).toBe('1 ROUND LEFT');
    expect(roundsText(3)).toBe('3 ROUNDS LEFT');
  });
});

describe('chipsThatFit (8a6c): the sheet\'s chips in two lines at most, then "+N"', () => {
  const plus = () => 20;
  it('all where they take two lines or fewer', () => {
    expect(chipsThatFit([], 200, 5, plus)).toBe(0);
    expect(chipsThatFit([60, 60, 60], 200, 5, plus)).toBe(3);
    // Three to a line exactly (60 + 5 + 60 + 5 + 60 = 190), six in two.
    expect(chipsThatFit([60, 60, 60, 60, 60, 60], 200, 5, plus)).toBe(6);
    expect(chipsThatFit([60, 60, 60, 60, 60, 60], 190, 5, plus)).toBe(6);
  });
  it('past two lines: as many as fit with "+N" in the last place', () => {
    // Seven: five, and "+2" (20 wide) beside them on the second line.
    expect(chipsThatFit([60, 60, 60, 60, 60, 60, 60], 200, 5, plus)).toBe(5);
    // "+N" as wide as a chip: still five (60 + 5 + 60 + 5 + 60 on the second line).
    expect(chipsThatFit([60, 60, 60, 60, 60, 60, 60], 200, 5, () => 60)).toBe(5);
    // Too wide for the last place beside them: four.
    expect(chipsThatFit([60, 60, 60, 60, 60, 60, 60], 200, 5, () => 75)).toBe(4);
    // "+N" exactly filling the line: it fits (60 + 5 + 60 + 5 + 60 = 190).
    expect(chipsThatFit([60, 60, 60, 60, 60, 60, 60], 190, 5, () => 60)).toBe(5);
    // "+N" as wide as what it says: "+2" too wide beside five, "+3" beside four.
    expect(chipsThatFit([60, 60, 60, 60, 60, 60, 60], 200, 5, (n) => (n >= 2 ? 80 : 20))).toBe(4);
  });
  it('a new line when the next one won\'t fit, the gap counted', () => {
    // 100 + 5 + 100 = 205 doesn't fit 200: one to a line, so three take three lines; two, "+1" beside the second.
    expect(chipsThatFit([100, 100, 100], 200, 5, plus)).toBe(2);
    expect(chipsThatFit([100, 100, 100], 205, 5, plus)).toBe(3);
  });
  it('a chip wider than the row has a line to itself; none at all where even "+N" alone won\'t do', () => {
    expect(chipsThatFit([300, 300], 200, 5, plus)).toBe(2);
    expect(chipsThatFit([300, 300, 300], 200, 5, plus)).toBe(1);
    expect(chipsThatFit([300, 300, 300], 200, 5, plus, 1)).toBe(0);
  });
  it('as many lines as asked', () => {
    expect(chipsThatFit([60, 60, 60, 60], 200, 5, plus, 1)).toBe(2);
    expect(chipsThatFit([60, 60, 60, 60, 60, 60, 60], 200, 5, plus, 3)).toBe(7);
  });
});
