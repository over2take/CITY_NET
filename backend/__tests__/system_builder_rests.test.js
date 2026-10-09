import { describe, it, expect } from 'vitest';

const { checkRests, restsOf, restIdsOf, reachOf, STANDARD, LIMITS } = require('../systemBuilder/rests');
const { checkDefinition } = require('../systemBuilder/definition');
const { conditionsOf } = require('../systemBuilder/conditions');
const { rollAmount, boxProblem } = require('../systemBuilder/tierRolls');

/**
 * A system's rests (4f1). Approved mockup builder-rests (2026-10-09): four standard rests, renamed or
 * off, and a system's own, twelve in all; ALSO COUNTS AS without loops; refills of health, a sheet
 * number or a whole section, with amounts that are numbers, formulas or dice naming the
 * character's own numbers; conditions that wear off at a rest. Stored as changes only.
 */

const HEARTH = {
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  // Ward is worked out but not on the sheet: an amount may still name it.
  derived: [{ id: 'spell_dc', label: 'Spell DC', formula: '10 + @con_mod' }, { id: 'ward', label: 'Ward', formula: '@con_mod + 2' }],
  sheet: {
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'level', label: 'Level', type: 'number' }] },
      { id: 'body', label: 'BODY', layout: 'grid', fields: [
        { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
        { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
        { id: 'fatigue', label: 'Fatigue', type: 'number' },
        { id: 'armor', label: 'Armor', type: 'number', source: 'token_ac' },
        { id: 'luck', label: 'Luck', type: 'number', maxField: 'luck_max' },
        { id: 'luck_max', label: 'Luck max', type: 'number' },
      ] },
      { id: 'magic', label: 'MAGIC', layout: 'grid', fields: [
        { id: 'slots', label: 'Slots', type: 'number', maxField: 'slots_max' },
        { id: 'slots_max', label: 'Slots max', type: 'number' },
        { id: 'focus', label: 'Focus', type: 'number', maxField: 'focus_max' },
        { id: 'focus_max', label: 'Focus max', type: 'number' },
        { id: 'spell_dc', label: 'Spell DC', type: 'number' },
      ] },
      { id: 'notes', label: 'NOTES', layout: 'notes', fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }] },
    ],
  },
};

const problemsOf = (rests, def = HEARTH) => {
  const problems = [];
  checkRests({ ...def, rests }, problems);
  return problems.map((p) => `${p.where}: ${p.message}`);
};
const refill = (r) => problemsOf({ short_rest: { refills: [r] } });

