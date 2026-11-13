import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * IMPROVE BY USE on the server (7f3a1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): which stats improve,
 * what marks one (a successful roll of it, any roll, by hand only), the rest it is rolled at, the roll, what it must beat,
 * the gain and its most; checked, carried in the system file, told to the sheet; a stat marked by a roll or by hand; and
 * at the rest each marked stat rolled, improved over its target, the marks cleared, the log saying so.
 */

const require_ = createRequire(import.meta.url);
const { MARKS_KEY, improveOf, improvingStats, improvesBy, improveShown, marksOf, markedByRoll, improveAction, improveAt } = require_('../systemBuilder/improveByUse');
const { restOn, restLine } = require_('../systemBuilder/resting');
const { checkDefinition } = require_('../systemBuilder/definition');
const { buildFile, readFile } = require_('../systemBuilder/citysys');
const { versionChanges } = require_('../systemBuilder/versionDiff');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const USED = {
  format: 1, name: 'Used', core: { health: { model: 'pool' }, advancement: ['use'] },
  stats: [
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }, { id: 'spot', label: 'Spot Hidden', max: 50 }, { id: 'climb', label: 'Climb', rank: 'dots' }] },
    { id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'str', label: 'Strength' }] },
  ],
  ranks: [{ id: 'dots', label: 'DOTS', list: [{ name: 'NONE', worth: '0' }, { name: 'ONE', worth: '1' }] }],
  rests: { long_rest: { counts_as: ['end_of_session'] } },
  improve: { stats: 'skills', marked: 'success', at: 'end_of_session', roll: 'd100', over: '@this', gain: '1d10', most: 99 },
  rolls: [
    { id: 'check', label: 'Check', dice: [{ count: '1', sides: 100 }], against: '1', by: ['lore'] },
    { id: 'hard', label: 'Hard check', dice: [{ count: '1', sides: 100 }], against: '1000', by: ['spot'] },
  ],
};
const withImprove = (improve) => ({ ...USED, improve });
const problemsOf = (def) => checkDefinition(def).problems.filter((p) => p.where.startsWith('improve'));
/** Dice that land on each face given, in turn: `faces` as [sides, face]. */
const dice = (...faces) => { let i = 0; return () => { const [sides, face] = faces[i++]; return (face - 0.5) / sides; }; };
const marked = (...ids) => ({ [MARKS_KEY]: Object.fromEntries(ids.map((id) => [id, true])) });

