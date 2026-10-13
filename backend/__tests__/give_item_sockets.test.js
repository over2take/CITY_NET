/**
 * GIVE ITEM through the socket (4g2b; approved mockup docs/mockups/give-item.html, 2026-10-12).
 *
 * The GM or a granted editor gives an item the running game has to player characters (online or
 * not) and NPC tokens with a sheet: all of it or none to each, a sheet with no room named and
 * skipped while the others get theirs. A preview says where it would land and writes nothing. Only
 * the player given it is told, on every screen they're signed in on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const store = require_('../shops/catalogueStore');
const { givable } = require_('../shops/give');
const { readInventory } = require_('../shops/placement');
const socketsFactory = require_('../sockets/index.js');

const CWN = 'cities_without_number';
const UPLOADS = { gear: [{ id: 'lucky_coin', name: 'Lucky Coin', price: 5, fields: {} }] };
const FULL = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`weapon${i + 1}_name`, 'Owned']));

let db;
let ids;
let broadcast;
let privately;
let handlers;
let replies;
let nextSocket = 0;

const sheet = async (username, system, data, isNpc = 0) => (await run(db,
  'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (?, ?, ?, ?, ?)',
  [username, system, JSON.stringify(data), isNpc, isNpc ? username : null])).lastID;
const token = async (name, shape, owner) => (await run(db,
  'INSERT INTO locations (name, x, y, z, shape, owner) VALUES (?, 0, 0, 0, ?, ?)', [name, shape, owner])).lastID;
const dataOf = async (id) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [id])).data);

/** A connection signed in as `who` (the GM's sign-in, or a player's name), its replies kept. */
const connect = async (who) => {
  const id = `give-${(nextSocket += 1)}`;
  const own = {};
  const sent = [];
  let onConnect;
  socketsFactory({
    on: (e, cb) => { if (e === 'connection') onConnect = cb; },
    emit: (event, data) => broadcast.push({ event, data }),
    to: (to) => ({ emit: (event, data) => privately.push({ to, event, data }) }),
  }, db, { elevatedUsers: new Set(['ghost']), emitUpdate: vi.fn(), recordAction: vi.fn() });
  onConnect({ id, on: (e, fn) => { own[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
  own.identify(who);
  await drain(db);
  // After the boot, which reads the running system's uploads from a table this database lacks.
  store.load(CWN, UPLOADS);
  handlers[id] = own;
  replies[id] = sent;
  return id;
};

const ask = async (socketId, event, payload, answer) => {
  const before = replies[socketId].length;
  handlers[socketId][event](payload);
  const reply = await untilValue(() => replies[socketId].slice(before).find((r) => r.event === answer), Boolean, { label: answer });
  await drain(db);
  return reply.data;
};

let gm;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [CWN]);
  broadcast = [];
  privately = [];
  handlers = {};
  replies = {};
  ids = {
    vex: await sheet('vex', CWN, { name: 'Vex', weapon1_name: 'Knife', notes: 'keep me' }),
    juno: await sheet('juno', CWN, { name: 'Juno', ...FULL }),
    rook: await sheet('rook', CWN, { name: 'Rook', inventory: JSON.stringify([{ name: 'Ammunition, empty magazine', qty: 1, carry: 'stowed' }]) }),
    ash: await sheet('ash', 'cyberpunk_red', { name: 'Ash' }),
    gangerSheet: await sheet('Ganger', CWN, {}, 1),
    ganger: await token('GANGER', 'enemy_rhombus', 'gm'),
    dog: await token('DOG', 'friendly_rhombus', 'gm'),
  };
  await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ids.ganger, ids.gangerSheet]);
  gm = await connect({ userName: 'gm', isAdmin: true, token: GM });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
// Signed out again, or the next test's notices would also go to this one's screens.
afterEach(() => { Object.values(handlers).forEach((h) => h.disconnect && h.disconnect()); vi.restoreAllMocks(); });

const give = (payload, as = gm) => ask(as, 'giveItem', payload, 'itemGiven');
const pistols = { catalogue: 'weapons', id: 'heavy_pistol', qty: 2, players: ['vex', 'juno', 'rook', 'ash', 'nobody'] };
const notices = () => privately.filter((p) => p.event === 'itemReceived');

describe('what can be given', () => {
  it('is sent to the GM: everything the running game has', async () => {
    const reply = await ask(gm, 'requestGivable', undefined, 'givableItems');
    expect(reply).toEqual({ ok: true, system: CWN, catalogues: givable(CWN) });
    expect(reply.catalogues.find((c) => c.catalogue === 'gear').items).toContainEqual({ id: 'lucky_coin', name: 'Lucky Coin', price: 5 });
  });

  it('is sent to a granted editor, and never to a player', async () => {
    const ghost = await connect('ghost');
    expect((await ask(ghost, 'requestGivable', undefined, 'givableItems')).ok).toBe(true);
    const vex = await connect('vex');
    handlers[vex].requestGivable();
    await drain(db);
    expect(replies[vex].filter((r) => r.event === 'givableItems')).toEqual([]);
  });
});

describe('a preview', () => {
  it('says where it would land on each, and why not', async () => {
    const reply = await give({ ...pistols, npcs: [ids.ganger, ids.dog], preview: true });
    expect(reply).toMatchObject({ ok: true, preview: true, qty: 2, item: { catalogue: 'weapons', id: 'heavy_pistol', name: 'Heavy Pistol', price: 200 } });
    expect(reply.recipients).toEqual([
      { kind: 'player', username: 'ash', name: 'ash', given: false, reason: 'No character in this game.' },
      { kind: 'player', username: 'nobody', name: 'nobody', given: false, reason: 'No character in this game.' },
      { kind: 'player', username: 'juno', name: 'Juno', given: false, reason: expect.stringMatching(/^No free weapon row/) },
      { kind: 'player', username: 'rook', name: 'Rook', given: false, lands: { shape: 'rows', group: 'weapon', rows: [1, 2] } },
      { kind: 'player', username: 'vex', name: 'Vex', given: false, lands: { shape: 'rows', group: 'weapon', rows: [2, 3] } },
      { kind: 'npc', location_id: ids.ganger, name: 'GANGER', given: false, lands: { shape: 'rows', group: 'weapon', rows: [1, 2] } },
      { kind: 'npc', location_id: ids.dog, name: 'DOG', given: false, reason: 'No sheet in this game.' },
    ]);
  });

  it('writes nothing and tells nobody', async () => {
    await connect('vex');
    await give({ ...pistols, npcs: [ids.ganger], preview: true });
    expect(await dataOf(ids.vex)).toEqual({ name: 'Vex', weapon1_name: 'Knife', notes: 'keep me' });
    expect(await dataOf(ids.gangerSheet)).toEqual({});
    expect(notices()).toEqual([]);
    expect(broadcast.filter((b) => b.event === 'sheetUpdated')).toEqual([]);
  });
});

describe('giving', () => {
  it('writes it onto every sheet with room, and skips the one without', async () => {
    await run(db, "UPDATE character_sheets SET updated_at = '2000-01-01 00:00:00' WHERE id = ?", [ids.juno]);
    const reply = await give({ ...pistols, npcs: [ids.ganger], preview: 'yes' });
    expect(reply.preview).toBe(false);
    expect(reply.recipients.map((r) => [r.name, r.given])).toEqual([['ash', false], ['nobody', false], ['Juno', false], ['Rook', true], ['Vex', true], ['GANGER', true]]);
    const vex = await dataOf(ids.vex);
    expect(vex).toMatchObject({ name: 'Vex', notes: 'keep me', weapon1_name: 'Knife', weapon2_name: 'Heavy Pistol', weapon3_name: 'Heavy Pistol', weapon2_carry: 'stowed' });
    expect(vex.weapon4_name).toBeUndefined();
    // With its worked-out values, as every save writes them.
    expect(vex.save_physical).toBe(16);
    expect((await dataOf(ids.rook)).weapon2_name).toBe('Heavy Pistol');
    expect((await dataOf(ids.gangerSheet)).weapon1_name).toBe('Heavy Pistol');
    // Not written at all, not even unchanged.
    expect(await dataOf(ids.juno)).toEqual({ name: 'Juno', ...FULL });
    expect((await get(db, 'SELECT updated_at FROM character_sheets WHERE id = ?', [ids.juno])).updated_at).toBe('2000-01-01 00:00:00');
  });

  it('finds a player however their name is typed', async () => {
    const reply = await give({ catalogue: 'gear', id: 'lucky_coin', players: ['VEX'] });
    expect(reply.recipients).toEqual([{ kind: 'player', username: 'vex', name: 'Vex', given: true, lands: { shape: 'inventory', stacked: false } }]);
  });

  it('tells each player given it, privately, on every screen, and every screen redraws their sheet', async () => {
    const vexA = await connect('vex');
    const vexB = await connect('vex');
    await connect('juno');
    await give({ ...pistols, npcs: [ids.ganger], note: '  For the job tonight.  ' });
    expect(notices()).toEqual([vexA, vexB].map((to) => ({ to, event: 'itemReceived', data: { item: 'Heavy Pistol', catalogue: 'weapons', qty: 2, note: 'For the job tonight.' } })));
    expect(broadcast.filter((b) => b.event === 'sheetUpdated').map((b) => b.data)).toEqual([{ username: 'rook', system: CWN }, { username: 'vex', system: CWN }]);
    expect(broadcast.filter((b) => b.event === 'itemReceived')).toEqual([]);
  });

  it('places it on the sheet as it is when written, not as it was when asked', async () => {
    // Vex picks up a magazine of their own between the GM's GIVE being read and it being written.
    const all = db.all.bind(db);
    db.all = (sql, params, cb) => all(sql, params, (e, rows) => {
      if (!/FROM character_sheets WHERE system/.test(sql)) return cb(e, rows);
      db.all = all;
      run(db, 'UPDATE character_sheets SET data = ? WHERE id = ?', [JSON.stringify({ name: 'Vex', inventory: [{ name: 'Ammunition, empty magazine', qty: 1, carry: 'readied' }] }), ids.vex]).then(() => cb(e, rows));
    });
    const reply = await give({ catalogue: 'gear', id: 'ammo_magazine', players: ['vex'] });
    expect(reply.recipients[0].lands).toEqual({ shape: 'inventory', stacked: true });
    expect(readInventory(await dataOf(ids.vex))).toEqual([expect.objectContaining({ name: 'Ammunition, empty magazine', qty: 2 })]);
    expect(reply.note).toBe('');
  });

  it('stacks an inventory line onto one they carry, and says so', async () => {
    const reply = await give({ catalogue: 'gear', id: 'ammo_magazine', qty: 3, players: ['rook', 'vex'] });
    expect(reply.recipients.map((r) => [r.username, r.lands])).toEqual([
      ['rook', { shape: 'inventory', stacked: true }],
      ['vex', { shape: 'inventory', stacked: false }],
    ]);
    expect(readInventory(await dataOf(ids.rook))[0]).toMatchObject({ name: 'Ammunition, empty magazine', qty: 4 });
    expect(readInventory(await dataOf(ids.vex))[0]).toMatchObject({ name: 'Ammunition, empty magazine', qty: 3 });
  });

  it('gives the GM\'s own uploads, and cyberware not yet placed', async () => {
    expect((await give({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] })).recipients[0].given).toBe(true);
    expect(readInventory(await dataOf(ids.vex)).map((i) => i.name)).toEqual(['Lucky Coin']);
    const chrome = await give({ catalogue: 'cyberware', id: 'assisted-glide-system', players: ['vex'] });
    expect(chrome.recipients[0].lands).toEqual({ shape: 'cyberware' });
    expect((await dataOf(ids.vex)).cyberware).toEqual([expect.objectContaining({ name: 'Assisted Glide System', placed: false })]);
  });

  it('is open to a granted editor', async () => {
    const ghost = await connect('ghost');
    expect((await give({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] }, ghost)).recipients[0].given).toBe(true);
  });
});

