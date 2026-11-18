/**
 * A gear line's COUNT (8a4a; approved mockup item-types, 2026-11-14, decision 5): spent one at a time by the button its
 * column names, refilled by a rest the column names (or one that counts as it), or by RELOAD from a carried line of an
 * item the column names, taking from its quantity, asked which when several are carried. The buttons are 8a4b's.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { spendCount, reloadCount, refillCounts } = require_('../systemBuilder/gearCounts');
const { restOn, restLine } = require_('../systemBuilder/resting');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const GUNS = {
  format: 1, name: 'Guns', core: { health: { model: 'pool' } },
  rests: { long_rest: { counts_as: ['short_rest'] } },
  resting: { finish: 'sheet' },
  items: {
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
        { id: 'ammo', label: 'Ammo', kind: 'count', button: 'Fire', reload: ['rounds', 'ap'] },
        { id: 'charges', label: 'CHARGES', kind: 'count', refill: 'short_rest' },
        { id: 'damage', label: 'DAMAGE', kind: 'damage' },
      ] },
      { id: 'gear', label: 'GEAR', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number' }] },
    ],
    list: [
      { id: 'pistol', label: 'Pistol', type: 'weapons', values: { ammo: 6, damage: '1d6' } },
      { id: 'wand', label: 'Wand', type: 'weapons', values: { charges: 3 } },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear' },
      { id: 'ap', label: 'AP Rounds', type: 'gear' },
    ],
  },
};
const line = (r) => ({ qty: 1, enc: '', bundled: false, carry: 'readied', location: '', ...r });
/** The sheet's gear as the sheet stores it: a JSON string. */
const gear = (...rows) => ({ name: 'Kes', inventory: JSON.stringify(rows.map(line)) });
const rowsOf = (data) => JSON.parse(data.inventory);

describe('the system', () => {
  it('a COUNT with a button, a reload and a rest is a well formed one', () => {
    expect(checkDefinition(GUNS).problems).toEqual([]);
  });
});

describe('FIRE: one spent', () => {
  it('a full line spends one, kept on the line; the column\'s button and label, in capitals; the gear kept a JSON string', () => {
    const r = spendCount(GUNS, gear({ name: 'Pistol' }), 0, 'ammo');
    expect(r).toMatchObject({ ok: true, now: 5, most: 6, line: 'Pistol', label: 'AMMO', button: 'FIRE' });
    expect(typeof r.data.inventory).toBe('string');
    expect(rowsOf(r.data)).toEqual([line({ name: 'Pistol', counts: { ammo: 5 } })]);
    expect(r.data.name).toBe('Kes');
  });

  it('down to none, then refused in words; the others on the line and the other lines untouched', () => {
    let data = gear({ name: 'Rope' }, { name: 'Pistol', counts: { ammo: 1, other: 2 } });
    const r = spendCount(GUNS, data, 1, 'ammo');
    expect(r).toMatchObject({ ok: true, now: 0 });
    data = r.data;
    expect(rowsOf(data)).toEqual([line({ name: 'Rope' }), line({ name: 'Pistol', counts: { ammo: 0, other: 2 } })]);
    expect(spendCount(GUNS, data, 1, 'ammo')).toEqual({ ok: false, error: 'No AMMO left in the Pistol' });
  });

  it('a column with no button is USE; a line with no name says its type\'s one; gear kept as a list stays a list', () => {
    const r = spendCount(GUNS, { inventory: [line({ name: '', type: 'weapons', values: { charges: 2 } })] }, 0, 'charges');
    expect(r).toMatchObject({ ok: true, now: 1, most: 2, line: 'Weapon', label: 'CHARGES', button: 'USE' });
    expect(Array.isArray(r.data.inventory)).toBe(true);
  });

  it('nothing to spend: no such line, a column that isn\'t a COUNT, none on its line, gear that doesn\'t read', () => {
    const data = gear({ name: 'Pistol' }, { name: 'Rope' });
    expect(spendCount(GUNS, data, 5, 'ammo')).toEqual({ ok: false, error: 'No such line' });
    expect(spendCount(GUNS, data, '0', 'ammo')).toEqual({ ok: false, error: 'No such line' });
    expect(spendCount(GUNS, data, 0, 'damage')).toEqual({ ok: false, error: 'Not a COUNT' });
    expect(spendCount(GUNS, data, 0, 'nope')).toEqual({ ok: false, error: 'Not a COUNT' });
    // The Pistol holds no CHARGES: none of them to spend.
    expect(spendCount(GUNS, data, 0, 'charges')).toEqual({ ok: false, error: 'No CHARGES left in the Pistol' });
    expect(spendCount(GUNS, { inventory: 'not json' }, 0, 'ammo')).toEqual({ ok: false, error: 'No such line' });
  });
});

