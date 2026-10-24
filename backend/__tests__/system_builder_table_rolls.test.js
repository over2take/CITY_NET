/**
 * A custom system's rolls at the table (6a2b; approved mockup docs/mockups/builder-rolls.html,
 * 2026-10-19): a die button rolls what ROLLED BY gives the field, with @this, @this_mod, @tie and
 * @tie_mod read from the stored sheet, through the socket into the same log and dice tray as every
 * roll. A change that costs something is paid from the sheet (6b3a); a condition on the character's
 * token with a modifier on all rolls is added to every roll (6b3b).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const require_ = createRequire(import.meta.url);
const { rollsFor, modifierOf, fieldsFor, termsOf, rollField, describe: describeRoll } = require_('../systemBuilder/tableRolls');
const { conditionsOf } = require_('../systemBuilder/conditions');
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
  // HURT -1 on all rolls; Poisoned's modifier is on Strength alone, not every roll.
  conditions: {
    hurt: { name: 'Hurt', short: 'HURT', modifiers: [{ target: 'all_rolls', amount: -1 }] },
    poisoned: { modifiers: [{ target: 'str', amount: -2 }] },
  },
};
const SHEET = { name: 'Kestrel', str: 16, wit: 9, fight: 2, lore: 3, str_mod: 1, wit_mod: 0, save: 15, stress: 4 };

/** HEARTH with dice of its own (6c1b): GOOD and BAD with symbols that cancel, and Fate dice. */
const DICED = {
  ...HEARTH,
  symbols: [{ id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' }, { id: 'miss', name: 'Miss', mark: '✕', cancels: 'hit' }, { id: 'edge', name: 'Edge', icon: 'star' }],
  dice: [
    { id: 'good', name: 'Good', faces: [{}, { s: ['hit'] }, { s: ['hit', 'edge'] }] },
    { id: 'bad', name: 'Bad', color: 'danger', faces: [{}, { s: ['miss'] }] },
    { id: 'fate', name: 'dF', faces: [{ n: 1 }, { n: 0 }, { n: -1 }] },
  ],
  rolls: [
    { id: 'clash', label: 'Clash', dice: [{ count: '@this', die: 'good' }, { count: '1', die: 'bad' }], read: 'symbols', on: 'hit', against: '1', by: ['fight'] },
    { id: 'fated', label: 'Fated', dice: [{ count: '3', die: 'fate' }], add: '@this', by: ['lore'] },
  ],
};
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

  it('takes changes picked, and ones it hasn\'t ignored', () => {
    expect(roll({ fieldId: 'lore', chosen: ['forward'] }).historyText).toBe('Kestrel rolled Skill check (Lore) (Forward) [4 5 = 9 + 4 = 13] — FULL');
    expect(roll({ fieldId: 'lore', chosen: ['nonsense', 7] }).ok).toBe(true);
  });

  it('pays what a change costs from the sheet as stored (6b3a): taken, said in the log, refused when short', () => {
    const paid = roll({ fieldId: 'lore', chosen: ['push'] });
    expect(paid.spends).toEqual([{ from: 'stress', by: -2 }]);
    expect(paid.historyText).toMatch(/^Kestrel rolled Skill check \(Lore\) \(Push: −2 STRESS\) \[/);
    expect(roll({ fieldId: 'lore', chosen: ['push'], data: { ...SHEET, stress: 1 } })).toEqual({ ok: false, error: 'Push costs 2 STRESS, and there is only 1' });
    expect(roll({ fieldId: 'lore', chosen: ['push'], data: { ...SHEET, stress: 0 } }).error).toBe('Push costs 2 STRESS, and there are only 0');
    expect(roll({ fieldId: 'lore', chosen: ['forward'] }).spends).toEqual([]);
  });

  it('adds what a change costs to a stat, refused past its highest, the stat named as players see it', () => {
    // Named Strain here, so the log and refusals show the name players see, not the id.
    const blades = { ...HEARTH, stats: [...HEARTH.stats, { id: 'track', label: 'Track', stats: [{ id: 'stress', label: 'Strain', min: 0, max: 9 }] }],
      rolls: [{ id: 'act', label: 'Action', ...PRESETS.blades.roll, by: ['fight'] }] };
    const push = (stress) => rollField({ definition: blades, data: { ...SHEET, stress }, fieldId: 'fight', chosen: ['push'], rng: d(6, 4, 5, 6), who: 'K' });
    expect(push(4).spends).toEqual([{ from: 'stress', by: 2 }]);
    expect(push(4).historyText).toMatch(/\(Push yourself: \+2 STRAIN\)/);
    expect(push(7).ok).toBe(true);
    expect(push(8)).toEqual({ ok: false, error: 'Push yourself adds 2 STRAIN, past its highest (8 of 9)' });
    // A test roll pays nothing and is refused nothing.
    const tried = rollField({ definition: blades, data: { ...SHEET, stress: 9 }, fieldId: 'fight', chosen: ['push'], rng: d(6, 4), who: 'K', tryCosts: true });
    expect(tried.ok).toBe(true);
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

  it('adds a condition\'s modifier on all rolls as its own named term, judged with it (6b3b)', () => {
    const on = (...ids) => conditionsOf(HEARTH).filter((c) => ids.includes(c.id));
    const hurt = roll({ fieldId: 'fight', conditions: on('hurt', 'poisoned') });
    expect(hurt.historyText).toBe('Kestrel rolled Skill check (Fight) [4 5 = 9 + 3 - 1 (HURT) = 11] — FULL');
    expect(hurt.total).toBe(11);
    // Lands it a band lower: 4 + 2, + Lore 3 and Wits' 0, - 1 is 8, a Cost.
    const low = rollField({ definition: HEARTH, data: SHEET, fieldId: 'lore', rng: d(6, 4, 2), who: 'K', conditions: on('hurt') });
    expect(low.historyText).toBe('K rolled Skill check (Lore) [4 2 = 6 + 3 - 1 (HURT) = 8] — COST');
    // With nothing else added, the dice's own value is still said.
    expect(rollField({ definition: HEARTH, data: SHEET, fieldId: 'save', rng: d(20, 15), who: 'K', conditions: on('hurt') }).historyText)
      .toBe('K rolled Save (Physical save) [15 = 15 - 1 (HURT) = 14] — vs 15: FAILURE');
    expect(roll({ fieldId: 'fight', conditions: on('poisoned') }).historyText).toBe('Kestrel rolled Skill check (Fight) [4 5 = 9 + 3 = 12] — FULL');
  });

  it('reads only modifiers on all rolls, each named by the condition\'s short name, or its name', () => {
    expect(termsOf([
      { id: 'a', short: 'HURT', modifiers: [{ target: 'all_rolls', amount: -1 }, { target: 'str', amount: -2 }, { target: 'all_rolls', amount: 2 }] },
      { id: 'b', name: 'Blessed', modifiers: [{ target: 'all_rolls', amount: 1 }] },
      { id: 'c', modifiers: [{ target: 'all_rolls', amount: 1.5 }, { target: 'all_rolls', amount: 0 }, null] },
      { id: 'd', modifiers: [{ target: 'all_rolls', amount: 3 }] },
      'nonsense', null,
    ])).toEqual([{ label: 'HURT', amount: -1 }, { label: 'HURT', amount: 2 }, { label: 'Blessed', amount: 1 }, { label: 'd', amount: 3 }]);
    expect(termsOf(undefined)).toEqual([]);
  });

  it('tells the tray\'s board what was rolled and what it came to, only its name for a total alone (6c4d1, 6c4d3)', () => {
    // Named for the field rolled, which says more than the roll: PHYSICAL SAVE, not SAVE.
    expect(roll({ fieldId: 'fight' }).board).toEqual({ label: 'FIGHT', outcome: 'FULL' });
    expect(rollField({ definition: HEARTH, data: SHEET, fieldId: 'save', rng: d(20, 17), who: 'K' }).board).toEqual({ label: 'PHYSICAL SAVE', outcome: 'vs 15: SUCCESS' });
    expect(rollField({ definition: HEARTH, data: SHEET, fieldId: 'str', chosen: ['advantage'], rng: d(20, 20, 3), who: 'K' }).board).toEqual({ label: 'STRENGTH', outcome: 'NATURAL 20' });
    expect(roll({ fieldId: 'fight', rollId: 'brawl' }).board).toEqual({ label: 'FIGHT' });
    // A roll with no field, as TEST ROLL and the dice menu make, by the roll's own name.
    expect(rollField({ definition: HEARTH, data: SHEET, roll: { id: 'quick', label: 'Quick d6', dice: [{ count: '1', sides: 6 }] }, rng: d(6, 4), who: 'K' }).board).toEqual({ label: 'QUICK D6' });
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
    expect(said).toEqual({ working: '6 (3) = 6 - 1 = 5', tags: ' — vs 6: FAILURE · PARTIAL · SIX · PAIR · GLITCH · MESSY', changes: ' (Push)',
      board: { outcome: 'vs 6: FAILURE · PARTIAL · SIX · PAIR · GLITCH · MESSY' } });
    const termed = { groups: [{ sides: 6, faces: [{ value: 6, kept: true }] }], dice: 6, add: 0, terms: [{ label: 'HURT', amount: -1 }, { label: 'BLESS', amount: 2 }], total: 7,
      target: null, success: null, band: null, natural: null, matches: [], glitch: null, effects: [], changes: [] };
    expect(describeRoll(termed).working).toBe('6 = 6 - 1 (HURT) + 2 (BLESS) = 7');
    expect(describeRoll(termed).board).toBeNull();
  });
});

describe('rolling at the table, through the socket', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const connect = async (who, { admin = false } = {}) => {
    const emitted = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: `s-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(admin ? { userName: who, isAdmin: true, token: GM } : who);
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

  it('sends a roll of the system\'s own dice with the faces each landed on, for the tray (6c4b1)', async () => {
    const def = JSON.stringify(DICED);
    await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, 'sys_hearthhearthhear']);
    await new Promise((resolve) => runtime.load(db, resolve));
    const kes = await connect('kes');
    kes.handlers.requestSheetRoll({ fieldId: 'fight' });
    const roll = await untilValue(() => rolled(kes)[0], Boolean, { label: 'a roll' });
    const { results, throw: thrown } = roll.data;
    expect(thrown.dice.map((d) => [d.key, d.sides, d.color])).toEqual([['Good', 3, undefined], ['Bad', 2, 'danger']]);
    for (const d of thrown.dice) expect(d.landed.map((i) => d.faces[i].text), d.key).toEqual(results[d.key]);
    expect(thrown.symbols.map((s) => s.id)).toEqual(['hit', 'miss', 'edge']);
  });

  it('rolls a custom system\'s skill from the stored sheet, into the log and the tray', async () => {
    const kes = await connect('kes');
    kes.handlers.requestSheetRoll({ fieldId: 'fight' });
    const roll = await untilValue(() => rolled(kes)[0], Boolean, { label: 'a roll' });
    // The roller is named as their own sheet names them, as for every roll.
    expect(roll.data.historyString).toMatch(/^Kestrel rolled Skill check \(Fight\) \[\d \d = \d+ \+ 3 = \d+\] — (MISS|COST|FULL)$/);
    expect(roll.data.total).toBe(roll.data.results['6'].reduce((a, b) => a + b, 0) + 3);
    expect((await get(db, 'SELECT total, historyString FROM dice_rolls')).historyString).toBe(roll.data.historyString);
    // The tray's board is told what it came to, as the log ends (6c4d1).
    expect(roll.data.board).toEqual({ label: 'FIGHT', outcome: roll.data.historyString.split(' — ')[1] });
  });

  it('rolls another of the field\'s rolls, with changes, and ignores what it can\'t roll', async () => {
    const kes = await connect('kes');
    // One at a time: each roll waits on its own database reads, so two sent together can come
    // back in either order.
    kes.handlers.requestSheetRoll({ fieldId: 'fight', rollId: 'brawl' });
    await untilValue(() => rolled(kes).length, (n) => n >= 1, { label: 'the brawl' });
    kes.handlers.requestSheetRoll({ fieldId: 'name' });
    await drain(db);
    expect(rolled(kes)).toHaveLength(1);
    kes.handlers.requestSheetRoll({ fieldId: 'lore', changes: ['forward'] });
    await untilValue(() => rolled(kes).length, (n) => n >= 2, { label: 'the skill check' });
    await drain(db);
    expect(rolled(kes).map((r) => r.data.historyString.replace(/\[.*$/, ''))).toEqual(['Kestrel rolled Brawl (Fight) ', 'Kestrel rolled Skill check (Lore) (Forward) ']);
    // Nothing costing was rolled: the sheet's Stress is as it was.
    const stress = async () => JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'kes'")).data).stress;
    expect(await stress()).toBe(4);
    // PUSH costs 2 Stress (6b3a): paid from the sheet once the roll is made, and every window told.
    kes.handlers.requestSheetRoll({ fieldId: 'lore', changes: ['push'] });
    await untilValue(() => rolled(kes).length, (n) => n >= 3, { label: 'the push' });
    await drain(db);
    expect(rolled(kes)[2].data.historyString).toMatch(/^Kestrel rolled Skill check \(Lore\) \(Push: −2 STRESS\) \[/);
    expect(await stress()).toBe(2);
    expect(kes.emitted.some((e) => e.event === 'sheetUpdated')).toBe(true);
    // Twice more: the first paid down to 0, the second refused, nothing rolled or taken.
    kes.handlers.requestSheetRoll({ fieldId: 'lore', changes: ['push'] });
    await untilValue(() => rolled(kes).length, (n) => n >= 4, { label: 'the second push' });
    await drain(db);
    kes.handlers.requestSheetRoll({ fieldId: 'lore', changes: ['push'] });
    await drain(db);
    expect(rolled(kes)).toHaveLength(4);
    expect(await stress()).toBe(0);
  });

  it('adds the conditions on the roller\'s token, and on an NPC\'s rolled for (6b3b)', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, conditions) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', '[{"id":"hurt"},{"id":"poisoned"}]')`);
    const kes = await connect('kes');
    kes.handlers.requestSheetRoll({ fieldId: 'fight', rollId: 'brawl' });
    const roll = await untilValue(() => rolled(kes)[0], Boolean, { label: 'a roll' });
    expect(roll.data.historyString).toMatch(/^Kestrel rolled Brawl \(Fight\) \[\d = \d \+ 2 - 1 \(HURT\) = \d+\]$/);
    expect(roll.data.total).toBe(roll.data.results['6'][0] + 1);
    expect(roll.data.modifiers).toEqual([2, -1]);

    // An NPC's token: the GM rolls for it, with its own conditions.
    const npc = (await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('npc', 'sys_hearthhearthhear', ?, 1)`, [JSON.stringify({ ...SHEET, name: 'Rex' })])).lastID;
    const loc = (await run(db, `INSERT INTO locations (name, x, y, z, shape, conditions) VALUES ('Rex', 0, 0, 0, 'enemy_rhombus', '[{"id":"hurt"}]')`)).lastID;
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [loc, npc]);
    const gm = await connect('gm', { admin: true });
    gm.handlers.requestSheetRoll({ fieldId: 'fight', rollId: 'brawl', location_id: loc });
    await drain(db);
    const forRex = rolled(gm).find((r) => / for Rex /.test(r.data.historyString));
    expect(forRex?.data.historyString).toMatch(/\+ 2 - 1 \(HURT\) = /);
  });

  it('adds none for a roller with no token, or a condition the game no longer has', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, conditions) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', '[{"id":"gone"}]')`);
    const kes = await connect('kes');
    kes.handlers.requestSheetRoll({ fieldId: 'fight', rollId: 'brawl' });
    const roll = await untilValue(() => rolled(kes)[0], Boolean, { label: 'a roll' });
    expect(roll.data.historyString).toMatch(/^Kestrel rolled Brawl \(Fight\) \[\d = \d \+ 2 = \d+\]$/);
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

  it('tries it under the draft\'s conditions asked for, by id (6b3b)', async () => {
    const res = await post({ definition: DRAFT, rollId: 'brawl', conditions: ['hurt', 'poisoned', 'nope'] });
    expect(res.body.result.terms).toEqual([{ label: 'HURT', amount: -1 }]);
    expect(res.body.total).toBe(res.body.result.dice + 2 - 1);
    expect(res.body.historyText).toMatch(/ - 1 \(HURT\) = /);
    expect((await post({ definition: DRAFT, rollId: 'brawl', conditions: 'hurt' })).body.result.terms).toBeUndefined();
    expect((await post({ definition: DRAFT, rollId: 'brawl', conditions: [] })).body.result.terms).toBeUndefined();
  });

  it('tests a roll rolled by nothing yet, reading 0 for @this', async () => {
    const res = await post({ definition: { ...DRAFT, rolls: [{ id: 'loose', label: 'Loose', dice: [{ count: '1', sides: 6 }], add: '@this + 1' }] }, rollId: 'loose' });
    expect(res.status).toBe(200);
    expect([res.body.field, res.body.fields, res.body.result.add]).toEqual([null, [], 1]);
    expect(res.body.historyText).toMatch(/^The sample rolled Loose \[/);
  });

  it('refuses a roll with problems, one it hasn\'t, and what isn\'t a system', async () => {
    const broken = await post({ definition: { ...DRAFT, rolls: [{ ...HEARTH.rolls[0], read: 'average' }] }, rollId: 'skill' });
    expect([broken.status, broken.body]).toEqual([400, { error: 'roll skill, read: Sum, highest, lowest, count, or the symbols' }]);
    expect((await post({ definition: DRAFT, rollId: 'nope' })).body).toEqual({ error: 'No such roll' });
    expect((await post({ definition: 'nope', rollId: 'skill' })).status).toBe(400);
  });

  it('is the main admin\'s, as every builder route is: never an editor\'s or a player\'s', async () => {
    expect((await post({ definition: DRAFT, rollId: 'skill' }, EDITOR)).status).toBe(403);
    expect((await post({ definition: DRAFT, rollId: 'skill' }, PLAYER)).status).toBe(403);
  });
});

describe('the rolls players\' browsers get (6b2a)', () => {
  const { renderOf } = runtime;

  it('each roll\'s name, the fields with a die button for it, and its changes with their costs; never how it rolls', () => {
    const rolls = renderOf('sys_hearthhearthhear', HEARTH).rolls;
    expect(rolls).toEqual([
      { id: 'skill', label: 'Skill check', fields: ['fight', 'lore'], changes: [{ id: 'forward', label: 'Forward' }, { id: 'push', label: 'Push', cost: { from: 'stress', amount: 2, label: 'stress' } }] },
      { id: 'check', label: 'Ability check', fields: ['str', 'wit'], changes: [{ id: 'advantage', label: 'Advantage' }, { id: 'disadvantage', label: 'Disadvantage' }] },
      { id: 'saving', label: 'Save', fields: ['save'], changes: [] },
      { id: 'brawl', label: 'Brawl', fields: ['fight'], changes: [] },
    ]);
    const sent = JSON.stringify(rolls);
    for (const secret of ['dice', 'add', 'against', 'bands', 'natural', 'extra', '@this']) expect(sent, secret).not.toContain(secret);
  });

  it('a roll with no name is offered by its id; a system without rolls offers none', () => {
    expect(renderOf('sys_x', { ...HEARTH, rolls: [{ id: 'quick', dice: [{ count: '1', sides: 6 }], by: ['str'] }] }).rolls)
      .toEqual([{ id: 'quick', label: 'quick', fields: ['str'], changes: [] }]);
    expect(renderOf('sys_x', { format: 1, name: 'Bare' }).rolls).toEqual([]);
  });
});

describe('what a cost shows on the sheet (6b3a)', () => {
  it('the stat\'s name, how much, which way, and its highest when added to', () => {
    const def = { ...HEARTH, stats: [...HEARTH.stats, { id: 'track', label: 'Track', stats: [{ id: 'stress', label: 'Stress', min: 0, max: 9 }, { id: 'luck', label: 'Luck' }] }],
      rolls: [{ id: 'act', label: 'Action', dice: [{ count: '1', sides: 6 }], by: ['fight'], changes: [
        { id: 'push', label: 'Push', extra: { dice: 1 }, cost: { from: 'stress', amount: 2, adds: true } },
        { id: 'lucky', label: 'Lucky', add: '1', cost: { from: 'luck', amount: 1 } },
      ] }] };
    expect(runtime.renderOf('sys_x', def).rolls[0].changes).toEqual([
      { id: 'push', label: 'Push', cost: { from: 'stress', amount: 2, label: 'Stress', adds: true, max: 9 } },
      { id: 'lucky', label: 'Lucky', cost: { from: 'luck', amount: 1, label: 'Luck' } },
    ]);
  });
});

describe('a system\'s own dice at the table (6c1b)', () => {
  // A face by its place among a die's faces (1 for the first) out of how many.
  const faces = (...plan) => { let i = 0; return () => { const [f, of] = plan[i++ % plan.length]; return (f - 1 + 0.5) / of; }; };

  it('logs each face as its marks (or a letter for an icon), the symbols left, and what that comes to', () => {
    // FIGHT 2: two GOOD dice (HIT EDGE, HIT) and a BAD (MISS).
    const r = rollField({ definition: DICED, data: SHEET, fieldId: 'fight', rng: faces([3, 3], [2, 3], [2, 2]), who: 'K' });
    expect(r.historyText).toBe('K rolled Clash (Fight) [✶E Good ✶ Good ✕ Bad = 1 HIT, 1 EDGE] — vs 1: SUCCESS');
    expect(r.total).toBe(1);
    // The tray gets them by name, each face as the log writes it.
    expect([r.results, r.diceSides]).toEqual([{ Good: ['✶E', '✶'], Bad: ['✕'] }, { Good: 3, Bad: 2 }]);
    const none = rollField({ definition: DICED, data: SHEET, fieldId: 'fight', rng: faces([1, 3], [2, 3], [2, 2]), who: 'K' });
    expect(none.historyText).toBe('K rolled Clash (Fight) [· Good ✶ Good ✕ Bad = NOTHING LEFT] — vs 1: FAILURE');
  });

  it('tells the tray\'s board what is left and what it came to, in the log\'s words (6c4d1)', () => {
    const r = rollField({ definition: DICED, data: SHEET, fieldId: 'fight', rng: faces([3, 3], [2, 3], [2, 2]), who: 'K' });
    expect(r.board).toEqual({ label: 'FIGHT', words: '1 HIT · 1 EDGE', outcome: 'vs 1: SUCCESS' });
    const none = rollField({ definition: DICED, data: SHEET, fieldId: 'fight', rng: faces([1, 3], [2, 3], [2, 2]), who: 'K' });
    expect(none.board).toEqual({ label: 'FIGHT', words: 'NOTHING LEFT', outcome: 'vs 1: FAILURE' });
    // A roll reading a sum says its total first, then what is left, as the log does after it.
    const summed = rollField({ definition: DICED, data: SHEET, roll: { id: 's', label: 'S', dice: [{ count: '2', die: 'good' }] }, rng: faces([3, 3], [2, 3]), who: 'K' });
    expect(summed.historyText).toMatch(/ = \d+ · 2 HIT, 1 EDGE\]$/);
    expect(summed.board).toEqual({ label: 'S', words: `${summed.total} · 2 HIT · 1 EDGE` });
  });

  it('a number with its sign on a die with any below 0, summed as any roll is', () => {
    const r = rollField({ definition: DICED, data: SHEET, fieldId: 'lore', rng: faces([1, 3], [2, 3], [3, 3]), who: 'K' });
    expect(r.historyText).toBe('K rolled Fated (Lore) [+1 0 -1 = 0 + 3 = 3]');
    expect(r.results).toEqual({ dF: ['+1', '0', '-1'] });
  });
});
