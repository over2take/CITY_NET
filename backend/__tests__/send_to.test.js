/**
 * SEND TO, the GM's (8b7a; approved mockup docs/mockups/send-to.html, 2026-11-26, all as recommended). A damage roll that
 * reached no target through the map's attack is kept with its log line, and the GM's copy says so; the GM sends it on to
 * tokens, each FULL or HALF (halved before resistances, rounded down), each taken as the table applies damage (CONFIRM keeps
 * it waiting), each said in the log, each token once per roll. Players can't send, and aren't told what may be sent.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get, all } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const sendTo = require_('../tokens/sendTo');
const { takenWords } = require_('../systemBuilder/damageTaken');
const { rollFor, emitRoll } = require_('../utils/rollSeen');
const socketsFactory = (await import('../sockets/index.js')).default;

describe('which rolls may be sent (tokens/sendTo.js)', () => {
  const gear = (more) => ({ ok: true, kind: 'damage', line: 'Fireball', value: 28, ...more });
  it('a gear line\'s DAMAGE that came to something, each part and its type; never its DICE', () => {
    expect(sendTo.sendableGear(gear({ parts: [{ value: 28, type: 'FIRE', label: 'FIRE', extra: 1 }] })))
      .toEqual({ what: 'Fireball', total: 28, parts: [{ value: 28, type: 'FIRE', label: 'FIRE' }] });
    expect(sendTo.sendableGear(gear())).toEqual({ what: 'Fireball', total: 28, parts: [{ value: 28, type: null, label: null }] });
    expect(sendTo.sendableGear(gear({ parts: [] })).parts).toEqual([{ value: 28, type: null, label: null }]);
    expect(sendTo.sendableGear(gear({ kind: 'dice' }))).toBeNull();
    expect(sendTo.sendableGear(gear({ value: 0 }))).toBeNull();
    expect(sendTo.sendableGear(gear({ ok: false }))).toBeNull();
    expect(sendTo.sendableGear(null)).toBeNull();
  });

  const field = (more = {}, result = {}) => ({
    ok: true, roll: 'bolt', read: 'sum', total: 12, board: { label: 'ARCANE BOLT' },
    result: { groups: [{ sides: 8, faces: [{ value: 5 }, { value: 4 }] }], target: null, ...result }, ...more,
  });
  it('a plain roll\'s total, one part of no type: never a lone d20, a roll against a number, symbols, or a count', () => {
    expect(sendTo.sendableField(field())).toEqual({ what: 'ARCANE BOLT', total: 12, parts: [{ value: 12, type: null, label: null }] });
    expect(sendTo.sendableField(field({ board: null })).what).toBe('BOLT');
    expect(sendTo.sendableField(field({ read: undefined }))).not.toBeNull();
    expect(sendTo.sendableField(field({}, { groups: [{ sides: 20, faces: [{ value: 15 }] }] }))).toBeNull();
    // A d20 that exploded is still one d20; a d20 and a d6 is not a roll to hit.
    expect(sendTo.sendableField(field({}, { groups: [{ sides: 20, faces: [{ value: 20 }, { value: 3, extra: true }] }] }))).toBeNull();
    expect(sendTo.sendableField(field({}, { groups: [{ sides: 20, faces: [{ value: 15 }] }, { sides: 6, faces: [{ value: 2 }] }] }))).not.toBeNull();
    expect(sendTo.sendableField(field({}, { groups: [{ sides: 6, faces: [{ value: 6 }] }] }))).not.toBeNull();
    expect(sendTo.sendableField(field({}, { target: 15 }))).toBeNull();
    expect(sendTo.sendableField(field({}, { symbols: { left: {} } }))).toBeNull();
    expect(sendTo.sendableField(field({ read: 'count' }))).toBeNull();
    expect(sendTo.sendableField(field({ total: 0 }))).toBeNull();
    expect(sendTo.sendableField(field({ ok: false }))).toBeNull();
    expect(sendTo.sendableField({ ok: true })).toBeNull();
  });

  it('HALF: each part halved, rounded down', () => {
    expect(sendTo.halved([{ value: 7, type: 'FIRE' }, { value: 4 }, { value: -3 }, {}])).toEqual([{ value: 3, type: 'FIRE' }, { value: 2 }, { value: 0 }, { value: 0 }]);
  });

  it('a SEND\'s targets: each token once, HALF only where said, at most 30', () => {
    expect(sendTo.targetsOf([{ locationId: 4, half: true }, { locationId: 9 }, { locationId: 4 }, { locationId: 2, half: 'yes' }]))
      .toEqual({ ok: true, targets: [{ locationId: 4, half: true }, { locationId: 9, half: false }, { locationId: 2, half: false }] });
    expect(sendTo.targetsOf([])).toEqual({ ok: false, error: 'Pick who it goes to' });
    expect(sendTo.targetsOf('4')).toEqual({ ok: false, error: 'Pick who it goes to' });
    for (const bad of [{ locationId: 0 }, { locationId: 1.5 }, { locationId: '4' }, null]) {
      expect(sendTo.targetsOf([bad])).toEqual({ ok: false, error: 'Nothing to send to' });
    }
    const many = Array.from({ length: 31 }, (_, i) => ({ locationId: i + 1 }));
    expect(sendTo.targetsOf(many)).toEqual({ ok: false, error: 'At most 30 at once' });
    expect(sendTo.targetsOf(many.slice(0, 30)).ok).toBe(true);
  });

  it('the line, and what the GM\'s tray is told of a kept roll', () => {
    expect(sendTo.sentWords({ what: 'Fireball', from_name: 'Mira' }, 'GOBLIN B · TAKES 14 OF 28')).toBe('SENT BY GM · Fireball (from MIRA) → GOBLIN B · TAKES 14 OF 28');
    const parts = JSON.stringify([{ value: 4, type: 'slashing', label: 'Slashing' }, { value: 6, type: 'fire' }, { value: 2, type: 'fire' }, { value: 1 }]);
    expect(sendTo.sendShown({ roll_id: 7, what: 'Flame Tongue', from_name: 'Kes', total: 13, parts }, ['GHOUL']))
      .toEqual({ rollId: 7, what: 'Flame Tongue', from: 'Kes', total: 13, types: ['SLASHING', 'FIRE'], sent: ['GHOUL'] });
    expect(sendTo.sendShown({ roll_id: 7, what: 'X', from_name: 'K', total: 1, parts: 'nope' }).types).toEqual([]);
  });

  it('a hit\'s words: SAVED: HALF before its resistances, OF the roll\'s whole total', () => {
    const taken = { parts: [{ value: 3, type: 'fire', kind: 'resist', works: 'half', taken: 1 }], rolled: 3, taken: 1 };
    expect(takenWords('Goblin B', taken, { lead: ['SAVED: HALF'], of: 10 })).toBe('GOBLIN B · SAVED: HALF · RESISTS FIRE: 3 → 1 · TAKES 1 OF 10');
    expect(takenWords('Goblin B', { parts: [{ value: 5, kind: null, taken: 5 }], rolled: 5, taken: 5 }, { of: 5 })).toBe('GOBLIN B · TAKES 5');
  });

  it('what only the GM is told of a roll goes to the GM alone', () => {
    const data = { historyString: 'rolled', gm: { send: { rollId: 3 } } };
    expect(rollFor(data, true)).toEqual({ historyString: 'rolled', send: { rollId: 3 } });
    expect(rollFor(data, false)).toEqual({ historyString: 'rolled' });
    const heard = [];
    const sockets = new Map([['a', { id: 'a', emit: (e, d) => heard.push(['a', d]) }], ['b', { id: 'b', emit: (e, d) => heard.push(['b', d]) }]]);
    const io = { emit: vi.fn() };
    emitRoll(io, sockets, (s) => s.id === 'a', data);
    expect(io.emit).not.toHaveBeenCalled();
    expect(heard).toEqual([['a', { historyString: 'rolled', send: { rollId: 3 } }], ['b', { historyString: 'rolled' }]]);
  });
});

const ID = 'sys_sendsendsendsend1';
const OTHER = 'sys_othergameothergam';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const SYSTEM = (apply = 'auto') => ({
  format: 1, name: 'Sends', core: { health: { model: 'pool' } },
  stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] },
    { id: 'spells', label: 'SPELLS', stats: [{ id: 'bolt', label: 'Arcane Bolt' }] },
  ],
  rolls: [
    { id: 'blast', label: 'Blast', dice: [{ count: '2', sides: 8 }], add: '3', by: ['spells'] },
    { id: 'tohit', label: 'To hit', dice: [{ count: '1', sides: 20 }], add: '2', by: ['abilities'] },
    { id: 'save', label: 'Save', dice: [{ count: '2', sides: 6 }], against: '7', by: ['abilities'] },
    { id: 'best', label: 'Best of three', dice: [{ count: '3', sides: 6 }], read: 'highest', by: ['abilities'] },
  ],
  items: {
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'heals', label: 'HEALS', kind: 'dice' }] }],
    list: [{ id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '4 SLASHING + 6 FIRE DMG', heals: '2' } }],
  },
  damage: { apply },
});
const LINES = { inventory: JSON.stringify([{ name: 'Flame Tongue', qty: 1, enc: '', bundled: false, carry: 'readied', location: '' }]) };
const FIRE_RESISTED = { _resistances: [{ kind: 'resist', type: 'fire' }] };
const ROLLED = 'Kes rolled Flame Tongue DAMAGE 4 SLASHING + 6 FIRE DMG [0 + 4] + [0 + 6] = 4 SLASHING + 6 FIRE DMG (10)';

let db;
const setUp = async ({ apply = 'auto', totalsShown = true } = {}) => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const def = JSON.stringify(SYSTEM(apply));
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Sends', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
  if (totalsShown) await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'hit_totals_gm_only\', \'0\')');
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', might: 1, bolt: 1, ...LINES })]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'ash\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Ash', ...FIRE_RESISTED })]);
  const ghoul = await run(db, 'INSERT INTO locations (name, shape, x, z, melee_ac, ranged_ac, hp_current, hp_max, hp_temp) VALUES (\'Ghoul\', \'friendly_rhombus\', 0, 0, 0, 0, 20, 20, 0)');
  const sheet = await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (\'gm\', ?, ?, 1, \'Ghoul\')', [ID, JSON.stringify({ name: 'Ghoul', ...FIRE_RESISTED })]);
  await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ghoul.lastID, sheet.lastID]);
  const ash = await run(db, 'INSERT INTO locations (name, shape, owner, x, z, melee_ac, hp_current, hp_max, hp_temp) VALUES (\'Ash\', \'rhombus\', \'ash\', 0, 0, 0, 20, 20, 2)');
  const barrel = await run(db, 'INSERT INTO locations (name, shape, x, z, hp_current, hp_max, hp_temp) VALUES (\'Barrel\', \'enemy_rhombus\', 0, 0, 5, 5, 0)');

  const everyone = [];
  const toGm = [];
  let connection;
  const emitUpdate = vi.fn();
  const io = {
    on: (e, cb) => { if (e === 'connection') connection = cb; },
    emit: (event, data) => { for (const h of everyone) h.push({ event, data }); },
    to: (id) => ({ emit: (event, data) => toGm.push({ id, event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
  const join = async (who, identity) => {
    const heard = [];
    everyone.push(heard);
    const handlers = {};
    connection({ id: `send-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    const rolls = () => heard.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data);
    const ask = (event, payload) => new Promise((resolve) => handlers[event](payload, resolve));
    return { handlers, heard, rolls, lines: () => rolls().map((r) => r.historyString), ask };
  };
  const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
  const kes = await join('kes', 'kes');
  const hp = async (id) => get(db, 'SELECT hp_current, hp_temp FROM locations WHERE id = ?', [id]);
  /** Kes rolls from the sheet (the Flame Tongue's DAMAGE by default), both hear it: the GM's copy of it and Kes's. */
  const roll = async (payload = { gear: { line: 0, column: 'damage' } }) => {
    const n = gm.rolls().length;
    const m = kes.rolls().length;
    kes.handlers.requestSheetRoll(payload);
    await until(() => gm.rolls().length > n && kes.rolls().length > m, { label: 'the roll heard' });
    await until(async () => (await get(db, 'SELECT COUNT(*) AS n FROM dice_rolls WHERE historyString = ?', [gm.lines().at(-1)])).n > 0, { label: 'kept' });
    return { gm: gm.rolls().at(-1), kes: kes.rolls().at(-1) };
  };
  /** The GM sends a kept roll and waits for its lines: `targets` [[id, half?]]. */
  const send = async (rollId, targets, who = gm) => {
    const before = gm.lines().length;
    const answer = await who.ask('sendRoll', { rollId, targets: targets.map(([locationId, half]) => ({ locationId, half: !!half })) });
    if (answer.ok) await until(() => gm.lines().length >= before + answer.sent.length, { label: 'each target\'s line' });
    return answer;
  };
  return { gm, kes, hp, roll, send, join, toGm, emitUpdate, ghoul: ghoul.lastID, ash: ash.lastID, barrel: barrel.lastID };
};
afterEach(() => vi.restoreAllMocks());

