/**
 * Hits waiting under APPLY DAMAGE CONFIRM (8b6b1; approved mockup docs/mockups/waiting-hits.html, answered 2026-11-25). A hit
 * that reaches its target is kept on it, worked out when made, the log saying WAITING ON ITS HEALTH · WOULD TAKE n; then the
 * GM, or whoever plays the target, APPLYs it (taken off as HEALTH's DAMAGE), DISMISSes it, or APPLIES ALL oldest first, each
 * said in the log, players reading an NPC's as HIT TOTALS ON NPCS allows. Kept in the table through anything but APPLY,
 * DISMISS or the token deleted. The one who made a hit sees how many of theirs wait; anyone else nothing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get, all } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { rowWords, shownTo, appliedWords, dismissedWords, mayApply, WAITING } = require_('../tokens/waitingHits');
const socketsFactory = (await import('../sockets/index.js')).default;

describe('the rules (tokens/waitingHits.js)', () => {
  const hit = (over = {}) => ({ id: 1, target_name: 'Bog Ghoul', taken: 7, rolled: 10, from_name: 'Kes', what: 'Flame Tongue', words: 'RESISTS FIRE: 6 → 3 · WOULD TAKE 7 OF 10', players: null, totals_hidden: 0, by_user: 'kes', created_at: 't', ...over });
  it('a hit\'s words for its row: without its target\'s name or where it waits', () => {
    expect(rowWords('Bog Ghoul', `BOG GHOUL · RESISTS FIRE: 6 → 3 · ${WAITING} · WOULD TAKE 7 OF 10`)).toBe('RESISTS FIRE: 6 → 3 · WOULD TAKE 7 OF 10');
    expect(rowWords('Bog Ghoul', `BOG GHOUL · ${WAITING} · WOULD TAKE 10`)).toBe('WOULD TAKE 10');
    expect(rowWords('Bog Ghoul', 'WOULD TAKE 10')).toBe('WOULD TAKE 10');
  });
  it('the log\'s APPLY: who, what it took of what was rolled, from whom with what; players without the numbers kept from them', () => {
    expect(appliedWords(hit(), 'gm')).toEqual({ words: 'APPLIED BY GM · BOG GHOUL TAKES 7 OF 10 (from KES · Flame Tongue)' });
    expect(appliedWords(hit({ taken: 10 }), 'gm').words).toBe('APPLIED BY GM · BOG GHOUL TAKES 10 (from KES · Flame Tongue)');
    expect(appliedWords(hit({ totals_hidden: 1 }), 'gm')).toEqual({
      words: 'APPLIED BY GM · BOG GHOUL TAKES 7 OF 10 (from KES · Flame Tongue)', players: 'APPLIED BY GM · BOG GHOUL (from KES · Flame Tongue)' });
  });
  it('the log\'s DISMISS: who, with what, on whom', () => {
    expect(dismissedWords(hit(), 'mira')).toEqual({ words: 'DISMISSED BY MIRA · Flame Tongue on BOG GHOUL' });
  });
  it('who sees what: whoever may apply, each hit oldest first, the GM\'s words or the players\'; the one who made some, how many; anyone else, none', () => {
    const hits = [hit(), hit({ id: 2, players: 'WOULD TAKE …', by_user: 'mira' })];
    expect(shownTo(hits, { may: true, editor: true, user: 'gm' }).hits.map((h) => [h.id, h.words])).toEqual([[1, hit().words], [2, hit().words]]);
    expect(shownTo(hits, { may: true, editor: false, user: 'vex' }).hits.map((h) => h.words)).toEqual([hit().words, 'WOULD TAKE …']);
    // Told nothing: nothing, never the GM's words.
    expect(shownTo([hit({ players: '' })], { may: true, editor: false, user: 'vex' }).hits[0].words).toBe('');
    expect(shownTo(hits, { may: true, editor: true, user: 'gm' }).hits[0]).toEqual({ id: 1, from: 'Kes', what: 'Flame Tongue', words: hit().words, taken: 7, at: 't' });
    // What it would take: to the GM always, to a player only where its numbers aren't kept from them (8b6b2).
    expect(shownTo([hit({ totals_hidden: 1 })], { may: true, editor: true, user: 'gm' }).hits[0].taken).toBe(7);
    expect(shownTo([hit({ totals_hidden: 1 })], { may: true, editor: false, user: 'kes' }).hits[0].taken).toBeNull();
    expect(shownTo([hit()], { may: true, editor: false, user: 'kes' }).hits[0].taken).toBe(7);
    expect(shownTo(hits, { may: false, editor: false, user: 'kes' })).toEqual({ may: false, hits: [], mine: 1 });
    expect(shownTo(hits, { may: false, editor: false, user: 'ash' })).toEqual({ may: false, hits: [], mine: 0 });
    expect(shownTo(hits, { may: false, editor: false, user: null })).toEqual({ may: false, hits: [], mine: 0 });
  });
  it('who may apply: the GM; a player their own character and an NPC given them; nobody unnamed, whatever the mode', () => {
    const own = { shape: 'rhombus', owner: 'kes' };
    const given = { shape: 'friendly_rhombus', controllers: JSON.stringify({ all: false, users: ['kes'] }) };
    expect(mayApply({ shape: 'enemy_rhombus' }, { editor: true, player: null })).toBe(true);
    expect(mayApply(own, { editor: false, player: 'kes' })).toBe(true);
    expect(mayApply(own, { editor: false, player: 'mira' })).toBe(false);
    expect(mayApply(given, { editor: false, player: 'kes' })).toBe(true);
    expect(mayApply(given, { editor: false, player: 'mira' })).toBe(false);
    expect(mayApply({ shape: 'rhombus', owner: null }, { editor: false, player: null })).toBe(false);
  });
});

const ID = 'sys_waitwaitwaitwait1';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const SYSTEM = (more = {}) => ({
  format: 1, name: 'Waits', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
    list: [{ id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '4 SLASHING + 6 FIRE DMG' } }, { id: 'club', label: 'Club', type: 'weapons', values: { damage: '5' } }],
  },
  damage: { apply: 'confirm' },
  ...more,
});
const LINES = { inventory: JSON.stringify(['Flame Tongue', 'Club'].map((name) => ({ name, qty: 1, enc: '', bundled: false, carry: 'readied', location: '' }))) };

let db;
const setUp = async ({ system = SYSTEM(), ghoulSheet = { name: 'Ghoul', _resistances: [{ kind: 'resist', type: 'fire' }] }, controllers = null, settings = {} } = {}) => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const def = JSON.stringify(system);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Waits', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
  for (const [key, value] of Object.entries(settings)) await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, ?)', [key, value]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', ...LINES })]);
  const ghoul = (await run(db, 'INSERT INTO locations (name, shape, controllers, x, z, melee_ac, ranged_ac, hp_current, hp_max, hp_temp) VALUES (\'Ghoul\', \'friendly_rhombus\', ?, 0, 0, 0, 0, 20, 20, 0)', [controllers])).lastID;
  if (ghoulSheet) {
    const sheet = await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (\'gm\', ?, ?, 1, \'Ghoul\')', [ID, JSON.stringify(ghoulSheet)]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ghoul, sheet.lastID]);
  }
  const shared = [];
  const everyone = [];
  let connection;
  const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => { shared.push({ event, data }); for (const h of everyone) h.push({ event, data }); }, to: () => ({ emit: () => {} }) };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const join = async (who, identity) => {
    const heard = [];
    everyone.push(heard);
    const handlers = {};
    connection({ id: `wait-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    const lines = () => heard.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data.historyString);
    const list = () => new Promise((resolve) => handlers.waitingHits({ locationId: ghoul }, resolve));
    const act = (payload) => new Promise((resolve) => handlers.waitingHitAct({ locationId: ghoul, ...payload }, resolve));
    return { handlers, heard, lines, list, act };
  };
  const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
  const kes = await join('kes', 'kes');
  const hp = async () => (await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [ghoul])).hp_current;
  /** Kes hits the Ghoul (AC 0) and rolls line `line`'s DAMAGE: kept, under CONFIRM. */
  const hitWith = async (line = 0) => {
    const before = kes.heard.filter((e) => e.event === 'attackPending').length;
    kes.handlers.initiateAttack({ targetId: ghoul, attackType: 'melee' });
    await until(() => kes.heard.filter((e) => e.event === 'attackPending').length > before, { label: 'the attack' });
    const rolled = shared.filter((e) => e.event === 'attackResult').length;
    kes.handlers.requestDiceRoll({ userName: 'kes', diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await until(() => shared.filter((e) => e.event === 'attackResult').length > rolled, { label: 'the hit' });
    const n = gm.lines().length;
    kes.handlers.requestSheetRoll({ gear: { line, column: 'damage' } });
    await until(() => gm.lines().length > n && /DAMAGE/.test(gm.lines().at(-1)), { label: 'the damage' });
    await until(async () => (await all(db, 'SELECT id FROM waiting_hits')).length > 0, { label: 'kept' });
    return gm.lines().at(-1);
  };
  return { gm, kes, join, hp, hitWith, ghoul, shared };
};
afterEach(() => vi.restoreAllMocks());

describe('a hit under CONFIRM, kept', () => {
  it('said WAITING ON ITS HEALTH with what it would take, nothing taken, kept with its words; whoever shows HEALTH told', async () => {
    const t = await setUp();
    expect(await t.hitWith()).toMatch(/→ GHOUL · RESISTS FIRE: 6 → 3 · WAITING ON ITS HEALTH · HIDDEN FROM PLAYERS · WOULD TAKE 7 OF 10$/);
    expect(await t.hp()).toBe(20);
    const kept = await all(db, 'SELECT location_id, target_name, taken, rolled, from_name, what, words, players, totals_hidden, by_user FROM waiting_hits');
    expect(kept).toEqual([{ location_id: t.ghoul, target_name: 'Ghoul', taken: 7, rolled: 10, from_name: 'Kes', what: 'Flame Tongue',
      // Players told nothing of an NPC's numbers (HIT TOTALS ON NPCS: GM ONLY, as it starts): nothing but that it waits.
      words: 'RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · WOULD TAKE 7 OF 10', players: '', totals_hidden: 1, by_user: 'kes' }]);
    expect(t.shared.some((e) => e.event === 'waitingHitsChanged' && e.data.locationId === t.ghoul)).toBe(true);
  });

  it('who sees them: the GM each with the GM\'s words; Kes, who made them, how many; another player nothing', async () => {
    const t = await setUp();
    await t.hitWith();
    await t.hitWith(1);
    const gm = await t.gm.list();
    expect(gm).toMatchObject({ ok: true, may: true });
    expect(gm.hits.map((h) => [h.from, h.what, h.words])).toEqual([
      ['Kes', 'Flame Tongue', 'RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · WOULD TAKE 7 OF 10'], ['Kes', 'Club', 'HIDDEN FROM PLAYERS · WOULD TAKE 5']]);
    expect(await t.kes.list()).toEqual({ ok: true, may: false, hits: [], mine: 2 });
    const ash = await t.join('ash', 'ash');
    expect(await ash.list()).toEqual({ ok: true, may: false, hits: [], mine: 0 });
    expect(await new Promise((r) => t.gm.handlers.waitingHits({ locationId: 9999 }, r))).toEqual({ ok: false, error: 'No such token' });
    expect(await new Promise((r) => t.gm.handlers.waitingHits(null, r))).toEqual({ ok: false, error: 'Nothing to show' });
    expect(() => t.gm.handlers.waitingHits({ locationId: t.ghoul })).not.toThrow();
  });
});

describe('APPLY, DISMISS, APPLY ALL', () => {
  it('APPLY: taken off as rolled then, the row gone, the log saying it, players without the numbers; twice applies nothing', async () => {
    const t = await setUp();
    await t.hitWith();
    const [hit] = (await t.gm.list()).hits;
    expect(await t.gm.act({ act: 'apply', hitId: hit.id })).toEqual({ ok: true, done: 1 });
    expect(await t.hp()).toBe(13);
    expect((await t.gm.list()).hits).toEqual([]);
    await until(() => t.gm.lines().some((l) => l.startsWith('APPLIED BY')), { label: 'said' });
    expect(t.gm.lines().at(-1)).toBe('APPLIED BY GM · GHOUL TAKES 7 OF 10 (from KES · Flame Tongue)');
    await until(() => t.kes.lines().some((l) => l.startsWith('APPLIED BY')), { label: 'told' });
    expect(t.kes.lines().at(-1)).toBe('APPLIED BY GM · GHOUL (from KES · Flame Tongue)');
    expect(await t.gm.act({ act: 'apply', hitId: hit.id })).toEqual({ ok: false, error: 'No such hit waiting' });
    expect(await t.hp()).toBe(13);
  });

  it('DISMISS: the row gone, nothing taken, the log saying it', async () => {
    const t = await setUp();
    await t.hitWith(1);
    const [hit] = (await t.gm.list()).hits;
    expect(await t.gm.act({ act: 'dismiss', hitId: hit.id })).toEqual({ ok: true, done: 1 });
    expect(await t.hp()).toBe(20);
    expect((await t.gm.list()).hits).toEqual([]);
    await until(() => t.gm.lines().some((l) => l.startsWith('DISMISSED BY')), { label: 'said' });
    expect(t.gm.lines().at(-1)).toBe('DISMISSED BY GM · Club on GHOUL');
  });

  it('APPLY ALL: every one, oldest first, each said; nothing waiting after', async () => {
    const t = await setUp({ settings: { hit_totals_gm_only: '0' } });
    await t.hitWith(1);
    await t.hitWith();
    expect(await t.gm.act({ act: 'apply_all' })).toEqual({ ok: true, done: 2 });
    expect(await t.hp()).toBe(8);
    expect((await t.gm.list()).hits).toEqual([]);
    await until(() => t.gm.lines().filter((l) => l.startsWith('APPLIED BY')).length === 2, { label: 'both said' });
    expect(t.gm.lines().filter((l) => l.startsWith('APPLIED BY'))).toEqual([
      'APPLIED BY GM · GHOUL TAKES 5 (from KES · Club)', 'APPLIED BY GM · GHOUL TAKES 7 OF 10 (from KES · Flame Tongue)']);
    // Totals shown at this table: the players read the numbers too.
    await until(() => t.kes.lines().filter((l) => l.startsWith('APPLIED BY')).length === 2, { label: 'told' });
    expect(t.kes.lines().filter((l) => l.startsWith('APPLIED BY'))[0]).toBe('APPLIED BY GM · GHOUL TAKES 5 (from KES · Club)');
  });

  it('a player: only on their own character or an NPC given them; refused otherwise, nothing done', async () => {
    const t = await setUp();
    await t.hitWith();
    const [hit] = (await t.gm.list()).hits;
    expect(await t.kes.act({ act: 'apply', hitId: hit.id })).toEqual({ ok: false, error: 'Only the GM, or whoever plays it, applies its hits' });
    expect(await t.hp()).toBe(20);
    const given = await setUp({ controllers: JSON.stringify({ all: false, users: ['kes'] }) });
    await given.hitWith();
    const mine = await given.kes.list();
    expect(mine.may).toBe(true);
    // A player reads the players' words where they were told less: here nothing of the NPC's numbers.
    expect(mine.hits[0].words).toBe('');
    expect(await given.kes.act({ act: 'apply', hitId: mine.hits[0].id })).toEqual({ ok: true, done: 1 });
    expect(await given.hp()).toBe(13);
  });

  it('one that can\'t be taken off: said why, kept waiting; nothing asked, or a hit of another token, nothing done', async () => {
    const typed = { model: 'typed', types: [{ id: 'bashing', label: 'Bashing' }, { id: 'lethal', label: 'Lethal' }] };
    const t = await setUp({ system: SYSTEM({ core: { health: typed } }), ghoulSheet: null });
    await t.hitWith(1);
    const [hit] = (await t.gm.list()).hits;
    expect(await t.gm.act({ act: 'apply', hitId: hit.id })).toEqual({ ok: false, error: 'This token has no sheet to keep that on', done: 0 });
    expect((await t.gm.list()).hits.map((h) => h.what)).toEqual(['Club']);
    expect(await t.gm.act({ act: 'nothing' })).toEqual({ ok: false, error: 'Nothing to do' });
    expect(await t.gm.act({ act: 'apply' })).toEqual({ ok: false, error: 'No such hit waiting' });
    expect(await new Promise((r) => t.gm.handlers.waitingHitAct({ locationId: 9999, act: 'apply_all' }, r))).toEqual({ ok: false, error: 'No such token' });
    expect(() => t.gm.handlers.waitingHitAct({ locationId: t.ghoul, act: 'dismiss', hitId: hit.id })).not.toThrow();
  });
});

describe('kept until', () => {
  it('the token deleted takes its waiting hits with it', async () => {
    const t = await setUp();
    await t.hitWith();
    await run(db, 'DELETE FROM locations WHERE id = ?', [t.ghoul]);
    expect(await all(db, 'SELECT id FROM waiting_hits')).toEqual([]);
  });

  it('another game being played: its hits not this one\'s', async () => {
    const t = await setUp();
    await t.hitWith();
    await run(db, 'UPDATE waiting_hits SET system = ?', ['sys_another0000000001']);
    expect((await t.gm.list()).hits).toEqual([]);
  });
});

describe('a player\'s character, and two hands at once', () => {
  it('a player\'s character: kept on one copy of their token, seen and applied from another, the game being played\'s alone, every copy taking it', async () => {
    const t = await setUp();
    const city = (await run(db, 'INSERT INTO locations (name, shape, owner, x, z, hp_current, hp_max, hp_temp) VALUES (\'Kes\', \'rhombus\', \'kes\', 0, 0, 20, 20, 0)')).lastID;
    const onMap = (await run(db, 'INSERT INTO locations (name, shape, owner, x, z, battle_map_id, floor_index, hp_current, hp_max, hp_temp) VALUES (\'Kes\', \'rhombus\', \'kes\', 0, 0, 7, 0, 20, 20, 0)')).lastID;
    const keep = (location, what, system = ID) => run(db, `INSERT INTO waiting_hits (location_id, system, target_name, taken, rolled, from_name, what, words, players, totals_hidden, by_user)
      VALUES (?, ?, 'Kes', 4, 4, 'OGRE', ?, 'WOULD TAKE 4', NULL, 0, 'gm')`, [location, system, what]);
    await keep(onMap, 'Greataxe');
    await keep(city, 'Club');
    await keep(onMap, 'Elsewhere', 'sys_another0000000001');
    const fromCity = await new Promise((r) => t.kes.handlers.waitingHits({ locationId: city }, r));
    expect(fromCity.may).toBe(true);
    expect(fromCity.hits.map((h) => h.what)).toEqual(['Greataxe', 'Club']);
    expect(await new Promise((r) => t.kes.handlers.waitingHitAct({ locationId: city, act: 'apply_all' }, r))).toEqual({ ok: true, done: 2 });
    for (const id of [city, onMap]) expect((await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [id])).hp_current).toBe(12);
    // Another game's stays for that game.
    expect((await all(db, 'SELECT what FROM waiting_hits')).map((h) => h.what)).toEqual(['Elsewhere']);
  });

  it('APPLY pressed twice at once, or by two people: taken once', async () => {
    const t = await setUp();
    await t.hitWith();
    const [hit] = (await t.gm.list()).hits;
    const answers = await Promise.all([t.gm.act({ act: 'apply', hitId: hit.id }), t.gm.act({ act: 'apply', hitId: hit.id })]);
    expect(answers.map((a) => a.done).sort()).toEqual([0, 1]);
    expect(await t.hp()).toBe(13);
  });
});

describe('who made it', () => {
  it('by their character\'s name where the sheet has one, the account\'s where it has none', async () => {
    const t = await setUp();
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = \'kes\'', [JSON.stringify({ name: 'Kestrel', ...LINES })]);
    await t.hitWith();
    expect((await t.gm.list()).hits[0].from).toBe('Kestrel');
    const nameless = await setUp();
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = \'kes\'', [JSON.stringify({ name: '  ', ...LINES })]);
    await nameless.hitWith();
    expect((await nameless.gm.list()).hits[0].from).toBe('Kes');
  });
});
