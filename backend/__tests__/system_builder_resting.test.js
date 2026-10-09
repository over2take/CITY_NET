import { describe, it, expect } from 'vitest';

const { restOn, restOrder } = require('../systemBuilder/resting');
const { restsOf } = require('../systemBuilder/rests');
const { checkDefinition } = require('../systemBuilder/definition');

/**
 * What one rest does to one character (4f2a). Approved mockup builder-rests (2026-10-09): the rests
 * it counts as first, then its own refills in order; health back through the system's own model;
 * sheet numbers held between 0 and their maximum; amounts read from the character as they stand;
 * dice left pending in a preview; the conditions that end at any of those rests taken off.
 */

const SHEET = {
  sections: [
    { id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'level', label: 'Level', type: 'number' }] },
    { id: 'body', label: 'BODY', layout: 'grid', fields: [
      { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
      { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
      { id: 'fatigue', label: 'Fatigue', type: 'number' },
      { id: 'luck', label: 'Luck', type: 'number', maxField: 'luck_max' },
      { id: 'luck_max', label: 'Luck max', type: 'number' },
    ] },
    { id: 'magic', label: 'MAGIC', layout: 'grid', fields: [
      { id: 'slots', label: 'Spell slots', type: 'number', maxField: 'slots_max' },
      { id: 'slots_max', label: 'Slots max', type: 'number' },
      { id: 'focus', label: 'Focus', type: 'number', maxField: 'focus_max' },
      { id: 'focus_max', label: 'Focus max', type: 'number' },
    ] },
  ],
};
const HEARTH = {
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  sheet: SHEET,
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
    long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }, { what: 'fatigue', how: 'by', amount: '-1' }, { what: 'section:magic', how: 'max' }] },
    end_of_session: { refills: [{ what: 'luck', how: 'max' }] },
    downtime: { name: 'Downtime', counts_as: ['long_rest'], refills: [{ what: 'fatigue', how: 'to', amount: '0' }] },
  },
  conditions: {
    exhausted: { ends: 'rest', at: ['long_rest'] },
    frightened: { ends: 'rest', at: ['end_of_scene'] },
    bleeding: { ends: 'rest', at: ['short_rest'] },
  },
};
const VEX = { level: 3, con_mod: 2, fatigue: 3, luck: 1, luck_max: 3, slots: 0, slots_max: 4, focus: 1, focus_max: 2 };
const TOKEN = { current: 9, max: 22, temp: 0 };
/** Every die shows `face` (1-based) on a die of `sides`: rng answers just above (face - 1) / sides. */
const showing = (face, sides) => () => (face - 1) / sides + 1e-9;

const rest = (restId, over = {}, def = HEARTH) => restOn({ definition: def, restId, sheet: VEX, token: TOKEN, conditions: [], ...over });
const with_ = (rests, extra = {}) => ({ ...HEARTH, rests, ...extra });

describe('the fixture', () => {
  it('is a system that publishes', () => {
    expect(checkDefinition(HEARTH)).toEqual({ problems: [] });
  });
});

describe('the order a rest runs in', () => {
  it('is each rest it counts as, theirs first, then its own, each once', () => {
    const rests = restsOf(HEARTH);
    expect(restOrder(rests, 'downtime')).toEqual(['short_rest', 'long_rest', 'downtime']);
    expect(restOrder(rests, 'long_rest')).toEqual(['short_rest', 'long_rest']);
    expect(restOrder(rests, 'end_of_scene')).toEqual(['end_of_scene']);
    const diamond = restsOf({ rests: { long_rest: { counts_as: ['short_rest'] }, end_of_session: { counts_as: ['long_rest', 'short_rest'] } } });
    expect(restOrder(diamond, 'end_of_session')).toEqual(['short_rest', 'long_rest', 'end_of_session']);
  });

  it('never comes back round a loop, though one can\'t be published', () => {
    const looped = [{ id: 'a', counts_as: ['b'] }, { id: 'b', counts_as: ['a'] }];
    expect(restOrder(looped, 'a')).toEqual(['b', 'a']);
    expect(restOrder(looped, 'nope')).toEqual([]);
  });

  it('refuses a rest the system hasn\'t got, or has turned off', () => {
    expect(rest('nap')).toEqual({ ok: false, error: 'Not one of this system\'s rests' });
    expect(rest('end_of_scene', {}, with_({ end_of_scene: { on: false } }))).toEqual({ ok: false, error: 'Not one of this system\'s rests' });
  });
});

