import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * A custom system's core rules: the setup questions, answered as data.
 *
 * The health model shapes the starter sheet a system gets before its GM designs one; a system
 * that answers nothing gets exactly the starter it always had. Advancement, dice and distance
 * are recorded and checked, and take effect in their own pieces.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { effectiveSheet } = require_('../systemBuilder/sheet');
const { healthLayout, distanceOf, HEALTH_MODELS, ADVANCEMENT, DISTANCE } = require_('../systemBuilder/core');
const { metaOf, renderOf } = require_('../systemBuilder/runtime');

const problems = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
const withCore = (core, extra = {}) => ({ format: 1, name: 'Test', ...extra, core });
const healthOf = (health) => effectiveSheet(withCore({ health }));
const section = (sheet, id) => sheet.sections.find((s) => s.id === id);

/** Every model, answered fully. */
const MODELS = {
  pool: { model: 'pool', label: 'VIGOR' },
  tracks: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true },
  typed: { model: 'typed', types: [{ id: 'superficial', label: 'SUPERFICIAL' }, { id: 'aggravated', label: 'AGGRAVATED' }] },
  harm: { model: 'harm', levels: [
    { id: 'lesser', label: 'LESSER', slots: 2, penalty: 'Reduced effect' },
    { id: 'moderate', label: 'MODERATE', slots: 2, penalty: '-1d' },
    { id: 'severe', label: 'SEVERE', slots: 1, penalty: 'Need help' },
  ] },
  wounds: { model: 'wounds', count: 3, penalty: -1 },
  locations: { model: 'locations', locations: [{ id: 'head', label: 'HEAD' }, { id: 'body', label: 'BODY' }] },
  none: { model: 'none' },
};

describe('a system that answers nothing', () => {
  it('gets exactly the starter sheet it always had', () => {
    const expected = {
      tabs: ['STATS', 'GEAR', 'NOTES'],
      header: { nameField: 'name', subtitleFields: ['concept'], hpField: 'hp', hpMaxField: 'hp_max' },
      sections: [
        { id: 'identity', label: 'IDENTITY', layout: 'list', tab: 'STATS', fields: [
          { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
          { id: 'concept', label: 'Concept', type: 'text' },
          { id: 'description', label: 'Description', type: 'textarea', visibility: 'public' },
        ] },
        { id: 'health', label: 'HEALTH', layout: 'grid', tab: 'STATS', columns: 2, fields: [
          { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
          { id: 'hp_max', label: 'HP MAX', type: 'number', source: 'token_hp_max' },
        ] },
        { id: 'inventory', label: 'INVENTORY', layout: 'inventory', tab: 'GEAR', fields: [] },
        { id: 'money', label: 'MONEY', layout: 'list', tab: 'GEAR', fields: [{ id: 'cash', label: 'Cash', type: 'number', source: 'bank_balance' }] },
        { id: 'notes', label: 'NOTES', layout: 'notes', tab: 'NOTES', fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }] },
      ],
    };
    // Compared as text, so the order of keys counts too.
    for (const definition of [{ format: 1, name: 'Bare' }, withCore({}), withCore({ dice: ['d20'] }), withCore({ health: { model: 'pool' } })]) {
      expect(JSON.stringify(effectiveSheet(definition))).toBe(JSON.stringify(expected));
    }
  });

  it('is still valid, and a designed sheet still wins over the starter', () => {
    expect(problems({ format: 1, name: 'Bare' })).toEqual([]);
    const own = { sections: [{ id: 'a', label: 'A', layout: 'list', fields: [] }] };
    expect(effectiveSheet({ ...withCore({ health: MODELS.harm }), sheet: own })).toBe(own);
  });
});

describe('the setup answers', () => {
  it('accept every model, and every model gives a starter sheet that passes the sheet checks', () => {
    for (const [id, health] of Object.entries(MODELS)) {
      const definition = withCore({ health, advancement: ['levels', 'spend'], dice: ['d20', '2d6', '4dF', 'd7', 'd100'], distance: 'feet' });
      expect(problems(definition), id).toEqual([]);
      // The starter, saved as the system's own sheet, is a sheet like any other.
      expect(problems({ ...definition, sheet: effectiveSheet(definition) }), id).toEqual([]);
    }
  });

  it('list every model and advancement style the plan names, in its order', () => {
    expect(HEALTH_MODELS.map((m) => m.id)).toEqual(['pool', 'tracks', 'typed', 'harm', 'wounds', 'locations', 'none']);
    expect(ADVANCEMENT.map((a) => a.id)).toEqual(['levels', 'milestone', 'spend', 'use']);
    for (const m of HEALTH_MODELS) expect(m.label && m.worksLike && m.examples, m.id).toBeTruthy();
  });
});

