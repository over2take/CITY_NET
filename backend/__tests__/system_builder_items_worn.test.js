import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * Items at the table, the server's half (7e3a; approved mockup docs/mockups/items.html, 2026-11-10, and the user's calls):
 * an item is carried while a readied or stowed gear line has its name; WEAR and TAKE OFF are free; ATTUNE needs it worn and
 * a slot free, or the GM's ATTUNE ANYWAY; taken off it stays attuned until ENDed; the GM sets a character's own count. A
 * working item's features count as an unlocked feature's do: the numbers, has(), their uses, the token's maximum.
 */

const require_ = createRequire(import.meta.url);
const { itemAction, carriedNames, slotUsed, slotCount, workingItems, itemsShown, WORN_KEY, SLOTS_KEY } = require_('../systemBuilder/items');
const { effectiveData, overlayOf, workedOf, usesOf, itemsRenderedOf, choicesShown } = require_('../systemBuilder/choices');
const { pickAction } = require_('../systemBuilder/picking');
const { compileSystem } = require_('../systemBuilder/derived');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const WORN = {
  format: 1, name: 'Worn', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
  derived: [{ id: 'luck', label: 'Luck', formula: '2 * has(lucky_coin) + has(lucky)' }],
  rests: { long_rest: { name: 'Long rest' } },
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 1 }],
    list: [
      { id: 'ring', label: 'Ring of Constitution', needs: 'attuned', features: [{ id: 'hardy', label: 'Hardy', modifiers: [{ target: 'con', amount: '2', cap: 20 }, { target: 'hp_max', amount: '5' }] }] },
      { id: 'cloak', label: 'Cloak', needs: 'attuned', features: [{ id: 'warded', label: 'Warded', modifiers: [{ target: 'con', amount: '1' }] }] },
      { id: 'boots', label: 'Boots', features: [{ id: 'quiet', label: 'Quiet', uses: { count: '1', refill: 'long_rest' } }] },
      { id: 'lucky_coin', label: 'Lucky Coin', needs: 'carried', features: [{ id: 'lucky', label: 'Lucky' }] },
    ],
  },
};
const gear = (...rows) => JSON.stringify(rows.map(([name, carry = 'stowed']) => ({ name, qty: 1, enc: '', bundled: false, carry, location: '' })));
const ALL = gear(['Ring of Constitution'], ['Cloak', 'readied'], ['Boots'], ['lucky coin']);
const act = (data, action, opts = {}) => itemAction(WORN, data, action, opts);
const GM = { gm: true };
const after = (data, ...actions) => actions.reduce((d, a) => { const done = act(d, a.action || a, a.gm ? GM : {}); if (!done.ok) throw new Error(done.error); return done.data; }, data);

describe('carried', () => {
  it('a readied or stowed line with its name, in any case; never one stashed, never what isn\'t gear', () => {
    expect([...carriedNames({ inventory: gear(['Ring'], ['Cloak', 'readied'], ['Boots', 'stash']) })]).toEqual(['ring', 'cloak']);
    expect([...carriedNames({ inventory: JSON.parse(gear(['  Ring  '])) })]).toEqual(['ring']);
    for (const inventory of ['not json', '', undefined, 5, [null, { carry: 'stowed' }]]) expect([...carriedNames({ inventory })], String(inventory)).toEqual([]);
    expect([...carriedNames(null)]).toEqual([]);
    // A line saying nothing of where it is, or something else, is stashed, as the sheet reads it.
    expect([...carriedNames({ inventory: [{ name: 'Ring' }, { name: 'Cloak', carry: 'pocket' }] })]).toEqual([]);
  });
});

describe('WEAR and TAKE OFF', () => {
  it('free, for what is carried; nothing to wear for what works carried', () => {
    const data = { inventory: ALL };
    expect(act(data, { kind: 'wear', item: 'boots' }).data[WORN_KEY]).toEqual({ boots: { worn: true } });
    expect(act({ inventory: gear(['Boots', 'stash']) }, { kind: 'wear', item: 'boots' }).error).toBe('Boots isn\'t in their gear, readied or stowed');
    expect(act(data, { kind: 'wear', item: 'lucky_coin' }).error).toBe('Lucky Coin works while carried: nothing to wear');
    expect(act(after(data, { kind: 'wear', item: 'boots' }), { kind: 'wear', item: 'boots' }).error).toBe('Boots is worn already');
    expect(act(data, { kind: 'wear', item: 'nope' }).error).toBe('No such item');
    const off = act(after(data, { kind: 'wear', item: 'boots' }), { kind: 'takeOff', item: 'boots' }).data;
    expect(off).not.toHaveProperty(WORN_KEY);
    expect(act(data, { kind: 'takeOff', item: 'boots' }).error).toBe('Boots isn\'t worn');
    expect(act(data, { kind: 'dance', item: 'boots' }).error).toBe('Nothing to do');
    expect(act(data, null).error).toBe('Nothing to do');
  });
});

