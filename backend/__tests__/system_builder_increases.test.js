import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * Ability increases at the table, the server's half (7d6b1; approved mockup docs/mockups/level-up.html, 2026-11-07):
 * an INCREASE a new level unlocks is spent with FINISH, checked (every point, the most on one, its stats, where they
 * stop), kept per feature under INCREASES_KEY, worked out onto the stats as a modifier is, named on the stat's badge,
 * and taken off by LEVEL_DOWN. The window's folder is 7d6b2's.
 */

const require_ = createRequire(import.meta.url);
const { PICKS_KEY, INCREASES_KEY, increaseOf, spentOf, effectiveData, workedOf, choicesShown, heldOf } = require_('../systemBuilder/choices');
const { checkDefinition } = require_('../systemBuilder/definition');
const { pickAction } = require_('../systemBuilder/picking');
const { LEVELING_KEY, levelAction } = require_('../systemBuilder/levelUp');
const { XP_KEY } = require_('../systemBuilder/levels');

const RAISED = {
  format: 1, name: 'Raised', core: { advancement: ['levels'] }, levels: { top: 6, first: 100, ranges: [{ to: 6, x: 2 }] },
  stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }] },
  ],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'grit', label: 'Grit', at: 1, modifiers: [{ target: 'might', amount: '1' }] },
        { id: 'drill', label: 'Drill', at: 2, text: 'Practice, at no cost.' },
        { id: 'asi', label: 'Ability Score Improvement', at: 2, increase: { points: 2, stats: 'abilities', cap: 20 } },
      ] },
      { id: 'mage', label: 'Mage', features: [{ id: 'spark', label: 'Spark', at: 1, increase: { points: 1 } }] },
    ] },
    { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [
      { id: 'everyone', label: 'Everyone', features: [{ id: 'boost', label: 'Boost', at: 3, increase: { points: 2, most: 1 } }] },
    ] },
  ],
};
const holding = (...picks) => ({ [PICKS_KEY]: { classes: picks.map(([option, level]) => ({ option, level })) } });
const sheet = (more = {}) => ({ [XP_KEY]: 9e9, might: 14, wits: 18, lore: 3, ...holding(['soldier', 1]), ...more });
const up = (data, action = {}, opts = {}) => levelAction(RAISED, data, { kind: 'up', list: 'classes', option: 'soldier', ...action }, opts);
const feature = (option, id) => RAISED.choices.flatMap((c) => c.options).find((o) => o.id === option).features.find((f) => f.id === id);

describe('an increase as it reads', () => {
  it('its points, the most on one, the stats it may raise and where they stop', () => {
    expect(increaseOf(RAISED, feature('soldier', 'asi'))).toEqual({ points: 2, most: 2, stats: ['might', 'wits'], cap: 20, instead: null });
    expect(increaseOf(RAISED, feature('mage', 'spark'))).toEqual({ points: 1, most: 1, stats: ['might', 'wits', 'lore'], cap: null, instead: null });
    expect(increaseOf(RAISED, { increase: { points: 2, most: 5 } }).most).toBe(2);
    expect(increaseOf(RAISED, { increase: { points: 4, most: 0 } }).most).toBe(4);
    expect(increaseOf(RAISED, { increase: { points: 2, stats: 'gone' } }).stats).toEqual([]);
    expect(increaseOf(RAISED, { increase: { points: 2, cap: 7.5 } }).cap).toBeNull();
    // Only a stat with an id is one it raises.
    expect(increaseOf({ stats: [{ id: 'g', stats: [{ id: 'might' }, 'junk', { label: 'No id' }, null] }] }, { increase: { points: 1 } }).stats).toEqual(['might']);
    for (const f of [feature('soldier', 'grit'), { increase: { points: 0 } }, { increase: { points: '2' } }, { increase: 2 }, null]) expect(increaseOf(RAISED, f)).toBeNull();
  });

  it('a spread counts while it holds: its stats, whole from 1, within its most and its points', () => {
    const inc = increaseOf(RAISED, { increase: { points: 3, most: 2, stats: 'abilities' } });
    expect(spentOf(inc, { might: 2, wits: 1 })).toEqual({ might: 2, wits: 1 });
    // Fewer than its points still counts, as the GM may have raised them since.
    expect(spentOf(inc, { wits: 1 })).toEqual({ wits: 1 });
    for (const spread of [{ lore: 1 }, { might: 3 }, { might: 2, wits: 2 }, { might: 1.5 }, { might: 0 }, { might: -1 }, { might: 2, wits: -1 }, {}, [1], null]) {
      expect(spentOf(inc, spread), JSON.stringify(spread)).toBeNull();
    }
    expect(spentOf(null, { might: 1 })).toBeNull();
  });
});