describe('a damage roll kept to send', () => {
  it('a gear DAMAGE that reached no target: the GM\'s copy says it may be sent, with its types; Kes\'s doesn\'t', async () => {
    const t = await setUp();
    const { gm, kes } = await t.roll();
    expect(gm.historyString).toBe(ROLLED);
    expect(gm.send).toEqual({ rollId: expect.any(Number), what: 'Flame Tongue', from: 'Kes', total: 10, types: ['SLASHING', 'FIRE'], sent: [] });
    expect(kes.send).toBeUndefined();
    expect(kes.historyString).toBe(ROLLED);
    const kept = await get(db, 'SELECT * FROM sendable_rolls WHERE roll_id = ?', [gm.send.rollId]);
    expect(kept).toMatchObject({ system: ID, what: 'Flame Tongue', from_name: 'Kes', by_user: 'kes', total: 10 });
    expect(JSON.parse(kept.parts).map((p) => [p.value, p.type])).toEqual([[4, 'slashing'], [6, 'fire']]);
    expect((await get(db, 'SELECT historyString FROM dice_rolls WHERE id = ?', [gm.send.rollId])).historyString).toBe(ROLLED);
  });

  it('not a gear DICE, nor a DAMAGE that already reached its target through the map\'s attack', async () => {
    const t = await setUp();
    expect((await t.roll({ gear: { line: 0, column: 'heals' } })).gm.send).toBeUndefined();
    t.kes.handlers.initiateAttack({ targetId: t.ghoul, attackType: 'melee' });
    await until(() => t.kes.heard.some((e) => e.event === 'attackPending'), { label: 'the attack waiting' });
    const n = t.gm.lines().length;
    t.kes.handlers.requestDiceRoll({ userName: 'kes', diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await until(() => t.gm.lines().length > n, { label: 'the d20' });
    const hit = await t.roll();
    expect(hit.gm.historyString).toMatch(/→ GHOUL/);
    expect(hit.gm.send).toBeUndefined();
    expect((await get(db, 'SELECT COUNT(*) AS n FROM sendable_rolls')).n).toBe(0);
  });

  it('a plain roll of the sheet\'s: its total, no type; not its lone d20, its save against a number, or its highest die', async () => {
    const t = await setUp();
    const bolt = await t.roll({ fieldId: 'bolt' });
    expect(bolt.gm.send).toEqual({ rollId: expect.any(Number), what: 'ARCANE BOLT', from: 'Kes', total: bolt.gm.total, types: [], sent: [] });
    expect(bolt.gm.total).toBeGreaterThanOrEqual(5);
    expect(bolt.kes.send).toBeUndefined();
    expect((await t.roll({ fieldId: 'might', rollId: 'tohit' })).gm.send).toBeUndefined();
    expect((await t.roll({ fieldId: 'might', rollId: 'save' })).gm.send).toBeUndefined();
    // Its highest die read, not a sum: not damage.
    expect((await t.roll({ fieldId: 'might', rollId: 'best' })).gm.send).toBeUndefined();
  });

  it('the history replayed: the GM\'s lines say what may be sent and where it went; a player\'s say nothing', async () => {
    const t = await setUp();
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.ghoul]]);
    const replay = async (who) => {
      const n = who.heard.filter((e) => e.event === 'diceRollHistory').length;
      who.handlers.requestDiceHistory();
      await until(() => who.heard.filter((e) => e.event === 'diceRollHistory').length > n, { label: 'the history' });
      return who.heard.filter((e) => e.event === 'diceRollHistory').at(-1).data;
    };
    const mine = await replay(t.gm);
    expect(mine.find((r) => r.historyString === ROLLED).send).toEqual({ ...gm.send, sent: ['GHOUL'] });
    expect(mine.filter((r) => r.send)).toHaveLength(1);
    expect((await replay(t.kes)).some((r) => 'send' in r)).toBe(false);
  });
});