describe('ATTUNE and END', () => {
  const data = { inventory: ALL };
  it('worn first, with a slot free; the slot\'s own word when none is', () => {
    expect(act(data, { kind: 'attune', item: 'ring' }).error).toBe('Wear Ring of Constitution first');
    const tuned = after(data, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' });
    expect(tuned[WORN_KEY]).toEqual({ ring: { worn: true, attuned: true } });
    expect(slotUsed(WORN, tuned, 'attuned')).toBe(1);
    expect(act(tuned, { kind: 'attune', item: 'ring' }).error).toBe('Ring of Constitution is attuned already');
    const cloakOn = after(tuned, { kind: 'wear', item: 'cloak' });
    expect(act(cloakOn, { kind: 'attune', item: 'cloak' }).error).toBe('No ATTUNED free: end one first, or ask your GM');
    expect(act(data, { kind: 'attune', item: 'boots' }).error).toBe('Boots needs no slot');
    // Worn, then stashed: not on them, so not attuned.
    const stashed = { ...after(data, { kind: 'wear', item: 'ring' }), inventory: gear(['Ring of Constitution', 'stash']) };
    expect(act(stashed, { kind: 'attune', item: 'ring' }).error).toBe('Wear Ring of Constitution first');
    // What is stored as worn only counts when it says so.
    expect(act({ ...data, [WORN_KEY]: { ring: { worn: 'yes' } } }, { kind: 'attune', item: 'ring' }).error).toBe('Wear Ring of Constitution first');
  });

  it('the GM attunes anyway past the count; free again, not anyway', () => {
    const full = after(data, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' }, { kind: 'wear', item: 'cloak' });
    const anyway = act(full, { kind: 'attune', item: 'cloak' }, GM).data;
    expect(anyway[WORN_KEY].cloak).toEqual({ worn: true, attuned: true, anyway: true });
    expect(slotUsed(WORN, anyway, 'attuned')).toBe(2);
    // Taken off, still attuned anyway.
    expect(act(anyway, { kind: 'takeOff', item: 'cloak' }, GM).data[WORN_KEY].cloak).toEqual({ attuned: true, anyway: true });
    // With one free, the GM's is an ordinary attuning.
    expect(act(after(data, { kind: 'wear', item: 'cloak' }), { kind: 'attune', item: 'cloak' }, GM).data[WORN_KEY].cloak).toEqual({ worn: true, attuned: true });
  });

  it('taken off, still attuned, its slot still used, doing nothing; END frees it', () => {
    const off = after(data, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' }, { kind: 'takeOff', item: 'ring' });
    expect(off[WORN_KEY]).toEqual({ ring: { attuned: true } });
    expect(slotUsed(WORN, off, 'attuned')).toBe(1);
    expect(workingItems(WORN, off).map((i) => i.id)).toEqual(['lucky_coin']);
    const ended = act(off, { kind: 'end', item: 'ring' }).data;
    expect(ended).not.toHaveProperty(WORN_KEY);
    expect(act(data, { kind: 'end', item: 'ring' }).error).toBe('Ring of Constitution isn\'t attuned');
    // END on an attuned-anyway one drops anyway too.
    const anyway = act(after(data, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' }, { kind: 'wear', item: 'cloak' }), { kind: 'attune', item: 'cloak' }, GM).data;
    expect(act(anyway, { kind: 'end', item: 'cloak' }).data[WORN_KEY].cloak).toEqual({ worn: true });
  });

  it('a slot is used only by what is carried: one stashed frees it', () => {
    const tuned = after(data, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' });
    expect(slotUsed(WORN, { ...tuned, inventory: gear(['Ring of Constitution', 'stash']) }, 'attuned')).toBe(0);
  });
});

describe('the GM\'s count for one character', () => {
  it('set, from 0 to 20, the GM\'s alone; none: the system\'s', () => {
    const data = { inventory: ALL };
    expect(act(data, { kind: 'slots', slot: 'attuned', count: 3 }).error).toBe('That is the GM\'s to do');
    const three = act(data, { kind: 'slots', slot: 'attuned', count: 3 }, GM).data;
    expect(three[SLOTS_KEY]).toEqual({ attuned: 3 });
    expect(slotCount(WORN, three, WORN.items.slots[0])).toBe(3);
    // Now two fit.
    const both = after(three, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' }, { kind: 'wear', item: 'cloak' }, { kind: 'attune', item: 'cloak' });
    expect(slotUsed(WORN, both, 'attuned')).toBe(2);
    for (const count of [-1, 21, 1.5, '3']) expect(act(data, { kind: 'slots', slot: 'attuned', count }, GM).error, String(count)).toBe('From 0 to 20');
    expect(act(three, { kind: 'slots', slot: 'attuned', count: null }, GM).data).not.toHaveProperty(SLOTS_KEY);
    expect(act(three, { kind: 'slots', slot: 'attuned' }, GM).data).not.toHaveProperty(SLOTS_KEY);
    expect(act(data, { kind: 'slots', slot: 'bound', count: 1 }, GM).error).toBe('No such slot');
    expect(slotCount(WORN, { [SLOTS_KEY]: { attuned: 99 } }, WORN.items.slots[0])).toBe(1);
  });
});

describe('what a working item does', () => {
  const tuned = after({ inventory: ALL, con: 19 }, { kind: 'wear', item: 'ring' }, { kind: 'attune', item: 'ring' });

  it('its bonuses, named by the item, its caps kept; worn but not attuned, nothing', () => {
    expect(effectiveData(WORN, tuned).con).toBe(20);
    expect(overlayOf(WORN, tuned).from.con).toEqual([{ feature: 'Ring of Constitution', amount: 2, got: 1, stop: 20 }]);
    expect(overlayOf(WORN, tuned).from.hp_max).toEqual([{ feature: 'Ring of Constitution', amount: 5 }]);
    const worn = after({ inventory: ALL, con: 19 }, { kind: 'wear', item: 'ring' });
    expect(effectiveData(WORN, worn).con).toBe(19);
    expect(effectiveData(WORN, { inventory: ALL, con: 19 }).con).toBe(19);
  });

  it('has() reads the item and its features while it works', () => {
    const luck = (data) => { const sheet = { ...data }; compileSystem({ derived: WORN.derived }).system.apply(sheet, overlayOf(WORN, sheet)); return sheet.luck; };
    expect(luck({ inventory: ALL })).toBe(3);
    expect(luck({ inventory: gear(['Lucky Coin', 'stash']) })).toBe(0);
  });

  it('its uses, ticked as a feature\'s are, while it works', () => {
    const worn = after({ inventory: ALL }, { kind: 'wear', item: 'boots' });
    expect(usesOf(WORN, worn).map((u) => [u.feature.id, u.max, u.refill])).toEqual([['quiet', 1, 'long_rest']]);
    expect(usesOf(WORN, { inventory: ALL })).toEqual([]);
    expect(pickAction(WORN, worn, { kind: 'use', feature: 'quiet', spent: 1 }).ok).toBe(true);
  });

  it('what the sheet is told: each carried item\'s state, each slot\'s count and use', () => {
    const shown = itemsShown(WORN, tuned);
    expect(shown.items).toEqual([
      { id: 'ring', needs: 'attuned', worn: true, attuned: true, working: true },
      { id: 'cloak', needs: 'attuned' }, { id: 'boots', needs: 'worn' }, { id: 'lucky_coin', needs: 'carried', working: true },
    ]);
    expect(shown.slots).toEqual([{ id: 'attuned', count: 1, used: 1 }]);
    expect(itemsShown(WORN, { inventory: gear(['Boots']) }).items).toEqual([{ id: 'boots', needs: 'worn' }]);
    expect(workedOf(WORN, tuned)).toMatchObject({ items: shown.items, slots: shown.slots });
    expect(workedOf({ ...WORN, items: undefined }, tuned)).not.toHaveProperty('items');
  });
});

describe('the render copy (7e3b)', () => {
  it('each slot by name and count, each item\'s words, what it needs and its features in words; null without', () => {
    const shown = itemsRenderedOf({ ...WORN, items: { ...WORN.items, list: [...WORN.items.list, { id: 'pin', description: '  ', features: [{ label: 'no id' }, { id: 'f' }] }] } });
    expect(shown.slots).toEqual([{ id: 'attuned', label: 'ATTUNED', count: 1 }]);
    expect(shown.list.map((i) => [i.id, i.label, i.needs])).toEqual([
      ['ring', 'Ring of Constitution', 'attuned'], ['cloak', 'Cloak', 'attuned'], ['boots', 'Boots', 'worn'], ['lucky_coin', 'Lucky Coin', 'carried'], ['pin', 'pin', 'worn'],
    ]);
    // Read as a pick's features are, by the same hand: what it changes by name, its uses and when they come back.
    expect(shown.list[0].features).toEqual([{ id: 'hardy', label: 'Hardy', modifies: ['Con', 'HP MAX'] }]);
    expect(shown.list[2].features).toEqual([{ id: 'quiet', label: 'Quiet', uses: { refill: 'Long rest' } }]);
    // Never a level, as only a levelled list's are.
    expect(shown.list[0].features[0]).not.toHaveProperty('at');
    expect(shown.list[4]).toEqual({ id: 'pin', label: 'pin', needs: 'worn', features: [{ id: 'f', label: 'f' }] });
    expect(itemsRenderedOf({ ...WORN, items: { slots: [{ id: 'bond', label: 'BONDED' }, { id: 'tied', count: 2 }] } })).toEqual({ slots: [{ id: 'bond', label: 'BONDED', count: 0 }, { id: 'tied', label: 'tied', count: 2 }], list: [] });
    expect(itemsRenderedOf({ ...WORN, items: { list: [{ id: 'x', label: 'X', description: 'Shiny.' }] } })).toEqual({ slots: [], list: [{ id: 'x', label: 'X', description: 'Shiny.', needs: 'worn', features: [] }] });
    expect(itemsRenderedOf({ ...WORN, items: undefined })).toBeNull();
    expect(itemsRenderedOf({ ...WORN, items: {} })).toBeNull();
    // On the copy the sheet loads.
    expect(runtime.renderOf('sys_x', WORN).items).toEqual(itemsRenderedOf(WORN));
    expect(runtime.renderOf('sys_x', { ...WORN, items: undefined }).items).toBeNull();
  });

  it('a pick\'s features read as they did, the level where its list unlocks by level', () => {
    const def = { ...WORN, choices: [{ id: 'class', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [{ id: 'tough', label: 'Tough', at: 3, text: 'Hard.', modifiers: [{ target: 'con', amount: '1' }] }, { id: 'grit' }] }] },
      { id: 'feat', one: 'Feat', many: 'Feats', options: [{ id: 'alert', features: [{ id: 'quick', label: 'Quick', at: 2 }] }] }] };
    const [cls, feat] = choicesShown(def);
    expect(cls.options[0].features).toEqual([{ id: 'tough', label: 'Tough', text: 'Hard.', at: 3, modifies: ['Con'] }, { id: 'grit', label: 'grit', at: 1 }]);
    expect(feat.options[0].features).toEqual([{ id: 'quick', label: 'Quick' }]);
  });
});

describe('through the socket', () => {
  it('worn and attuned, the ring\'s HP MAX bonus moves the token; refused in words', async () => {
    const db = await makeTestDb();
    const ID = 'sys_wornwornworn1234';
    const def = JSON.stringify(WORN);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Worn', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', inventory: ALL })]);
    await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES (\'Kes\', 0, 0, 0, \'rhombus\', \'kes\', 10, 10)');
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const heard = [];
    connection({ id: 'worn-kes', on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => heard.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    const token = async () => (await get(db, 'SELECT hp_max FROM locations WHERE owner = ?', ['kes'])).hp_max;
    handlers.itemAction({ kind: 'attune', item: 'ring' });
    await until(() => heard.some((e) => e.event === 'choicesRefused'), { label: 'refused' });
    expect(heard.find((e) => e.event === 'choicesRefused').data.error).toBe('Wear Ring of Constitution first');
    handlers.itemAction({ kind: 'wear', item: 'ring' });
    handlers.itemAction({ kind: 'attune', item: 'ring' });
    await until(async () => (await token()) === 15, { label: 'the token moved' });
    const stored = JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    expect(stored[WORN_KEY]).toEqual({ ring: { worn: true, attuned: true } });
    expect(stored._worked.slots).toEqual([{ id: 'attuned', count: 1, used: 1 }]);
  });
});