describe('a system\'s rests', () => {
  it('start as the four standard ones, on, in order and refilling nothing', () => {
    expect(STANDARD.map((r) => r.id)).toEqual(['short_rest', 'long_rest', 'end_of_scene', 'end_of_session']);
    expect(restsOf({})).toEqual(STANDARD.map((r) => ({ id: r.id, name: r.name, counts_as: [], refills: [], standard: true })));
    expect(restsOf(undefined).map((r) => r.id)).toEqual(STANDARD.map((r) => r.id));
  });

  it('keep the edits, leave out those turned off, and add the system\'s own after them', () => {
    const rests = restsOf({ rests: {
      downtime: { name: ' Downtime ', counts_as: ['long_rest', 'end_of_scene', 'downtime'], refills: [{ what: 'fatigue', how: 'to', amount: '0' }] },
      long_rest: { name: 'Night\'s sleep', counts_as: ['short_rest'] },
      end_of_scene: { on: false },
      nameless: { refills: [] },
      'Bad Id': { name: 'Bad' },
    } });
    expect(rests.map((r) => [r.id, r.name, r.standard])).toEqual([
      ['short_rest', 'Short rest', true], ['long_rest', 'Night\'s sleep', true], ['end_of_session', 'End of session', true], ['downtime', 'Downtime', false],
    ]);
    // Counting as a rest that is off, or as itself, counts for nothing.
    expect(rests.find((r) => r.id === 'downtime').counts_as).toEqual(['long_rest']);
    expect(rests.find((r) => r.id === 'downtime').refills).toEqual([{ what: 'fatigue', how: 'to', amount: '0' }]);
  });

  it('name every id a condition may end at, those turned off included', () => {
    expect([...restIdsOf({ rests: { end_of_scene: { on: false }, downtime: { name: 'Downtime' }, 'Bad Id': {}, nope: 'x' } })])
      .toEqual(['short_rest', 'long_rest', 'end_of_scene', 'end_of_session', 'downtime']);
  });

  it('accept a whole set that does everything the mockup shows', () => {
    const rests = {
      short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
      long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }, { what: 'fatigue', how: 'by', amount: '-1' }, { what: 'section:magic', how: 'max' }] },
      end_of_session: { name: 'Session over', refills: [{ what: 'luck', how: 'max' }] },
      end_of_scene: { on: false },
      downtime: { name: 'Downtime', counts_as: ['long_rest'], refills: [{ what: 'fatigue', how: 'to', amount: '0' }, { what: 'focus', how: 'by', amount: '@level d4 + @spell_dc - 10' }] },
    };
    expect(problemsOf(rests)).toEqual([]);
    expect(checkDefinition({ ...HEARTH, rests })).toEqual({ problems: [] });
    // And a definition reports what is wrong with its rests.
    expect(checkDefinition({ ...HEARTH, rests: { short_rest: { counts_as: ['nap'] } } }).problems)
      .toEqual([{ where: 'rest short_rest, counts_as 1', message: 'Not one of this system\'s rests' }]);
  });

  it('refuse what isn\'t a rest', () => {
    expect(problemsOf('x')).toEqual(['rests: Must be a set of rests']);
    expect(problemsOf({ 'Bad Id': { name: 'X' }, short_rest: 'x' })).toEqual([
      'rest Bad Id: Ids use lowercase letters, digits and _, starting with a letter',
      'rest short_rest: Must be a rest',
    ]);
    expect(problemsOf({ short_rest: { on: 'yes', ends: 1 }, downtime: { name: 'D', on: false } })).toEqual([
      'rest short_rest, ends: Not part of a rest',
      'rest short_rest, on: Must say on: true or on: false',
      'rest downtime, on: Only a standard rest is turned off; delete one of the system\'s own instead',
    ]);
  });

  it('need a name on the system\'s own, and keep names short', () => {
    expect(problemsOf({ downtime: {}, carousing: { name: '  ' }, long_rest: { name: 3 }, short_rest: { name: 'x'.repeat(LIMITS.name + 1) } })).toEqual([
      'rest downtime, name: Cannot be blank',
      'rest carousing, name: Cannot be blank',
      'rest long_rest, name: Must be text',
      `rest short_rest, name: Longer than ${LIMITS.name} characters`,
    ]);
    expect(problemsOf({ short_rest: { name: '' }, downtime: { name: 'x'.repeat(LIMITS.name) } })).toEqual([]);
  });

  it('stop at twelve, the standard four included', () => {
    const own = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`own_${i}`, { name: `Own ${i}` }]));
    expect(problemsOf(own(LIMITS.rests - STANDARD.length))).toEqual([]);
    expect(problemsOf(own(LIMITS.rests - STANDARD.length + 1))).toEqual([`rests: At most ${LIMITS.rests} rests, the ${STANDARD.length} standard ones included`]);
  });

  it('count only as other rests that exist, never as themselves, directly or round a loop', () => {
    expect(problemsOf({ short_rest: { counts_as: 'long_rest' } })).toEqual(['rest short_rest, counts_as: Must be a list of rests']);
    expect(problemsOf({ short_rest: { counts_as: ['short_rest', 'nap'] } })).toEqual([
      'rest short_rest, counts_as 1: A rest can\'t count as itself',
      'rest short_rest, counts_as 2: Not one of this system\'s rests',
    ]);
    expect(problemsOf({ short_rest: { counts_as: ['long_rest'] }, long_rest: { counts_as: ['short_rest'] } })).toEqual([
      'rest short_rest, counts_as: Counts as itself through long_rest',
      'rest long_rest, counts_as: Counts as itself through short_rest',
    ]);
    expect(problemsOf({
      short_rest: { counts_as: ['end_of_scene'] }, end_of_scene: { counts_as: ['downtime'] }, downtime: { name: 'D', counts_as: ['short_rest'] }, long_rest: { counts_as: ['short_rest'] },
    })).toEqual([
      'rest short_rest, counts_as: Counts as itself through downtime',
      'rest end_of_scene, counts_as: Counts as itself through short_rest',
      'rest downtime, counts_as: Counts as itself through end_of_scene',
    ]);
    // A chain, and two rests counting as the same one, are fine; so is counting as one turned off.
    expect(problemsOf({ long_rest: { counts_as: ['short_rest'] }, downtime: { name: 'D', counts_as: ['long_rest', 'short_rest'] }, end_of_session: { counts_as: ['end_of_scene'] }, end_of_scene: { on: false } })).toEqual([]);
  });

  it('take a list of at most twenty refills', () => {
    expect(problemsOf({ short_rest: { refills: { what: 'health' } } })).toEqual(['rest short_rest, refills: Must be a list of refills']);
    const many = Array.from({ length: LIMITS.refills + 1 }, () => ({ what: 'health', how: 'full' }));
    expect(problemsOf({ short_rest: { refills: many } })).toEqual([`rest short_rest, refills: At most ${LIMITS.refills} refills`]);
    expect(problemsOf({ short_rest: { refills: many.slice(1) } })).toEqual([]);
  });
});

