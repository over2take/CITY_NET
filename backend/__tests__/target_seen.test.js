/**
 * How much of a roll's target players see (6c4h; approved mockup docs/mockups/players-see-target.html,
 * 2026-10-24): SHOWN "vs 15: SUCCESS", VERDICT ONLY "SUCCESS", GM ONLY nothing of it, and nothing of the
 * effects that come only on a success or a failure. Set for the whole system and overridden by a roll.
 * The GM (the main admin, not a granted editor) sees all of it, live and in the history replayed. A
 * system made before the setting has none and stays SHOWN; a new one is made GM ONLY.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const require_ = createRequire(import.meta.url);
const { rollField, seenOf, HIDDEN } = require_('../systemBuilder/tableRolls');
const { checkRoll, SEEN } = require_('../systemBuilder/rollStyles');
const { checkDefinition, blankDefinition } = require_('../systemBuilder/definition');
const { rollFor, emitRoll, historyFor } = require_('../utils/rollSeen');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

/** A d20 save against the sheet's own number, a natural 20 that anyone can see, and an effect only a success brings. */
const SAVE = {
  id: 'saving', label: 'Save', dice: [{ count: '1', sides: 20, name: 'Luck' }], against: '@this', by: ['save'],
  natural: [{ face: 20, label: 'Critical' }],
  effects: [{ name: 'Luck', face: 20, when: 'success', label: 'Lucky' }, { name: 'Luck', face: 20, when: 'any', label: 'Bright' }],
};
const OLD = { format: 1, name: 'Old', derived: [{ id: 'save', label: 'Save', formula: '15' }], rolls: [SAVE] };
const SHEET = { save: 15 };

/** Dice that land on these faces, in turn. */
const faces = (...fs) => { let i = 0; return () => { const f = fs[i++ % fs.length]; return (f - 0.5) / 20; }; };
const roll = (definition, rng = faces(20)) => rollField({ definition, data: SHEET, fieldId: 'save', rng, who: 'Kestrel' });

describe('the setting, in a system\'s file', () => {
  it('is one of SHOWN, VERDICT ONLY and GM ONLY, for the system and for a roll', () => {
    expect(SEEN).toEqual(['shown', 'verdict', 'gm']);
    for (const seen of SEEN) {
      expect(checkDefinition({ ...OLD, target_seen: seen }).problems, seen).toEqual([]);
      expect(checkRoll({ ...SAVE, seen }), seen).toEqual([]);
    }
    expect(checkDefinition({ ...OLD, target_seen: 'hidden' }).problems).toEqual([{ where: 'target_seen', message: 'One of shown, verdict, gm' }]);
    expect(checkRoll({ ...SAVE, seen: 'nobody' })).toEqual([{ where: 'roll, seen', message: 'One of shown, verdict, gm' }]);
  });

  it('on a roll needs a target to keep', () => {
    const { against, ...noTarget } = SAVE;
    expect(checkRoll({ ...noTarget, seen: 'gm' })).toEqual([{ where: 'roll, seen', message: 'Who sees the target needs a target' }]);
  });

  it('is GM ONLY in a new system, and none at all in one made before it (so SHOWN, as it was)', () => {
    expect(blankDefinition('Fresh')).toEqual({ format: 1, name: 'Fresh', target_seen: 'gm' });
    expect(seenOf(OLD, SAVE)).toBe('shown');
    expect(seenOf({ ...OLD, target_seen: 'gm' }, SAVE)).toBe('gm');
    // A roll's own wins over the system's.
    expect(seenOf({ ...OLD, target_seen: 'gm' }, { ...SAVE, seen: 'verdict' })).toBe('verdict');
    expect(seenOf({ ...OLD, target_seen: 'verdict' }, { ...SAVE, seen: 'shown' })).toBe('shown');
  });
});