describe('spent going up', () => {
  it('not spent, FINISH waits; spent, it is kept and the place goes', () => {
    expect(up(sheet()).error).toBe('Spend Ability Score Improvement\'s points first');
    const done = up({ ...sheet(), [LEVELING_KEY]: { list: 'classes', option: 'soldier' } }, { increases: { asi: { might: 1, wits: 1 } } });
    expect(done.ok).toBe(true);
    expect(done.data[INCREASES_KEY]).toEqual({ asi: { might: 1, wits: 1 } });
    expect(done.data).not.toHaveProperty(LEVELING_KEY);
  });

  it('worked out onto the stats with the modifiers, and named on the badge', () => {
    const data = up(sheet(), { increases: { asi: { might: 2 } } }).data;
    expect(effectiveData(RAISED, data).might).toBe(14 + 1 + 2);
    expect(workedOf(RAISED, data).from.might).toEqual([{ feature: 'Grit', amount: 1 }, { feature: 'Ability Score Improvement', amount: 2 }]);
    // The stat itself is never written.
    expect(data.might).toBe(14);
  });

  it('says what is wrong with a spread', () => {
    const said = (spread, more = {}) => up(sheet(more), { increases: { asi: spread } }).error;
    expect(said({ lore: 2 })).toBe('Ability Score Improvement doesn\'t raise Lore');
    expect(said({ might: 3 })).toBe('Ability Score Improvement: at most 2 on one stat');
    expect(said({ might: 1 })).toBe('Ability Score Improvement: spend all 2 points');
    expect(said({ might: 2, wits: 1 })).toBe('Ability Score Improvement: spend all 2 points');
    // Where they stop counts what else is on the stat: Might 18 with Grit's +1 is 19.
    expect(said({ might: 2 }, { might: 18 })).toBe('Ability Score Improvement: Might stops at 20');
    expect(said({ might: 1, wits: 1 }, { might: 18 })).toBeUndefined();
    expect(said({ wits: 2 })).toBeUndefined();
    expect(said({ wits: 2 }, { wits: 19 })).toBe('Ability Score Improvement: Wits stops at 20');
    expect(said({ wits: 2 }, { wits: 'x' })).toBeUndefined();
    // Points that aren't whole aren't points.
    expect(said({ might: 1, wits: 1.5 })).toBe('Ability Score Improvement: spend all 2 points');
    expect(said('two')).toBe('Spend Ability Score Improvement\'s points first');
  });

  it('one point is said as one', () => {
    const two = up(sheet(), { increases: { asi: { wits: 2 } } }).data;
    expect(levelAction(RAISED, two, { kind: 'up', list: 'classes', option: 'mage', increases: { spark: { might: 1, lore: 1 }, boost: { might: 1, wits: 1 } } }).error).toBe('Spark: spend all 1 point');
  });

  it('the GM may go up without spending it', () => {
    const done = up(sheet(), {}, { gm: true });
    expect(done.ok).toBe(true);
    expect(done.data).not.toHaveProperty(INCREASES_KEY);
  });

  it('only what this level unlocks: one spent before is never asked again, and another\'s isn\'t taken', () => {
    const two = up(sheet(), { increases: { asi: { wits: 2 } } }).data;
    // Soldier 3, character level 3: what everyone has unlocks, at most 1 on one stat.
    expect(up(two).error).toBe('Spend Boost\'s points first');
    expect(up(two, { increases: { boost: { might: 2 } } }).error).toBe('Boost: at most 1 on one stat');
    const three = up(two, { increases: { boost: { might: 1, lore: 1 }, asi: { might: 2 } } }).data;
    expect(three[INCREASES_KEY]).toEqual({ asi: { wits: 2 }, boost: { might: 1, lore: 1 } });
  });

  it('a class taken up at level 1 brings its own', () => {
    const two = up(sheet(), { increases: { asi: { wits: 2 } } }).data;
    const joined = (increases) => levelAction(RAISED, two, { kind: 'up', list: 'classes', option: 'mage', increases });
    // Character level 3 as well: Boost comes with it.
    expect(joined({ boost: { might: 1, wits: 1 } }).error).toBe('Spend Spark\'s points first');
    const done = joined({ spark: { lore: 1 }, boost: { might: 1, wits: 1 } });
    expect(done.data[INCREASES_KEY]).toEqual({ asi: { wits: 2 }, spark: { lore: 1 }, boost: { might: 1, wits: 1 } });
    expect(effectiveData(RAISED, done.data).lore).toBe(4);
  });
});