describe('RELOAD: from a carried line', () => {
  it('as much as it takes, from the carried line\'s quantity; full again, nothing kept on the line', () => {
    const r = reloadCount(GUNS, gear({ name: 'Pistol', counts: { ammo: 2 } }, { name: 'Pistol Rounds', qty: 10, carry: 'stowed' }), 0, 'ammo');
    expect(r).toMatchObject({ ok: true, now: 6, most: 6, took: 4, from: 'Pistol Rounds', line: 'Pistol', label: 'AMMO' });
    expect(rowsOf(r.data)).toEqual([line({ name: 'Pistol' }), line({ name: 'Pistol Rounds', qty: 6, carry: 'stowed' })]);
  });

  it('as much as there is: the line used up is gone', () => {
    const r = reloadCount(GUNS, gear({ name: 'Pistol Rounds', qty: 3 }, { name: 'Pistol', counts: { ammo: 1 } }, { name: 'Rope' }), 1, 'ammo');
    expect(r).toMatchObject({ ok: true, now: 4, took: 3 });
    expect(rowsOf(r.data)).toEqual([line({ name: 'Pistol', counts: { ammo: 4 } }), line({ name: 'Rope' })]);
  });

  it('a name and carry matched however written; a quantity read as the sheet reads it (words for a number, at least one)', () => {
    const typed = reloadCount(GUNS, gear({ name: 'Pistol', counts: { ammo: 0 } }, { name: '  pistol ROUNDS ', qty: '4', carry: ' Stowed ' }), 0, 'ammo');
    expect(typed).toMatchObject({ ok: true, now: 4, took: 4, from: 'pistol ROUNDS' });
    expect(rowsOf(typed.data)).toHaveLength(1);
    const unsaid = reloadCount(GUNS, gear({ name: 'Pistol', counts: { ammo: 0 } }, { name: 'AP Rounds', qty: undefined }), 0, 'ammo');
    expect(unsaid).toMatchObject({ ok: true, now: 1, took: 1 });
  });

  it('several carried: asked which, nothing changed; then from the one named', () => {
    const data = gear({ name: 'Pistol', counts: { ammo: 2 } }, { name: 'Pistol Rounds', qty: 10 }, { name: 'Rope' }, { name: 'AP Rounds', qty: 2, carry: 'stowed' });
    expect(reloadCount(GUNS, data, 0, 'ammo')).toEqual({ ok: false, ask: [{ line: 1, name: 'Pistol Rounds', qty: 10 }, { line: 3, name: 'AP Rounds', qty: 2 }] });
    const ap = reloadCount(GUNS, data, 0, 'ammo', 3);
    expect(ap).toMatchObject({ ok: true, now: 4, took: 2, from: 'AP Rounds' });
    expect(rowsOf(ap.data).map((r) => r.name)).toEqual(['Pistol', 'Pistol Rounds', 'Rope']);
    expect(reloadCount(GUNS, data, 0, 'ammo', 1)).toMatchObject({ ok: true, took: 4, from: 'Pistol Rounds' });
    // A line that isn't one to reload from: refused.
    expect(reloadCount(GUNS, data, 0, 'ammo', 2)).toEqual({ ok: false, error: 'Not one to reload from: Pistol Rounds or AP Rounds' });
  });

  it('stashed, or another item: nothing to reload from; full; a COUNT refilled another way', () => {
    const stashed = gear({ name: 'Pistol', counts: { ammo: 2 } }, { name: 'Pistol Rounds', qty: 10, carry: 'stash' }, { name: 'AP Rounds', carry: 'somewhere' }, { name: 'Rope', qty: 9 });
    expect(reloadCount(GUNS, stashed, 0, 'ammo')).toEqual({ ok: false, error: 'Nothing carried to reload from: Pistol Rounds or AP Rounds' });
    expect(reloadCount(GUNS, gear({ name: 'Pistol' }, { name: 'Pistol Rounds' }), 0, 'ammo')).toEqual({ ok: false, error: 'The Pistol\'s AMMO is full' });
    expect(reloadCount(GUNS, gear({ name: 'Wand', counts: { charges: 0 } }), 0, 'charges')).toEqual({ ok: false, error: 'The CHARGES is refilled another way' });
    expect(reloadCount(GUNS, gear({ name: 'Pistol' }), 0, 'damage')).toEqual({ ok: false, error: 'Not a COUNT' });
  });

  it('a line never reloads from itself', () => {
    const own = { ...GUNS, items: { ...GUNS.items, list: GUNS.items.list.map((i) => (i.id === 'rounds' ? { ...i, label: 'Pistol' } : i)) } };
    expect(reloadCount(own, gear({ name: 'Pistol', counts: { ammo: 1 }, qty: 5 }), 0, 'ammo')).toEqual({ ok: false, error: 'Nothing carried to reload from: Pistol or AP Rounds' });
  });
});