describe('a roll as players and the GM see it', () => {
  it('an old system with no setting: players see the target and the verdict, as always', () => {
    const made = roll(OLD);
    expect(made.players).toBeNull();
    expect(made.historyText).toBe('Kestrel rolled Save (Save) [20 = 20] — vs 15: SUCCESS · CRITICAL · LUCKY · BRIGHT');
    expect(made.board).toEqual({ label: 'SAVE', outcome: 'vs 15: SUCCESS · CRITICAL · LUCKY · BRIGHT' });
  });

  it('VERDICT ONLY: players see SUCCESS but never the number; the GM sees all, and that it was kept', () => {
    const made = roll({ ...OLD, target_seen: 'verdict' });
    expect(made.players.historyText).toBe('Kestrel rolled Save (Save) [20 = 20] — SUCCESS · CRITICAL · LUCKY · BRIGHT');
    expect(made.players.board).toEqual({ label: 'SAVE', outcome: 'SUCCESS · CRITICAL · LUCKY · BRIGHT' });
    expect(made.historyText).toBe(`Kestrel rolled Save (Save) [20 = 20] — vs 15: SUCCESS · CRITICAL · LUCKY · BRIGHT${HIDDEN}`);
    expect(made.board).toEqual({ label: 'SAVE', outcome: 'vs 15: SUCCESS · CRITICAL · LUCKY · BRIGHT' });
  });

  it('GM ONLY: players see the total, what the dice show and any-roll effects; not the target, the verdict, or a success\'s effect', () => {
    const made = roll({ ...OLD, target_seen: 'gm' });
    expect(made.players.historyText).toBe('Kestrel rolled Save (Save) [20 = 20] — CRITICAL · BRIGHT');
    expect(made.players.board).toEqual({ label: 'SAVE', outcome: 'CRITICAL · BRIGHT' });
    expect(made.historyText).toBe(`Kestrel rolled Save (Save) [20 = 20] — vs 15: SUCCESS · CRITICAL · LUCKY · BRIGHT${HIDDEN}`);
    // A failure with nothing else to say leaves players the bare total, on the board too.
    const missed = roll({ ...OLD, target_seen: 'gm' }, faces(3));
    expect(missed.players.historyText).toBe('Kestrel rolled Save (Save) [3 = 3]');
    expect(missed.players.board).toEqual({ label: 'SAVE' });
    expect(missed.historyText).toBe(`Kestrel rolled Save (Save) [3 = 3] — vs 15: FAILURE${HIDDEN}`);
  });

  it('a roll\'s own setting over the system\'s, either way', () => {
    expect(roll({ ...OLD, target_seen: 'gm', rolls: [{ ...SAVE, seen: 'shown' }] }).players).toBeNull();
    expect(roll({ ...OLD, rolls: [{ ...SAVE, seen: 'gm' }] }).players.historyText).toBe('Kestrel rolled Save (Save) [20 = 20] — CRITICAL · BRIGHT');
  });

  it('keeps nothing from players when a roll has no target, whatever the setting', () => {
    const { against, ...noTarget } = SAVE;
    const made = roll({ ...OLD, target_seen: 'gm', rolls: [noTarget] });
    expect(made.players).toBeNull();
    expect(made.historyText).not.toContain(HIDDEN);
  });
});

describe('sending a roll', () => {
  const players = { historyText: 'kept', board: { label: 'SAVE' } };
  const data = { userName: 'Kestrel', total: 20, historyString: 'all', board: { label: 'SAVE', outcome: 'vs 15: SUCCESS' }, throw: {}, group: 'g' };

  it('gives the GM all of it, anyone else the players\' version, and never the players\' version as itself', () => {
    expect(rollFor({ ...data, players }, true)).toEqual(data);
    expect(rollFor({ ...data, players }, false)).toEqual({ ...data, historyString: 'kept', board: { label: 'SAVE' } });
    expect(rollFor({ ...data, players: null }, false)).toEqual(data);
  });

  it('goes to everyone at once when all see it alike, each their own when not', () => {
    const io = { emit: vi.fn() };
    const socket = (id) => ({ id, emit: vi.fn() });
    const gm = socket('gm');
    const kes = socket('kes');
    const connections = new Map([[gm.id, gm], [kes.id, kes]]);
    emitRoll(io, connections, (s) => s.id === 'gm', { ...data, players: null });
    expect(io.emit).toHaveBeenCalledWith('diceRollBroadcast', data);
    expect(gm.emit).not.toHaveBeenCalled();
    emitRoll(io, connections, (s) => s.id === 'gm', { ...data, players });
    expect(io.emit).toHaveBeenCalledTimes(1);
    expect(gm.emit).toHaveBeenCalledWith('diceRollBroadcast', data);
    expect(kes.emit).toHaveBeenCalledWith('diceRollBroadcast', { ...data, historyString: 'kept', board: { label: 'SAVE' } });
  });

  it('replays the history the same way: the players\' line where a roll has one', () => {
    expect(historyFor({ historyString: 'all', players_history: 'kept' }, true)).toBe('all');
    expect(historyFor({ historyString: 'all', players_history: 'kept' }, false)).toBe('kept');
    expect(historyFor({ historyString: 'all', players_history: null }, false)).toBe('all');
  });
});

