import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * Items installed (7e4a; approved mockup docs/mockups/installed.html, 2026-11-11, and the user's calls): an INSTALL is
 * made like a slot, each costing against a stat or formula, ADDING TO it up to a limit or TAKING FROM it down to one. The
 * player or the GM installs an item while its line is in the gear; past the limit only the GM. It stays in the gear,
 * shops won't buy it, its cost is overlaid as one of its modifiers, and REMOVE gives it back at once.
 */

const require_ = createRequire(import.meta.url);
const { itemAction, itemsShown, installedCost, installedNames, workingItems, WORN_KEY } = require_('../systemBuilder/items');
const { checkChoices, effectiveData, overlayOf, workedOf, valueOn } = require_('../systemBuilder/choices');
const runtime = require_('../systemBuilder/runtime');
const store = require_('../shops/catalogueStore');
const { planSale } = require_('../shops/sell');
const socketsFactory = require_('../sockets/index.js');

const WIRED = {
  format: 1, name: 'Wired', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'strain', label: 'Strain' }, { id: 'essence', label: 'Essence' }] }],
  derived: [{ id: 'reflex', label: 'Reflex', formula: '10 + has(booster)' }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 1 }],
    installs: [
      { id: 'cyberware', label: 'CYBERWARE', against: 'strain', way: 'adds', limit: '@might' },
      { id: 'bioware', label: 'BIOWARE', against: 'essence', way: 'takes', limit: '0' },
    ],
    list: [
      { id: 'jack', label: 'Cranial Jack', needs: 'cyberware', cost: 1, features: [{ id: 'jacked', label: 'Jacked', modifiers: [{ target: 'reflex', amount: '1' }] }] },
      { id: 'dermal', label: 'Dermal Armor', needs: 'cyberware', cost: 1.5, features: [] },
      { id: 'booster', label: 'Reflex Booster', needs: 'cyberware', cost: 2, features: [] },
      { id: 'tweak', label: 'Muscle Tweak', needs: 'bioware', cost: 0.25, features: [] },
      { id: 'ring', label: 'Ring', needs: 'attuned', features: [] },
    ],
  },
};
const gear = (...rows) => JSON.stringify(rows.map(([name, carry = 'stowed']) => ({ name, qty: 1, enc: '', bundled: false, carry, location: '' })));
const ALL = gear(['Cranial Jack'], ['Dermal Armor', 'readied'], ['Reflex Booster'], ['Muscle Tweak'], ['Ring']);
const readValue = (data) => (text) => valueOn(WIRED, data, text);
const act = (data, action, gm = false) => itemAction(WIRED, data, action, { gm, readValue: readValue(data) });
const after = (data, ...actions) => actions.reduce((d, a) => { const done = act(d, a.action || a, a.gm); if (!done.ok) throw new Error(done.error); return done.data; }, data);
const problemsOf = (items) => { const problems = []; checkChoices({ ...WIRED, items }, problems); return problems; };

describe('the checks', () => {
  it('a system with installs is well formed', () => {
    expect(problemsOf(WIRED.items)).toEqual([]);
  });

  it('an install: a name of its own among slots and installs, a stat or formula to cost against, a way, a limit', () => {
    const bad = problemsOf({ ...WIRED.items, installs: [
      { id: 'attuned', label: 'X', against: 'strain', limit: '1' },
      { id: 'worn', label: 'Y', against: 'strain', limit: '1' },
      { id: 'a', label: '  ', against: 'nope', way: 'sideways', limit: '@might +', extra: 1 },
      { id: 'b', label: 'B', against: 'hp_max', limit: '' },
      'not one',
    ] });
    const said = bad.map((p) => `${p.where}: ${p.message}`);
    expect(said).toContain('install attuned: A slot or another install has this id already');
    expect(said).toContain('install worn: worn is what an item needs without an install: call it something else');
    expect(said).toContain('install a, label: Cannot be blank');
    expect(said).toContain('install a, against: A stat or formula of this system');
    expect(said).toContain('install a, way: adds or takes');
    expect(said).toContain('install a, extra: Not part of an install');
    expect(said.some((s) => s.startsWith('install a, limit: '))).toBe(true);
    expect(said).toContain('install b, against: Not the token\'s maximum: its bonuses live on the token');
    expect(said).toContain('install b, limit: Must be formula text');
    expect(said).toContain('install 5: Must be an install');
    expect(problemsOf({ ...WIRED.items, installs: {} }).map((p) => p.message)).toContain('Must be a list of installs');
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `i${i}`, label: 'I', against: 'strain', limit: '1' }));
    expect(problemsOf({ installs: many }).map((p) => p.message)).toContain('At most 10 installs');
  });

  it('an item needing an install has a cost, 0 to 1000, fractions allowed; no other item has one', () => {
    const item = (over) => problemsOf({ ...WIRED.items, list: [{ id: 'x', label: 'X', ...over }] }).map((p) => `${p.where}: ${p.message}`);
    expect(item({ needs: 'cyberware', cost: 0.25 })).toEqual([]);
    expect(item({ needs: 'cyberware', cost: 0 })).toEqual([]);
    for (const cost of [undefined, -1, 1001, '1', Infinity]) {
      expect(item({ needs: 'cyberware', cost }), String(cost)).toEqual(['item x, cost: What installing it costs: 0 to 1000, fractions allowed']);
    }
    expect(item({ needs: 'worn', cost: 1 })).toEqual(['item x, cost: Only an item needing an install has a cost']);
    expect(item({ needs: 'nope' })).toEqual(['item x, needs: carried, worn, or one of this system\'s slots or installs']);
  });
});