describe('a refill', () => {
  it('says what it refills and how, and nothing else', () => {
    expect(refill('x')).toEqual(['rest short_rest, refill 1: Must say what it refills and how']);
    expect(refill({ what: 'health', how: 'full', when: 'dawn' })).toEqual(['rest short_rest, refill 1, when: Not part of a refill']);
    expect(refill({ what: 'gold', how: 'max' })).toEqual(['rest short_rest, refill 1, what: Health, a number on the character sheet, or a section of it']);
  });

  it('refills health to full, or up by an amount where the model heals by amounts', () => {
    expect(refill({ what: 'health', how: 'full' })).toEqual([]);
    expect(refill({ what: 'health', how: 'by', amount: '2' })).toEqual([]);
    expect(refill({ what: 'health', how: 'max' })).toEqual(['rest short_rest, refill 1, how: To full, or up by an amount']);
    const harm = { ...HEARTH, sheet: undefined, core: { health: { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER', slots: 2 }] } } };
    expect(problemsOf({ short_rest: { refills: [{ what: 'health', how: 'by', amount: '1' }] } }, harm)).toEqual(['rest short_rest, refill 1, how: This health model heals one harm at a time; refill it to full']);
    expect(problemsOf({ short_rest: { refills: [{ what: 'health', how: 'full' }] } }, harm)).toEqual([]);
    for (const model of [{ model: 'pool' }, { model: 'wounds', count: 3 }, { model: 'typed', types: [{ id: 'light', label: 'L' }, { id: 'heavy', label: 'H' }] }, { model: 'locations', locations: [{ id: 'head', label: 'HEAD' }] }]) {
      expect(problemsOf({ short_rest: { refills: [{ what: 'health', how: 'by', amount: '1' }] } }, { ...HEARTH, sheet: undefined, core: { health: model } }), model.model).toEqual([]);
    }
  });

  it('has no health to refill with token health off, or a model of none', () => {
    const off = { ...HEARTH, parts: { token_health: { on: false } } };
    expect(problemsOf({ short_rest: { refills: [{ what: 'health', how: 'full' }] } }, off)).toEqual(['rest short_rest, refill 1, what: This system has no health to refill']);
    const none = { ...HEARTH, core: { health: { model: 'none' } } };
    expect(problemsOf({ short_rest: { refills: [{ what: 'health', how: 'full' }] } }, none)).toEqual(['rest short_rest, refill 1, what: This system has no health to refill']);
  });

  it('names a track only for health up by an amount in a system with two tracks', () => {
    const tracks = { ...HEARTH, sheet: undefined, core: { health: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }] } } };
    const with_ = (r) => problemsOf({ short_rest: { refills: [r] } }, tracks);
    expect(with_({ what: 'health', how: 'by', amount: '@level', track: 'stun' })).toEqual(['rest short_rest, refill 1, amount: @level isn\'t a stat, formula or sheet field of this system']);
    expect(with_({ what: 'health', how: 'by', amount: '3', track: 'stun' })).toEqual([]);
    expect(with_({ what: 'health', how: 'by', amount: '3', track: 'edge' })).toEqual(['rest short_rest, refill 1, track: Not one of this system\'s tracks']);
    expect(with_({ what: 'health', how: 'full', track: 'stun' })).toEqual(['rest short_rest, refill 1, track: Only health up by an amount, in a system with two tracks, names a track']);
    expect(refill({ what: 'health', how: 'by', amount: '3', track: 'stun' })).toEqual(['rest short_rest, refill 1, track: Only health up by an amount, in a system with two tracks, names a track']);
    // The second track lives on the sheet, but it counts damage: it is refilled as health, not as a number.
    expect(with_({ what: 'stun', how: 'to', amount: '0' })).toEqual(['rest short_rest, refill 1, what: Health, a number on the character sheet, or a section of it']);
  });

  it('refills a sheet number to its maximum when it has one, up or down by, or set to', () => {
    expect(refill({ what: 'luck', how: 'max' })).toEqual([]);
    expect(refill({ what: 'fatigue', how: 'max' })).toEqual(['rest short_rest, refill 1, how: This number has no maximum']);
    expect(refill({ what: 'fatigue', how: 'by', amount: '-1' })).toEqual([]);
    expect(refill({ what: 'fatigue', how: 'to', amount: 0 })).toEqual([]);
    expect(refill({ what: 'fatigue', how: 'full' })).toEqual(['rest short_rest, refill 1, how: To its maximum, up or down by an amount, or set to an amount']);
  });

  it('never refills a number worked out by a formula, linked to the token or bank, or that isn\'t a number', () => {
    for (const what of ['spell_dc', 'ward', 'hp', 'hp_max', 'armor', 'name', 'notes', 'con_mod']) {
      expect(refill({ what, how: 'to', amount: '1' }), what).toEqual(['rest short_rest, refill 1, what: Health, a number on the character sheet, or a section of it']);
    }
  });

  it('refills a whole section, every number in it to its maximum, where it holds one with a maximum', () => {
    expect(refill({ what: 'section:magic', how: 'max' })).toEqual([]);
    expect(refill({ what: 'section:body', how: 'max' })).toEqual([]);
    expect(refill({ what: 'section:magic', how: 'by', amount: '1' })).toEqual(['rest short_rest, refill 1, how: Every number in it to its maximum']);
    expect(refill({ what: 'section:who', how: 'max' })).toEqual(['rest short_rest, refill 1, what: Not a section of the character sheet with numbers that have a maximum']);
    expect(refill({ what: 'section:gone', how: 'max' })).toEqual(['rest short_rest, refill 1, what: Not a section of the character sheet with numbers that have a maximum']);
  });

  it('has an amount exactly when it goes up, down or is set, naming the character\'s own numbers', () => {
    expect(refill({ what: 'fatigue', how: 'by' })).toEqual(['rest short_rest, refill 1, amount: Required']);
    expect(refill({ what: 'fatigue', how: 'to', amount: ' ' })).toEqual(['rest short_rest, refill 1, amount: Required']);
    expect(refill({ what: 'luck', how: 'max', amount: '1' })).toEqual(['rest short_rest, refill 1, amount: Only up or down by, or set to, has an amount']);
    expect(refill({ what: 'health', how: 'full', amount: '1' })).toEqual(['rest short_rest, refill 1, amount: Only up or down by, or set to, has an amount']);
    expect(refill({ what: 'fatigue', how: 'by', amount: '-@gold' })).toEqual(['rest short_rest, refill 1, amount: @gold isn\'t a stat, formula or sheet field of this system']);
    expect(refill({ what: 'fatigue', how: 'by', amount: '1d0' })).toEqual(['rest short_rest, refill 1, amount: A die has 2 to 1000 sides']);
    expect(refill({ what: 'fatigue', how: 'by', amount: '$cwn_soak + 1' })).toEqual(['rest short_rest, refill 1, amount: A rule can\'t be used here']);
    expect(refill({ what: 'fatigue', how: 'by', amount: `1${' + 1'.repeat(LIMITS.amount)}` })).toEqual([`rest short_rest, refill 1, amount: Longer than ${LIMITS.amount} characters`]);
    for (const amount of ['@level', '@con_mod', '@spell_dc', '@ward', '@armor', '@luck_max - @luck', '2d6 + @con_mod', '@level d4', 'max(1, @con_mod)']) {
      expect(refill({ what: 'fatigue', how: 'by', amount }), amount).toEqual([]);
    }
  });
});

