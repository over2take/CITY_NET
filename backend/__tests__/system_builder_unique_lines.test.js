/**
 * UNIQUE, the server's half (G5a; decided 2026-11-20, the user: "mark it as Unique so the GM can see changes at a glance").
 * A gear line named like one of the system's items, a column of its own that isn't the item's: the item made unique. Who
 * changed each such column and when is kept on the line, worked out from what was stored on every inventory write: by the
 * player's own socket, by the GM on a player's sheet, by the GM on an NPC's. Never taken from what the sheet sends.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { withChanges, uniqueColumns } = require_('../systemBuilder/uniqueLines');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const gm = { Authorization: `Bearer ${GM}` };

const BLADES = {
  format: 1, name: 'Bladeworks', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' }, { id: 'weight', label: 'WEIGHT', kind: 'number' }] },
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number' }] },
    ],
    list: [{ id: 'cutlass', label: 'Cutlass', type: 'weapons', values: { damage: '1d8 + @might', range: 'melee', weight: 3 } }],
  },
};
const line = (name, more = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });
const AT = '2026-11-22T10:00:00.000Z';
const LATER = '2026-11-23T09:30:00.000Z';

describe('which columns are unique', () => {
  it('a value of its own that isn\'t its item\'s; read loosely; none for a line of no item, or of another type', () => {
    expect(uniqueColumns(BLADES, line('Cutlass', { values: { damage: '2d8 + @might', weight: 3 } }))).toEqual(['damage']);
    // 3 and "3", and spaces around, are the item's own.
    expect(uniqueColumns(BLADES, line(' cutlass ', { values: { weight: '3', range: ' melee ' } }))).toEqual([]);
    // A column the item hasn't filled, filled by the line: unique.
    expect(uniqueColumns({ ...BLADES, items: { ...BLADES.items, list: [{ id: 'cutlass', label: 'Cutlass', type: 'weapons', values: {} }] } }, line('Cutlass', { values: { range: '2 m' } }))).toEqual(['range']);
    // Blank is nothing of its own.
    expect(uniqueColumns(BLADES, line('Cutlass', { values: { damage: '  ' } }))).toEqual([]);
    // A stick made by hand is no item; a Cutlass made GEAR by hand is a thing of its own, not the item.
    expect(uniqueColumns(BLADES, line('A stick', { type: 'weapons', values: { damage: '1d4' } }))).toEqual([]);
    expect(uniqueColumns(BLADES, line('Cutlass', { type: 'gear', values: { weight: 9 } }))).toEqual([]);
    expect(uniqueColumns(BLADES, line('Cutlass', { type: 'weapons', values: { weight: 9 } }))).toEqual(['weight']);
  });
});

describe('who changed it, and when', () => {
  const kes = { by: 'kes' };

  it('a column changed: the writer\'s, when; left as it was: kept; put back to the item\'s or cleared: gone', () => {
    const first = withChanges(BLADES, '[]', [line('Cutlass', { values: { damage: '2d8 + @might' } })], kes, AT);
    expect(first[0].changed).toEqual({ damage: { by: 'kes', at: AT } });
    // The GM changes RANGE later; DAMAGE as it was keeps Kes's.
    const second = withChanges(BLADES, first, [line('Cutlass', { values: { damage: '2d8 + @might', range: '2 m' } })], { by: 'gm', gm: true }, LATER);
    expect(second[0].changed).toEqual({ damage: { by: 'kes', at: AT }, range: { by: 'gm', gm: true, at: LATER } });
    // DAMAGE changed again: the writer's, now.
    const third = withChanges(BLADES, second, [line('Cutlass', { values: { damage: '3d8', range: '2 m' } })], kes, LATER);
    expect(third[0].changed.damage).toEqual({ by: 'kes', at: LATER });
    // THE ITEM'S: DAMAGE back to the item's, RANGE cleared: nothing changed, no `changed` at all.
    const back = withChanges(BLADES, third, [line('Cutlass', { values: { damage: '1d8 + @might' } })], kes, LATER);
    expect(back[0]).toEqual(line('Cutlass', { values: { damage: '1d8 + @might' } }));
  });

  it('never what the sheet sends: a record made up is dropped, one left off is kept', () => {
    const stored = [line('Cutlass', { values: { damage: '2d8' }, changed: { damage: { by: 'kes', at: AT } } })];
    const forged = withChanges(BLADES, stored, [line('Cutlass', { values: { damage: '2d8', range: '2 m' }, changed: { damage: { by: 'someone', at: 'x' } } })], { by: 'mo' }, LATER);
    expect(forged[0].changed).toEqual({ damage: { by: 'kes', at: AT }, range: { by: 'mo', at: LATER } });
    // A line of no item says nothing changed, whatever it is sent with.
    expect(withChanges(BLADES, '[]', [line('Rope', { changed: { weight: { by: 'x', at: 'y' } } })], kes, AT)[0]).toEqual(line('Rope'));
  });

  it('the line it was: in its place, or found by name and type where lines moved; a new one is the writer\'s', () => {
    const stored = [line('Rope'), line('Cutlass', { values: { damage: '2d8' }, changed: { damage: { by: 'kes', at: AT } } })];
    // The Rope removed: the Cutlass moved up a place, still the same, keeping Kes's.
    expect(withChanges(BLADES, stored, [line('Cutlass', { values: { damage: '2d8' } })], { by: 'mo' }, LATER)[0].changed).toEqual({ damage: { by: 'kes', at: AT } });
    // A second Cutlass made 2d8 too: the first keeps its record, the new one is the writer's.
    const two = withChanges(BLADES, stored, [line('Rope'), line('Cutlass', { values: { damage: '2d8' } }), line('Cutlass', { values: { damage: '2d8' } })], { by: 'mo' }, LATER);
    expect(two.map((l) => l.changed)).toEqual([undefined, { damage: { by: 'kes', at: AT } }, { damage: { by: 'mo', at: LATER } }]);
  });

  it('as stored: a JSON string back as one; as given with no definition or lines that can\'t be read', () => {
    const out = withChanges(BLADES, '[]', JSON.stringify([line('Cutlass', { values: { damage: '2d8' } })]), kes, AT);
    expect(JSON.parse(out)[0].changed).toEqual({ damage: { by: 'kes', at: AT } });
    expect(withChanges(null, '[]', '[{"name":"Cutlass"}]', kes, AT)).toBe('[{"name":"Cutlass"}]');
    expect(withChanges(BLADES, '[]', 'not json', kes, AT)).toBe('not json');
    // What was stored unreadable: every unique column is the writer's.
    expect(withChanges(BLADES, '{bad', [line('Cutlass', { values: { damage: '2d8' } })], kes, AT)[0].changed).toEqual({ damage: { by: 'kes', at: AT } });
  });
});

describe('kept by every write of the inventory', () => {
  let db;
  let app;
  let id;

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')");
    const io = { emit: () => {}, to: () => ({ emit: () => {} }) };
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/systems', require_('../routes/systems.js')(db));
    app.use('/api/sheets', require_('../routes/sheets.js')(db, io));
    id = (await request(app).post('/api/systems').set(gm).send({ definition: BLADES })).body.id;
    await new Promise((resolve) => runtime.load(db, resolve));
    await request(app).post(`/api/systems/${id}/publish`).set(gm);
    await request(app).put('/api/sheets/system').set(gm).send({ system: id });
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', id, JSON.stringify({ name: 'Kes', might: 2 })]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const connectAs = async (userName, { admin = false } = {}) => {
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `ul-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(admin ? { userName, isAdmin: true, token: GM } : userName);
    await drain(db);
    return handlers;
  };
  const linesOf = async (where = "username = 'kes'") => JSON.parse(JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE ${where}`)).data).inventory || '[]');

  it('the player\'s own: theirs; the GM on their sheet then: the GM\'s, the player\'s kept', async () => {
    const kes = await connectAs('kes');
    kes.updateSheetField({ fieldId: 'inventory', value: JSON.stringify([line('Cutlass', { values: { damage: '2d8 + @might' } })]) });
    await until(async () => (await linesOf())[0]?.changed?.damage?.by === 'kes', { label: 'Kes\'s' });
    const [mine] = await linesOf();
    expect(mine.changed.damage.gm).toBeUndefined();
    expect(Date.parse(mine.changed.damage.at)).not.toBeNaN();
    // The GM, on Kes's sheet, gives it a RANGE; the sheet sends no `changed`, as it never does.
    const res = await request(app).put('/api/sheets/user/kes').set(gm)
      .send({ fields: { inventory: JSON.stringify([line('Cutlass', { values: { damage: '2d8 + @might', range: '2 m' } })]) } });
    expect(res.status).toBe(200);
    const [after] = await linesOf();
    expect(after.changed).toEqual({ damage: mine.changed.damage, range: { by: 'gm', gm: true, at: expect.any(String) } });
  });

  it('a built-in system\'s inventory is written as sent', async () => {
    await request(app).put('/api/sheets/system').set(gm).send({ system: 'generic' });
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['mo', 'generic', JSON.stringify({ name: 'Mo' })]);
    const mo = await connectAs('mo');
    const sent = JSON.stringify([line('Cutlass', { values: { damage: '2d8' }, changed: { damage: { by: 'x', at: 'y' } } })]);
    mo.updateSheetField({ fieldId: 'inventory', value: sent });
    await until(async () => JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'mo'")).data).inventory === sent, { label: 'as sent' });
  });

  it('an NPC\'s: the GM\'s', async () => {
    const made = await request(app).post('/api/sheets/npcs').set(gm).send({ data: { name: 'Bosun' }, npc_label: 'Bosun' });
    expect(made.status).toBeLessThan(300);
    const npc = (await get(db, 'SELECT id FROM character_sheets WHERE is_npc = 1')).id;
    const res = await request(app).put(`/api/sheets/npcs/${npc}`).set(gm).send({ fields: { inventory: JSON.stringify([line('Cutlass', { values: { weight: 5 } })]) } });
    expect(res.status).toBe(200);
    expect((await linesOf(`id = ${npc}`))[0].changed).toEqual({ weight: { by: 'gm', gm: true, at: expect.any(String) } });
  });
});