describe('a long rest, as the mockup shows it', () => {
  it('previews health to full over the short rest\'s dice, fatigue down, the magic section filled, and what wears off', () => {
    const r = rest('long_rest', { conditions: [{ id: 'exhausted' }, { id: 'poisoned', left: 2 }, { id: 'bleeding' }, { id: 'frightened' }] });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([
      { what: 'health', label: 'HP', from: 9, to: 22 },
      { what: 'fatigue', label: 'Fatigue', from: 3, to: 2 },
      { what: 'slots', label: 'Spell slots', from: 0, to: 4 },
      { what: 'focus', label: 'Focus', from: 1, to: 2 },
    ]);
    expect(r.token).toEqual({ current: 22, max: 22, temp: 0 });
    expect(r.sheetPatch).toEqual({ fatigue: 2, slots: 4, focus: 2 });
    // Ending at the short rest it counts as counts too; a condition ending at another rest stays.
    expect(r.gone).toEqual(['exhausted', 'bleeding']);
    expect(r.conditions).toEqual([{ id: 'poisoned', left: 2 }, { id: 'frightened' }]);
  });

  it('leaves out what doesn\'t move, and what is already full', () => {
    const r = rest('long_rest', { sheet: { ...VEX, fatigue: 0, slots: 4 }, token: { current: 22, max: 22 } });
    expect(r.changes).toEqual([{ what: 'focus', label: 'Focus', from: 1, to: 2 }]);
    expect(r.sheetPatch).toEqual({ fatigue: 0, slots: 4, focus: 2 });
  });
});

describe('dice', () => {
  it('are left pending in a preview, with every amount still to come', () => {
    const r = rest('short_rest');
    expect(r.changes).toEqual([{ what: 'health', label: 'HP', from: 9, to: null, pending: ['1d8 + @con_mod'] }]);
    expect(r.token).toEqual(TOKEN);
    const chained = rest('end_of_session', {}, with_({ end_of_session: { refills: [{ what: 'fatigue', how: 'by', amount: '1d4' }, { what: 'fatigue', how: 'by', amount: '-1' }] } }));
    expect(chained.changes).toEqual([{ what: 'fatigue', label: 'Fatigue', from: 3, to: null, pending: ['1d4', '-1'] }]);
  });

  it('are settled by a later refill to a set value, after which amounts apply as usual', () => {
    const r = rest('end_of_session', {}, with_({ end_of_session: { refills: [{ what: 'fatigue', how: 'by', amount: '1d4' }, { what: 'fatigue', how: 'to', amount: '1' }] } }));
    expect(r.changes).toEqual([{ what: 'fatigue', label: 'Fatigue', from: 3, to: 1 }]);
    const after = rest('end_of_session', {}, with_({ end_of_session: { refills: [{ what: 'fatigue', how: 'by', amount: '1d4' }, { what: 'fatigue', how: 'to', amount: '2' }, { what: 'fatigue', how: 'by', amount: '-1' }] } }));
    expect(after.changes).toEqual([{ what: 'fatigue', label: 'Fatigue', from: 3, to: 1 }]);
  });

  it('are rolled when the rest is called, each kept, and healing stops at the maximum', () => {
    const r = rest('short_rest', { rng: showing(5, 8) });
    expect(r.changes).toEqual([{ what: 'health', label: 'HP', from: 9, to: 16 }]);
    expect(r.rolls).toEqual([{ amount: '1d8 + @con_mod', value: 7, dice: [{ count: 1, sides: 8, rolls: [5] }] }]);
    expect(rest('short_rest', { rng: showing(8, 8), token: { current: 20, max: 22 } }).token.current).toBe(22);
  });
});

