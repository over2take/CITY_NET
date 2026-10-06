/**
 * The SETUP page as logic (4a3a). Approved mockup builder-setup (2026-10-06): five questions on one
 * page, a live preview of the starter sheet's HEALTH section. What it offers and previews is held
 * here to the server's own (backend/systemBuilder/core.js), which checks and builds the real thing.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  HEALTH_MODELS, ADVANCEMENT, DISTANCE, COMMON_DICE, MAX_DICE, LIST_LIMITS, defaultHealth, idFor, setupOf, withCover, withCore,
  toggleAdvancement, toggleDie, addDie, healthLayout, tokenNote, type Health,
} from '../setup';

const core = createRequire(import.meta.url)('../../../../backend/systemBuilder/core.js');
const { checkDefinition } = createRequire(import.meta.url)('../../../../backend/systemBuilder/definition.js');

const ok = (def: object) => checkDefinition(def).problems;

describe('held to the server', () => {
  it('offers the server\'s health models, advancement kinds and units', () => {
    expect(HEALTH_MODELS).toEqual(core.HEALTH_MODELS);
    expect(ADVANCEMENT).toEqual(core.ADVANCEMENT);
    // Every unit, feet first since it is what a system says nothing about.
    expect([...DISTANCE.map((d) => d.id)].sort()).toEqual([...core.DISTANCE].sort());
    expect(DISTANCE[0].id).toBe('feet');
  });

  it('every model\'s starting shape is one the server accepts', () => {
    for (const m of HEALTH_MODELS) {
      expect(ok({ format: 1, name: 'Hearth', core: { health: defaultHealth(m.id) } }), m.id).toEqual([]);
    }
  });

  it('previews exactly the health sections the server builds, for every model and its edge cases', () => {
    const cases: unknown[] = [
      ...HEALTH_MODELS.map((m) => defaultHealth(m.id)),
      { model: 'pool', label: 'VIGOR' }, { model: 'pool', label: '  ' }, undefined, null, 'pool', { model: 'nonsense' },
      { model: 'tracks', tracks: [{ id: 'only', label: 'ONLY' }] },
      { model: 'typed', types: [{ id: 'a', label: 'A' }, 'junk'] },
      { model: 'harm', levels: [{ id: 'bad', label: 'BAD', slots: 'two' }, { id: 'worse', label: 'WORSE', slots: 3 }] },
      { model: 'wounds', count: 'many' }, { model: 'wounds', count: 4 },
      { model: 'locations', locations: [] },
    ];
    for (const h of cases) {
      expect(healthLayout(h), JSON.stringify(h)).toEqual(core.healthLayout(h));
      expect(healthLayout(h, 'VIGOR'), JSON.stringify(h)).toEqual(core.healthLayout(h, 'VIGOR'));
    }
  });

  it('every die it offers, and every one addDie lets in, is one the server accepts', () => {
    expect(ok({ format: 1, name: 'Hearth', core: { dice: COMMON_DICE.slice(0, MAX_DICE) } })).toEqual([]);
    for (const typed of ['d7', '3d8', 'd100', 'dF', '99d2']) {
      const r = addDie([], typed);
      expect('dice' in r, typed).toBe(true);
      if ('dice' in r) expect(ok({ format: 1, name: 'H', core: { dice: r.dice } }), typed).toEqual([]);
    }
    for (const typed of ['d1', 'd101', '0d6', '100d6', 'd', 'six']) {
      expect(addDie([], typed), typed).toEqual({ error: `${typed} is not a die (d2 to d100, or dF, with a count: 2d6)` });
      expect(ok({ format: 1, name: 'H', core: { dice: [typed] } }).length, typed).toBeGreaterThan(0);
    }
  });

  it('keeps each model\'s list within the server\'s limits', () => {
    const named = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, label: `E${i}` }));
    const shapes: Record<keyof typeof LIST_LIMITS, (n: number) => object> = {
      tracks: (n) => ({ model: 'tracks', tracks: named(n) }),
      types: (n) => ({ model: 'typed', types: named(n) }),
      levels: (n) => ({ model: 'harm', levels: named(n).map((l) => ({ ...l, slots: 1 })) }),
      locations: (n) => ({ model: 'locations', locations: named(n) }),
    };
    for (const [key, [min, max]] of Object.entries(LIST_LIMITS) as [keyof typeof LIST_LIMITS, readonly [number, number]][]) {
      expect(ok({ format: 1, name: 'H', core: { health: shapes[key](min) } }), `${key} ${min}`).toEqual([]);
      expect(ok({ format: 1, name: 'H', core: { health: shapes[key](max) } }), `${key} ${max}`).toEqual([]);
      expect(ok({ format: 1, name: 'H', core: { health: shapes[key](max + 1) } }).length, `${key} ${max + 1}`).toBeGreaterThan(0);
      if (min > 1) expect(ok({ format: 1, name: 'H', core: { health: shapes[key](min - 1) } }).length, `${key} ${min - 1}`).toBeGreaterThan(0);
    }
  });
});

describe('ids for new entries', () => {
  it('come from the label, as the server allows, and never repeat', () => {
    expect(idFor('LEFT ARM', [])).toBe('left_arm');
    expect(idFor('LEFT  -  ARM', [])).toBe('left_arm');
    expect(idFor('  Stun!! ', [])).toBe('stun');
    expect(idFor('2nd wind', [])).toBe('x2nd_wind');
    expect(idFor('', [])).toBe('x');
    expect(idFor('Head', ['head'])).toBe('head_2');
    expect(idFor('Head', ['head', 'head_2'])).toBe('head_3');
    expect(idFor('A'.repeat(60), []).length).toBe(36);
    for (const label of ['LEFT ARM', '2nd wind', '', '!!!', 'Ünïcode']) {
      expect(idFor(label, []), label).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    }
  });
});

describe('reading a system', () => {
  it('reads what the definition says', () => {
    const def = {
      format: 1, name: 'Hearth', description: 'By one fire.', author: 'Cody', license: 'CC BY 4.0',
      core: { health: defaultHealth('wounds'), advancement: ['milestone'], dice: ['d6', '2d6'], distance: 'meters' },
    };
    expect(setupOf(def)).toEqual({
      description: 'By one fire.', author: 'Cody', license: 'CC BY 4.0',
      health: defaultHealth('wounds'), advancement: ['milestone'], dice: ['d6', '2d6'], distance: 'meters',
    });
  });

  it('fills in what it leaves out: one pool, no advancement, no dice, feet', () => {
    const blank = { description: '', author: '', license: '', health: { model: 'pool' }, advancement: [], dice: [], distance: 'feet' };
    expect(setupOf({ format: 1, name: 'Hearth' })).toEqual(blank);
    expect(setupOf(null)).toEqual(blank);
    expect(setupOf({ format: 1, name: 'H', description: 4, core: { health: { model: 'tentacles' }, advancement: 'levels', dice: ['d6', 7], distance: 'leagues' } }))
      .toEqual({ ...blank, dice: ['d6'] });
    expect(setupOf({ format: 1, name: 'H', core: 'yes' })).toEqual(blank);
    expect(setupOf({ format: 1, name: 'H', core: { advancement: ['levels', 3, null] } }).advancement).toEqual(['levels']);
  });
});

describe('writing it back', () => {
  const def = { format: 1, name: 'Hearth', core: { dice: ['d20'] } };

  it('sets a cover field, and leaves a blank one out', () => {
    expect(withCover(def, 'description', 'By one fire.')).toEqual({ ...def, description: 'By one fire.' });
    expect(withCover({ ...def, author: 'Cody' }, 'author', '   ')).toEqual(def);
    expect(def).toEqual({ format: 1, name: 'Hearth', core: { dice: ['d20'] } });
  });

  it('replaces some core answers, keeping the rest', () => {
    expect(withCore(def, { distance: 'zones' })).toEqual({ ...def, core: { dice: ['d20'], distance: 'zones' } });
    expect(withCore({ format: 1, name: 'H' }, { advancement: [] })).toEqual({ format: 1, name: 'H', core: { advancement: [] } });
    expect(def.core).toEqual({ dice: ['d20'] });
  });

  it('turns advancement on and off, in the page\'s order', () => {
    expect(toggleAdvancement([], 'spend')).toEqual(['spend']);
    expect(toggleAdvancement(['spend'], 'levels')).toEqual(['levels', 'spend']);
    expect(toggleAdvancement(['levels', 'spend'], 'levels')).toEqual(['spend']);
  });

  it('turns dice on and off, up to eight', () => {
    expect(toggleDie(['d20'], 'd6')).toEqual(['d20', 'd6']);
    expect(toggleDie(['d20', 'd6'], 'd20')).toEqual(['d6']);
    const eight = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', '2d6'];
    expect(toggleDie(eight, '3d6')).toEqual(eight);
    expect(addDie(eight, 'd7')).toEqual({ error: 'Up to 8 dice' });
    expect(addDie(['d7'], ' d7 ')).toEqual({ dice: ['d7'] });
  });
});

describe('what the token shows', () => {
  it('says it for every model', () => {
    const notes = Object.fromEntries(HEALTH_MODELS.map((m) => [m.id, tokenNote(defaultHealth(m.id))]));
    expect(notes).toEqual({
      pool: 'The token\'s monitor shows HP.',
      tracks: 'The token\'s monitor shows PHYSICAL; STUN lives on the sheet. A full STUN spills into PHYSICAL.',
      typed: 'The token\'s monitor shows HEALTH; heavier damage turns lighter boxes over.',
      harm: 'No number on the token: it shows the worst level taken.',
      wounds: 'Out after 3 wounds, each giving -1 to rolls.',
      locations: 'Injuries are noted per location, under the health pool.',
      none: 'No health section. Consequences are written in as conditions.',
    });
    expect(tokenNote({ model: 'pool', label: 'VIGOR' })).toBe('The token\'s monitor shows VIGOR.');
    expect(tokenNote({ ...(defaultHealth('tracks') as Extract<Health, { model: 'tracks' }>), overflow: false })).toBe('The token\'s monitor shows PHYSICAL; STUN lives on the sheet.');
    expect(tokenNote({ model: 'wounds', count: 4 })).toBe('Out after 4 wounds.');
  });
});
