/**
 * Dying at the table (8c1b1; approved mockup docs/mockups/rule-library.html, 2026-11-26): every place that changes a token's
 * health tells tokens/dyingTable.js, which keeps on the token whether it went down, was hurt while down or came back up,
 * under the running game's `dying` rule. A player's character always; an NPC as WHO GOES DOWN says. Kept per game system
 * beside its health; the word everyone's, the count and each line its player's and the GM's (an NPC's, the GM's alone).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run, all } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { outNow } = require_('../systemBuilder/health');
const { noticeHealth, setAnnouncer, publicDying, rollDeathSave, turnGoesBy, dyingTurns, inFight } = require_('../tokens/dyingTable');
const { takeOff, targetOf } = require_('../tokens/hitOnTarget');
const { fireTurnMoments } = require_('../tokens/turnEffects');
const { takeRest } = require_('../sheets/rests');
const { spendRecovery } = require_('../sheets/recover');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { switchSystem } = require_('../tokens/vitals');
const socketsFactory = (await import('../sockets/index.js')).default;
const initiativeMod = await import('../sockets/initiative.js');
const registerInitiativeHandlers = initiativeMod.registerInitiativeHandlers || initiativeMod.default.registerInitiativeHandlers;

const ID = 'sys_dyingtabledying01';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const KES = jwt.sign({ id: 2, username: 'kes', role: 'player' }, 'test-secret');
const ASH = jwt.sign({ id: 3, username: 'ash', role: 'player' }, 'test-secret');
const DND = { word: 'Dying', way: 'count', save: { dice: '1d20', target: '10' }, hurt: 'failure' };
const SYSTEM = (dying = DND, more = {}) => ({
  format: 1, name: 'Ashfall', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'body', label: 'Body' }] }],
  conditions: { burning: { name: 'Burning', each_turn: [{ when: 'turn_start', does: 'damage', roll: '2' }] } },
  rests: { short_rest: { refills: [{ what: 'health', how: 'by', amount: '3' }] } },
  dying,
  ...more,
});

let db;
let heard;
let kes;
let ghoul;
let pal;
const setUp = async (system = SYSTEM()) => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    players_history TEXT, seen_by TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const def = JSON.stringify(system);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Ashfall', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', body: 7 })]);
  kes = (await run(db, 'INSERT INTO locations (name, shape, owner, x, z, hp_current, hp_max, hp_temp) VALUES (\'Kes\', \'rhombus\', \'kes\', 0, 0, 5, 20, 0)')).lastID;
  await run(db, 'INSERT INTO locations (name, shape, owner, x, z, battle_map_id, floor_index, hp_current, hp_max, hp_temp) VALUES (\'Kes\', \'rhombus\', \'kes\', 0, 0, 7, 0, 5, 20, 0)');
  ghoul = (await run(db, 'INSERT INTO locations (name, shape, x, z, hp_current, hp_max, hp_temp) VALUES (\'Ghoul\', \'enemy_rhombus\', 0, 0, 5, 10, 0)')).lastID;
  pal = (await run(db, 'INSERT INTO locations (name, shape, x, z, hp_current, hp_max, hp_temp) VALUES (\'Pal\', \'friendly_rhombus\', 0, 0, 5, 10, 0)')).lastID;
  heard = [];
  setAnnouncer((a) => heard.push(a));
};
const states = async (owner) => (await all(db, 'SELECT dying FROM locations WHERE owner = ? ORDER BY id', [owner])).map((r) => (r.dying ? JSON.parse(r.dying) : null));
const stateOfToken = async (id) => { const r = await get(db, 'SELECT dying FROM locations WHERE id = ?', [id]); return r.dying ? JSON.parse(r.dying) : null; };
const hp = (id, current) => run(db, 'UPDATE locations SET hp_current = ? WHERE id = ? OR (owner IS NOT NULL AND owner = (SELECT owner FROM locations WHERE id = ?))', [current, id, id]);
const lines = () => heard.flatMap((a) => a.lines);
const DOWN = { state: 'dying', saves: 0, fails: 0, made: 0, turns: 0, due: false };

describe('health run out, as each model says it', () => {
  it('a pool or a count at 0, with a maximum to count from; never without one, nor in a game with no health', () => {
    expect(outNow({ model: 'pool' }, { current: 0, max: 20 }, {})).toBe(true);
    expect(outNow({ model: 'pool' }, { current: 1, max: 20 }, {})).toBe(false);
    expect(outNow({ model: 'pool' }, { current: 0, max: 0 }, {})).toBe(false);
    expect(outNow(null, { current: -3, max: 5 }, {})).toBe(true);
    expect(outNow({ model: 'tracks' }, { current: 0, max: 10 }, { stun: 2 })).toBe(true);
    expect(outNow({ model: 'harm' }, { current: 0, max: 6 }, {})).toBe(true);
    expect(outNow({ model: 'locations' }, { current: 2, max: 6 }, {})).toBe(false);
    expect(outNow({ model: 'none' }, { current: 0, max: 5 }, {})).toBe(false);
    // Wounds count from the setup's number until the token has its own.
    expect(outNow({ model: 'wounds', count: 3 }, { current: 0, max: 0 }, {})).toBe(true);
    expect(outNow({ model: 'wounds', count: 0 }, { current: 0, max: 0 }, {})).toBe(false);
  });

  it('typed: the heaviest type\'s marks filling the track, not every box marked lighter', () => {
    const typed = { model: 'typed', types: [{ id: 'superficial' }, { id: 'aggravated' }] };
    expect(outNow(typed, { current: 0, max: 4 }, { superficial: 4, aggravated: 0 })).toBe(false);
    expect(outNow(typed, { current: 0, max: 4 }, { superficial: 0, aggravated: 4 })).toBe(true);
    expect(outNow(typed, { current: 0, max: 0 }, { aggravated: 4 })).toBe(false);
    expect(outNow({ model: 'typed', types: [{ id: 'x' }] }, { current: 0, max: 4 }, { x: 4 })).toBe(false);
  });
});

describe('a token\'s state as its health changes', () => {
  beforeEach(() => setUp());

  it('down at 0: kept on every copy of a player\'s token, said to them and the GM', async () => {
    await hp(kes, 0);
    expect(await noticeHealth(db, { locationId: kes, hurt: true })).toEqual({ st: DOWN, said: 'DYING' });
    expect(await states('kes')).toEqual([DOWN, DOWN]);
    expect(heard).toEqual([{ lines: [{ line: 'KES · DYING', seenBy: 'kes', account: 'kes' }], changed: true, owner: 'kes' }]);
  });

  it('hurt while down counts a failure; healed above 0 lets all of it go', async () => {
    await hp(kes, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    await noticeHealth(db, { locationId: kes, hurt: true });
    expect(await states('kes')).toEqual([{ ...DOWN, fails: 1 }, { ...DOWN, fails: 1 }]);
    expect(lines()[1].line).toBe('KES · HURT WHILE DOWN · A FAILURE · 0 OF 3 SAVES · 1 OF 3 FAILS');
    // Something else written at 0 that isn't damage: nothing changes, nothing said.
    heard = [];
    expect(await noticeHealth(db, { locationId: kes })).toEqual({ st: { ...DOWN, fails: 1 }, said: null });
    expect(heard).toEqual([]);
    await hp(kes, 3);
    expect((await noticeHealth(db, { owner: 'kes' })).said).toBe('BACK UP');
    expect(await states('kes')).toEqual([null, null]);
    expect(heard).toEqual([{ lines: [{ line: 'KES · BACK UP', seenBy: 'kes', account: 'kes' }], changed: true, owner: 'kes' }]);
  });

  it('set to 0 by hand, not as damage, still goes down', async () => {
    await hp(kes, 0);
    expect((await noticeHealth(db, { locationId: kes })).st).toEqual(DOWN);
  });

  it('two hits landing together each count', async () => {
    await hp(kes, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    await Promise.all([noticeHealth(db, { locationId: kes, hurt: true }), noticeHealth(db, { owner: 'kes', hurt: true })]);
    expect((await states('kes'))[0].fails).toBe(2);
  });

  it('well, nothing kept and nothing said', async () => {
    expect(await noticeHealth(db, { locationId: kes, hurt: true })).toEqual({ st: null, said: null });
    expect(heard).toEqual([]);
    expect(await states('kes')).toEqual([null, null]);
  });

  it('nothing for what is not a token, nor in a game without the rule', async () => {
    const shop = (await run(db, 'INSERT INTO locations (name, shape, x, z, hp_current, hp_max) VALUES (\'Shop\', \'box\', 0, 0, 0, 5)')).lastID;
    expect(await noticeHealth(db, { locationId: shop, hurt: true })).toBeNull();
    expect(await noticeHealth(db, { locationId: 'x' })).toBeNull();
    expect(await noticeHealth(db, { locationId: 9999 })).toBeNull();
    expect(await noticeHealth(db, { owner: 'nobody' })).toBeNull();
    await run(db, 'UPDATE global_settings SET value = \'generic\' WHERE key = \'game_system\'');
    await hp(kes, 0);
    expect(await noticeHealth(db, { locationId: kes, hurt: true })).toBeNull();
    expect(await states('kes')).toEqual([null, null]);
  });
});

describe('who goes down', () => {
  it('NPCs left out to start: an NPC at 0 is out, as today', async () => {
    await setUp();
    await hp(ghoul, 0); await hp(pal, 0);
    expect(await noticeHealth(db, { locationId: ghoul, hurt: true })).toBeNull();
    expect(await noticeHealth(db, { locationId: pal, hurt: true })).toBeNull();
    expect(await stateOfToken(ghoul)).toBeNull();
    expect(heard).toEqual([]);
  });

  it('ENEMY NPCS ticked: an enemy goes down, said to the GM alone; a friendly one still out', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }));
    await hp(ghoul, 0); await hp(pal, 0);
    expect((await noticeHealth(db, { locationId: ghoul, hurt: true })).st).toEqual(DOWN);
    expect(lines()).toEqual([{ line: 'GHOUL (NPC) · DYING', seenBy: '', account: null }]);
    expect(await noticeHealth(db, { locationId: pal, hurt: true })).toBeNull();
  });

  it('FRIENDLY NPCS ticked: a friendly one goes down', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { friendly: true } }));
    await hp(pal, 0);
    expect((await noticeHealth(db, { locationId: pal, hurt: true })).said).toBe('DYING');
    expect(await stateOfToken(pal)).toEqual(DOWN);
  });

  it('a state kept from before the rule went is let go at the next change', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }, { parts: { death: { on: false } } }));
    await run(db, 'UPDATE locations SET dying = ?, hp_current = 0 WHERE id = ?', [JSON.stringify(DOWN), ghoul]);
    expect(await noticeHealth(db, { locationId: ghoul, hurt: true })).toBeNull();
    expect(await stateOfToken(ghoul)).toBeNull();
    expect(heard).toEqual([{ lines: [], changed: true, owner: null }]);
  });
});

describe('every way a token\'s health changes tells it', () => {
  beforeEach(() => setUp());

  it('the HEALTH folder\'s DAMAGE and HEAL', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/locations', require_('../routes/locations.js')(db, { emit: () => {}, to: () => ({ emit: () => {} }) }, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
    const put = (body) => request(app).put(`/api/locations/${kes}/health`).set('Authorization', `Bearer ${GM}`).send(body);
    expect((await put({ action: 'damage', amount: 9 })).status).toBe(200);
    // Each line waited for, as it is said after the state is kept.
    await until(() => lines().length === 1, { label: 'down by DAMAGE' });
    await put({ action: 'damage', amount: 2 });
    await until(() => lines().length === 2, { label: 'a failure by DAMAGE while down' });
    await put({ action: 'heal', amount: 4 });
    await until(() => lines().length === 3, { label: 'back up by HEAL' });
    expect(await states('kes')).toEqual([null, null]);
    expect(lines().map((l) => l.line)).toEqual(['KES · DYING', 'KES · HURT WHILE DOWN · A FAILURE · 0 OF 3 SAVES · 1 OF 3 FAILS', 'KES · BACK UP']);
  });

  it('the HEALTH folder on an NPC under ENEMY NPCS, and under a health model of the game\'s own', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }, { core: { health: { model: 'wounds', count: 3, penalty: 1 } } }));
    await run(db, 'UPDATE locations SET hp_current = 1, hp_max = 3 WHERE id = ?', [ghoul]);
    const app = express();
    app.use(express.json());
    app.use('/api/locations', require_('../routes/locations.js')(db, { emit: () => {}, to: () => ({ emit: () => {} }) }, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
    const put = (id, body) => request(app).put(`/api/locations/${id}/health`).set('Authorization', `Bearer ${GM}`).send(body);
    expect((await put(ghoul, { action: 'damage', amount: 1 })).body).toMatchObject({ hp_current: 0, out: true });
    await until(() => lines().length === 1, { label: 'the ghoul down by its wounds' });
    expect(lines()[0].line).toBe('GHOUL (NPC) · DYING');
    await put(ghoul, { action: 'damage', amount: 1 });
    await until(() => lines().length === 2, { label: 'the ghoul hurt while down' });
    expect((await stateOfToken(ghoul)).fails).toBe(1);
  });

  it('the HEALTH folder on an NPC in one pool', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }));
    const app = express();
    app.use(express.json());
    app.use('/api/locations', require_('../routes/locations.js')(db, { emit: () => {}, to: () => ({ emit: () => {} }) }, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
    await request(app).put(`/api/locations/${ghoul}/health`).set('Authorization', `Bearer ${GM}`).send({ action: 'damage', amount: 6 });
    await until(() => lines().length === 1, { label: 'the ghoul down' });
    expect(await stateOfToken(ghoul)).toEqual(DOWN);
  });

  it('a hit taken off (AUTO, APPLY, SEND TO)', async () => {
    const target = await new Promise((ok) => targetOf(db, kes, ID, ok));
    await new Promise((ok) => takeOff(db, { system: ID, health: { model: 'pool' }, target, amount: 8 }, ok));
    await until(async () => (await states('kes'))[0]?.state === 'dying', { label: 'down by a hit' });
  });

  it('a condition\'s EACH TURN damage, and a hit while down from it', async () => {
    await run(db, 'UPDATE locations SET hp_current = 2, conditions = ? WHERE owner = \'kes\'', [JSON.stringify([{ id: 'burning' }])]);
    const io = { emit: vi.fn() };
    await fireTurnMoments(db, { io, runtime, system: ID, moments: [{ when: 'turn_start', ids: ['player:kes'] }] });
    expect((await states('kes'))[0]).toEqual(DOWN);
    await fireTurnMoments(db, { io, runtime, system: ID, moments: [{ when: 'turn_start', ids: ['player:kes'] }] });
    expect((await states('kes'))[0].fails).toBe(1);
  });

  it('a recovery die spent brings them back up', async () => {
    await setUp(SYSTEM(DND, {
      choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }] }],
      resting: { recovery: { name: 'Hit Dice', count: 'levels', spent_at: 'any', back: [] } },
    }));
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = \'kes\'', [JSON.stringify({ name: 'Kes', body: 7, [PICKS_KEY]: { classes: [{ option: 'fighter', level: 3 }] } })]);
    await hp(kes, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    const done = await spendRecovery(db, { emit: vi.fn() }, { system: ID, definition: runtime.definitionOf(ID), username: 'kes', pool: 'fighter', count: 1, rng: () => 0.5 });
    expect(done.ok).toBe(true);
    expect(await states('kes')).toEqual([null, null]);
  });

  it('a rest\'s healing brings them back up', async () => {
    await hp(kes, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    expect((await takeRest(db, { emit: vi.fn() }, { system: ID, definition: runtime.definitionOf(ID), restId: 'short_rest', username: 'kes' })).error).toBeUndefined();
    expect(await states('kes')).toEqual([null, null]);
  });
});

describe('kept per game system, beside its health', () => {
  it('put away with the game left, and back with it', async () => {
    await setUp();
    await hp(kes, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    await switchSystem(db, 'generic');
    expect(await states('kes')).toEqual([null, null]);
    await switchSystem(db, ID);
    expect(await states('kes')).toEqual([DOWN, DOWN]);
  });
});

describe('who reads it', () => {
  it('the word everyone\'s; the count its player\'s and the GM\'s', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }));
    expect(publicDying(JSON.stringify({ ...DOWN, fails: 2 }))).toBe('{"state":"dying"}');
    expect(publicDying(null)).toBeNull();
    expect(publicDying('nonsense')).toBeNull();
    await hp(kes, 0); await hp(ghoul, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    await noticeHealth(db, { locationId: ghoul, hurt: true });
    const app = express();
    app.use(express.json());
    app.use('/api/locations', require_('../routes/locations.js')(db, { emit: () => {}, to: () => ({ emit: () => {} }) }, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
    const seen = async (token) => {
      const req = request(app).get('/api/locations');
      const res = token ? await req.set('Authorization', `Bearer ${token}`) : await req;
      return Object.fromEntries(res.body.filter((l) => l.dying !== undefined && l.name !== 'Pal').map((l) => [`${l.name}${l.battle_map_id ? ' 2' : ''}`, l.dying && JSON.parse(l.dying)]));
    };
    expect(await seen(GM)).toEqual({ Kes: DOWN, 'Kes 2': DOWN, Ghoul: DOWN });
    expect(await seen(KES)).toEqual({ Kes: DOWN, 'Kes 2': DOWN, Ghoul: { state: 'dying' } });
    expect(await seen(ASH)).toEqual({ Kes: { state: 'dying' }, 'Kes 2': { state: 'dying' }, Ghoul: { state: 'dying' } });
    expect(await seen(null)).toEqual({ Kes: { state: 'dying' }, 'Kes 2': { state: 'dying' }, Ghoul: { state: 'dying' } });
  });

  it('each line live and in the history: the player\'s own and the GM\'s; an NPC\'s the GM\'s alone', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }));
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) };
    const emitUpdate = vi.fn();
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
    const join = async (who, identity) => {
      const got = [];
      const handlers = {};
      connection({ id: `dying-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => got.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      const said = () => got.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data.historyString);
      const history = async () => {
        got.length = 0;
        handlers.requestDiceHistory();
        return (await until(() => got.find((e) => e.event === 'diceRollHistory'), { label: `${who}'s history` })).data.map((r) => r.historyString);
      };
      return { said, history };
    };
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    const k = await join('kes', 'kes');
    const a = await join('ash', 'ash');
    // A socket named nothing is nobody's: never an NPC's line, the GM's alone.
    const nobody = await join('nobody', '');
    await hp(kes, 0); await hp(ghoul, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    await noticeHealth(db, { locationId: ghoul, hurt: true });
    await until(() => gm.said().length === 2, { label: 'the GM told both' });
    await until(() => k.said().length === 1, { label: 'kes told theirs' });
    expect(gm.said()).toEqual(['KES · DYING', 'GHOUL (NPC) · DYING']);
    expect(k.said()).toEqual(['KES · DYING']);
    expect(a.said()).toEqual([]);
    expect(nobody.said()).toEqual([]);
    expect(emitUpdate).toHaveBeenCalledWith({ isRhombusOnly: true });
    // A line everyone sees, after them.
    await run(db, 'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (\'ash\', 4, \'[4]\', \'#00ff00\', \'ash rolled 4\')');
    await until(async () => (await all(db, 'SELECT id FROM dice_rolls')).length === 3, { label: 'all three kept' });
    expect(await gm.history()).toEqual(['KES · DYING', 'GHOUL (NPC) · DYING', 'ash rolled 4']);
    expect(await k.history()).toEqual(['KES · DYING', 'ash rolled 4']);
    expect(await a.history()).toEqual(['ash rolled 4']);
    expect(await nobody.history()).toEqual(['ash rolled 4']);
    expect((await get(db, 'SELECT seen_by FROM dice_rolls WHERE historyString = \'GHOUL (NPC) · DYING\'')).seen_by).toBe('');
  });
});

/** Dice that land on these faces, in turn. */
const faces = (sides, ...shown) => { let i = 0; return () => (shown[Math.min(i++, shown.length - 1)] - 0.5) / sides; };
const NATURALS = { ...DND, naturals: [{ face: 20, then: 'back_up' }] };
const CWN = { word: 'Mortally Wounded', way: 'turns', turns: 2, hurt: 'dead' };
const fight = async (combatants) => {
  await run(db, `CREATE TABLE IF NOT EXISTS initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
    pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE IF NOT EXISTS initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
    sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1, begun INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!combatants) return;
  const combat = (await run(db, 'INSERT INTO initiative_combat (system) VALUES (?)', [ID])).lastID;
  await run(db, 'INSERT INTO initiative_scene (scene_key, combat_id, combatants, turn_index, begun) VALUES (\'main\', ?, ?, 0, 1)', [combat, JSON.stringify(combatants)]);
};
const down = async (id = kes) => { await hp(id, 0); await noticeHealth(db, { locationId: id, hurt: true }); heard = []; };
const save = (shown, more = {}) => rollDeathSave(db, { locationId: kes, who: 'kes', account: 'kes', rng: faces(20, ...shown), ...more });

describe('the death save (8c1b2)', () => {
  it('rolled with the character\'s numbers, kept, and said with its dice to the player and the GM', async () => {
    await setUp();
    await fight();
    await down();
    expect(await save([14])).toEqual({ ok: true, st: { ...DOWN, saves: 1, turns: 1 }, words: 'DEATH SAVE 1d20 [14 = 14] · 10 OR MORE · SUCCESS · 1 OF 3 SAVES · 0 OF 3 FAILS' });
    expect(await states('kes')).toEqual([{ ...DOWN, saves: 1, turns: 1 }, { ...DOWN, saves: 1, turns: 1 }]);
    expect(heard).toEqual([{ lines: [{ line: 'kes: KES · DEATH SAVE 1d20 [14 = 14] · 10 OR MORE · SUCCESS · 1 OF 3 SAVES · 0 OF 3 FAILS', seenBy: 'kes', account: 'kes', userName: 'kes', results: { 20: [14] }, total: 14 }], changed: true, owner: 'kes' }]);
    // Their own number to beat, read off their sheet.
    await setUp(SYSTEM({ ...DND, save: { dice: '1d20', target: '@body + 6' } }));
    await fight();
    await down();
    expect((await save([12])).words).toBe('DEATH SAVE 1d20 [12 = 12] · 13 OR MORE · FAILURE · 0 OF 3 SAVES · 1 OF 3 FAILS');
  });

  it('a natural that brings them back: 1 HP on every copy, and the rest let go', async () => {
    await setUp(SYSTEM(NATURALS));
    await fight();
    await down();
    expect((await save([20])).words).toBe('DEATH SAVE 1d20 [20 = 20] · 10 OR MORE · NATURAL 20 · BACK WITH 1 HP');
    await until(() => lines().length === 2, { label: 'back up said after the save' });
    expect((await all(db, 'SELECT hp_current FROM locations WHERE owner = \'kes\'')).map((r) => r.hp_current)).toEqual([1, 1]);
    expect(await states('kes')).toEqual([null, null]);
    expect(lines()[1].line).toBe('KES · BACK UP');
  });

  it('refused where nobody is down, or the game has no saves', async () => {
    await setUp();
    await fight();
    expect(await save([14])).toEqual({ ok: false, error: 'Not dying' });
    await down();
    await save([1]); await save([1]); await save([1]);
    expect(await save([14])).toEqual({ ok: false, error: 'Already dead' });
    await setUp(SYSTEM(CWN));
    await fight();
    await down();
    expect(await save([14])).toEqual({ ok: false, error: 'This game has no death saves' });
    expect(await rollDeathSave(db, { locationId: 9999, who: 'kes', rng: faces(20, 14) })).toEqual({ ok: false, error: 'No such token' });
    await setUp(SYSTEM(DND, { parts: { death: { on: false } } }));
    await fight();
    expect(await save([14])).toEqual({ ok: false, error: 'This game has no dying rule for them' });
    expect(heard).toEqual([]);
  });

  it('in a fight it waits for their turn, which the tracker lights; the GM\'s needn\'t wait', async () => {
    await setUp();
    await fight([{ id: 'player:kes' }, { id: `npc:${ghoul}` }]);
    expect(await inFight(db, { shape: 'rhombus', owner: 'kes' })).toBe(true);
    expect(await inFight(db, { shape: 'friendly_rhombus', id: pal })).toBe(false);
    await down();
    expect(await save([14])).toEqual({ ok: false, error: 'A death save waits for their turn' });
    await dyingTurns(db, { moments: [{ when: 'turn_end', ids: ['player:kes'] }, { when: 'turn_start', ids: ['player:kes', 'npc:x', 'nobody'] }] });
    expect(await states('kes')).toEqual([{ ...DOWN, turns: 1, due: true }, { ...DOWN, turns: 1, due: true }]);
    expect(lines()).toEqual([{ line: 'KES IS DYING: DEATH SAVE', seenBy: 'kes', account: 'kes' }]);
    // Spent by the save, which the tracker has already counted as a turn.
    expect((await save([14])).st).toEqual({ ...DOWN, saves: 1, turns: 1 });
    expect(await save([14])).toEqual({ ok: false, error: 'A death save waits for their turn' });
    expect((await save([14], { byGm: true })).st.saves).toBe(2);
  });
});

describe('a turn going by (8c1b2)', () => {
  it('TURNS LEFT runs down by the GM\'s A TURN GOES BY out of a fight, to DEAD', async () => {
    await setUp(SYSTEM(CWN));
    await fight();
    await down();
    expect(await turnGoesBy(db, { locationId: kes })).toEqual({ ok: true, st: { ...DOWN, turns: 1 }, said: '1 TURN LEFT' });
    expect(lines()).toEqual([{ line: 'KES · MORTALLY WOUNDED · 1 TURN LEFT', seenBy: 'kes', account: 'kes' }]);
    expect((await turnGoesBy(db, { locationId: kes })).st.state).toBe('dead');
    expect(lines()[1].line).toBe('KES · MORTALLY WOUNDED · OUT OF TURNS · DEAD');
    // The dead have no turns to count.
    heard = [];
    expect(await turnGoesBy(db, { locationId: kes })).toEqual({ ok: true, st: { ...DOWN, turns: 2, state: 'dead' }, said: null });
    expect(heard).toEqual([]);
  });

  it('in a fight, the tracker\'s to count: the GM\'s refused, the turn start counted', async () => {
    await setUp(SYSTEM({ ...CWN, npcs: { enemy: true } }));
    await fight([{ id: `npc:${ghoul}` }]);
    await down(ghoul);
    expect(await turnGoesBy(db, { locationId: ghoul })).toEqual({ ok: false, error: 'In a fight the tracker counts their turns' });
    await dyingTurns(db, { moments: [{ when: 'turn_start', ids: [`npc:${ghoul}`] }] });
    expect((await stateOfToken(ghoul)).turns).toBe(1);
    expect(lines()).toEqual([{ line: 'GHOUL (NPC) · MORTALLY WOUNDED · 1 TURN LEFT', seenBy: '', account: null }]);
  });

  it('SAVES COUNTED out of a fight: a turn counted, no save lit to carry into one', async () => {
    await setUp();
    await fight();
    await down();
    expect(await turnGoesBy(db, { locationId: kes })).toEqual({ ok: true, st: { ...DOWN, turns: 1 }, said: 'DEATH SAVE' });
    expect((await states('kes'))[0].due).toBe(false);
  });

  it('nothing for one not down, nor a token gone', async () => {
    await setUp();
    await fight([{ id: 'player:kes' }]);
    expect(await turnGoesBy(db, { locationId: kes })).toEqual({ ok: false, error: 'Not down' });
    await dyingTurns(db, { moments: [{ when: 'turn_start', ids: ['player:kes'] }] });
    expect(await states('kes')).toEqual([null, null]);
    expect(heard).toEqual([]);
    await dyingTurns(db, { moments: 'nonsense' });
  });

  it('the tracker\'s NEXT starts their turn and lights the save', async () => {
    await setUp();
    await fight([{ id: `npc:${ghoul}` }, { id: 'player:kes' }]);
    await down();
    let connect;
    registerInitiativeHandlers({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) }, db, { emitUpdate: () => {} });
    const handlers = {};
    connect({ id: 'gm', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, use: () => {}, join: () => {} });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(() => lines().length === 1, { label: 'the save lit by the turn' });
    expect(lines()[0].line).toBe('KES IS DYING: DEATH SAVE');
    expect((await states('kes'))[0].due).toBe(true);
  });
});

describe('pressed at the table (8c1b2)', () => {
  it('DEATH SAVE: their player\'s or the GM\'s; A TURN GOES BY the GM\'s', async () => {
    await setUp(SYSTEM({ ...DND, npcs: { enemy: true } }));
    await fight();
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const handlers = {};
      const got = [];
      connection({ id: `press-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => got.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      const ask = (event, payload) => new Promise((ok) => handlers[event](payload, ok));
      return { ask, got };
    };
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    const k = await join('kes', 'kes');
    const a = await join('ash', 'ash');
    await hp(kes, 0); await hp(ghoul, 0);
    await noticeHealth(db, { locationId: kes, hurt: true });
    await noticeHealth(db, { locationId: ghoul, hurt: true });
    expect(await a.ask('deathSave', { locationId: kes })).toEqual({ ok: false, error: 'Only their player or the GM rolls it' });
    expect(await k.ask('deathSave', { locationId: ghoul })).toEqual({ ok: false, error: 'Only their player or the GM rolls it' });
    expect(await k.ask('deathSave', { locationId: 'x' })).toEqual({ ok: false, error: 'Which token?' });
    expect(await k.ask('deathSave', { locationId: 9999 })).toEqual({ ok: false, error: 'No such token' });
    expect(await k.ask('deathSave', { locationId: kes })).toEqual({ ok: true });
    expect(await gm.ask('deathSave', { locationId: ghoul })).toEqual({ ok: true });
    expect((await states('kes'))[0].turns).toBe(1);
    expect((await stateOfToken(ghoul)).turns).toBe(1);
    // Thrown in the tray with its die, named by who pressed it, as their rolls are (their character's name).
    const thrown = await until(() => k.got.find((e) => e.event === 'diceRollBroadcast' && /^Kes: KES · DEATH SAVE 1d20 \[\d+ = \d+\]/.test(e.data.historyString)), { label: 'the save in kes\'s tray' });
    expect(thrown.data.results['20']).toHaveLength(1);
    expect(thrown.data.quiet).toBeUndefined();
    expect(a.got.some((e) => e.event === 'diceRollBroadcast')).toBe(false);
    expect(await k.ask('dyingTurn', { locationId: kes })).toEqual({ ok: false, error: 'The GM\'s to say' });
    expect(await gm.ask('dyingTurn', { locationId: 'x' })).toEqual({ ok: false, error: 'Which token?' });
    expect(await gm.ask('dyingTurn', { locationId: kes })).toEqual({ ok: true });
    expect((await states('kes'))[0].turns).toBe(2);
    expect(await gm.ask('dyingTurn', { locationId: pal })).toEqual({ ok: false, error: 'This game has no dying rule for them' });
    // In a fight, their player waits for their turn; the GM needn't.
    const combat = (await run(db, 'INSERT INTO initiative_combat (system) VALUES (?)', [ID])).lastID;
    await run(db, 'INSERT INTO initiative_scene (scene_key, combat_id, combatants, turn_index, begun) VALUES (\'main\', ?, ?, 0, 1)', [combat, JSON.stringify([{ id: 'player:kes' }])]);
    expect(await k.ask('deathSave', { locationId: kes })).toEqual({ ok: false, error: 'A death save waits for their turn' });
    expect(await gm.ask('deathSave', { locationId: kes })).toEqual({ ok: true });
  });
});