describe('the system file', () => {
  it('carries the installs and each item\'s cost with the items, and back unchanged', () => {
    const { buildFile, readFile } = require_('../systemBuilder/citysys');
    const file = buildFile({ definition: WIRED, version: 1, origin: 'sys_wiredwiredwired12' });
    expect(file.items.installs).toEqual(WIRED.items.installs);
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.items).toEqual(WIRED.items);
  });
});

describe('the render copy (7e4c)', () => {
  it('each install by name, what it costs against by name, and which way; each item needing one with its cost', () => {
    const { itemsRenderedOf } = require_('../systemBuilder/choices');
    const shown = itemsRenderedOf(WIRED);
    expect(shown.installs).toEqual([
      { id: 'cyberware', label: 'CYBERWARE', against: 'Strain', way: 'adds' },
      { id: 'bioware', label: 'BIOWARE', against: 'Essence', way: 'takes' },
    ]);
    expect(shown.list.map((i) => [i.id, i.cost])).toEqual([['jack', 1], ['dermal', 1.5], ['booster', 2], ['tweak', 0.25], ['ring', undefined]]);
    // Never the limit's formula; an install unnamed or against nothing said as it is.
    expect(JSON.stringify(shown.installs)).not.toContain('@might');
    expect(itemsRenderedOf({ ...WIRED, items: { installs: [{ id: 'x', against: 'nope' }, { id: 'y' }] } }))
      .toEqual({ slots: [], installs: [{ id: 'x', label: 'x', against: 'nope', way: 'adds' }, { id: 'y', label: 'y', against: '', way: 'adds' }], list: [] });
    // A cost on an item not needing an install is never sent.
    expect(itemsRenderedOf({ ...WIRED, items: { ...WIRED.items, list: [{ id: 'r', label: 'R', needs: 'attuned', cost: 3, features: [] }] } }).list[0]).not.toHaveProperty('cost');
    expect(itemsRenderedOf({ ...WIRED, items: { slots: WIRED.items.slots } })).not.toHaveProperty('installs');
  });
});