describe('the distance answer (3d1)', () => {
  it('is the unit the browser\'s ruler reads in, one of the six', () => {
    expect(DISTANCE).toEqual(['meters', 'feet', 'yards', 'squares', 'hexes', 'zones']);
    for (const distance of DISTANCE) {
      expect(distanceOf(withCore({ distance })), distance).toBe(distance);
      expect(renderOf('sys_aaaaaaaaaaaaaaaa', withCore({ distance })).distance, distance).toBe(distance);
    }
  });

  it('is feet, as every built-in system and the ruler have always used, where a system gave none', () => {
    for (const definition of [{ format: 1, name: 'Bare' }, withCore({}), withCore({ distance: 'leagues' }), withCore({ distance: 7 }), { format: 1, name: 'Odd', core: 'yes' }, null]) {
      expect(distanceOf(definition), JSON.stringify(definition)).toBe('feet');
    }
    expect(renderOf('sys_aaaaaaaaaaaaaaaa', { format: 1, name: 'Bare' }).distance).toBe('feet');
  });
});

describe('the starter sheet each health model gives', () => {
  it('one pool: the token\'s HP, under the system\'s own name', () => {
    const sheet = healthOf(MODELS.pool);
    expect(section(sheet, 'health').fields.map((f) => [f.id, f.label, f.source])).toEqual([
      ['hp', 'VIGOR', 'token_hp'], ['hp_max', 'VIGOR MAX', 'token_hp_max'],
    ]);
    expect(sheet.header).toMatchObject({ hpField: 'hp', hpMaxField: 'hp_max' });
  });

  it('two tracks: the first on the token, the second on the sheet, each with a maximum', () => {
    const sheet = healthOf(MODELS.tracks);
    expect(section(sheet, 'health').fields).toEqual([
      { id: 'physical', label: 'PHYSICAL', type: 'number', source: 'token_hp', maxField: 'physical_max' },
      { id: 'physical_max', label: 'PHYSICAL MAX', type: 'number', source: 'token_hp_max' },
      { id: 'stun', label: 'STUN', type: 'number', maxField: 'stun_max' },
      { id: 'stun_max', label: 'STUN MAX', type: 'number' },
    ]);
    expect(sheet.header).toMatchObject({ hpField: 'physical', hpMaxField: 'physical_max' });
  });

  it('damage types: one track on the token, and a count of each kind of damage', () => {
    const fields = section(healthOf(MODELS.typed), 'health').fields;
    expect(fields.map((f) => [f.id, f.label, f.source])).toEqual([
      ['health', 'HEALTH', 'token_hp'], ['health_max', 'HEALTH MAX', 'token_hp_max'],
      ['superficial', 'SUPERFICIAL', undefined], ['aggravated', 'AGGRAVATED', undefined],
    ]);
  });

  it('harm levels: a line for each slot, with the penalty as its hint, and nothing on the token', () => {
    const sheet = healthOf(MODELS.harm);
    expect(section(sheet, 'health')).toBeUndefined();
    expect(section(sheet, 'harm').fields.map((f) => [f.id, f.label, f.hint])).toEqual([
      ['lesser_1', 'LESSER', 'Reduced effect'], ['lesser_2', 'LESSER 2', 'Reduced effect'],
      ['moderate_1', 'MODERATE', '-1d'], ['moderate_2', 'MODERATE 2', '-1d'],
      ['severe_1', 'SEVERE', 'Need help'],
    ]);
    expect(sheet.header.hpField).toBeUndefined();
  });

  it('wound count: the wounds left, on the token', () => {
    const fields = section(healthOf(MODELS.wounds), 'health').fields;
    expect(fields.map((f) => [f.id, f.label, f.source, f.hint])).toEqual([
      ['wounds', 'WOUNDS LEFT', 'token_hp', undefined], ['wounds_max', 'WOUNDS', 'token_hp_max', 'Out after 3'],
    ]);
  });

  it('hit locations: an HP pool, and an injury line per location', () => {
    const sheet = healthOf(MODELS.locations);
    expect(section(sheet, 'health').fields.map((f) => f.id)).toEqual(['hp', 'hp_max']);
    expect(section(sheet, 'injuries').fields.map((f) => [f.id, f.label])).toEqual([['head', 'HEAD'], ['body', 'BODY']]);
  });

  it('none: no health on the sheet at all', () => {
    const sheet = healthOf(MODELS.none);
    expect(sheet.sections.map((s) => s.id)).toEqual(['identity', 'inventory', 'money', 'notes']);
    expect(sheet.header).toEqual({ nameField: 'name', subtitleFields: ['concept'] });
  });

  it("reaches the running game: the token links, and the browser's copy", () => {
    const definition = withCore({ health: MODELS.tracks });
    expect(metaOf(definition).linkedFields).toEqual({ physical: 'token_hp', physical_max: 'token_hp_max', cash: 'bank_balance' });
    expect(metaOf(definition).maxPairs).toEqual({ physical_max: 'physical', stun_max: 'stun' });
    expect(renderOf('sys_0123456789abcdef', definition).sheet).toEqual(effectiveSheet(definition));
  });

  it('falls back to one pool rather than failing on an unfinished answer', () => {
    expect(healthLayout({ model: 'tracks', tracks: [{ id: 'a', label: 'A' }] })).toEqual(healthLayout(undefined));
  });
});