describe('kept with the place', () => {
  it('as they are being spent, points that aren\'t whole left out', () => {
    const placed = levelAction(RAISED, sheet(), { kind: 'place', list: 'classes', option: 'soldier', increases: { asi: { might: 1, wits: 1.5, lore: 0, grit: 'x' }, spark: [2], drill: 'all', boost: {} } });
    expect(placed.data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'soldier', increases: { asi: { might: 1 } } });
    expect(levelAction(RAISED, sheet(), { kind: 'place', list: 'classes', option: 'soldier', increases: [1] }).data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'soldier' });
  });

  it('through a health roll too', () => {
    const ROLLED = { ...RAISED, levels: { ...RAISED.levels, health: { how: 'level', gain: 'roll' } }, choices: [{ ...RAISED.choices[0], options: RAISED.choices[0].options.map((o) => ({ ...o, die: 10 })) }, RAISED.choices[1]] };
    const placed = levelAction(ROLLED, sheet(), { kind: 'place', list: 'classes', option: 'soldier', increases: { asi: { might: 2 } } }).data;
    const rolled = levelAction(ROLLED, placed, { kind: 'healthRoll', list: 'classes', option: 'soldier' }, { rng: () => 0.5 }).data;
    expect(rolled[LEVELING_KEY].increases).toEqual({ asi: { might: 2 } });
  });
});

describe('counted while its feature is unlocked', () => {
  it('locked again, it is kept but adds nothing', () => {
    const data = { ...sheet(), [INCREASES_KEY]: { asi: { might: 2 } } };
    expect(effectiveData(RAISED, data).might).toBe(15);
    expect(effectiveData(RAISED, { ...data, ...holding(['soldier', 2]) }).might).toBe(17);
  });

  it('one that no longer holds adds nothing', () => {
    const data = { ...sheet(holding(['soldier', 2])), [INCREASES_KEY]: { asi: { lore: 2 } } };
    expect(effectiveData(RAISED, data).lore).toBe(3);
    expect(workedOf(RAISED, data).from).not.toHaveProperty('lore');
  });
});

describe('LEVEL_DOWN', () => {
  it('takes off what the levels it takes away were spent on, and keeps the rest', () => {
    const two = up(sheet(), { increases: { asi: { might: 2 } } }).data;
    const both = levelAction(RAISED, two, { kind: 'up', list: 'classes', option: 'mage', increases: { spark: { lore: 1 }, boost: { might: 1, wits: 1 } } }).data;
    // Soldier 2 → 1: Ability Score Improvement locks, and Boost with the character level; Mage's Spark stays.
    const down = levelAction(RAISED, both, { kind: 'down', option: 'soldier' }, { gm: true });
    expect(down.ok).toBe(true);
    expect(down.data[INCREASES_KEY]).toEqual({ spark: { lore: 1 } });
    expect(effectiveData(RAISED, down.data).might).toBe(15);
    const none = levelAction(RAISED, two, { kind: 'down' }, { gm: true }).data;
    expect(none).not.toHaveProperty(INCREASES_KEY);
    expect(effectiveData(RAISED, none).might).toBe(15);
  });

  it('a sheet with none is left as it was', () => {
    const two = up(sheet(), {}, { gm: true }).data;
    expect(levelAction(RAISED, two, { kind: 'down' }, { gm: true }).data).not.toHaveProperty(INCREASES_KEY);
  });
});