describe('the GM\'s SEND', () => {
  it('AUTO: each taken at once, its own resistances worked out; HALF halved first, said OF the whole roll', async () => {
    const t = await setUp();
    const { gm } = await t.roll();
    const answer = await t.send(gm.send.rollId, [[t.ghoul], [t.ash, true], [t.barrel]]);
    expect(answer).toEqual({ ok: true, sent: ['GHOUL', 'ASH', 'BARREL'] });
    expect(t.gm.lines().slice(-3)).toEqual([
      'SENT BY GM · Flame Tongue (from KES) → GHOUL · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10',
      'SENT BY GM · Flame Tongue (from KES) → ASH · SAVED: HALF · RESISTS FIRE: 3 → 1 · TAKES 3 OF 10',
      'SENT BY GM · Flame Tongue (from KES) → BARREL · TAKES 10',
    ]);
    // Players: an NPC's unrevealed resistance and what it did kept from them; a player's character's all.
    expect(t.kes.lines().slice(-3)).toEqual([
      'SENT BY GM · Flame Tongue (from KES) → GHOUL',
      'SENT BY GM · Flame Tongue (from KES) → ASH · SAVED: HALF · RESISTS FIRE: 3 → 1 · TAKES 3 OF 10',
      'SENT BY GM · Flame Tongue (from KES) → BARREL · TAKES 10',
    ]);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 13, hp_temp: 0 });
    expect(await t.hp(t.ash)).toEqual({ hp_current: 19, hp_temp: 0 });
    expect(await t.hp(t.barrel)).toEqual({ hp_current: 0, hp_temp: 0 });
    expect(t.emitUpdate).toHaveBeenCalledWith({ isRhombusOnly: true });
    expect(t.kes.heard.some((e) => e.event === 'sheetUpdated' && e.data.username === 'ash')).toBe(true);
    // Kept in the log, the players' words beside the GM's; every GM tray told where it went.
    const kept = await get(db, 'SELECT username, historyString, players_history FROM dice_rolls WHERE historyString LIKE \'%→ GHOUL%\'');
    expect(kept).toEqual({ username: 'gm', historyString: t.gm.lines().at(-3), players_history: 'SENT BY GM · Flame Tongue (from KES) → GHOUL' });
    expect(t.toGm).toEqual([{ id: 'send-gm', event: 'rollSent', data: { ...gm.send, sent: ['GHOUL', 'ASH', 'BARREL'] } }]);
  });

  it('each token once per roll: sent again, it is passed over; a new token still takes it', async () => {
    const t = await setUp();
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.ghoul]]);
    const lines = t.gm.lines().length;
    expect(await t.send(gm.send.rollId, [[t.ghoul, true], [t.barrel]])).toEqual({ ok: true, sent: ['BARREL'] });
    expect(t.gm.lines().length).toBe(lines + 1);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 13, hp_temp: 0 });
    expect(t.toGm.at(-1).data.sent).toEqual(['GHOUL', 'BARREL']);
    // Two sends at once to the same token: one takes it.
    const second = (await t.roll()).gm.send.rollId;
    const [a, b] = await Promise.all([t.gm.ask('sendRoll', { rollId: second, targets: [{ locationId: t.ghoul }] }), t.gm.ask('sendRoll', { rollId: second, targets: [{ locationId: t.ghoul }] })]);
    expect([...a.sent, ...b.sent]).toEqual(['GHOUL']);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 6, hp_temp: 0 });
  });

  it('a token gone is passed over, and may be sent to no more than any other', async () => {
    const t = await setUp();
    const { gm } = await t.roll();
    await run(db, 'DELETE FROM locations WHERE id = ?', [t.barrel]);
    expect(await t.send(gm.send.rollId, [[t.barrel], [t.ghoul]])).toEqual({ ok: true, sent: ['GHOUL'] });
    expect(await all(db, 'SELECT location_id, target_name FROM roll_sends')).toEqual([{ location_id: t.ghoul, target_name: 'GHOUL' }]);
  });

  it('CONFIRM: each waits on its target\'s HEALTH, HALF\'s kept OF the whole roll; nothing taken yet', async () => {
    const t = await setUp({ apply: 'confirm' });
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.ghoul, true]]);
    expect(t.gm.lines().at(-1)).toBe('SENT BY GM · Flame Tongue (from KES) → GHOUL · SAVED: HALF · RESISTS FIRE: 3 → 1 · WAITING ON ITS HEALTH · HIDDEN FROM PLAYERS · WOULD TAKE 3 OF 10');
    expect(t.kes.lines().at(-1)).toBe('SENT BY GM · Flame Tongue (from KES) → GHOUL · SAVED · WAITING ON ITS HEALTH');
    const waiting = await get(db, 'SELECT * FROM waiting_hits WHERE location_id = ?', [t.ghoul]);
    expect(waiting).toMatchObject({ taken: 3, rolled: 10, from_name: 'Kes', what: 'Flame Tongue', by_user: 'kes', words: 'SAVED: HALF · RESISTS FIRE: 3 → 1 · HIDDEN FROM PLAYERS · WOULD TAKE 3 OF 10' });
    expect(t.kes.heard.some((e) => e.event === 'waitingHitsChanged' && e.data.locationId === t.ghoul)).toBe(true);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 20, hp_temp: 0 });
    expect(t.emitUpdate).not.toHaveBeenCalledWith({ isRhombusOnly: true });
  });

  it('OFF: only said, with what it would take', async () => {
    const t = await setUp({ apply: 'off' });
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.barrel]]);
    expect(t.gm.lines().at(-1)).toBe('SENT BY GM · Flame Tongue (from KES) → BARREL · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE 10');
    expect(await t.hp(t.barrel)).toEqual({ hp_current: 5, hp_temp: 0 });
    expect((await get(db, 'SELECT COUNT(*) AS n FROM waiting_hits')).n).toBe(0);
  });

  it('HIT TOTALS ON NPCS: GM ONLY: players told only that it was sent, and that it saved', async () => {
    const t = await setUp({ totalsShown: false });
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.barrel, true]]);
    expect(t.gm.lines().at(-1)).toBe('SENT BY GM · Flame Tongue (from KES) → BARREL · SAVED: HALF · HIDDEN FROM PLAYERS · TAKES 5 OF 10');
    expect(t.kes.lines().at(-1)).toBe('SENT BY GM · Flame Tongue (from KES) → BARREL · SAVED');
  });

  it('a plain roll sent: its total, of no type, met by nothing', async () => {
    const t = await setUp();
    const { gm } = await t.roll({ fieldId: 'bolt' });
    await t.send(gm.send.rollId, [[t.ghoul]]);
    expect(t.gm.lines().at(-1)).toBe(`SENT BY GM · ARCANE BOLT (from KES) → GHOUL · TAKES ${gm.total}`);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 20 - gm.total, hp_temp: 0 });
  });

  it('only the GM sends, or is told what it would take; a roll not kept, or of another game, isn\'t sent', async () => {
    const t = await setUp();
    const { gm } = await t.roll();
    const kept = { rollId: gm.send.rollId, targets: [{ locationId: t.ghoul }] };
    expect(await t.kes.ask('sendRoll', kept)).toEqual({ ok: false, error: 'Only the GM sends a roll' });
    expect(await t.kes.ask('sendRollPreview', kept)).toEqual({ ok: false, error: 'Only the GM sends a roll' });
    expect(await t.gm.ask('sendRoll', { rollId: gm.send.rollId + 50, targets: kept.targets })).toEqual({ ok: false, error: 'That roll can\'t be sent' });
    expect(await t.gm.ask('sendRoll', { rollId: 'x', targets: kept.targets })).toEqual({ ok: false, error: 'Nothing to send' });
    expect(await t.gm.ask('sendRoll', { rollId: gm.send.rollId, targets: [] })).toEqual({ ok: false, error: 'Pick who it goes to' });
    await run(db, 'UPDATE sendable_rolls SET system = ? WHERE roll_id = ?', [OTHER, gm.send.rollId]);
    expect(await t.gm.ask('sendRoll', kept)).toEqual({ ok: false, error: 'That roll was made in another game' });
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 20, hp_temp: 0 });
    expect((await get(db, 'SELECT COUNT(*) AS n FROM roll_sends')).n).toBe(0);
    // A send with no answer wanted is still checked.
    t.kes.handlers.sendRoll(kept);
    await drain(db);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 20, hp_temp: 0 });
  });

  it('the picker\'s numbers: what each would take, FULL or HALF, and whether it went there; nothing kept or taken', async () => {
    const t = await setUp({ apply: 'confirm' });
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.barrel]]);
    const lines = t.gm.lines().length;
    const seen = await t.gm.ask('sendRollPreview', { rollId: gm.send.rollId, targets: [{ locationId: t.ghoul, half: true }, { locationId: t.ash }, { locationId: t.barrel }, { locationId: 999 }] });
    expect(seen).toEqual({ ok: true, targets: [
      { locationId: t.ghoul, half: true, name: 'GHOUL', taken: 3, words: 'SAVED: HALF · RESISTS FIRE: 3 → 1 · WOULD TAKE 3 OF 10', sent: false },
      { locationId: t.ash, half: false, name: 'ASH', taken: 7, words: 'RESISTS FIRE: 6 → 3 · WOULD TAKE 7 OF 10', sent: false },
      { locationId: t.barrel, half: false, name: 'BARREL', taken: 10, words: 'WOULD TAKE 10', sent: true },
    ] });
    await drain(db);
    expect(t.gm.lines().length).toBe(lines);
    expect((await get(db, 'SELECT COUNT(*) AS n FROM waiting_hits')).n).toBe(1);
    expect(await t.hp(t.ghoul)).toEqual({ hp_current: 20, hp_temp: 0 });
    expect(await t.gm.ask('sendRollPreview', { rollId: gm.send.rollId, targets: 'all' })).toEqual({ ok: false, error: 'Pick who it goes to' });
    expect(await t.gm.ask('sendRollPreview', { rollId: 0, targets: [{ locationId: t.ghoul }] })).toEqual({ ok: false, error: 'Nothing to send' });
  });

  it('a history purged takes its kept rolls and where they went with it (db.js)', async () => {
    const t = await setUp();
    // db.js's own trigger, read from it (requiring db.js would open the live database).
    const source = readFileSync(new URL('../db.js', import.meta.url), 'utf8');
    const trigger = source.match(/CREATE TRIGGER IF NOT EXISTS sendable_rolls_line_gone[\s\S]*?END/);
    expect(trigger).not.toBeNull();
    await run(db, trigger[0]);
    const { gm } = await t.roll();
    await t.send(gm.send.rollId, [[t.ghoul]]);
    await run(db, 'DELETE FROM dice_rolls');
    expect((await get(db, 'SELECT COUNT(*) AS n FROM sendable_rolls')).n).toBe(0);
    expect((await get(db, 'SELECT COUNT(*) AS n FROM roll_sends')).n).toBe(0);
  });
});