describe('INSTALL and REMOVE', () => {
  const data = { might: 4, strain: 0, essence: 6, inventory: ALL };

  it('the player installs with room; the cost counted toward the limit', () => {
    const one = after(data, { kind: 'install', item: 'jack' });
    expect(one[WORN_KEY]).toEqual({ jack: { installed: true } });
    const two = after(one, { kind: 'install', item: 'dermal' });
    expect(installedCost(WIRED, two, 'cyberware')).toBe(2.5);
    // 2.5 + 2 is past Might 4: a player can't.
    expect(act(two, { kind: 'install', item: 'booster' }).error).toBe('Reflex Booster would take CYBERWARE past its limit: only your GM can install it');
    // Exactly at the limit is room enough.
    expect(act({ ...two, might: 4.5 }, { kind: 'install', item: 'booster' }).ok).toBe(true);
  });

  it('the GM installs anyway past it, marked so; and where the limit can\'t be read, only the GM', () => {
    const two = after(data, { kind: 'install', item: 'jack' }, { kind: 'install', item: 'dermal' });
    expect(act(two, { kind: 'install', item: 'booster' }, true).data[WORN_KEY].booster).toEqual({ installed: true, anyway: true });
    expect(act(data, { kind: 'install', item: 'jack' }, true).data[WORN_KEY].jack).toEqual({ installed: true });
    const blind = itemAction(WIRED, data, { kind: 'install', item: 'jack' }, { readValue: () => null });
    expect(blind.error).toBe('Cranial Jack would take CYBERWARE past its limit: only your GM can install it');
    expect(itemAction(WIRED, data, { kind: 'install', item: 'jack' }, { gm: true }).data[WORN_KEY].jack).toEqual({ installed: true, anyway: true });
  });

  it('TAKES FROM: down to its floor, never past it for a player', () => {
    const low = { ...data, essence: 0.5 };
    const one = after(low, { kind: 'install', item: 'tweak' });
    expect(one[WORN_KEY].tweak).toEqual({ installed: true });
    expect(act({ ...data, essence: 0.2 }, { kind: 'install', item: 'tweak' }).error).toBe('Muscle Tweak would take BIOWARE past its limit: only your GM can install it');
  });

  it('only in the gear, never twice; REMOVE what is installed, its anyway gone with it', () => {
    expect(act({ ...data, inventory: gear(['Rope']) }, { kind: 'install', item: 'jack' }).error).toBe('Cranial Jack isn\'t in their gear');
    // Stashed is still in the gear: an implant's line is kept wherever it is.
    expect(act({ ...data, inventory: gear(['Cranial Jack', 'stash']) }, { kind: 'install', item: 'jack' }).ok).toBe(true);
    const one = after(data, { kind: 'install', item: 'jack' });
    expect(act(one, { kind: 'install', item: 'jack' }).error).toBe('Cranial Jack is installed already');
    expect(act(one, { kind: 'uninstall', item: 'jack' }).data).not.toHaveProperty(WORN_KEY);
    expect(act(data, { kind: 'uninstall', item: 'jack' }).error).toBe('Cranial Jack isn\'t installed');
    const anyway = act(after(data, { kind: 'install', item: 'jack' }, { kind: 'install', item: 'dermal' }), { kind: 'install', item: 'booster' }, true).data;
    expect(act(anyway, { kind: 'uninstall', item: 'booster' }).data[WORN_KEY]).toEqual({ jack: { installed: true }, dermal: { installed: true } });
  });

  it('an installed item isn\'t worn, and a worn one isn\'t installed', () => {
    for (const kind of ['wear', 'takeOff', 'attune', 'end']) expect(act(data, { kind, item: 'jack' }).error, kind).toBe('Cranial Jack is installed, not worn');
    expect(act(data, { kind: 'install', item: 'ring' }).error).toBe('Ring isn\'t installed: it is worn');
    const coin = { ...WIRED, items: { ...WIRED.items, list: [{ id: 'coin', label: 'Coin', needs: 'carried', features: [] }] } };
    expect(itemAction(coin, { inventory: gear(['Coin']) }, { kind: 'install', item: 'coin' }).error).toBe('Coin isn\'t installed: it is carried');
  });
});