describe('mistakes in the answers', () => {
  it('are reported with where they are', () => {
    expect(problems(withCore({ mood: 'grim', health: { model: 'tracks', tracks: [{ id: 'a', label: 'A' }], overflow: 'yes', count: 3 } }))).toEqual([
      'core mood: Not a setup question',
      'core health, count: Not part of the tracks model',
      'core health track: Exactly 2',
      'core health, overflow: true or false',
    ]);
    expect(problems(withCore({ health: { model: 'hearts' } }))).toEqual([
      'core health, model: One of pool, tracks, typed, harm, wounds, locations, none',
    ]);
    expect(problems(withCore({ health: 'pool' }))).toEqual(['core health: Must say which health model']);
    expect(problems(withCore('all of them'))).toEqual(['core: Must be a set of answers']);
  });

  it('in the lists of tracks, types, levels and locations', () => {
    expect(problems(withCore({ health: { model: 'typed', label: '', types: [{ id: 'Light', label: 'LIGHT' }, { id: 'a', label: 'A' }, { id: 'a', label: 'A' }, 'x', { id: 'b', label: 'B' }] } }))).toEqual([
      'core health, label: Required',
      'core health type: From 2 to 4',
      'core health type Light: Ids use lowercase letters, digits and _, starting with a letter',
      'core health type a: Defined twice',
      'core health type 4: Needs an id and a label',
    ]);
    expect(problems(withCore({ health: { model: 'harm', levels: [{ id: 'a', label: 'A', slots: 5, penalty: 'x'.repeat(41) }, { id: 'b', slots: 1 }] } }))).toEqual([
      'core health level a, slots: A whole number from 1 to 4',
      'core health level a, penalty: Longer than 40 characters',
      'core health level b, label: Required',
    ]);
    expect(problems(withCore({ health: { model: 'wounds', count: 0, penalty: 2 } }))).toEqual([
      'core health, count: A whole number from 1 to 10',
      'core health, penalty: A whole number from -5 to 0',
    ]);
    expect(problems(withCore({ health: { model: 'locations', locations: [] } }))).toEqual(['core health location: From 1 to 12']);
    expect(problems(withCore({ health: { model: 'pool', label: 'x'.repeat(21) } }))).toEqual(['core health, label: Longer than 20 characters']);
    expect(problems(withCore({ health: { model: 'tracks', tracks: [{ id: 'a'.repeat(41), label: 'A' }, { id: 'b', label: 'B' }] } })))
      .toEqual([`core health track ${'a'.repeat(41)}: Ids use lowercase letters, digits and _, starting with a letter`]);
  });

  it('when a health field would clash with the starter sheet, a derived value or itself', () => {
    expect(problems(withCore({ health: { model: 'tracks', tracks: [{ id: 'name', label: 'NAME' }, { id: 'stun', label: 'STUN' }] } })))
      .toEqual(['core health name: Clashes with another field on the starter sheet']);
    expect(problems(withCore({ health: { model: 'tracks', tracks: [{ id: 'stun', label: 'A' }, { id: 'stun_max', label: 'B' }] } })))
      .toEqual(['core health stun_max: Clashes with another field on the starter sheet']);
    expect(problems(withCore({ health: { model: 'typed', types: [{ id: 'health', label: 'A' }, { id: 'b', label: 'B' }] } })))
      .toEqual(['core health health: Clashes with another field on the starter sheet']);
    expect(problems(withCore({ health: { model: 'harm', levels: [{ id: 'grit', label: 'GRIT', slots: 1 }] } }, { derived: [{ id: 'grit_1', formula: '1' }] })))
      .toEqual(['core health grit_1: A derived value has this id']);
  });

  it('in advancement, dice and distance', () => {
    expect(problems(withCore({ advancement: ['levels', 'luck', 'levels'], dice: ['d20', 'd1', 'd101', '100d6', 'dX', 7, 'd20'], distance: 'leagues' }))).toEqual([
      'core advancement: luck is not one of levels, milestone, spend, use',
      'core advancement: Named twice',
      'core dice: d1 is not a die (d2 to d100, or dF, with a count: 2d6)',
      'core dice: d101 is not a die (d2 to d100, or dF, with a count: 2d6)',
      'core dice: 100d6 is not a die (d2 to d100, or dF, with a count: 2d6)',
      'core dice: dX is not a die (d2 to d100, or dF, with a count: 2d6)',
      'core dice: 7 is not a die (d2 to d100, or dF, with a count: 2d6)',
      'core dice: Named twice',
      'core distance: One of meters, feet, yards, squares, hexes, zones',
    ]);
    expect(problems(withCore({ advancement: 'levels', dice: 'd20' }))).toEqual(['core advancement: Must be a list', 'core dice: Must be a list']);
    expect(problems(withCore({ dice: ['d2', 'd3', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] }))).toEqual(['core dice: More than 8']);
    expect(problems(withCore({ advancement: [] }))).toEqual([]);
  });
});
