import { describe, it, expect } from 'vitest';
import { COST_STARTS, spendSet, groupChoices, listChoices, withBuyAdded, withBuy, withBuyOff, withWait, spendNotes } from '../spendXp';
import type { Definition } from '../systemsApi';
import { createRequire } from 'module';

/**
 * SPEND XP on the builder's LEVELS page, as logic (7f2b): the price list read and written, what each buy may raise or
 * buy from, and what the section says can't be bought yet, held to the server's checks (backend spendXp.js).
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../../../../backend/systemBuilder/definition.js');

const DEF: Definition = {
  format: 1, name: 'Spender', core: { health: { model: 'pool' }, advancement: ['spend'] },
  stats: [
    { id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'body', label: 'Body' }] },
    { id: 'empty', label: 'EMPTY', stats: [] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }] },
  ],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'mage', label: 'Mage' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'alert', label: 'Alert' }] },
  ],
};

describe('the price list', () => {
  it('reads as stored, those whole enough to show; none at all to start', () => {
    expect(spendSet(DEF)).toEqual({ buys: [], wait: false });
    const stored = { ...DEF, spend: { buys: [{ id: 'a', what: 'stat', cost: '1' }, { id: 'b', what: 'thing', cost: '1' }, { what: 'stat' }, 'x', { id: 'c', what: 'option' }], wait: true } };
    expect(spendSet(stored)).toEqual({ buys: [{ id: 'a', what: 'stat', cost: '1' }, { id: 'c', what: 'option', cost: '' }], wait: true });
    expect(spendSet({ ...DEF, spend: { buys: 'x', wait: 'yes' } })).toEqual({ buys: [], wait: false });
  });

  it('what RAISE A STAT can raise, and AN OPTION buy from: groups with stats, lists without levels', () => {
    expect(groupChoices(DEF)).toEqual([{ id: 'attrs', label: 'ATTRIBUTES' }, { id: 'skills', label: 'SKILLS' }]);
    expect(listChoices(DEF)).toEqual([{ id: 'feats', label: 'Feats' }]);
  });

  it('a buy added, each with an id of its own, starting in the first group or list, at a cost to start', () => {
    const one = withBuyAdded(DEF, 'stat');
    expect(one.spend).toEqual({ buys: [{ id: 'raise', what: 'stat', stats: 'attrs', cost: COST_STARTS.stat }] });
    const three = withBuyAdded(withBuyAdded(withBuyAdded(withBuyAdded(one, 'stat'), 'option'), 'option'), 'stat');
    expect(spendSet(three).buys.map((b) => [b.id, b.stats ?? b.list, b.cost])).toEqual([
      ['raise', 'attrs', '@new * 5'], ['raise_2', 'attrs', '@new * 5'], ['option', 'feats', '10'], ['option_2', 'feats', '10'], ['raise_3', 'attrs', '@new * 5'],
    ]);
    // Sound as the server reads it.
    expect(checkDefinition(three).problems).toEqual([]);
    // Nothing to raise or buy from yet: the buy says nothing of where.
    const bare = { format: 1, name: 'Bare', core: { advancement: ['spend'] } };
    expect(spendSet(withBuyAdded(withBuyAdded(bare, 'stat'), 'option')).buys).toEqual([
      { id: 'raise', what: 'stat', cost: '@new * 5' }, { id: 'option', what: 'option', cost: '10' },
    ]);
  });

  it('each changed: every stat, a group, UP TO and none, a list, a cost', () => {
    const d = withBuyAdded(withBuyAdded(DEF, 'stat'), 'option');
    expect(spendSet(withBuy(d, 0, { stats: null })).buys[0]).toEqual({ id: 'raise', what: 'stat', cost: '@new * 5' });
    expect(spendSet(withBuy(d, 0, { stats: null })).buys[0]).not.toHaveProperty('stats');
    expect(spendSet(withBuy(d, 0, { stats: 'skills', most: 5, cost: '@new * 2' })).buys[0]).toEqual({ id: 'raise', what: 'stat', stats: 'skills', cost: '@new * 2', most: 5 });
    expect(spendSet(withBuy(withBuy(d, 0, { most: 5 }), 0, { most: null })).buys[0]).not.toHaveProperty('most');
    expect(spendSet(withBuy(d, 1, { list: 'other', cost: '20' })).buys[1]).toEqual({ id: 'option', what: 'option', list: 'other', cost: '20' });
    // The other buy is left as it was.
    expect(spendSet(withBuy(d, 1, { cost: '20' })).buys[0]).toEqual(spendSet(d).buys[0]);
  });

  it('taken off; waiting on and off; nothing left, no price list at all', () => {
    const d = withBuyAdded(withBuyAdded(DEF, 'stat'), 'option');
    expect(spendSet(withBuyOff(d, 0)).buys.map((b) => b.id)).toEqual(['option']);
    expect(spendSet(withBuyOff(d, 1)).buys.map((b) => b.id)).toEqual(['raise']);
    expect(withWait(d, true).spend).toMatchObject({ wait: true });
    expect(withWait(withWait(d, true), false).spend).not.toHaveProperty('wait');
    expect(withBuyOff(withBuyOff(d, 0), 0)).not.toHaveProperty('spend');
    // Waiting, with nothing bought yet, is kept.
    expect(withWait(DEF, true).spend).toEqual({ buys: [], wait: true });
    expect(withWait(withWait(DEF, true), false)).not.toHaveProperty('spend');
  });
});

describe('what the section says', () => {
  it('a cost not written, a group or list not there, a levelled list, nothing to raise', () => {
    const d = { ...DEF, spend: { buys: [
      { id: 'a', what: 'stat', stats: 'attrs', cost: '1' },
      { id: 'b', what: 'stat', stats: 'gone', cost: ' ' },
      { id: 'c', what: 'option', cost: '1' },
      { id: 'd', what: 'option', list: 'gone', cost: '1' },
      { id: 'e', what: 'option', list: 'classes', cost: '1' },
      { id: 'f', what: 'stat', stats: 'empty', cost: '1' },
    ] } };
    expect(spendNotes(d)).toEqual([
      'RAISE A STAT 2: write what it costs, a number or a formula',
      'RAISE A STAT 2: no group of stats with stats in it is called gone',
      'AN OPTION 3: pick the list it buys from. Make one on CHOICES',
      'AN OPTION 4: pick the list it buys from. Make one on CHOICES',
      'AN OPTION 5: Classes goes up by LEVEL UP, never bought',
      'RAISE A STAT 6: no group of stats with stats in it is called empty',
    ]);
    expect(spendNotes({ format: 1, name: 'Bare', spend: { buys: [{ id: 'a', what: 'stat', cost: '1' }] } })).toEqual(['RAISE A STAT 1: there are no stats to raise. Make them on STATS & RULES']);
    expect(spendNotes({ ...DEF, spend: { buys: [{ id: 'a', what: 'stat', cost: '1' }] } })).toEqual([]);
  });

  it('each note the server has a problem for too', () => {
    const d = { ...DEF, spend: { buys: [{ id: 'b', what: 'stat', stats: 'gone', cost: ' ' }, { id: 'c', what: 'option', cost: '1' }, { id: 'e', what: 'option', list: 'classes', cost: '1' }] } };
    expect(checkDefinition(d).problems.filter((p: { where: string }) => p.where.startsWith('spend')).length).toBe(spendNotes(d).length);
  });
});
