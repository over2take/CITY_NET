import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { IMPROVE_DEFAULTS, improveSet, withImprove, improveGroups, improveRests, improveLine, improveNotes } from '../improveByUse';
import type { Definition } from '../systemsApi';

/**
 * IMPROVE BY USE on LEVELS, as logic (7f3a2): what is set, read and written; the groups and rests it can use; what it
 * does in a line, and what can't work yet, held to the server's checks (backend improveByUse.js).
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../../../../backend/systemBuilder/definition.js');

const DEF: Definition = {
  format: 1, name: 'Used', core: { health: { model: 'pool' }, advancement: ['use'] },
  stats: [
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }] },
    { id: 'ranked', label: 'RANKED', stats: [{ id: 'climb', label: 'Climb', rank: 'dots' }] },
    { id: 'empty', label: 'EMPTY', stats: [] },
  ],
  ranks: [{ id: 'dots', label: 'DOTS', list: [{ name: 'NONE', worth: '0' }, { name: 'ONE', worth: '1' }] }],
  rests: { short_rest: { on: false } },
};

describe('IMPROVE BY USE on LEVELS', () => {
  it('Call of Cthulhu\'s with nothing said; what was typed kept, empty or not', () => {
    expect(improveSet(DEF)).toEqual({ ...IMPROVE_DEFAULTS });
    expect(improveSet({ ...DEF, improve: { stats: 'skills', marked: 'hand', at: 'long_rest', roll: '', over: '10', gain: '1', most: 99 } }))
      .toEqual({ stats: 'skills', marked: 'hand', at: 'long_rest', roll: '', over: '10', gain: '1', most: 99 });
    expect(improveSet({ ...DEF, improve: { marked: 'often', at: '', most: 1.5, stats: 3 } })).toEqual({ ...IMPROVE_DEFAULTS });
    expect(improveSet({ ...DEF, improve: 'x' })).toEqual({ ...IMPROVE_DEFAULTS });
  });

  it('written as changed; every stat and no end take their setting away', () => {
    let d = withImprove(DEF, { stats: 'skills', most: 99, roll: '1d20' });
    expect(d.improve).toEqual({ stats: 'skills', most: 99, roll: '1d20' });
    d = withImprove(d, { stats: null, most: null, marked: 'any', at: 'long_rest', over: '@this', gain: '1' });
    expect(d.improve).toEqual({ roll: '1d20', marked: 'any', at: 'long_rest', over: '@this', gain: '1' });
    // A setting not named in the change is left as it is.
    expect(withImprove(d, { roll: undefined }).improve).toHaveProperty('roll', '1d20');
    expect(checkDefinition(d).problems).toEqual([]);
  });

  it('the groups it may improve, never one of ranks or none; the rests the game has on', () => {
    expect(improveGroups(DEF)).toEqual([{ id: 'skills', label: 'SKILLS' }]);
    expect(improveRests(DEF).map((r) => r.id)).toEqual(['long_rest', 'end_of_scene', 'end_of_session']);
  });

  it('what it does, in a line', () => {
    expect(improveLine(DEF)).toBe('At END OF SESSION, each marked stat rolls d100; over @this, it gains 1d10. The marks clear.');
    expect(improveLine(withImprove(DEF, { at: 'long_rest', most: 99 }))).toBe('At LONG REST, each marked stat rolls d100; over @this, it gains 1d10, up to 99. The marks clear.');
    expect(improveLine(withImprove(DEF, { at: 'gone' }))).toContain('At GONE,');
  });

  it('what can\'t work yet, each a problem the server has too', () => {
    const bad = withImprove(DEF, { stats: 'ranked', at: 'short_rest', roll: ' ', over: '', gain: '' });
    expect(improveNotes(bad)).toEqual([
      'No group of stats that can improve is called ranked: a stat held as a rank doesn\'t',
      'No rest is called short_rest. Pick one, or turn it on on RESTS',
      'ROLL: write dice or a formula',
      'IMPROVES IF OVER: write dice or a formula',
      'THEN ADD: write dice or a formula',
    ]);
    expect(checkDefinition(bad).problems.filter((p: { where: string }) => p.where.startsWith('improve')).length).toBe(5);
    const bare = { format: 1, name: 'Bare', core: { advancement: ['use'] }, improve: {} };
    expect(improveNotes(bare)).toEqual(['There are no stats to improve yet. Make them on STATS & RULES']);
    expect(improveNotes(withImprove(DEF, {}))).toEqual([]);
  });
});