describe('at the table, through the socket', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const SYSTEM = { ...OLD, target_seen: 'gm', stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] }] };

  /** One table: the GM, a player and a granted editor on one server, each hearing their own. */
  const table = async () => {
    const shared = [];
    let connection;
    const elevatedUsers = new Set(['ghost']);
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers, emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const heard = [];
      const handlers = {};
      connection({ id: `s-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      const rolls = () => [...heard, ...shared].filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data);
      return { handlers, heard, rolls };
    };
    return {
      gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM }),
      kes: await join('kes', 'kes'),
      ghost: await join('ghost', 'ghost'),
    };
  };

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(SYSTEM);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_seenseenseenseen', 'Old', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'sys_seenseenseenseen')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', 'sys_seenseenseenseen', ?, 0)`, [JSON.stringify({ name: 'Kestrel', save: 15 })]);
  });

  it('sends the GM the target and verdict, and the player and a granted editor neither, live and in the history', async () => {
    const { gm, kes, ghost } = await table();
    kes.handlers.requestSheetRoll({ fieldId: 'save' });
    const toGm = await untilValue(() => gm.rolls()[0], Boolean, { label: 'the GM\'s roll' });
    const toKes = await untilValue(() => kes.rolls()[0], Boolean, { label: 'the player\'s roll' });
    const toGhost = await untilValue(() => ghost.rolls()[0], Boolean, { label: 'the editor\'s roll' });
    expect(toGm.historyString).toMatch(/— vs 15: (SUCCESS|FAILURE)/);
    expect(toGm.historyString.endsWith(HIDDEN)).toBe(true);
    for (const theirs of [toKes, toGhost]) {
      expect(theirs.historyString).not.toMatch(/vs 15|SUCCESS|FAILURE|HIDDEN/);
      expect(theirs.board.outcome ?? '').not.toMatch(/vs 15|SUCCESS|FAILURE/);
      expect(theirs).not.toHaveProperty('players');
      // The same roll: its dice, total and throw are everyone's.
      expect([theirs.total, theirs.throw]).toEqual([toGm.total, toGm.throw]);
    }
    expect(toGm).not.toHaveProperty('players');

    // Kept both ways, and replayed to each their own.
    const row = await get(db, 'SELECT historyString, players_history FROM dice_rolls');
    expect([row.historyString, row.players_history]).toEqual([toGm.historyString, toKes.historyString]);
    for (const [who, line] of [[gm, toGm.historyString], [kes, toKes.historyString], [ghost, toKes.historyString]]) {
      who.handlers.requestDiceHistory();
      const replay = await untilValue(() => who.heard.find((e) => e.event === 'diceRollHistory'), Boolean, { label: 'the history' });
      expect(replay.data.map((r) => r.historyString)).toEqual([line]);
    }
  });

  it('sends a roll everyone sees alike once, to everyone, as before', async () => {
    const shown = JSON.stringify({ ...SYSTEM, target_seen: 'shown' });
    await run(db, 'UPDATE custom_systems SET draft = ?, published = ?', [shown, shown]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const { gm, kes } = await table();
    kes.handlers.requestSheetRoll({ fieldId: 'save' });
    const toKes = await untilValue(() => kes.rolls()[0], Boolean, { label: 'the roll' });
    expect(toKes.historyString).toMatch(/— vs 15: (SUCCESS|FAILURE)/);
    // One send to the whole table, not one per connection.
    expect(gm.heard.some((e) => e.event === 'diceRollBroadcast')).toBe(false);
    expect((await get(db, 'SELECT players_history FROM dice_rolls')).players_history).toBeNull();
  });
});