describe('sheet numbers', () => {
  const one = (refills, sheet = VEX) => rest('end_of_session', { sheet }, with_({ end_of_session: { refills } }));

  it('stay between 0 and their maximum', () => {
    expect(one([{ what: 'fatigue', how: 'by', amount: '-5' }]).sheetPatch).toEqual({ fatigue: 0 });
    expect(one([{ what: 'luck', how: 'by', amount: '9' }]).sheetPatch).toEqual({ luck: 3 });
    expect(one([{ what: 'luck', how: 'to', amount: '9' }]).sheetPatch).toEqual({ luck: 3 });
    expect(one([{ what: 'luck', how: 'to', amount: '-2' }]).sheetPatch).toEqual({ luck: 0 });
    expect(one([{ what: 'fatigue', how: 'by', amount: '40' }]).sheetPatch).toEqual({ fatigue: 43 });
    expect(one([{ what: 'luck', how: 'max' }], { ...VEX, luck_max: -2 }).sheetPatch).toEqual({ luck: 0 });
  });

  it('report one change per value, from where it started', () => {
    expect(one([{ what: 'fatigue', how: 'by', amount: '-1' }, { what: 'fatigue', how: 'by', amount: '-1' }]).changes).toEqual([{ what: 'fatigue', label: 'Fatigue', from: 3, to: 1 }]);
  });

  it('read the character as it stands when the refill is reached, token-linked fields from the token', () => {
    expect(one([{ what: 'luck', how: 'max' }, { what: 'fatigue', how: 'to', amount: '@luck + @level' }]).sheetPatch).toEqual({ luck: 3, fatigue: 6 });
    expect(one([{ what: 'fatigue', how: 'to', amount: '@hp_max - @hp' }]).sheetPatch).toEqual({ fatigue: 13 });
    expect(one([{ what: 'fatigue', how: 'to', amount: '@con_mod' }], { ...VEX, con_mod: undefined }).sheetPatch).toEqual({ fatigue: 0 });
  });

  it('change with no token on the map; health then has nothing to refill', () => {
    const r = rest('long_rest', { token: null });
    expect(r.token).toBeNull();
    expect(r.changes.map((c) => c.what)).toEqual(['fatigue', 'slots', 'focus']);
  });

  it('take a whole section to the maximums of the numbers that have one', () => {
    expect(one([{ what: 'section:body', how: 'max' }]).sheetPatch).toEqual({ luck: 3 });
  });
});

