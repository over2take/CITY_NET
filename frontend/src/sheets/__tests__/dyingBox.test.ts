import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { downOf, downWord, saveWords, boxOf, type DyingShown } from '../dyingBox';

/**
 * The sheet's DYING box as logic (8c3; approved mockup docs/mockups/rule-library.html, section 2): a token's state read, the
 * word, the save in words, and what the box shows for each way and state. The rule as the server shows it (dyingShown).
 */

const { dyingShown } = createRequire(import.meta.url)('../../../../backend/systemBuilder/dying.js');
const OWN = { format: 1, name: 'Ashfall', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'body', label: 'Body' }] }] };
const rule = (dying: Record<string, unknown>): DyingShown => dyingShown({ ...OWN, dying });
const DND = rule({ word: 'Dying', way: 'count', save: { dice: '1d20', target: '10' } });
const CPR = rule({ word: 'Mortally Wounded', way: 'once', save: { dice: '1d10', way: 'under', target: '@body' }, harder: 1 });
const CWN = rule({ word: 'Mortally Wounded', way: 'turns', turns: 6 });
const FULL = (more: Record<string, unknown> = {}) => JSON.stringify({ state: 'dying', saves: 0, fails: 0, made: 0, turns: 0, due: false, ...more });

describe('a token\'s state', () => {
  it('read in full, or as the word alone; nothing for anything else', () => {
    expect(downOf(FULL({ saves: 2, due: true }))).toEqual({ state: 'dying', saves: 2, fails: 0, made: 0, turns: 0, due: true, full: true });
    expect(downOf('{"state":"stable"}')).toEqual({ state: 'stable', full: false });
    expect(downOf(FULL({ saves: -1, fails: 'x' }))).toEqual({ state: 'dying', made: 0, turns: 0, full: true });
    // Due only when kept as due.
    expect(downOf(FULL({ due: 'yes' }))!.due).toBeUndefined();
    for (const bad of [null, undefined, '', '{', '[]', '{"state":"asleep"}', 'null']) expect(downOf(bad), String(bad)).toBeNull();
  });

  it('the word: the game\'s while dying, STABLE or DEAD after', () => {
    expect(downWord(CPR, { state: 'dying', full: false })).toBe('MORTALLY WOUNDED');
    expect(downWord(null, { state: 'dying', full: false })).toBe('DYING');
    expect(downWord(CPR, { state: 'stable', full: false })).toBe('STABLE');
    expect(downWord(CPR, { state: 'dead', full: false })).toBe('DEAD');
  });

  it('the save in words: AT LEAST or UNDER its target by name, harder by the saves made where one fail is death', () => {
    expect(saveWords(DND, { state: 'dying', full: true })).toBe('1d20 · 10 OR MORE');
    expect(saveWords(CPR, { state: 'dying', made: 2, full: true })).toBe('1d10 + 2 · UNDER BODY');
    expect(saveWords({ ...CPR, harder: -1 }, { state: 'dying', made: 3, full: true })).toBe('1d10 - 3 · UNDER BODY');
    expect(saveWords({ ...DND, harder: 4 }, { state: 'dying', made: 3, full: true })).toBe('1d20 · 10 OR MORE');
  });
});

describe('what the box shows', () => {
  it('SAVES COUNTED: the count of each, the save, lit on their turn', () => {
    const box = boxOf(DND, downOf(FULL({ saves: 1, fails: 2, due: true }))!, { gm: false });
    expect(box).toMatchObject({ word: 'DYING', state: 'dying', saves: { made: 1, of: 3 }, fails: { made: 2, of: 3 }, save: { words: '1d20 · 10 OR MORE', lit: true }, turnButton: false });
    expect(boxOf(DND, downOf(FULL())!, { gm: true }).save!.lit).toBe(false);
    expect(box.note).toBe('3 successes and they are stable; 3 failures and they are dead.');
  });

  it('ONE FAIL IS DEATH: the saves made and the save; TURNS LEFT: the turns, and the GM\'s A TURN GOES BY', () => {
    expect(boxOf(CPR, downOf(FULL({ made: 2 }))!, { gm: false })).toMatchObject({ madeIt: 2, save: { words: '1d10 + 2 · UNDER BODY' }, turnButton: false });
    const turns = boxOf(CWN, downOf(FULL({ turns: 4 }))!, { gm: true });
    expect(turns).toMatchObject({ word: 'MORTALLY WOUNDED', turnsLeft: { left: 2, of: 6 }, turnButton: true });
    expect(turns.save).toBeUndefined();
    expect(boxOf(CWN, downOf(FULL({ turns: 4 }))!, { gm: false }).turnButton).toBe(false);
    expect(boxOf(CWN, downOf(FULL({ turns: 9 }))!, { gm: true }).turnsLeft!.left).toBe(0);
  });

  it('NO ROLL, STABLE and DEAD: the word and what it means, nothing to press', () => {
    const none = boxOf(rule({ word: 'Taken Out', way: 'none' }), downOf(FULL())!, { gm: true });
    expect(none).toMatchObject({ word: 'TAKEN OUT', turnButton: false, note: 'The table decides what happens. Healing above 0 clears it.' });
    expect(none.save).toBeUndefined();
    expect(boxOf(DND, downOf(FULL({ state: 'stable' }))!, { gm: true })).toEqual({ word: 'STABLE', state: 'stable', turnButton: false, note: 'No more saves. Healing above 0 clears it.' });
    expect(boxOf(CWN, downOf(FULL({ state: 'dead' }))!, { gm: true })).toEqual({ word: 'DEAD', state: 'dead', turnButton: false, note: 'The GM heals them back if the table says so. Nothing on the sheet is lost.' });
  });
});