describe('IMPROVE BY USE, checked', () => {
  it('a sound one has no problems; Call of Cthulhu\'s with nothing said', () => {
    expect(checkDefinition(USED).problems).toEqual([]);
    expect(improveOf({})).toEqual({ marked: 'success', at: 'end_of_session', roll: 'd100', over: '@this', gain: '1d10', most: null });
    expect(improveOf(USED)).toEqual({ stats: 'skills', marked: 'success', at: 'end_of_session', roll: 'd100', over: '@this', gain: '1d10', most: 99 });
    expect(improveOf(withImprove({ marked: 'often', roll: ' ', most: 1.5 }))).toMatchObject({ marked: 'success', roll: 'd100', most: null });
    expect(improvesBy(USED)).toBe(true);
    expect(improvesBy({ ...USED, core: { advancement: ['levels'] } })).toBe(false);
    expect(improvesBy(null)).toBe(false);
  });

  it('every problem said where it is', () => {
    expect(problemsOf(withImprove('x'))).toEqual([{ where: 'improve', message: 'Must say how stats improve by use' }]);
    expect(problemsOf(withImprove({ stats: 'nope', marked: 'often', at: 'nap', other: 1, most: 1.5 }))).toEqual([
      { where: 'improve, other', message: 'Not part of IMPROVE BY USE' },
      { where: 'improve, stats', message: 'No group of stats is called nope' },
      { where: 'improve, marked', message: 'A SUCCESSFUL ROLL OF IT, ANY ROLL OF IT or BY HAND ONLY' },
      { where: 'improve, at', message: 'No rest is called nap' },
      { where: 'improve, most', message: 'UP TO is a whole number' },
    ]);
    expect(problemsOf(withImprove({ at: 3 }))).toEqual([{ where: 'improve, at', message: 'Pick the rest it is rolled at' }]);
    expect(problemsOf(withImprove({ roll: '', over: 4, gain: '1d10 +' }))).toEqual([
      { where: 'improve, roll', message: 'Dice or a formula' },
      { where: 'improve, over', message: 'Dice or a formula' },
      expect.objectContaining({ where: 'improve, gain' }),
    ]);
    expect(problemsOf(withImprove({ over: '@nope', roll: 'd1' }))).toEqual([
      { where: 'improve, roll', message: 'A die has 2 to 1000 sides' },
      { where: 'improve, over', message: '@nope: no stat or formula is called that' },
    ]);
    expect(problemsOf(withImprove({ roll: 'd'.repeat(201) }))).toEqual([{ where: 'improve, roll', message: 'At most 200 characters' }]);
    // A group of ranks alone has nothing to improve.
    const ranksOnly = { ...USED, stats: [{ id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb', rank: 'dots' }] }], rolls: [] };
    expect(problemsOf({ ...ranksOnly, improve: { stats: 'skills' } })).toEqual([{ where: 'improve, stats', message: 'There are no stats to improve: a stat held as a rank isn\'t' }]);
    // A formula reading the sheet and @this reads.
    expect(problemsOf(withImprove({ over: 'max(@this, 95) - @str', gain: '@str d4 + 1' }))).toEqual([]);
  });

  it('the stats that improve: the group\'s, never a rank; every stat\'s with no group named; the sheet told them by name', () => {
    expect(improvingStats(USED).map((s) => s.id)).toEqual(['lore', 'spot']);
    expect(improvingStats(withImprove({})).map((s) => s.id)).toEqual(['lore', 'spot', 'str']);
    expect(improveShown(USED)).toEqual({ stats: [{ id: 'lore', label: 'Lore' }, { id: 'spot', label: 'Spot Hidden' }], marked: 'success', at: { id: 'end_of_session', name: 'End of session' } });
    expect(improveShown(withImprove({ at: 'long_rest' })).at).toEqual({ id: 'long_rest', name: 'Long rest' });
    expect(improveShown(withImprove({ at: 'gone' })).at).toEqual({ id: 'gone', name: 'gone' });
  });
});

describe('a mark', () => {
  it('by a roll as MARKED BY says: a success, any roll, or never', () => {
    expect(markedByRoll(USED, {}, 'lore', true)).toEqual(marked('lore'));
    expect(markedByRoll(USED, {}, 'lore', false)).toBeNull();
    expect(markedByRoll(USED, { name: 'Kes' }, 'lore', true)).toEqual({ name: 'Kes', ...marked('lore') });
    expect(markedByRoll(withImprove({ marked: 'any' }), {}, 'lore', false)).toEqual(marked('lore'));
    expect(markedByRoll(withImprove({ marked: 'hand' }), {}, 'lore', true)).toBeNull();
    // Not one that improves, marked already, or a game that doesn't improve by use.
    expect(markedByRoll(USED, {}, 'str', true)).toBeNull();
    expect(markedByRoll(USED, {}, 'climb', true)).toBeNull();
    expect(markedByRoll(USED, marked('lore'), 'lore', true)).toBeNull();
    expect(markedByRoll({ ...USED, core: { advancement: [] } }, {}, 'lore', true)).toBeNull();
    expect(markedByRoll(USED, null, 'spot', true)).toEqual(marked('spot'));
  });

  it('ticked or cleared by hand; the marks kept only while there are any, on stats that improve', () => {
    expect(improveAction(USED, {}, { kind: 'mark', stat: 'lore', on: true })).toEqual({ ok: true, data: marked('lore') });
    expect(improveAction(USED, marked('lore', 'spot'), { kind: 'mark', stat: 'lore', on: false }).data).toEqual(marked('spot'));
    expect(improveAction(USED, marked('lore'), { kind: 'mark', stat: 'lore', on: false }).data).toEqual({});
    expect(improveAction(USED, {}, { kind: 'mark', stat: 'str', on: true })).toEqual({ ok: false, error: 'That stat doesn\'t improve by use' });
    expect(improveAction(USED, {}, { kind: 'roll' })).toEqual({ ok: false, error: 'Nothing to do' });
    expect(improveAction(USED, {}, null)).toEqual({ ok: false, error: 'Nothing to do' });
    expect(improveAction({ ...USED, core: {} }, {}, { kind: 'mark', stat: 'lore', on: true }).error).toBe('Stats don\'t improve by use in this game');
    expect(marksOf(USED, { [MARKS_KEY]: { lore: true, str: true, spot: false } })).toEqual(['lore']);
    // Only a mark that is one counts: no other value ticks it, kept or asked for.
    expect(marksOf(USED, { [MARKS_KEY]: { lore: 'yes' } })).toEqual([]);
    expect(improveAction(USED, {}, { kind: 'mark', stat: 'lore', on: 'yes' }).data).toEqual({});
    expect(marksOf(USED, null)).toEqual([]);
  });
});

describe('at the rest', () => {
  const rest = (data, restId, rng) => restOn({ definition: USED, restId, sheet: data, rng });

  it('each marked stat rolled: over its target it gains; the marks clear; the log says so', () => {
    // Lore 45: d100 67 over 45, +1d10 7 = 52. Spot 30: d100 20, not over: no gain.
    const done = rest({ name: 'Kes', lore: 45, spot: 30, ...marked('lore', 'spot') }, 'end_of_session', dice([100, 67], [10, 7], [100, 20]));
    expect(done.sheetPatch).toEqual({ lore: 52, [MARKS_KEY]: {} });
    expect(done.changes).toEqual([{ what: 'improve:lore', label: 'Lore', from: 45, to: 52 }]);
    expect(done.rolls.map((r) => [r.amount, r.value])).toEqual([['d100', 67], ['1d10', 7], ['d100', 20]]);
    expect(restLine(USED, 'END OF SESSION', 'Kes', done)).toContain('Lore 45 → 52');
  });

  it('up to its most and its own highest; never down; only at its rest or one counting as it', () => {
    expect(rest({ lore: 95, ...marked('lore') }, 'end_of_session', dice([100, 100], [10, 10])).sheetPatch.lore).toBe(99);
    expect(rest({ spot: 45, ...marked('spot') }, 'end_of_session', dice([100, 90], [10, 9])).sheetPatch.spot).toBe(50);
    // Already past both: no change.
    expect(rest({ spot: 60, ...marked('spot') }, 'end_of_session', dice([100, 90], [10, 9])).changes).toEqual([]);
    // A long rest counts as the end of a session here; a short one doesn't.
    expect(rest({ lore: 10, ...marked('lore') }, 'long_rest', dice([100, 50], [10, 3])).sheetPatch.lore).toBe(13);
    expect(rest({ lore: 10, ...marked('lore') }, 'short_rest', dice([100, 50], [10, 3])).sheetPatch).toEqual({});
    // Equal isn't over.
    expect(rest({ lore: 50, ...marked('lore') }, 'end_of_session', dice([100, 50])).sheetPatch).toEqual({ [MARKS_KEY]: {} });
  });

  it('nothing marked, nothing rolled; a preview rolls nothing and keeps the marks', () => {
    expect(improveAt(USED, { lore: 40 }, new Set(['end_of_session']), dice())).toBeNull();
    expect(improveAt({ ...USED, core: {} }, { lore: 40, ...marked('lore') }, new Set(['end_of_session']), dice())).toBeNull();
    const preview = rest({ lore: 40, ...marked('lore') }, 'end_of_session', null);
    expect(preview.sheetPatch).toEqual({});
    expect(preview.changes).toEqual([{ what: 'improve:lore', label: 'Lore', from: 40, to: null, pending: ['d100 over @this'] }]);
  });

  it('a target and gain reading the sheet; one that can\'t be worked out skipped', () => {
    const def = withImprove({ stats: 'skills', roll: '1d20', over: '@str', gain: '2' });
    expect(restOn({ definition: def, restId: 'end_of_session', sheet: { lore: 5, str: 12, ...marked('lore') }, rng: dice([20, 13]) }).sheetPatch.lore).toBe(7);
    expect(restOn({ definition: def, restId: 'end_of_session', sheet: { lore: 5, str: 12, ...marked('lore') }, rng: dice([20, 12]) }).sheetPatch.lore).toBeUndefined();
    const broken = withImprove({ stats: 'skills', over: '@this +' });
    expect(improveAt(broken, { lore: 5, ...marked('lore') }, new Set(['end_of_session']), dice([100, 90]))).toEqual({ patch: { [MARKS_KEY]: {} }, changes: [], rolls: [] });
    // A gain that can't be worked out, or comes to nothing: the roll said, the stat as it was.
    const end = new Set(['end_of_session']);
    const noGain = improveAt(withImprove({ stats: 'skills', gain: '1d10 +' }), { lore: 5, ...marked('lore') }, end, dice([100, 90]));
    expect(noGain).toEqual({ patch: { [MARKS_KEY]: {} }, changes: [], rolls: [{ amount: 'd100', value: 90, dice: [{ count: 1, sides: 100, rolls: [90] }] }] });
    const zero = improveAt(withImprove({ stats: 'skills', gain: '0' }), { lore: 5, ...marked('lore') }, end, dice([100, 90]));
    expect(zero.patch).toEqual({ [MARKS_KEY]: {} });
    expect(zero.changes).toEqual([]);
  });
});

describe('the system file, and a new version', () => {
  it('carries IMPROVE BY USE beside the definition, and back unchanged; a change to it said', () => {
    const file = buildFile({ definition: USED, version: 1, origin: 'sys_usedusedusedused' });
    expect(file.improve).toEqual(USED.improve);
    expect(file.definition).not.toHaveProperty('improve');
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.improve).toEqual(USED.improve);
    expect(versionChanges(USED, withImprove({ stats: 'skills' }))).toEqual([{ kind: 'other', change: 'changed', id: 'improve' }]);
  });
});

describe('at the table', () => {
  const setUp = async (def = USED) => {
    const db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const ID = 'sys_usedusedusedused';
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Used', JSON.stringify(def), JSON.stringify(def)]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', lore: 40, spot: 30 })]);
    let connection;
    const emitted = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const handlers = {};
      const said = [];
      connection({ id: `use-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, p) => said.push([e, p]), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      return { handlers, said };
    };
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    const rolled = () => emitted.filter((e) => e.event === 'diceRollBroadcast').length;
    return { db, join, stored, rolled, emitted };
  };

  it('a successful roll of a stat marks it; a failed one doesn\'t', async () => {
    const { join, stored, rolled } = await setUp();
    const kes = await join('kes', 'kes');
    kes.handlers.requestSheetRoll({ fieldId: 'spot' });
    await until(() => rolled() === 1, { label: 'the hard check' });
    kes.handlers.requestSheetRoll({ fieldId: 'lore' });
    await until(async () => (await stored())[MARKS_KEY]?.lore === true, { label: 'Lore marked' });
    expect((await stored())[MARKS_KEY]).toEqual({ lore: true });
  });

  it('ticked and cleared by hand, the player\'s own or the GM\'s for them; refused where it can\'t be', async () => {
    const { join, stored } = await setUp();
    const kes = await join('kes', 'kes');
    kes.handlers.improveAction({ kind: 'mark', stat: 'spot', on: true });
    await until(async () => (await stored())[MARKS_KEY]?.spot === true, { label: 'Spot ticked' });
    kes.handlers.improveAction({ kind: 'mark', stat: 'str', on: true });
    await until(() => kes.said.some(([e, p]) => e === 'choicesRefused' && p.error === 'That stat doesn\'t improve by use'), { label: 'refused' });
    const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.improveAction({ kind: 'mark', stat: 'spot', on: false, username: 'kes' });
    await until(async () => (await stored())[MARKS_KEY] === undefined, { label: 'Spot cleared by the GM' });
  });

  it('by hand only: a roll marks nothing', async () => {
    const { join, stored, rolled } = await setUp(withImprove({ stats: 'skills', marked: 'hand' }));
    const kes = await join('kes', 'kes');
    kes.handlers.requestSheetRoll({ fieldId: 'lore' });
    await until(() => rolled() === 1, { label: 'the check' });
    kes.handlers.updateSheetField({ fieldId: 'name', value: 'Kesh' });
    await until(async () => (await stored()).name === 'Kesh', { label: 'a write after the roll' });
    expect((await stored())[MARKS_KEY]).toBeUndefined();
  });

  it('the sheet is told how it improves, where stats improve by use', async () => {
    const { db } = await setUp();
    const plain = JSON.stringify({ ...USED, name: 'Plain', core: { advancement: ['levels'] } });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_plainplainplain2', 'Plain', plain, plain]);
    await new Promise((resolve) => runtime.load(db, resolve));
    expect(runtime.render('sys_usedusedusedused').improve).toEqual(improveShown(USED));
    expect(runtime.render('sys_plainplainplain2').improve).toBeNull();
  });
});
