import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  ownOf, standardOf, entriesOf, canAdd, draftProblem, withAdded, withRemoved, EMPTY_DRAFT,
} from '../tableConditions';
import { STANDARD, LIMITS } from '../conditions';
import type { GameCondition } from '../tokenConditions';

/**
 * The GAME tab's CONDITIONS panel as logic (4e2c2). Approved mockup builder-conditions, stage 3
 * (2026-10-09): a built-in game's own conditions beside the standard set, a name, icon and
 * description only. What it sends is held to the server's own checks (systemBuilder/tableConditions.js)
 * and read back through the server's own conditionsOf, so the two can't drift apart.
 */

const req = createRequire(import.meta.url);
const { conditionsOf } = req('../../../../backend/systemBuilder/conditions.js');
const { checkTableConditions } = req('../../../../backend/systemBuilder/tableConditions.js');

/** The game's list as the server would give it with `entries` as the table's own. */
const gameWith = (entries: Record<string, unknown>): GameCondition[] => conditionsOf({ conditions: entries });

const WIRED = { name: 'Wired', icon: 'bolt', description: 'Jacked in.' };
const FRAGGED = { name: 'Fragged', icon: `/uploads/condition_icons/${'a'.repeat(64)}.svg` };

describe('a built-in game\'s own conditions', () => {
  it('are everything in the game\'s list that isn\'t standard, in the order stored', () => {
    const list = gameWith({ wired: WIRED, fragged: FRAGGED });
    expect(standardOf(list).map((c) => c.id)).toEqual(STANDARD.map((s) => s.id));
    expect(ownOf(list).map((c) => c.id)).toEqual(['wired', 'fragged']);
  });

  it('go back to the server as they came, which its checks accept', () => {
    const own = ownOf(gameWith({ wired: WIRED, fragged: FRAGGED }));
    const entries = entriesOf(own);
    expect(entries).toEqual({ wired: WIRED, fragged: FRAGGED });
    expect(checkTableConditions(entries)).toEqual([]);
  });

  it('get a new one at the end, under an id from its name, trimmed, that the server takes', () => {
    const own = ownOf(gameWith({ wired: WIRED }));
    const entries = withAdded(own, { name: '  Hard Wired ', icon: 'signal', description: ' Chrome everywhere. ' });
    expect(Object.keys(entries)).toEqual(['wired', 'hard_wired']);
    expect(entries.hard_wired).toEqual({ name: 'Hard Wired', icon: 'signal', description: 'Chrome everywhere.' });
    expect(checkTableConditions(entries)).toEqual([]);
    expect(ownOf(gameWith(entries)).map((c) => c.name)).toEqual(['Wired', 'Hard Wired']);
  });

  it('never take a standard condition\'s id or another of their own, which the server would refuse', () => {
    const own = ownOf(gameWith({ wired: WIRED }));
    const blinded = withAdded(own, { ...EMPTY_DRAFT, name: 'Blinded' });
    expect(Object.keys(blinded)).toEqual(['wired', 'blinded_2']);
    expect(checkTableConditions(blinded)).toEqual([]);
    expect(Object.keys(withAdded(own, { ...EMPTY_DRAFT, name: 'Wired' }))).toEqual(['wired', 'wired_2']);
  });

  it('send no description when it is left blank', () => {
    const entries = withAdded([], { name: 'Marked', icon: 'target', description: '   ' });
    expect(entries).toEqual({ marked: { name: 'Marked', icon: 'target' } });
    expect(checkTableConditions(entries)).toEqual([]);
  });

  it('lose one when it is removed, and keep the rest in order', () => {
    const own = ownOf(gameWith({ wired: WIRED, fragged: FRAGGED, marked: { name: 'Marked', icon: 'target' } }));
    expect(Object.keys(withRemoved(own, 'fragged'))).toEqual(['wired', 'marked']);
    expect(withRemoved(own, 'nothing')).toEqual(entriesOf(own));
  });

  it('need a name before one is added', () => {
    expect(draftProblem(EMPTY_DRAFT)).toBe('Needs a name');
    expect(draftProblem({ ...EMPTY_DRAFT, name: '   ' })).toBe('Needs a name');
    expect(draftProblem({ ...EMPTY_DRAFT, name: 'Wired' })).toBeNull();
  });

  it('count the standard set against the limit of 60, as the server does', () => {
    const room = LIMITS.conditions - STANDARD.length;
    const full = Object.fromEntries(Array.from({ length: room }, (_, i) => [`own_${i}`, { name: `Own ${i}`, icon: 'target' }]));
    expect(checkTableConditions(full)).toEqual([]);
    expect(canAdd(ownOf(gameWith(full)))).toBe(false);
    const { own_0: _gone, ...oneShort } = full;
    expect(canAdd(ownOf(gameWith(oneShort)))).toBe(true);
    expect(checkTableConditions(withAdded(ownOf(gameWith(full)), { ...EMPTY_DRAFT, name: 'One more' }))).not.toEqual([]);
  });
});
