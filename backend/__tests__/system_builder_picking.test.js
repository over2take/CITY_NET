/**
 * Picking on the sheet (7a3a; approved mockup docs/mockups/builder-choices.html and the user's calls of
 * 2026-10-28): a player picks for their own character while the list has room and the requirement is
 * met, and sets their own levels and spent uses; only the GM takes a pick away or picks past a
 * requirement. Every save writes what the sheet shows of the picks; a rest refills uses; the sheet is
 * drawn from the lists in words, never a formula. Through the socket, as a player and as the GM.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { pickAction } = require_('../systemBuilder/picking');
const { PICKS_KEY, USES_KEY, WORKED_KEY, workedOf, choicesShown, needsText, usesOf, meets } = require_('../systemBuilder/choices');
const { checkDefinition } = require_('../systemBuilder/definition');
const { restOn } = require_('../systemBuilder/resting');
const runtime = require_('../systemBuilder/runtime');
const templates = require_('../sheets/templates');
const { effectiveSheet, starterSheet, LAYOUTS } = require_('../systemBuilder/sheet');
const socketsFactory = (await import('../sockets/index.js')).default;

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }, { id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  rests: { long_rest: { refills: [] } },
  rolls: [{ id: 'mind_save', label: 'Mind save', dice: [{ count: '1', sides: 20 }], changes: [{ id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'rally', label: 'Rally', uses: { count: '1 + @soldier_level', refill: 'short_rest' } },
        { id: 'focus', label: 'Focus', at: 3, changes: [{ roll: 'mind_save', change: 'advantage' }] },
      ] },
      { id: 'mage', label: 'Mage', requires: '@int >= 13', features: [{ id: 'ward', label: 'Ward', uses: { count: '2', refill: 'long_rest' } }] },
    ] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [{ id: 'dockhand', label: 'Dockhand', description: 'The wharf.' }, { id: 'acolyte', label: 'Acolyte' }] },
  ],
};
const picks = (data) => data[PICKS_KEY];

describe('picking, as a player', () => {
  const sheet = { int: 10, con: 12 };

  it('the system checks clean', () => {
    expect(checkDefinition(HEARTH).problems).toEqual([]);
  });

  it('picks an option while the list has room: a levelled one at level 1', () => {
    const one = pickAction(HEARTH, sheet, { kind: 'pick', list: 'classes', option: 'soldier' });
    expect(one).toEqual({ ok: true, data: { ...sheet, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }] } } });
    const bg = pickAction(HEARTH, one.data, { kind: 'pick', list: 'backgrounds', option: 'dockhand' });
    expect(picks(bg.data)).toEqual({ classes: [{ option: 'soldier', level: 1 }], backgrounds: [{ option: 'dockhand' }] });
  });

  it('not twice, not past the list\'s room, not past a requirement', () => {
    const had = { ...sheet, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 2 }], backgrounds: ['dockhand'] } };
    expect(pickAction(HEARTH, had, { kind: 'pick', list: 'classes', option: 'soldier' })).toEqual({ ok: false, error: 'Soldier is already picked' });
    expect(pickAction(HEARTH, had, { kind: 'pick', list: 'backgrounds', option: 'acolyte' })).toEqual({ ok: false, error: 'No more Backgrounds can be picked' });
    expect(pickAction(HEARTH, had, { kind: 'pick', list: 'classes', option: 'mage' })).toEqual({ ok: false, error: 'Mage needs INTELLECT >= 13' });
    // Met: MORE THAN ONCE leaves room for a second class.
    expect(picks(pickAction(HEARTH, { ...had, int: 13 }, { kind: 'pick', list: 'classes', option: 'mage' }).data).classes)
      .toEqual([{ option: 'soldier', level: 2 }, { option: 'mage', level: 1 }]);
  });

  it('never takes a pick away', () => {
    const had = { ...sheet, [PICKS_KEY]: { backgrounds: ['dockhand'] } };
    expect(pickAction(HEARTH, had, { kind: 'drop', list: 'backgrounds', option: 'dockhand' })).toEqual({ ok: false, error: 'Only the GM takes a pick away' });
  });

  it('sets their own level, from 1 to the highest, in a levelled list, on a pick they have', () => {
    const had = { ...sheet, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }], backgrounds: ['dockhand'] } };
    expect(picks(pickAction(HEARTH, had, { kind: 'level', list: 'classes', option: 'soldier', level: 4 }).data).classes).toEqual([{ option: 'soldier', level: 4 }]);
    for (const level of [0, 31, 2.5, 'three']) expect(pickAction(HEARTH, had, { kind: 'level', list: 'classes', option: 'soldier', level }).error).toBe('A level from 1 to 30');
    expect(pickAction(HEARTH, had, { kind: 'level', list: 'classes', option: 'mage', level: 2 }).error).toBe('Mage isn\'t picked');
    expect(pickAction(HEARTH, had, { kind: 'level', list: 'backgrounds', option: 'dockhand', level: 2 }).error).toBe('The Backgrounds have no levels');
  });

  it('ticks a feature\'s uses off and back, within how many it has', () => {
    const had = { ...sheet, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 2 }] } };
    // Rally: 1 + @soldier_level = 3.
    expect(pickAction(HEARTH, had, { kind: 'use', feature: 'rally', spent: 2 }).data[USES_KEY]).toEqual({ rally: 2 });
    expect(pickAction(HEARTH, had, { kind: 'use', feature: 'rally', spent: 4 })).toEqual({ ok: false, error: 'Between none and all 3 of its uses' });
    expect(pickAction(HEARTH, had, { kind: 'use', feature: 'ward', spent: 1 })).toEqual({ ok: false, error: 'This character has no such feature with uses' });
  });

  it('refuses what isn\'t there', () => {
    expect(pickAction(HEARTH, sheet, { kind: 'pick', list: 'feats', option: 'x' }).error).toBe('Not one of this system\'s lists');
    expect(pickAction(HEARTH, sheet, { kind: 'pick', list: 'classes', option: 'rogue' }).error).toBe('Not one of the Classes');
    expect(pickAction(HEARTH, sheet, { kind: 'sell', list: 'classes', option: 'soldier' }).error).toBe('Nothing to do');
    expect(pickAction(HEARTH, sheet, null).error).toBe('Nothing to do');
  });
});

describe('picking, as the GM', () => {
  it('picks past a requirement, never past the list\'s room', () => {
    const gm = { gm: true };
    expect(picks(pickAction(HEARTH, { int: 8 }, { kind: 'pick', list: 'classes', option: 'mage' }, gm).data).classes).toEqual([{ option: 'mage', level: 1 }]);
    const full = { [PICKS_KEY]: { backgrounds: ['dockhand'] } };
    expect(pickAction(HEARTH, full, { kind: 'pick', list: 'backgrounds', option: 'acolyte' }, gm).error).toBe('No more Backgrounds can be picked');
  });

  it('takes a pick away; one not picked says so', () => {
    const had = { [PICKS_KEY]: { classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }] } };
    expect(picks(pickAction(HEARTH, had, { kind: 'drop', list: 'classes', option: 'soldier' }, { gm: true }).data).classes).toEqual([{ option: 'mage', level: 1 }]);
    expect(pickAction(HEARTH, {}, { kind: 'drop', list: 'classes', option: 'soldier' }, { gm: true }).error).toBe('Soldier isn\'t picked');
  });
});

describe('what the sheet shows', () => {
  it('a save writes the picks, levels, where each change comes from, uses, and options not met', () => {
    const data = { int: 10, con: 12, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 3 }] }, [USES_KEY]: { rally: 1 } };
    runtime.metaOf(HEARTH).recompute(data);
    expect(data[WORKED_KEY]).toEqual({
      picks: [{ list: 'classes', option: 'soldier', level: 3 }],
      opens: [],
      levels: { soldier_level: 3, mage_level: 0, classes_level: 3, level: 3 },
      from: { defense: [{ feature: 'Guard Stance', amount: 1 }] },
      uses: { rally: { max: 4, spent: 1 } },
      unmet: ['mage'],
    });
    expect(data.defense).toBe(11);
    expect(workedOf(HEARTH, { ...data, int: 14 }).unmet).toEqual([]);
  });

  it('a system without choices writes none, and takes away one left from before', () => {
    const plain = { ...HEARTH, choices: undefined };
    const data = { int: 10, [WORKED_KEY]: { picks: [] } };
    runtime.metaOf(plain).recompute(data);
    expect(data).not.toHaveProperty(WORKED_KEY);
  });

  it('uses never more spent than there are; a stored count past them reads as all of them', () => {
    const data = { [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }] }, [USES_KEY]: { rally: 9 } };
    expect(usesOf(HEARTH, data).map((u) => [u.feature.id, u.max, u.spent])).toEqual([['rally', 2, 2]]);
  });

  it('a requirement in the sheet\'s words, and met or not on the sheet as it reads', () => {
    expect(needsText(HEARTH, '@int >= 13 and @soldier_level > 1')).toBe('INTELLECT >= 13 and SOLDIER LEVEL > 1');
    const mage = HEARTH.choices[0].options[1];
    expect(meets(HEARTH, { int: 13 }, mage)).toBe(true);
    expect(meets(HEARTH, { int: 12 }, mage)).toBe(false);
    expect(meets(HEARTH, {}, HEARTH.choices[0].options[0])).toBe(true);
  });

  it('the lists as the sheet draws them: words, never a formula', () => {
    const shown = choicesShown(HEARTH);
    expect(shown[0]).toEqual({
      id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: true, levelled: true, picked: 'own',
      options: [
        { id: 'soldier', label: 'Soldier', features: [
          { id: 'guard', label: 'Guard Stance', at: 1, modifies: ['Defense'] },
          { id: 'rally', label: 'Rally', at: 1, uses: { refill: 'Short rest' } },
          { id: 'focus', label: 'Focus', at: 3, changes: ['Advantage on Mind save'] },
        ] },
        { id: 'mage', label: 'Mage', needs: 'INTELLECT >= 13', features: [{ id: 'ward', label: 'Ward', at: 1, uses: { refill: 'Long rest' } }] },
      ],
    });
    expect(shown[1].options[0]).toEqual({ id: 'dockhand', label: 'Dockhand', description: 'The wharf.', features: [] });
    expect(JSON.stringify(shown)).not.toMatch(/@|1 \+/);
    expect(runtime.renderOf('sys_x', HEARTH).choices).toEqual(shown);
  });
});

describe('a rest refills uses', () => {
  it('the ones it refills, or counts as, set back to none spent; others left', () => {
    const data = { [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }, { option: 'mage', level: 1 }] }, [USES_KEY]: { rally: 2, ward: 1 } };
    const short = restOn({ definition: HEARTH, restId: 'short_rest', sheet: data });
    expect(short.sheetPatch[USES_KEY]).toEqual({ rally: 0, ward: 1 });
    expect(short.changes).toEqual([{ what: 'uses:rally', label: 'Rally uses', from: 0, to: 2 }]);
    // A long rest counts as a short one in the standard set: both refilled.
    const withLong = { ...HEARTH, rests: { long_rest: { counts_as: ['short_rest'] } } };
    expect(restOn({ definition: withLong, restId: 'long_rest', sheet: data }).sheetPatch[USES_KEY]).toEqual({ rally: 0, ward: 0 });
    // Nothing spent: nothing written.
    expect(restOn({ definition: HEARTH, restId: 'short_rest', sheet: { ...data, [USES_KEY]: {} } }).sheetPatch).not.toHaveProperty(USES_KEY);
  });
});

describe('the picks and what is kept beside them, as fields', () => {
  it('no name starting with _ is a player\'s to write, under any system; the rest as before', () => {
    for (const k of [PICKS_KEY, USES_KEY, WORKED_KEY, '_anything']) expect(templates.playerMayEdit('sys_x', k), k).toBe(false);
    expect(templates.playerMayEdit('sys_x', 'int')).toBe(true);
  });
});

describe('through the socket', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_pickpickpickpick';

  const table = async () => {
    const shared = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const heard = [];
      const handlers = {};
      connection({ id: `s-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      return { handlers, heard, refused: () => heard.filter((e) => e.event === 'choicesRefused').map((e) => e.data.error) };
    };
    return { shared, gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM }), kes: await join('kes', 'kes') };
  };
  const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);

  beforeEach(async () => {
    db = await makeTestDb();
    const def = JSON.stringify(HEARTH);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hearth', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Kestrel', int: 10 })]);
  });

  it('a player picks, levels and ticks their own; each save works it out and tells every screen', async () => {
    const { kes, shared } = await table();
    kes.handlers.choicesAction({ kind: 'pick', list: 'classes', option: 'soldier' });
    await until(async () => !!(await stored())[PICKS_KEY], { label: 'the pick stored' });
    kes.handlers.choicesAction({ kind: 'level', list: 'classes', option: 'soldier', level: 2 });
    await until(async () => (await stored())[WORKED_KEY]?.levels.soldier_level === 2, { label: 'the level' });
    kes.handlers.choicesAction({ kind: 'use', feature: 'rally', spent: 1 });
    await until(async () => (await stored())[USES_KEY]?.rally === 1, { label: 'the use' });
    const data = await stored();
    expect(data[WORKED_KEY].uses).toEqual({ rally: { max: 3, spent: 1 } });
    expect(data.defense).toBe(11);
    expect(shared.filter((e) => e.event === 'sheetUpdated').map((e) => e.data)).toEqual(Array(3).fill({ username: 'kes', system: ID }));
    expect(kes.refused()).toEqual([]);
  });

  it('a player is told why not: a requirement, taking a pick away; nothing is written', async () => {
    const { kes } = await table();
    kes.handlers.choicesAction({ kind: 'pick', list: 'classes', option: 'mage' });
    await until(() => kes.refused().length === 1, { label: 'the refusal' });
    kes.handlers.choicesAction({ kind: 'drop', list: 'classes', option: 'mage' });
    await until(() => kes.refused().length === 2, { label: 'the second refusal' });
    expect(kes.refused()).toEqual(['Mage needs INTELLECT >= 13', 'Only the GM takes a pick away']);
    expect(await stored()).toEqual({ name: 'Kestrel', int: 10 });
  });

  it('a player can\'t name another character, nor write the picks as a field', async () => {
    const { kes } = await table();
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('rook', ?, '{}', 0)`, [ID]);
    kes.handlers.choicesAction({ kind: 'pick', list: 'backgrounds', option: 'dockhand', username: 'rook' });
    await until(async () => !!(await stored())[PICKS_KEY], { label: 'the pick, on their own' });
    expect(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['rook'])).data)).toEqual({});
    kes.handlers.updateSheetField({ fieldId: PICKS_KEY, value: { classes: [{ option: 'mage', level: 30 }] } });
    await drain(db);
    expect((await stored())[PICKS_KEY]).toEqual({ backgrounds: [{ option: 'dockhand' }] });
  });

  it('the GM picks past a requirement and takes a pick away, on the player they name', async () => {
    const { gm } = await table();
    gm.handlers.choicesAction({ kind: 'pick', list: 'classes', option: 'mage', username: 'kes' });
    await until(async () => !!(await stored())[PICKS_KEY], { label: 'the GM\'s pick' });
    expect((await stored())[PICKS_KEY].classes).toEqual([{ option: 'mage', level: 1 }]);
    gm.handlers.choicesAction({ kind: 'drop', list: 'classes', option: 'mage', username: 'kes' });
    await until(async () => (await stored())[PICKS_KEY].classes.length === 0, { label: 'taken away' });
    expect(gm.refused()).toEqual([]);
  });

  it('a game on a built-in system has nothing to pick', async () => {
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    const { kes } = await table();
    kes.handlers.choicesAction({ kind: 'pick', list: 'classes', option: 'soldier' });
    await until(() => kes.refused().length === 1, { label: 'the refusal' });
    expect(kes.refused()).toEqual(['This game has no choices to pick from']);
  });
});

describe('the sheet\'s CHOICES block (7a3b1)', () => {
  const block = (def) => effectiveSheet(def).sections.find((s) => s.layout === 'choices');

  it('the starter sheet has one when the system has lists, on STATS after IDENTITY, named for the one list', () => {
    const sheet = effectiveSheet({ ...HEARTH, choices: [HEARTH.choices[0]] });
    expect(sheet.sections.slice(0, 2).map((s) => s.id)).toEqual(['identity', 'choices']);
    expect(block({ ...HEARTH, choices: [HEARTH.choices[0]] })).toEqual({ id: 'choices', label: 'CLASSES', layout: 'choices', tab: 'STATS', fields: [] });
    expect(block(HEARTH).label).toBe('CHOICES');
    expect(block({ ...HEARTH, choices: undefined })).toBeUndefined();
    expect(block({ ...HEARTH, choices: ['junk'] })).toBeUndefined();
  });

  it('a designed sheet may hold one, and CUSTOMIZE copies the starter\'s', () => {
    expect(LAYOUTS).toContain('choices');
    const sheet = starterSheet(HEARTH);
    expect(checkDefinition({ ...HEARTH, sheet }).problems).toEqual([]);
    expect(sheet.sections.some((s) => s.layout === 'choices')).toBe(true);
  });
});