describe('the GIVEN list', () => {
  it('gains a line for each GIVE, naming those given it, and is sent with the answer', async () => {
    const reply = await give({ ...pistols, npcs: [ids.ganger, ids.dog], note: ' For the job. ' });
    expect(reply.given).toEqual([{ id: 1, at: expect.any(String), by: 'gm', catalogue: 'weapons', item: 'Heavy Pistol', qty: 2, to: ['Rook', 'Vex', 'GANGER'], note: 'For the job.' }]);
    const ghost = await connect('ghost');
    const second = await give({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] }, ghost);
    expect(second.given.map((l) => [l.by, l.item, l.to])).toEqual([['ghost', 'Lucky Coin', ['Vex']], ['gm', 'Heavy Pistol', ['Rook', 'Vex', 'GANGER']]]);
  });

  it('gains nothing from a preview, or from a GIVE nobody got', async () => {
    expect((await give({ ...pistols, preview: true })).given).toBeUndefined();
    expect((await give({ ...pistols, players: ['juno', 'nobody'] })).given).toEqual([]);
    expect((await ask(gm, 'requestGiven', undefined, 'givenList'))).toEqual({ ok: true, system: CWN, entries: [] });
  });

  it('is sent to the GM and granted editors on asking, and never to a player', async () => {
    await give({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] });
    const list = await ask(gm, 'requestGiven', undefined, 'givenList');
    expect(list).toMatchObject({ ok: true, system: CWN, entries: [{ by: 'gm', item: 'Lucky Coin', to: ['Vex'] }] });
    const ghost = await connect('ghost');
    expect(await ask(ghost, 'requestGiven', undefined, 'givenList')).toEqual(list);
    const vex = await connect('vex');
    handlers[vex].requestGiven();
    await drain(db);
    expect(replies[vex].filter((r) => r.event === 'givenList')).toEqual([]);
  });

  it('only ever shows the running game\'s', async () => {
    await give({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] });
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    expect((await ask(gm, 'requestGiven', undefined, 'givenList')).entries).toEqual([]);
  });

  it('doesn\'t undo a gift it couldn\'t write down', async () => {
    await run(db, 'DROP TABLE given_items');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reply = await give({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] });
    expect(reply).toMatchObject({ ok: true, given: null, recipients: [{ given: true }] });
    expect(readInventory(await dataOf(ids.vex)).map((i) => i.name)).toEqual(['Lucky Coin']);
    expect((await ask(gm, 'requestGiven', undefined, 'givenList'))).toEqual({ ok: false, reason: 'read' });
  });
});

