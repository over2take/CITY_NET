/**
 * A custom system's rolls at the table (6a2b; approved mockup docs/mockups/builder-rolls.html,
 * 2026-10-19): a die button rolls what ROLLED BY gives the field, with @this, @this_mod, @tie and
 * @tie_mod read from the stored sheet, through the socket into the same log and dice tray as every
 * roll. A change that costs something is refused until the table can take the cost (6b3).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const require_ = createRequire(import.meta.url);
const { rollsFor, modifierOf, fieldsFor, rollField, describe: describeRoll } = require_('../systemBuilder/tableRolls');
const { PRESETS, FATE } = require_('../systemBuilder/rollStyles');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const HEARTH = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }, { id: 'wit', label: 'Wits' }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight', tie: 'str' }, { id: 'lore', label: 'Lore', tie: 'wit' }] },
  ],
  lookups: { mod: { bands: [{ upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'mod(@str)' },
    { id: 'wit_mod', label: 'Wit mod', formula: 'mod(@wit)' },
    { id: 'save', label: 'Physical save', formula: '16 - @str_mod' },
  ],
  rolls: [
    { id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }], add: '@this + @tie_mod', bands: [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Cost' }, { label: 'Full' }],
      changes: [{ id: 'forward', label: 'Forward', add: '1' }, { id: 'push', label: 'Push', extra: { dice: 1, keep: 'highest' }, cost: { from: 'stress', amount: 2 } }], by: ['skills'] },
    { id: 'check', label: 'Ability check', ...PRESETS.dnd.roll, by: ['abilities'] },
    { id: 'saving', label: 'Save', dice: [{ count: '1', sides: 20 }], against: '@this', by: ['save'] },
    { id: 'brawl', label: 'Brawl', dice: [{ count: '1', sides: 6 }], add: '@this', by: ['fight'] },
  ],
};
const SHEET = { name: 'Kestrel', str: 16, wit: 9, fight: 2, lore: 3, str_mod: 1, wit_mod: 0, save: 15, stress: 4 };
const d = (sides, ...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 1 + 0.5) / sides; };

describe('which rolls a field rolls', () => {
  it('those ROLLED BY it, or by its stats group, in the order the system lists them', () => {
    expect(rollsFor(HEARTH, 'fight').map((r) => r.id)).toEqual(['skill', 'brawl']);
    expect(rollsFor(HEARTH, 'lore').map((r) => r.id)).toEqual(['skill']);
    expect(rollsFor(HEARTH, 'str').map((r) => r.id)).toEqual(['check']);
    expect(rollsFor(HEARTH, 'save').map((r) => r.id)).toEqual(['saving']);
    expect(rollsFor(HEARTH, 'name')).toEqual([]);
    expect(rollsFor({ ...HEARTH, rolls: undefined }, 'fight')).toEqual([]);
  });
});

describe('what a roll reads', () => {
  it('a stat\'s modifier is the formula reading only it through one of the system\'s tables', () => {
    expect(modifierOf(HEARTH, 'str')).toBe('str_mod');
    expect(modifierOf(HEARTH, 'fight')).toBeNull();
    expect(modifierOf({ ...HEARTH, lookups: {} }, 'str')).toBeNull();
    expect(modifierOf({ ...HEARTH, derived: [{ id: 'x', formula: 'mod(@str) + 1' }] }, 'str')).toBeNull();
  });

  it('@this, @this_mod, @tie and @tie_mod for the field rolled; any other name, the sheet; nothing, 0', () => {
    const fight = fieldsFor(HEARTH, SHEET, 'fight');
    expect(['this', 'this_mod', 'tie', 'tie_mod', 'stress', 'nowhere'].map(fight)).toEqual([2, 0, 16, 1, 4, 0]);
    const str = fieldsFor(HEARTH, SHEET, 'str');
    expect(['this', 'this_mod', 'tie', 'tie_mod'].map(str)).toEqual([16, 1, 0, 0]);
    expect(fieldsFor(HEARTH, { ...SHEET, fight: 'lots' }, 'fight')('this')).toBe(0);
    // Nothing a sheet's object inherits reads as a value.
    expect(fieldsFor(HEARTH, SHEET, 'fight')('constructor')).toBe(0);
  });
});

describe('a field rolled', () => {
  const roll = (extra) => rollField({ definition: HEARTH, data: SHEET, rng: d(6, 4, 5), who: 'Kestrel', forName: null, ...extra });

  it('rolls its first roll, saying it in the log\'s words', () => {
    const r = roll({ fieldId: 'fight' });
    expect(r.ok).toBe(true);
    expect(r.roll).toBe('skill');
    expect(r.total).toBe(12);
    expect(r.historyText).toBe('Kestrel rolled Skill check (Fight) [4 5 = 9 + 3 = 12] — FULL');
    expect([r.results, r.diceSides]).toEqual([{ 6: [4, 5] }, {}]);
  });

  it('rolls another of its rolls when asked, and none it doesn\'t have', () => {
    expect(roll({ fieldId: 'fight', rollId: 'brawl' }).historyText).toBe('Kestrel rolled Brawl (Fight) [4 = 4 + 2 = 6]');
    expect(roll({ fieldId: 'fight', rollId: 'check' })).toEqual({ ok: false, error: 'That field has no such roll' });
    expect(roll({ fieldId: 'name' }).ok).toBe(false);
  });

  it('takes changes picked that cost nothing, and refuses one that costs something for now', () => {
    expect(roll({ fieldId: 'lore', chosen: ['forward'] }).historyText).toBe('Kestrel rolled Skill check (Lore) (Forward) [4 5 = 9 + 4 = 13] — FULL');
    expect(roll({ fieldId: 'lore', chosen: ['push'] })).toEqual({ ok: false, error: "Push costs something, which the table can't take yet" });
    expect(roll({ fieldId: 'lore', chosen: ['nonsense', 7] }).ok).toBe(true);
  });

  it('names a target met or missed, a natural, an NPC rolled for, and kept and dropped dice', () => {
    const save = rollField({ definition: HEARTH, data: SHEET, fieldId: 'save', rng: d(20, 17), who: 'Kestrel', forName: 'Rex' });
    expect(save.historyText).toBe('Kestrel rolled Save (Physical save) for Rex [17 = 17] — vs 15: SUCCESS');
    const adv = rollField({ definition: HEARTH, data: SHEET, fieldId: 'str', chosen: ['advantage'], rng: d(20, 20, 3), who: 'Kestrel' });
    expect(adv.historyText).toBe('Kestrel rolled Ability check (Strength) (Advantage) [20 (3) = 20 + 1 = 21] — NATURAL 20');
  });

  it('sends named dice and Fate dice to the tray under their own names, with their sizes', () => {
    const vamp = { ...HEARTH, rolls: [{ id: 'v', label: 'Pool', ...PRESETS.vampire.roll, by: ['str'] }] };
    const r = rollField({ definition: vamp, data: { ...SHEET, str: 3, hunger: 1 }, fieldId: 'str', rng: d(10, 7, 2, 10), who: 'K' });
    expect([r.results, r.diceSides]).toEqual([{ 10: [7, 2], Hunger: [10] }, { Hunger: 10 }]);
    // 7 and the Hunger 10 are successes; nothing is added, so the dice's count is the total.
    expect(r.historyText).toBe('K rolled Pool (Strength) [7 (2) 10 Hunger = 2]');
    const fate = { ...HEARTH, rolls: [{ id: 'f', label: 'Fate', dice: [{ count: '4', sides: FATE }], by: ['str'] }] };
    const f = rollField({ definition: fate, data: SHEET, fieldId: 'str', rng: () => 0.9, who: 'K' });
    expect([f.results, f.diceSides]).toEqual([{ dF: [1, 1, 1, 1] }, { dF: 6 }]);
    expect(f.historyText).toBe('K rolled Fate (Strength) [+ + + + = 4]');
  });

  it('glitches tell the tray, as SR6\'s do', () => {
    const sr6 = { ...HEARTH, rolls: [{ id: 's', label: 'Pool', ...PRESETS.sr6.roll, by: ['fight'] }] };
    const r = rollField({ definition: sr6, data: { ...SHEET, fight: 1, str: 1 }, fieldId: 'fight', rng: d(6, 1, 1), who: 'K' });
    expect([r.glitch, r.criticalGlitch, r.total]).toEqual([true, true, 0]);
  });
});

describe('the log line on its own', () => {
  it('says what came of a roll in the table\'s order', () => {
    const said = describeRoll({ groups: [{ sides: 6, faces: [{ value: 6, kept: true }, { value: 3, kept: false }] }], dice: 6, add: -1, total: 5,
      target: 6, success: false, band: 'Partial', natural: { label: 'Six' }, matches: [{ label: 'Pair', sets: 1 }], glitch: 'Glitch', effects: ['Messy'], changes: ['Push'] });
    expect(said).toEqual({ working: '6 (3) = 6 - 1 = 5', tags: ' — vs 6: FAILURE · PARTIAL · SIX · PAIR · GLITCH · MESSY', changes: ' (Push)' });
  });
});

describe('rolling at the table, through the socket', () => {
  let db;
  const connect = async (who) => {
    const emitted = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: `s-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(who);
    await drain(db);
    return { handlers, emitted };
  };
  const rolled = (c) => c.emitted.filter((e) => e.event === 'diceRollBroadcast');

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(HEARTH);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_hearthhearthhear', 'Hearth', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'sys_hearthhearthhear')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', 'sys_hearthhearthhear', ?, 0)`, [JSON.stringify(SHEET)]);
  });

  it('rolls a custom system\'s skill from the stored sheet, into the log and the tray', async () => {
    const kes = await connect('kes');
    kes.handlers.requestSheetRoll({ fieldId: 'fight' });
    const roll = await untilValue(() => rolled(kes)[0], Boolean, { label: 'a roll' });
    // The roller is named as their own sheet names them, as for every roll.
    expect(roll.data.historyString).toMatch(/^Kestrel rolled Skill check \(Fight\) \[\d \d = \d+ \+ 3 = \d+\] — (MISS|COST|FULL)$/);
    expect(roll.data.total).toBe(roll.data.results['6'].reduce((a, b) => a + b, 0) + 3);
    expect((await get(db, 'SELECT total, historyString FROM dice_rolls')).historyString).toBe(roll.data.historyString);
  });

  it('rolls another of the field\'s rolls, with changes, and ignores what it can\'t roll', async () => {
    const kes = await connect('kes');
    kes.handlers.requestSheetRoll({ fieldId: 'fight', rollId: 'brawl' });
    kes.handlers.requestSheetRoll({ fieldId: 'lore', changes: ['push'] });
    kes.handlers.requestSheetRoll({ fieldId: 'name' });
    kes.handlers.requestSheetRoll({ fieldId: 'lore', changes: ['forward'] });
    await untilValue(() => rolled(kes).length, (n) => n >= 2, { label: 'two rolls' });
    await drain(db);
    expect(rolled(kes).map((r) => r.data.historyString.replace(/\[.*$/, ''))).toEqual(['Kestrel rolled Brawl (Fight) ', 'Kestrel rolled Skill check (Lore) (Forward) ']);
    // The sheet's stress is untouched: nothing costing was rolled.
    expect(JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'kes'")).data).stress).toBe(4);
  });
});

describe('TEST ROLL, the builder route (6b1a)', () => {
  const express_ = require_('express');
  const request_ = require_('supertest');
  const jwt_ = require_('jsonwebtoken');
  const { elevatedUsers } = require_('../middleware/auth');
  const systemsRoute = require_('../routes/systems.js');
  const GM = jwt_.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const EDITOR = jwt_.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
  const PLAYER = jwt_.sign({ username: 'vex', role: 'player' }, 'test-secret');
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    const db = await makeTestDb();
    app = express_();
    app.use(express_.json());
    app.use('/api/systems', systemsRoute(db));
  });
  const post = (body, token = GM) => request_(app).post('/api/systems/test-roll').set({ Authorization: `Bearer ${token}` }).send(body);
  const DRAFT = { ...HEARTH, samples: { str: 16, wit: 9, fight: 2, lore: 3, stress: 4 } };

  it('rolls a draft\'s roll for its sample, its formulas worked out on it, on the first field it is rolled by', async () => {
    const res = await post({ definition: DRAFT, rollId: 'skill' });
    expect(res.status).toBe(200);
    expect(res.body.field).toBe('fight');
    expect(res.body.fields).toEqual(['fight', 'lore']);
    // Fight 2 and Strength 16's modifier +1, worked out from the sample, not stored anywhere.
    expect(res.body.result.add).toBe(3);
    expect(res.body.total).toBe(res.body.result.dice + 3);
    expect(res.body.historyText).toMatch(/^The sample rolled Skill check \(Fight\) \[/);
  });

  it('rolls for the field asked, with changes, even ones that cost something', async () => {
    const res = await post({ definition: DRAFT, rollId: 'skill', fieldId: 'lore', changes: ['push', 'forward'] });
    expect(res.status).toBe(200);
    expect(res.body.field).toBe('lore');
    expect(res.body.result.add).toBe(4);
    expect(res.body.result.groups[0].faces).toHaveLength(3);
    expect(res.body.result.costs).toEqual([{ from: 'stress', amount: 2 }]);
    // A field the roll isn't rolled by falls back to its first.
    expect((await post({ definition: DRAFT, rollId: 'skill', fieldId: 'str' })).body.field).toBe('fight');
  });

  it('tests a roll rolled by nothing yet, reading 0 for @this', async () => {
    const res = await post({ definition: { ...DRAFT, rolls: [{ id: 'loose', label: 'Loose', dice: [{ count: '1', sides: 6 }], add: '@this + 1' }] }, rollId: 'loose' });
    expect(res.status).toBe(200);
    expect([res.body.field, res.body.fields, res.body.result.add]).toEqual([null, [], 1]);
    expect(res.body.historyText).toMatch(/^The sample rolled Loose \[/);
  });

  it('refuses a roll with problems, one it hasn\'t, and what isn\'t a system', async () => {
    const broken = await post({ definition: { ...DRAFT, rolls: [{ ...HEARTH.rolls[0], read: 'average' }] }, rollId: 'skill' });
    expect([broken.status, broken.body]).toEqual([400, { error: 'roll skill, read: Sum, highest, lowest or count' }]);
    expect((await post({ definition: DRAFT, rollId: 'nope' })).body).toEqual({ error: 'No such roll' });
    expect((await post({ definition: 'nope', rollId: 'skill' })).status).toBe(400);
  });

  it('is the main admin\'s, as every builder route is: never an editor\'s or a player\'s', async () => {
    expect((await post({ definition: DRAFT, rollId: 'skill' }, EDITOR)).status).toBe(403);
    expect((await post({ definition: DRAFT, rollId: 'skill' }, PLAYER)).status).toBe(403);
  });
});