describe('health under each model', () => {
  const model = (health, refills, over = {}) => rest('end_of_session', over, { name: 'M', core: { health }, rests: { end_of_session: { refills } } });

  it('fills a pool, keeping temp, and names the system\'s own word for it', () => {
    const r = model({ model: 'pool' }, [{ what: 'health', how: 'full' }], { token: { current: 2, max: 10, temp: 3 }, sheet: {} });
    expect(r.token).toEqual({ current: 10, max: 10, temp: 3 });
    expect(r.changes).toEqual([{ what: 'health', label: 'HP', from: 2, to: 10 }]);
    const worded = rest('end_of_session', { token: { current: 2, max: 10 }, sheet: {} }, { name: 'W', words: { hp: { singular: 'VIGOR', short: 'VG' } }, rests: { end_of_session: { refills: [{ what: 'health', how: 'full' }] } } });
    expect(worded.changes[0].label).toBe('VG');
    const labeled = model({ model: 'pool', label: 'GRIT' }, [{ what: 'health', how: 'full' }], { token: { current: 2, max: 10 }, sheet: {} });
    expect(labeled.changes[0].label).toBe('GRIT');
  });

  const TRACKS = { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }] };
  it('clears both tracks to full, and heals the one a refill names', () => {
    const full = model(TRACKS, [{ what: 'health', how: 'full' }], { token: { current: 4, max: 10 }, sheet: { stun: 5, stun_max: 9 } });
    expect(full.token.current).toBe(10);
    expect(full.sheetPatch).toEqual({ stun: 0 });
    expect(full.changes).toEqual([{ what: 'health', label: 'HP', from: 4, to: 10 }, { what: 'health:stun', label: 'STUN', from: 5, to: 0 }]);
    const stun = model(TRACKS, [{ what: 'health', how: 'by', amount: '3', track: 'stun' }], { token: { current: 4, max: 10 }, sheet: { stun: 5, stun_max: 9 } });
    expect(stun.token.current).toBe(4);
    expect(stun.changes).toEqual([{ what: 'health:stun', label: 'STUN', from: 5, to: 2 }]);
    const first = model(TRACKS, [{ what: 'health', how: 'by', amount: '3' }], { token: { current: 4, max: 10 }, sheet: { stun: 5, stun_max: 9 } });
    expect(first.changes).toEqual([{ what: 'health', label: 'HP', from: 4, to: 7 }]);
  });

  it('clears every mark of a damage-typed track', () => {
    const typed = { model: 'typed', types: [{ id: 'superficial', label: 'S' }, { id: 'aggravated', label: 'A' }] };
    const r = model(typed, [{ what: 'health', how: 'full' }], { token: { current: 2, max: 7 }, sheet: { superficial: 3, aggravated: 2 } });
    expect(r.sheetPatch).toEqual({ superficial: 0, aggravated: 0 });
    expect(r.token.current).toBe(7);
    const healed = model(typed, [{ what: 'health', how: 'by', amount: '2' }], { token: { current: 2, max: 7 }, sheet: { superficial: 3, aggravated: 2 } });
    expect(healed.sheetPatch).toEqual({ superficial: 1, aggravated: 2 });
  });

  it('clears every harm slot, its count the token\'s', () => {
    const harm = { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER', slots: 2 }, { id: 'severe', label: 'SEVERE', slots: 1 }] };
    // The token's own max is stale here: the slots set it.
    const r = model(harm, [{ what: 'health', how: 'full' }], { token: { current: 0, max: 5 }, sheet: { lesser_1: 'Cut', lesser_2: '', severe_1: 'Broken arm' } });
    expect(r.sheetPatch).toEqual({ lesser_1: '', severe_1: '' });
    expect(r.token).toEqual({ current: 3, max: 3, temp: 0 });
  });

  it('gives back every wound, to the system\'s count where the token sets none', () => {
    expect(model({ model: 'wounds', count: 3 }, [{ what: 'health', how: 'full' }], { token: { current: 1, max: 4 }, sheet: {} }).token.current).toBe(4);
    expect(model({ model: 'wounds', count: 3 }, [{ what: 'health', how: 'full' }], { token: { current: 0, max: 0 }, sheet: {} }).token).toEqual({ current: 3, max: 3, temp: 0 });
    expect(model({ model: 'wounds', count: 3 }, [{ what: 'health', how: 'by', amount: '1' }], { token: { current: 1, max: 3 }, sheet: {} }).token.current).toBe(2);
  });

  it('fills the pool of hit locations and leaves their notes', () => {
    const r = model({ model: 'locations', locations: [{ id: 'head', label: 'HEAD' }] }, [{ what: 'health', how: 'full' }], { token: { current: 1, max: 8 }, sheet: { head: 'Concussed' } });
    expect(r.token.current).toBe(8);
    expect(r.sheetPatch).toEqual({});
  });

  it('heals nothing for an amount of 0 or less', () => {
    expect(model({ model: 'pool' }, [{ what: 'health', how: 'by', amount: '@con_mod - 5' }], { token: { current: 2, max: 10 }, sheet: { con_mod: 1 } }).changes).toEqual([]);
  });

  it('has nothing to refill with token health off', () => {
    const off = rest('end_of_session', { token: { current: 2, max: 10 }, sheet: {} }, { name: 'Off', parts: { token_health: { on: false } }, rests: { end_of_session: { refills: [{ what: 'health', how: 'full' }] } } });
    expect(off.ok).toBe(true);
    expect(off.token).toEqual({ current: 2, max: 10, temp: 0 });
    expect(off.changes).toEqual([]);
  });
});