describe('the sheet\'s view of the lists', () => {
  it('each increase with its stats by name and where they stop', () => {
    const shown = choicesShown(RAISED);
    const of = (option, id) => shown.flatMap((c) => c.options).find((o) => o.id === option).features.find((f) => f.id === id);
    expect(of('soldier', 'asi').increase).toEqual({ points: 2, most: 2, stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }], cap: 20 });
    expect(of('mage', 'spark').increase).toEqual({ points: 1, most: 1, stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }, { id: 'lore', label: 'Lore' }] });
    expect(of('soldier', 'grit')).not.toHaveProperty('increase');
  });
});

describe('OR A FEAT INSTEAD (7d6c)', () => {
  const FEATS = { id: 'feats', one: 'Feat', many: 'Feats', picked: 'features', options: [
    { id: 'tough', label: 'Tough', features: [{ id: 'tough_f', label: 'Tough', modifiers: [{ target: 'wits', amount: '1' }] }] },
    { id: 'quick', label: 'Quick' },
  ] };
  const PATHS = { id: 'paths', one: 'Path', many: 'Paths', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }] };
  const withAsi = (increase, more = {}, lists = [FEATS, PATHS]) => ({ ...RAISED, choices: [
    { ...RAISED.choices[0], options: [{ ...RAISED.choices[0].options[0], features: RAISED.choices[0].options[0].features.map((f) => (f.id === 'asi' ? { ...f, increase, ...more } : f)) }, RAISED.choices[0].options[1]] },
    RAISED.choices[1], ...lists,
  ] });
  const FEATED = withAsi({ points: 2, stats: 'abilities', cap: 20, instead: 'feats' });
  const go = (definition, data, action, opts = {}) => levelAction(definition, data, { kind: 'up', list: 'classes', option: 'soldier', ...action }, opts);
  const said = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
  const AT = 'list classes, option soldier, feature asi, increase, instead';
  const TOUGH = [{ list: 'feats', option: 'tough', from: 'asi' }];

  it('a list picked through features, or both; never its own, or one picked on its own', () => {
    expect(said(FEATED)).toEqual([]);
    expect(said(withAsi({ points: 2, instead: 'feats' }, {}, [{ ...FEATS, picked: 'both' }, PATHS]))).toEqual([]);
    expect(said(withAsi({ points: 2, instead: 'gone' }))).toEqual([`${AT}: Not one of this system's lists`]);
    expect(said(withAsi({ points: 2, instead: 7 }))).toEqual([`${AT}: Not one of this system's lists`]);
    expect(said(withAsi({ points: 2, instead: 'classes' }))).toEqual([`${AT}: A list can't be picked from inside itself`]);
    expect(said(withAsi({ points: 2, instead: 'feats' }, {}, [{ ...FEATS, picked: undefined }, PATHS]))).toEqual([`${AT}: FEATS is picked on its own: set it to THROUGH FEATURES or BOTH`]);
  });

  it('a list offered instead counts as opened, for the lists never to go round in a loop', () => {
    const back = { ...FEATS, options: [{ id: 'tough', label: 'Tough', features: [{ id: 'again', label: 'Again', choice: 'paths' }] }] };
    const round = { ...PATHS, options: [{ id: 'duelist', label: 'Duelist', features: [{ id: 'more', label: 'More', increase: { points: 1, instead: 'feats' } }] }] };
    expect(said(withAsi({ points: 2, instead: 'feats' }, {}, [back, round]))).toContain('list feats: Its features open lists that lead back to it: FEATS → PATHS → FEATS');
  });

  it('read with its list, none for one picked on its own; in the sheet\'s view', () => {
    expect(increaseOf(FEATED, { increase: { points: 2, instead: 'feats' } }).instead).toBe('feats');
    expect(increaseOf(withAsi({ points: 2 }, {}, [{ ...FEATS, picked: 'own' }]), { increase: { points: 2, instead: 'feats' } }).instead).toBeNull();
    expect(increaseOf(FEATED, { increase: { points: 2, instead: 'gone' } }).instead).toBeNull();
    const asi = choicesShown(FEATED)[0].options[0].features.find((f) => f.id === 'asi');
    expect(asi.increase.instead).toBe('feats');
    expect(choicesShown(RAISED)[0].options[0].features.find((f) => f.id === 'asi').increase).not.toHaveProperty('instead');
  });

  it('going up: the points or a pick from the list, never both, never neither', () => {
    expect(go(FEATED, sheet()).error).toBe('Spend Ability Score Improvement\'s points, or pick a Feat, first');
    expect(go(FEATED, sheet(), { picks: TOUGH, increases: { asi: { wits: 1 } } }).error).toBe('Ability Score Improvement: the points or a Feat, not both');
    const feat = go(FEATED, sheet(), { picks: TOUGH });
    expect(feat.ok).toBe(true);
    expect(feat.data[PICKS_KEY].feats).toEqual([{ option: 'tough', from: 'asi' }]);
    expect(feat.data).not.toHaveProperty(INCREASES_KEY);
    expect(effectiveData(FEATED, feat.data).wits).toBe(19);
    const points = go(FEATED, sheet(), { increases: { asi: { wits: 2 } } });
    expect(points.data[INCREASES_KEY]).toEqual({ asi: { wits: 2 } });
    // Only one pick there.
    expect(go(FEATED, sheet(), { picks: [...TOUGH, { list: 'feats', option: 'quick', from: 'asi' }] }).error).toBe('No more Feats can be picked there');
  });

  it('on the sheet: one pick there while the points aren\'t spent; none once they are', () => {
    const open = go(FEATED, sheet(), {}, { gm: true }).data;
    expect(workedOf(FEATED, open).opens).toEqual([{ feature: 'asi', list: 'feats', count: 1, used: 0, instead: true }]);
    expect(pickAction(FEATED, open, { kind: 'pick', list: 'feats', option: 'quick', from: 'asi' }).ok).toBe(true);
    const spent = go(FEATED, sheet(), { increases: { asi: { wits: 2 } } }).data;
    expect(workedOf(FEATED, spent).opens).toEqual([{ feature: 'asi', list: 'feats', count: 0, used: 0, instead: true }]);
    expect(pickAction(FEATED, spent, { kind: 'pick', list: 'feats', option: 'quick', from: 'asi' }).error).toBe('The points were spent there instead: no Feats as well');
    expect(pickAction(FEATED, spent, { kind: 'pick', list: 'feats', option: 'quick', from: 'asi' }, { gm: true }).error).toBe('The points were spent there instead: no Feats as well');
  });

  it('a pick taken there means the points don\'t count', () => {
    const both = { ...sheet(holding(['soldier', 2])), [INCREASES_KEY]: { asi: { wits: 2 } }, [PICKS_KEY]: { ...holding(['soldier', 2])[PICKS_KEY], feats: [{ option: 'quick', from: 'asi' }] } };
    expect(effectiveData(FEATED, both).wits).toBe(18);
    expect(workedOf(FEATED, both).from).not.toHaveProperty('wits');
    // Without the list offered instead, the points count whatever else is picked.
    expect(effectiveData(withAsi({ points: 2, stats: 'abilities' }), both).wits).toBe(20);
  });

  it('a feature opening one list and offering another: a pick under each, each with its own room', () => {
    const def = withAsi({ points: 2, stats: 'abilities', instead: 'feats' }, { choice: 'paths' });
    const data = { ...sheet(), [PICKS_KEY]: { ...holding(['soldier', 2])[PICKS_KEY], feats: [{ option: 'tough', from: 'asi' }], paths: [{ option: 'duelist', from: 'asi' }] } };
    expect(heldOf(def, data).filter((p) => p.from === 'asi').map((p) => [p.list.id, p.active])).toEqual([['feats', true], ['paths', true]]);
    expect(workedOf(def, data).opens).toEqual([{ feature: 'asi', list: 'paths', count: 1, used: 1 }, { feature: 'asi', list: 'feats', count: 1, used: 1, instead: true }]);
  });

  it('there, a pick from the list it opens is never the one taken instead', () => {
    const def = withAsi({ points: 2, stats: 'abilities', instead: 'feats' }, { choice: 'paths' });
    const DUELIST = [{ list: 'paths', option: 'duelist', from: 'asi' }];
    // Going up with a Path picked and the points spent.
    const up2 = go(def, sheet(), { picks: DUELIST, increases: { asi: { wits: 2 } } });
    expect(up2.ok).toBe(true);
    // The points count with a Path picked there.
    expect(effectiveData(def, up2.data).wits).toBe(20);
    // The points spent: no Feat there, while the Path was taken all the same.
    expect(pickAction(def, up2.data, { kind: 'pick', list: 'feats', option: 'quick', from: 'asi' }).error).toBe('The points were spent there instead: no Feats as well');
  });
});