describe('refused', () => {
  it('to a player, who is not even answered', async () => {
    const vex = await connect('vex');
    handlers[vex].giveItem({ catalogue: 'gear', id: 'lucky_coin', players: ['vex'] });
    await drain(db);
    expect(replies[vex].filter((r) => r.event === 'itemGiven')).toEqual([]);
    expect(await dataOf(ids.vex)).toEqual({ name: 'Vex', weapon1_name: 'Knife', notes: 'keep me' });
  });

  it('for something the game hasn\'t got', async () => {
    expect(await give({ catalogue: 'weapons', id: 'no_such_gun', players: ['vex'] })).toEqual({ ok: false, reason: 'Not something this game can give.' });
    expect(await give({ catalogue: 'cyber_mods', id: 'anything', players: ['vex'] })).toEqual({ ok: false, reason: 'Not something this game can give.' });
  });

  it('for a request it can\'t read', async () => {
    // One at a time, so each reply is the one asked for.
    const reasons = async (payloads) => { const out = []; for (const p of payloads) out.push((await give(p)).reason); return out; };
    const ok = { catalogue: 'gear', id: 'lucky_coin', players: ['vex'] };
    expect(await reasons([
      undefined, { ...ok, id: '' }, { ...ok, catalogue: 7 },
      { ...ok, qty: 0 }, { ...ok, qty: 100 }, { ...ok, qty: 1.5 }, { ...ok, qty: '2' },
      { ...ok, players: 'vex' }, { ...ok, players: [3] }, { ...ok, npcs: [0] }, { ...ok, npcs: ['1'] },
      { ...ok, players: [] }, { catalogue: 'gear', id: 'lucky_coin' },
      { ...ok, note: 'x'.repeat(201) }, { ...ok, note: 5 }, { ...ok, note: ['x'] },
    ])).toEqual([
      'catalogue and id: the item to give', 'catalogue and id: the item to give', 'catalogue and id: the item to give',
      'qty: a whole number from 1 to 99', 'qty: a whole number from 1 to 99', 'qty: a whole number from 1 to 99', 'qty: a whole number from 1 to 99',
      'players: a list of up to 100 player names', 'players: a list of up to 100 player names', 'npcs: a list of up to 100 token ids', 'npcs: a list of up to 100 token ids',
      'Pick someone to give it to', 'Pick someone to give it to',
      'note: at most 200 characters', 'note: at most 200 characters', 'note: at most 200 characters',
    ]);
    expect(await dataOf(ids.vex)).toEqual({ name: 'Vex', weapon1_name: 'Knife', notes: 'keep me' });
  });

  it('takes the most it allows', async () => {
    const reply = await give({ catalogue: 'gear', id: 'lucky_coin', qty: 99, players: ['vex'], npcs: [ids.ganger], note: 'x'.repeat(200) });
    expect(reply.recipients.map((r) => r.given)).toEqual([true, true]);
    expect(readInventory(await dataOf(ids.vex))[0].qty).toBe(99);
  });
});