describe('what a rest can reach', () => {
  it('is the health model, the refillable numbers with their maximums, sections holding any with one, and the names an amount may use', () => {
    const reach = reachOf(HEARTH);
    expect(reach.health).toEqual({ model: 'pool' });
    expect([...reach.numbers]).toEqual([['level', null], ['fatigue', null], ['luck', 'luck_max'], ['luck_max', null], ['slots', 'slots_max'], ['slots_max', null], ['focus', 'focus_max'], ['focus_max', null]]);
    expect([...reach.sections]).toEqual([['body', ['luck']], ['magic', ['slots', 'focus']]]);
    for (const name of ['level', 'hp', 'armor', 'con_mod', 'spell_dc', 'ward', 'notes']) expect(reach.names.has(name), name).toBe(true);
    expect(reach.names.has('gold')).toBe(false);
  });
});

describe('a condition that wears off at a rest', () => {
  const conditionProblems = (conditions, rests) => checkDefinition({ ...HEARTH, conditions, rests }).problems.map((p) => `${p.where}: ${p.message}`);

  it('names the rests it ends at, which the system has (one turned off included)', () => {
    expect(conditionProblems({ exhausted: { ends: 'rest', at: ['long_rest'] }, glitching: { name: 'Glitching', ends: 'rest', at: ['downtime', 'end_of_scene'] } },
      { downtime: { name: 'Downtime' }, end_of_scene: { on: false } })).toEqual([]);
    expect(conditionProblems({ exhausted: { ends: 'rest' } })).toEqual(['condition exhausted, at: Name the rests it wears off at']);
    expect(conditionProblems({ exhausted: { ends: 'rest', at: [] } })).toEqual(['condition exhausted, at: Name the rests it wears off at']);
    expect(conditionProblems({ exhausted: { ends: 'rest', at: ['nap', 'long_rest'] } })).toEqual(['condition exhausted, at 1: Not one of this system\'s rests']);
    expect(conditionProblems({ exhausted: { ends: 'rounds', rounds: 2, at: ['long_rest'] } })).toEqual(['condition exhausted, at: Only a condition that ends at a rest names rests']);
    expect(conditionProblems({ exhausted: { ends: 'dawn' } })).toEqual(['condition exhausted, ends: Ends when removed, after rounds, or at a rest']);
  });

  it('is offered with the rests it ends at; one ending otherwise has none', () => {
    const list = conditionsOf({ conditions: { exhausted: { ends: 'rest', at: ['long_rest', 3] }, poisoned: { ends: 'rounds', rounds: 2, at: ['long_rest'] } } });
    expect(list.find((c) => c.id === 'exhausted')).toMatchObject({ ends: 'rest', at: ['long_rest'] });
    expect(list.find((c) => c.id === 'poisoned')).not.toHaveProperty('at');
    expect(list.find((c) => c.id === 'blinded')).not.toHaveProperty('at');
  });
});