describe('what an installed item does', () => {
  const data = { might: 4, strain: 1, essence: 6, inventory: ALL };
  const wired = () => after(data, { kind: 'install', item: 'jack' }, { kind: 'install', item: 'dermal' }, { kind: 'install', item: 'tweak' });

  it('its cost overlaid on what it costs against, named by it, never written in; its features count', () => {
    const sheet = wired();
    const overlay = overlayOf(WIRED, sheet);
    expect(effectiveData(WIRED, sheet).strain).toBe(3.5);
    expect(effectiveData(WIRED, sheet).essence).toBe(5.75);
    expect(overlay.from.strain).toEqual([{ feature: 'Cranial Jack', amount: 1 }, { feature: 'Dermal Armor', amount: 1.5 }]);
    expect(overlay.from.essence).toEqual([{ feature: 'Muscle Tweak', amount: -0.25 }]);
    expect(overlay.from.reflex).toEqual([{ feature: 'Cranial Jack', amount: 1 }]);
    // The typed Strain is the player's still.
    expect(sheet.strain).toBe(1);
    expect(workingItems(WIRED, sheet).map((i) => i.id)).toEqual(['jack', 'dermal', 'tweak']);
  });

  it('has() reads it; REMOVE gives the cost back at once; its line gone, it stops', () => {
    const booster = after({ ...data, might: 9 }, { kind: 'install', item: 'booster' });
    expect(valueOn(WIRED, booster, 'has(booster)')).toBe(1);
    const sheet = wired();
    expect(effectiveData(WIRED, after(sheet, { kind: 'uninstall', item: 'dermal' })).strain).toBe(2);
    const lost = { ...sheet, inventory: gear(['Dermal Armor'], ['Muscle Tweak']) };
    expect(workingItems(WIRED, lost).map((i) => i.id)).toEqual(['dermal', 'tweak']);
    expect(effectiveData(WIRED, lost).strain).toBe(2.5);
    // Only installed counts: one in the gear, not installed, costs nothing.
    expect(effectiveData(WIRED, data).strain).toBe(1);
  });

  it('a cost of 0 is no modifier at all', () => {
    const free = { ...WIRED, items: { ...WIRED.items, list: [{ id: 'chip', label: 'Chip', needs: 'cyberware', cost: 0, features: [] }] } };
    const sheet = itemAction(free, { might: 4, inventory: gear(['Chip']) }, { kind: 'install', item: 'chip' }, { readValue: () => 0 }).data;
    expect(overlayOf(free, sheet).from).toEqual({});
  });

  it('what the sheet is told: each installed item, and each install\'s cost, value and limit as it reads now', () => {
    const sheet = { ...wired(), inventory: gear(['Cranial Jack', 'stash'], ['Dermal Armor'], ['Muscle Tweak'], ['Reflex Booster']) };
    const shown = itemsShown(WIRED, sheet, readValue(sheet));
    expect(shown.items).toEqual([
      { id: 'jack', needs: 'cyberware', installed: true, working: true },
      { id: 'dermal', needs: 'cyberware', installed: true, working: true },
      { id: 'booster', needs: 'cyberware' },
      { id: 'tweak', needs: 'bioware', installed: true, working: true },
    ]);
    expect(shown.installs).toEqual([{ id: 'cyberware', used: 2.5, value: 3.5, limit: 4 }, { id: 'bioware', used: 0.25, value: 5.75, limit: 0 }]);
    expect(workedOf(WIRED, sheet).installs).toEqual(shown.installs);
    // None made: nothing said of them.
    expect(itemsShown({ ...WIRED, items: { ...WIRED.items, installs: undefined } }, sheet)).not.toHaveProperty('installs');
    expect(installedNames(WIRED, sheet)).toEqual(new Set(['cranial jack', 'dermal armor', 'muscle tweak']));
  });

  it('an item worn before the GM made it installed is never said worn; one installed whose line went costs nothing', () => {
    const was = { might: 4, inventory: gear(['Cranial Jack']), [WORN_KEY]: { jack: { worn: true, attuned: true } } };
    expect(itemsShown(WIRED, was, readValue(was)).items).toEqual([{ id: 'jack', needs: 'cyberware' }]);
    const gone = { ...wired(), inventory: gear(['Muscle Tweak']) };
    expect(installedCost(WIRED, gone, 'cyberware')).toBe(0);
    expect(installedCost(WIRED, gone, 'bioware')).toBe(0.25);
  });
});

describe('at the table', () => {
  const ID = 'sys_wiredwiredwired12';
  const load = async (db) => {
    const def = JSON.stringify(WIRED);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Wired', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  afterEach(() => store.clear());

  it('no shop buys an installed line; one not installed sells', async () => {
    const db = await makeTestDb();
    await load(db);
    store.load(ID, { gear: [{ id: 'cranial_jack', name: 'Cranial Jack', price: 100 }] });
    const data = after({ might: 4, strain: 0, inventory: gear(['Cranial Jack']) }, { kind: 'install', item: 'jack' });
    const sell = (sheet) => planSale({ data: sheet, items: [{ catalogue: 'gear', id: 'cranial_jack', qty: 1 }], catalogues: ['gear'], locationPct: null, globalPct: null, system: ID });
    expect(sell(data)).toEqual({ ok: false, reason: 'installed', itemId: 'cranial_jack' });
    expect(sell(after(data, { kind: 'uninstall', item: 'jack' }))).toMatchObject({ ok: true });
  });

  it('over the socket: installed in words, refused in words, the stat badge\'s line saved', async () => {
    const db = await makeTestDb();
    await load(db);
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', might: 2, strain: 0, inventory: ALL })]);
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const heard = [];
    connection({ id: 'wired-kes', on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => heard.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    handlers.itemAction({ kind: 'install', item: 'jack' });
    await until(async () => (await stored())[WORN_KEY]?.jack?.installed === true, { label: 'installed' });
    expect((await stored())._worked.from.strain).toEqual([{ feature: 'Cranial Jack', amount: 1 }]);
    expect((await stored())._worked.installs[0]).toEqual({ id: 'cyberware', used: 1, value: 1, limit: 2 });
    handlers.itemAction({ kind: 'install', item: 'dermal' });
    await until(() => heard.some((e) => e.event === 'choicesRefused'), { label: 'refused' });
    expect(heard.find((e) => e.event === 'choicesRefused').data.error).toBe('Dermal Armor would take CYBERWARE past its limit: only your GM can install it');
  });
});