describe('a rest refills', () => {
  const spent = gear({ name: 'Pistol', counts: { ammo: 2 } }, { name: 'Wand', counts: { charges: 1 } }, { name: 'Rope' });

  it('each COUNT whose column names the rest, full again; the others not', () => {
    const r = refillCounts(GUNS, spent, new Set(['short_rest']));
    expect(r.refilled).toEqual([{ index: 1, column: 'charges', line: 'Wand', label: 'CHARGES', from: 1, to: 3 }]);
    expect(rowsOf({ inventory: r.inventory })).toEqual([line({ name: 'Pistol', counts: { ammo: 2 } }), line({ name: 'Wand' }), line({ name: 'Rope' })]);
    expect(refillCounts(GUNS, spent, new Set(['end_of_session']))).toEqual({ inventory: null, refilled: [] });
    // Already full: nothing to say.
    expect(refillCounts(GUNS, gear({ name: 'Wand', counts: { charges: 3 } }), new Set(['short_rest'])).inventory).toBeNull();
  });

  it('a rest that counts as it, in the rest\'s line ("Wand CHARGES 1 → 3"); one that doesn\'t leaves them', () => {
    const long = restOn({ definition: GUNS, restId: 'long_rest', sheet: spent });
    expect(rowsOf({ inventory: long.sheetPatch.inventory })[1]).toEqual(line({ name: 'Wand' }));
    expect(long.changes).toContainEqual({ what: 'count:1:charges', label: 'Wand CHARGES', from: 1, to: 3 });
    expect(restLine(GUNS, 'Long rest', 'Kes', long)).toBe('LONG REST · Kes: Wand CHARGES 1 → 3');
    expect(restOn({ definition: GUNS, restId: 'end_of_session', sheet: spent }).sheetPatch).not.toHaveProperty('inventory');
  });
});

