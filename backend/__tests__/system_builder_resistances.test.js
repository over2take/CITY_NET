import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * Resistances (8b3a; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23): a RESISTANCE row on a
 * feature (a pick's, a worn item's, an installed one's) and on a condition, RESIST, IMMUNE or VULNERABLE to one of the
 * game's damage types or ALL; counted while the thing counts, gone when it stops; two for one type never stacking.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { resistancesOf, resistanceSourcesOf, PICKS_KEY } = require_('../systemBuilder/choices');
const { kindOf, resistancesIn, LIMIT } = require_('../systemBuilder/resistances');
const { damageTypeIdsOf } = require_('../systemBuilder/damageTypes');
const { conditionsOf } = require_('../systemBuilder/conditions');
const { itemAction, WORN_KEY } = require_('../systemBuilder/items');
const { valueOn } = require_('../systemBuilder/choices');
const { readChoicesFile } = require_('../systemBuilder/choicesImport');
const { readItemsFile } = require_('../systemBuilder/itemsImport');
const citysys = require_('../systemBuilder/citysys');

const STONE = {
  format: 1, name: 'Stonehold Resist Test', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }, { id: 'strain', label: 'Strain' }] }],
  damage: { types: { necrotic: { on: false }, sonic: { name: 'Sonic' } } },
  choices: [{ id: 'kin', one: 'Kin', many: 'Kin', levelled: true, options: [
    { id: 'dwarf', label: 'Dwarf', features: [
      { id: 'resilience', label: 'Dwarven Resilience', at: 1, resistances: [{ kind: 'resist', type: 'poison' }] },
      { id: 'deep_blood', label: 'Deep Blood', at: 3, resistances: [{ kind: 'immune', type: 'poison' }, { kind: 'vulnerable', type: 'sonic' }] },
    ] },
  ] }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 1 }],
    installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'strain', way: 'adds', limit: '10' }],
    list: [
      { id: 'ring', label: 'Ring of Warmth', needs: 'worn', features: [{ id: 'warm', label: 'Warm', resistances: [{ kind: 'resist', type: 'cold' }] }] },
      { id: 'dampers', label: 'Ear Dampers', needs: 'cyberware', cost: 1, features: [{ id: 'damped', label: 'Damped', resistances: [{ kind: 'resist', type: 'sonic' }] }] },
    ],
  },
  conditions: {
    petrified: { name: 'Petrified', resistances: [{ kind: 'resist', type: 'all' }] },
    soaked: { name: 'Soaked', resistances: [{ kind: 'vulnerable', type: 'lightning' }, { kind: 'resist', type: 'fire' }] },
  },
};
const gear = (...names) => JSON.stringify(names.map((name) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' })));
const act = (data, action) => {
  const done = itemAction(STONE, data, action, { gm: true, readValue: (text) => valueOn(STONE, data, text) });
  if (!done.ok) throw new Error(done.error);
  return done.data;
};
const dwarf = (level) => ({ [PICKS_KEY]: { kin: [{ option: 'dwarf', level }] } });
const said = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
const kinds = (worked) => Object.fromEntries(Object.entries(worked).map(([t, w]) => [t, w.kind]));

describe('the checks', () => {
  it('a system with rows on features, items, installs and conditions is well formed', () => {
    expect(said(STONE)).toEqual([]);
  });

  it('a row says RESIST, IMMUNE or VULNERABLE, to one of the system\'s types (on or off) or all, once each, nothing else', () => {
    const feature = (resistances) => said({ ...STONE, choices: [{ ...STONE.choices[0], options: [{ id: 'dwarf', label: 'Dwarf', features: [{ id: 'f', label: 'F', resistances }] }] }] });
    expect(feature([{ kind: 'resist', type: 'necrotic' }, { kind: 'immune', type: 'sonic' }, { kind: 'vulnerable', type: 'all' }])).toEqual([]);
    expect(feature([{ kind: 'shrug', type: 'fire' }, { kind: 'resist', type: 'lava' }, { kind: 'resist', type: 'fire', amount: 2 }, 'fire', { kind: 'immune', type: 'fire' }, { kind: 'resist', type: 7 }])).toEqual([
      'list kin, option dwarf, feature f, resistance 1, kind: RESIST, IMMUNE or VULNERABLE',
      'list kin, option dwarf, feature f, resistance 2, type: Not one of this system\'s damage types, or all',
      'list kin, option dwarf, feature f, resistance 3, amount: Not part of a resistance',
      'list kin, option dwarf, feature f, resistance 3, type: Already says that type',
      'list kin, option dwarf, feature f, resistance 4: Must say RESIST, IMMUNE or VULNERABLE, and to what',
      'list kin, option dwarf, feature f, resistance 5, type: Already says that type',
      'list kin, option dwarf, feature f, resistance 6, type: Not one of this system\'s damage types, or all',
    ]);
    expect(feature([{ kind: 'resist', type: 'all' }, { kind: 'immune', type: 'all' }])).toEqual(['list kin, option dwarf, feature f, resistance 2, type: Already says ALL']);
    expect(feature({ kind: 'resist', type: 'fire' })).toEqual(['list kin, option dwarf, feature f, resistance: Must be a list of resistances']);
    expect(feature(Array.from({ length: LIMIT + 1 }, (_, i) => ({ kind: 'resist', type: ['fire', 'cold', 'acid', 'poison', 'radiant', 'psychic', 'force', 'thunder', 'piercing', 'slashing', 'sonic'][i] })))).toEqual([`list kin, option dwarf, feature f, resistance: At most ${LIMIT}`]);
  });

  it('an item\'s feature and a condition are checked the same', () => {
    expect(said({ ...STONE, items: { ...STONE.items, list: [{ id: 'ring', label: 'Ring', needs: 'worn', features: [{ id: 'warm', label: 'Warm', resistances: [{ kind: 'resist', type: 'lava' }] }] }] } }))
      .toEqual(['item ring, feature warm, resistance 1, type: Not one of this system\'s damage types, or all']);
    expect(said({ ...STONE, conditions: { petrified: { name: 'Petrified', resistances: [{ kind: 'fond', type: 'all' }] }, gone: { name: 'Gone', resistances: 'all' } } })).toEqual([
      'condition petrified, resistance 1, kind: RESIST, IMMUNE or VULNERABLE',
      'condition gone, resistance: Must be a list of resistances',
    ]);
  });

  it('a type is the system\'s own only with a name; every starter one, on or off', () => {
    const ids = damageTypeIdsOf({ damage: { types: { sonic: { name: 'Sonic' }, nameless: {}, Bad: { name: 'Bad' }, necrotic: { on: false } } } });
    expect(ids.has('sonic')).toBe(true);
    expect(ids.has('necrotic')).toBe(true);
    expect(ids.has('physical')).toBe(true);
    expect(ids.has('nameless')).toBe(false);
    expect(ids.has('Bad')).toBe(false);
    expect(damageTypeIdsOf(undefined).has('fire')).toBe(true);
  });
});

describe('two for one type', () => {
  it('IMMUNE beats either; RESIST and VULNERABLE come to nothing; one is itself', () => {
    expect(kindOf(['resist'])).toBe('resist');
    expect(kindOf(['vulnerable'])).toBe('vulnerable');
    expect(kindOf(['resist', 'resist'])).toBe('resist');
    expect(kindOf(['resist', 'immune', 'vulnerable'])).toBe('immune');
    expect(kindOf(['vulnerable', 'immune'])).toBe('immune');
    expect(kindOf(['resist', 'vulnerable'])).toBe(null);
    expect(kindOf([])).toBe(null);
  });

  it('a row read as written, the ill-formed passed over', () => {
    expect(resistancesIn([{ kind: 'resist', type: 'fire', extra: 1 }, { kind: 'nope', type: 'fire' }, { kind: 'immune' }, null])).toEqual([{ kind: 'resist', type: 'fire' }]);
    expect(resistancesIn('fire')).toEqual([]);
  });
});

describe('where they come from', () => {
  it('a feature while it is unlocked, named by it: Dwarven Resilience at 1, Deep Blood from 3', () => {
    expect(resistancesOf(STONE, {})).toEqual({});
    expect(resistancesOf(STONE, dwarf(1))).toEqual({ poison: { kind: 'resist', from: [{ kind: 'resist', from: 'Dwarven Resilience' }] } });
    // Deep Blood: IMMUNE beats the RESIST beside it; Sonic is the system's own.
    expect(resistancesOf(STONE, dwarf(3))).toEqual({
      poison: { kind: 'immune', from: [{ kind: 'resist', from: 'Dwarven Resilience' }, { kind: 'immune', from: 'Deep Blood' }] },
      sonic: { kind: 'vulnerable', from: [{ kind: 'vulnerable', from: 'Deep Blood' }] },
    });
  });

  it('an item while it works, named by the item: the ring worn, the dampers installed; gone when taken off', () => {
    const carried = { inventory: gear('Ring of Warmth', 'Ear Dampers') };
    expect(resistancesOf(STONE, carried)).toEqual({});
    const worn = act(carried, { kind: 'wear', item: 'ring' });
    expect(resistancesOf(STONE, worn)).toEqual({ cold: { kind: 'resist', from: [{ kind: 'resist', from: 'Ring of Warmth' }] } });
    const installed = act(worn, { kind: 'install', item: 'dampers' });
    expect(kinds(resistancesOf(STONE, installed))).toEqual({ cold: 'resist', sonic: 'resist' });
    expect(resistancesOf(STONE, installed).sonic.from).toEqual([{ kind: 'resist', from: 'Ear Dampers' }]);
    // Taken off, and the installed one with Deep Blood's VULNERABLE: the two come to nothing, both still said.
    const off = act({ ...installed, ...dwarf(3) }, { kind: 'takeOff', item: 'ring' });
    expect(off[WORN_KEY].ring).toBeUndefined();
    const both = resistancesOf(STONE, off);
    expect(both.cold).toBeUndefined();
    expect(both.sonic).toEqual({ kind: null, from: [{ kind: 'vulnerable', from: 'Deep Blood' }, { kind: 'resist', from: 'Ear Dampers' }] });
  });

  it('a condition while it is on the token, named by it; ALL counting for every type that is on', () => {
    expect(conditionsOf(STONE).find((c) => c.id === 'petrified').resistances).toEqual([{ kind: 'resist', type: 'all' }]);
    expect(conditionsOf(STONE).find((c) => c.id === 'blinded')).not.toHaveProperty('resistances');
    // As written, the ill-formed left out; an empty row none at all.
    const messy = conditionsOf({ conditions: { prone: { resistances: [{ kind: 'resist', type: 'fire', amount: 2 }, null, { kind: 'immune' }] }, stunned: { resistances: [] } } });
    expect(messy.find((c) => c.id === 'prone').resistances).toEqual([{ kind: 'resist', type: 'fire' }]);
    expect(messy.find((c) => c.id === 'stunned')).not.toHaveProperty('resistances');
    expect(resistancesOf(STONE, {}, ['soaked'])).toEqual({
      fire: { kind: 'resist', from: [{ kind: 'resist', from: 'Soaked' }] },
      lightning: { kind: 'vulnerable', from: [{ kind: 'vulnerable', from: 'Soaked' }] },
    });
    const all = resistancesOf(STONE, dwarf(3), ['petrified', 'soaked', 'not_one', 7]);
    // Every type that is on: the 12 starters still on, and Sonic; Necrotic is off, so not there.
    expect(Object.keys(all)).toHaveLength(13);
    expect(all.necrotic).toBeUndefined();
    expect(all.acid).toEqual({ kind: 'resist', from: [{ kind: 'resist', from: 'Petrified', all: true }] });
    expect(all.poison.kind).toBe('immune');
    expect(all.lightning).toEqual({ kind: null, from: [{ kind: 'resist', from: 'Petrified', all: true }, { kind: 'vulnerable', from: 'Soaked' }] });
    expect(all.fire.from).toEqual([{ kind: 'resist', from: 'Petrified', all: true }, { kind: 'resist', from: 'Soaked' }]);
  });

  it('a condition switched off counts for nothing; a type switched off is kept in the row and counts once it is on', () => {
    expect(resistancesOf({ ...STONE, conditions: { ...STONE.conditions, stunned: { on: false, resistances: [{ kind: 'resist', type: 'all' }] } } }, {}, ['stunned'])).toEqual({});
    const necrotic = { ...STONE, conditions: { soaked: { name: 'Soaked', resistances: [{ kind: 'immune', type: 'necrotic' }] } } };
    expect(said(necrotic)).toEqual([]);
    expect(resistancesOf(necrotic, {}, ['soaked'])).toEqual({});
    expect(resistancesOf({ ...necrotic, damage: { types: {} } }, {}, ['soaked'])).toEqual({ necrotic: { kind: 'immune', from: [{ kind: 'immune', from: 'Soaked' }] } });
  });

  it('every source, in order: features, items, then conditions', () => {
    const data = act({ ...dwarf(1), inventory: gear('Ring of Warmth') }, { kind: 'wear', item: 'ring' });
    expect(resistanceSourcesOf(STONE, data, ['soaked'])).toEqual([
      { kind: 'resist', type: 'poison', from: 'Dwarven Resilience' },
      { kind: 'resist', type: 'cold', from: 'Ring of Warmth' },
      { kind: 'vulnerable', type: 'lightning', from: 'Soaked' },
      { kind: 'resist', type: 'fire', from: 'Soaked' },
    ]);
    expect(resistanceSourcesOf(STONE, null)).toEqual([]);
  });
});

describe('the ways in and out', () => {
  it('a CHOICES file changing a feature\'s words keeps its resistances, and says so', () => {
    const r = readChoicesFile(STONE, 'kin', ['[features]', 'option, feature, level, words', 'Dwarf, Dwarven Resilience, 1, Hardy against venom.'].join('\n'));
    const f = r.list.options[0].features.find((x) => x.id === 'resilience');
    expect(f).toEqual({ id: 'resilience', label: 'Dwarven Resilience', at: 1, text: 'Hardy against venom.', resistances: [{ kind: 'resist', type: 'poison' }] });
    expect(r.notes).toEqual([{ line: 3, message: 'Dwarf · Dwarven Resilience keeps its resistances, set in the builder' }]);
  });

  it('an ITEMS file the same', () => {
    const r = readItemsFile(STONE, ['[features]', 'item, feature, words', 'Ring of Warmth, Warm, Never cold.'].join('\n'));
    expect(r.items.list.find((i) => i.id === 'ring').features).toEqual([{ id: 'warm', label: 'Warm', text: 'Never cold.', resistances: [{ kind: 'resist', type: 'cold' }] }]);
    expect(r.notes).toEqual([{ line: 3, message: 'Ring of Warmth · Warm keeps its resistances, set in the builder' }]);
  });

  it('the system\'s file carries every row, read back the same', () => {
    const file = citysys.buildFile({ definition: STONE, version: 1, origin: 'org_stone' });
    const back = citysys.readFile(JSON.stringify(file));
    expect(back.problems).toEqual([]);
    expect(back.file.definition.choices).toEqual(STONE.choices);
    expect(back.file.definition.items).toEqual(STONE.items);
    expect(back.file.definition.conditions).toEqual(STONE.conditions);
  });
});

describe('a built-in game\'s own conditions', () => {
  it('have no resistances: they would change the game\'s rules', () => {
    const { checkTableConditions } = require_('../systemBuilder/tableConditions');
    expect(checkTableConditions({ wet: { name: 'Wet', resistances: [{ kind: 'resist', type: 'fire' }] } }).map((p) => `${p.where}: ${p.message}`)).toContain('condition wet, resistances: Not part of a condition');
  });
});