describe('an amount', () => {
  const names = { known: (n) => ['level', 'con_mod'].includes(n), refused: (n) => `no @${n}` };
  const rng = () => 0.5; // every die shows its middle face, rounded up: a d8 shows 5

  it('works out from the character\'s own numbers, dice counted by one of them too', () => {
    expect(rollAmount('2 + @con_mod', { con_mod: 3 }, names)).toEqual({ value: 5, dice: [] });
    expect(rollAmount('1d8 + @con_mod', { con_mod: 2 }, names, rng)).toEqual({ value: 7, dice: [{ count: 1, sides: 8, rolls: [5] }] });
    expect(rollAmount('@level d4', { level: 3 }, names, rng)).toEqual({ value: 9, dice: [{ count: 3, sides: 4, rolls: [3, 3, 3] }] });
    expect(rollAmount(-1, {}, names)).toEqual({ value: -1, dice: [] });
  });

  it('counts a name with no value as 0, and holds a count of dice from a name to 0 to 100', () => {
    expect(rollAmount('@con_mod + 1', {}, names)).toEqual({ value: 1, dice: [] });
    expect(rollAmount('@level d4', { level: -2 }, names, rng)).toEqual({ value: 0, dice: [{ count: 0, sides: 4, rolls: [] }] });
    expect(rollAmount('@level d2', { level: 500 }, names, rng).dice[0].count).toBe(100);
  });

  it('refuses a name it may not use, as the rest says', () => {
    expect(rollAmount('@gold', {}, names)).toEqual({ error: 'no @gold' });
    expect(boxProblem('@gold d6', names)).toBe('no @gold');
    // A tier still reads @level alone.
    expect(boxProblem('@con_mod')).toBe('Only @level can be used here, not @con_mod');
    expect(boxProblem('@level d8 + 4')).toBeNull();
  });
});