describe('at the table', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_gearcountsgearcnt';
  const KES = gear({ name: 'Pistol', counts: { ammo: 2 } }, { name: 'Pistol Rounds', qty: 10 }, { name: 'Wand', counts: { charges: 0 } });

  const table = async () => {
    const shared = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const heard = [];
      const handlers = {};
      connection({ id: `count-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      /** countAction, its answer awaited. */
      const act = (payload) => new Promise((resolve) => handlers.countAction(payload, resolve));
      return { handlers, act, refused: () => heard.filter((e) => e.event === 'choicesRefused').map((e) => e.data.error) };
    };
    return { shared, gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM }), kes: await join('kes', 'kes') };
  };
  const stored = async (who = 'kes') => rowsOf(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [who])).data));

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
      results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(GUNS);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Guns', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    for (const who of ['kes', 'ash']) await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', [who, ID, JSON.stringify(KES)]);
  });

  it('a player FIRES and RELOADS their own line; every screen told; another\'s named is not touched', async () => {
    const { kes, shared } = await table();
    expect(await kes.act({ kind: 'spend', line: 0, column: 'ammo', username: 'ash' })).toEqual({ ok: true, now: 1, most: 6 });
    expect((await stored())[0].counts).toEqual({ ammo: 1 });
    expect((await stored('ash'))[0].counts).toEqual({ ammo: 2 });
    expect(shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'kes')).toBe(true);
    expect(await kes.act({ kind: 'reload', line: 0, column: 'ammo' })).toEqual({ ok: true, now: 6, most: 6 });
    const rows = await stored();
    expect(rows[0].counts).toBeUndefined();
    expect(rows[1].qty).toBe(5);
    expect(kes.refused()).toEqual([]);
  });

  it('several to reload from: asked, nothing written; then the one named', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = \'kes\'', [JSON.stringify(gear({ name: 'Pistol', counts: { ammo: 0 } }, { name: 'Pistol Rounds', qty: 10 }, { name: 'AP Rounds', qty: 3 }))]);
    const { kes, shared } = await table();
    expect(await kes.act({ kind: 'reload', line: 0, column: 'ammo' })).toEqual({ ok: false, ask: [{ line: 1, name: 'Pistol Rounds', qty: 10 }, { line: 2, name: 'AP Rounds', qty: 3 }] });
    expect((await stored())[0].counts).toEqual({ ammo: 0 });
    expect(shared.some((e) => e.event === 'sheetUpdated')).toBe(false);
    expect(kes.refused()).toEqual([]);
    expect(await kes.act({ kind: 'reload', line: 0, column: 'ammo', from: 2 })).toEqual({ ok: true, now: 3, most: 6 });
    expect((await stored()).map((r) => r.name)).toEqual(['Pistol', 'Pistol Rounds']);
  });

  it('the GM on the player they name; refusals answered in words, to the line alone; what isn\'t one passed over', async () => {
    const { gm, kes } = await table();
    expect(await gm.act({ kind: 'spend', line: 0, column: 'ammo', username: 'ash' })).toEqual({ ok: true, now: 1, most: 6 });
    expect((await stored('ash'))[0].counts).toEqual({ ammo: 1 });
    expect(await kes.act({ kind: 'spend', line: 2, column: 'charges' })).toEqual({ ok: false, error: 'No CHARGES left in the Wand' });
    // Said on the line that asked (8a4b), never again under the gear's items as a choicesRefused.
    expect(kes.refused()).toEqual([]);
    expect(await kes.act({ kind: 'spend', line: '0', column: 'ammo' })).toEqual({ ok: false, error: 'No such line' });
    expect(await kes.act({ kind: 'spend', line: 0, column: { id: 'ammo' } })).toEqual({ ok: false, error: 'Not a COUNT' });
    // A kind it doesn't know, or nothing at all: passed over, nothing answered or thrown.
    expect(() => kes.handlers.countAction({ kind: 'drop', line: 0, column: 'ammo' })).not.toThrow();
    expect(() => kes.handlers.countAction(null)).not.toThrow();
    // No answer asked for: still done.
    kes.handlers.countAction({ kind: 'spend', line: 0, column: 'ammo' });
    await until(async () => (await stored())[0].counts.ammo === 1, { label: 'spent with no answer asked' });
  });

  it('a rest from the sheet refills, written with the rest and said in its line', async () => {
    const { kes } = await table();
    kes.handlers.restTake({ rest: 'short_rest' });
    await until(async () => (await stored())[2].counts === undefined, { label: 'the wand refilled' });
    await until(async () => (await get(db, 'SELECT COUNT(*) AS n FROM dice_rolls')).n === 1, { label: 'the rest\'s line' });
    expect((await get(db, 'SELECT historyString FROM dice_rolls')).historyString).toBe('SHORT REST · Kes: Wand CHARGES 0 → 3');
    expect((await stored())[0].counts).toEqual({ ammo: 2 });
  });
});
