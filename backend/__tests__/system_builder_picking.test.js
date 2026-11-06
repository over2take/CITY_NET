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
const giving = require_('../sheets/giving');
const bankAccounts = require_('../bank/accounts');
const catalogues = require_('../shops/catalogueStore');
const { readInventory } = require_('../shops/placement');
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
      id: 'classes', one: 'Class', many: 'Classes', picks: 1, again: true, levelled: true, picked: 'own', players: 'hand',
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

  describe('the guided new character, over the socket (7c2)', () => {
    const turnOn = async () => {
      const def = JSON.stringify({ ...HEARTH, creation: { on: true } });
      await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
      await new Promise((resolve) => runtime.load(db, resolve));
    };

    it('opens, moves and finishes on their own sheet, telling every screen; never the GM\'s to be asked', async () => {
      await turnOn();
      const { kes, shared } = await table();
      kes.handlers.creationAction({ kind: 'open' });
      await until(async () => !!(await stored())._creating, { label: 'opened' });
      expect((await stored())[WORKED_KEY].unmet).toEqual(['mage']);
      kes.handlers.creationAction({ kind: 'at', step: 'stats' });
      await until(async () => (await stored())._creating.at === 'stats', { label: 'moved' });
      kes.handlers.creationAction({ kind: 'finish' });
      await until(async () => (await stored())._creating.done === true, { label: 'finished' });
      expect(shared.filter((e) => e.event === 'sheetUpdated')).toHaveLength(3);
      expect(kes.refused()).toEqual([]);
      expect((await stored()).name).toBe('Kestrel');
    });

    it('says why not, writing nothing, and a second open tells no screen', async () => {
      await turnOn();
      const { kes, shared } = await table();
      kes.handlers.creationAction({ kind: 'finish' });
      await until(() => kes.refused().length === 1, { label: 'the refusal' });
      expect(kes.refused()).toEqual(['This character isn\'t being made']);
      kes.handlers.creationAction({ kind: 'open' });
      await until(async () => !!(await stored())._creating, { label: 'opened' });
      const heard = shared.filter((e) => e.event === 'sheetUpdated').length;
      kes.handlers.creationAction({ kind: 'open' });
      await drain(db);
      expect(shared.filter((e) => e.event === 'sheetUpdated')).toHaveLength(heard);
    });

    it('says when a socket is known, so what it asked too soon can be asked again', async () => {
      const { kes } = await table();
      expect(kes.heard.filter((e) => e.event === 'identified')).toHaveLength(1);
    });

    it('refuses with the flow off', async () => {
      const { kes } = await table();
      kes.handlers.creationAction({ kind: 'open' });
      await until(() => kes.refused().length === 1, { label: 'the refusal' });
      expect(kes.refused()).toEqual(['This game has no guided new character']);
      expect((await stored())._creating).toBeUndefined();
    });

    it('an upload finishes it, taken as it is, and a batch edit doesn\'t', async () => {
      await turnOn();
      const { kes } = await table();
      kes.handlers.creationAction({ kind: 'open' });
      await until(async () => !!(await stored())._creating, { label: 'opened' });
      kes.handlers.importSheetFields({ fields: { int: 12 } });
      await until(async () => (await stored()).int === 12, { label: 'the batch edit' });
      expect((await stored())._creating).toEqual({});
      kes.handlers.importSheetFields({ fields: { name: 'Wren', int: 14 }, replace: true });
      await until(async () => (await stored()).name === 'Wren', { label: 'the upload' });
      expect((await stored())._creating).toEqual({ done: true, uploaded: true });
    });

    it('an upload with the flow off leaves no mark', async () => {
      const { kes } = await table();
      kes.handlers.importSheetFields({ fields: { name: 'Wren' }, replace: true });
      await until(async () => (await stored()).name === 'Wren', { label: 'the upload' });
      expect((await stored())._creating).toBeUndefined();
    });

    describe('a fixed array (7c3b)', () => {
      const turnOnArray = async () => {
        const def = JSON.stringify({ ...HEARTH, creation: { on: true, ways: { stats: { way: 'array', numbers: [15, 14, 13] } } } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Kestrel', _creating: { at: 'stats' } }), 'kes']);
      };

      it('a number placed is stored, worked out and told; one placed twice is refused', async () => {
        await turnOnArray();
        const { kes, shared } = await table();
        kes.handlers.creationAction({ kind: 'place', step: 'stats', stat: 'int', value: 15 });
        await until(async () => (await stored()).int === 15, { label: 'placed' });
        expect((await stored())[WORKED_KEY].unmet).not.toContain('mage');
        expect(shared.filter((e) => e.event === 'sheetUpdated')).toHaveLength(1);
        kes.handlers.creationAction({ kind: 'place', step: 'stats', stat: 'int', value: 99 });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['That number is already placed']);
        expect((await stored()).int).toBe(15);
      });

      it('a player can\'t type over it while the character is being made, by a field or a batch edit', async () => {
        await turnOnArray();
        const { kes } = await table();
        kes.handlers.updateSheetField({ fieldId: 'int', value: 20 });
        kes.handlers.importSheetFields({ fields: { int: 21, concept: 'Scout' } });
        await until(async () => (await stored()).concept === 'Scout', { label: 'the rest of the batch' });
        expect((await stored()).int).toBeUndefined();
        kes.handlers.updateSheetField({ fieldId: 'concept', value: 'Rook' });
        await until(async () => (await stored()).concept === 'Rook', { label: 'another field' });
      });

      it('the GM still can, and an upload is taken as it is', async () => {
        await turnOnArray();
        const { kes, gm } = await table();
        gm.handlers.creationAction({ kind: 'place', step: 'stats', stat: 'int', value: 13, username: 'kes' });
        await until(async () => (await stored()).int === 13, { label: 'placed by the GM' });
        kes.handlers.importSheetFields({ fields: { name: 'Wren', int: 20 }, replace: true });
        await until(async () => (await stored()).name === 'Wren', { label: 'the upload' });
        expect((await stored()).int).toBe(20);
        expect((await stored())._creating).toEqual({ done: true, uploaded: true });
      });

      it('finished, the sheet is theirs again', async () => {
        await turnOnArray();
        const { kes } = await table();
        kes.handlers.creationAction({ kind: 'finish' });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['Every stat needs its number first']);
        kes.handlers.creationAction({ kind: 'place', step: 'stats', stat: 'int', value: 13 });
        await until(async () => (await stored()).int === 13, { label: 'placed' });
        kes.handlers.creationAction({ kind: 'place', step: 'stats', stat: 'con', value: 14 });
        await until(async () => (await stored()).con === 14, { label: 'placed again' });
        kes.handlers.creationAction({ kind: 'finish' });
        await until(async () => (await stored())._creating.done === true, { label: 'finished' });
        kes.handlers.updateSheetField({ fieldId: 'int', value: 20 });
        await until(async () => (await stored()).int === 20, { label: 'typed' });
      });
    });

    describe('rolled (7c3c)', () => {
      const turnOnRoll = async (placed) => {
        const def = JSON.stringify({ ...HEARTH, creation: { on: true, ways: { stats: { way: 'roll', each: '20d100', placed } } } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Kestrel', _creating: { at: 'stats' } }), 'kes']);
      };

      it('in order: stored on the stats, in the log and thrown for everyone, on the sheet\'s queue', async () => {
        await turnOnRoll('order');
        const { kes, shared } = await table();
        kes.handlers.creationAction({ kind: 'roll', step: 'stats' });
        await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'the throw' });
        const data = await stored();
        const [int, con] = data._creating.rolled.stats;
        expect([data.int, data.con]).toEqual([int, con]);
        const thrown = shared.find((e) => e.event === 'diceRollBroadcast').data;
        // On the secure dice: twenty of a hundred sides all landing on 1 isn't going to happen.
        expect(Math.min(int, con)).toBeGreaterThan(20);
        expect(thrown.historyString).toBe(`Kestrel rolled THE STATS (20d100): Intellect ${int}, Constitution ${con}`);
        expect(thrown.results[100]).toHaveLength(40);
        expect(thrown.total).toBe(int + con);
        expect(thrown.board).toEqual({ label: 'THE STATS' });
        expect(thrown.throw.dice[0].landed).toHaveLength(40);
        await until(() => shared.some((e) => e.event === 'sheetUpdated'), { label: 'the screens told' });
      });

      it('once only: a second is refused, the numbers as they were, and no second throw', async () => {
        await turnOnRoll('arrange');
        const { kes, shared } = await table();
        kes.handlers.creationAction({ kind: 'roll', step: 'stats' });
        await until(async () => !!(await stored())._creating.rolled, { label: 'rolled' });
        const first = (await stored())._creating.rolled.stats;
        expect([(await stored()).int, (await stored()).con]).toEqual([undefined, undefined]);
        kes.handlers.creationAction({ kind: 'roll', step: 'stats' });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['Rolled, and kept: rolling again is the GM\'s']);
        expect((await stored())._creating.rolled.stats).toEqual(first);
        expect(shared.filter((e) => e.event === 'diceRollBroadcast')).toHaveLength(1);
      });
    });

    describe('a point buy (7c3d)', () => {
      const turnOnBuy = async () => {
        const def = JSON.stringify({ ...HEARTH, creation: { on: true, ways: { stats: { way: 'buy', points: 5, lowest: 8, highest: 15 } } } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Kestrel', _creating: {} }), 'kes']);
      };

      it('arriving fills them in; a number bought is stored and worked out; too many is refused', async () => {
        await turnOnBuy();
        const { kes, shared } = await table();
        kes.handlers.creationAction({ kind: 'at', step: 'stats' });
        await until(async () => (await stored()).int === 8, { label: 'filled in' });
        expect((await stored()).con).toBe(8);
        kes.handlers.creationAction({ kind: 'buy', step: 'stats', stat: 'int', value: 13 });
        await until(async () => (await stored()).int === 13, { label: 'bought' });
        expect((await stored())[WORKED_KEY].unmet).not.toContain('mage');
        await until(() => shared.filter((e) => e.event === 'sheetUpdated').length === 2, { label: 'the screens told' });
        kes.handlers.creationAction({ kind: 'buy', step: 'stats', stat: 'con', value: 9 });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['Not enough points left']);
        expect((await stored()).con).toBe(8);
      });

      it('a player can\'t type over a number while the character is being made; the GM can', async () => {
        await turnOnBuy();
        const { kes, gm } = await table();
        kes.handlers.updateSheetField({ fieldId: 'int', value: 20 });
        kes.handlers.updateSheetField({ fieldId: 'concept', value: 'Rook' });
        await until(async () => (await stored()).concept === 'Rook', { label: 'another field' });
        expect((await stored()).int).toBeUndefined();
        gm.handlers.creationAction({ kind: 'buy', step: 'stats', stat: 'int', value: 10, username: 'kes' });
        await until(async () => (await stored()).int === 10, { label: 'bought by the GM' });
      });
    });

    describe('kits (7c4b)', () => {
      const KITS = [
        { id: 'essentials', name: 'ESSENTIALS', items: [{ name: 'Knife', qty: 1 }, { name: ' COIL of rope ', qty: 2 }], who: 'all' },
        { id: 'traveler', name: 'TRAVELER', items: [{ name: 'Knife', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' },
        { id: 'rook', name: 'ROOK', items: [{ name: 'Letter', qty: 1 }], who: 'gm' },
      ];
      const turnOnKits = async (start = {}) => {
        const def = JSON.stringify({ ...HEARTH, creation: { on: true, kits: KITS } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Kestrel', _creating: { at: 'kits' }, ...start }), 'kes']);
      };
      const lines = async () => readInventory(await stored()).map((i) => [i.name, i.qty, i.carry, i.enc]);

      it('picking gives nothing yet; FINISH puts it all in the inventory, stacking, a catalogue\'s item by its own name', async () => {
        await turnOnKits();
        const { kes, shared } = await table();
        // After the boot, as GIVE ITEM's tests do: what this game's catalogues hold.
        catalogues.load(ID, { gear: [{ id: 'rope', name: 'Coil of Rope', price: 5, fields: { enc: '1' } }] });
        kes.handlers.creationAction({ kind: 'kit', kit: 'traveler' });
        await until(async () => (await stored())._creating.kit === 'traveler', { label: 'picked' });
        expect(await lines()).toEqual([]);
        kes.handlers.creationAction({ kind: 'finish' });
        await until(async () => (await stored())._creating.done === true, { label: 'finished' });
        expect(await lines()).toEqual([
          ['Knife', 2, 'stowed', ''],
          ['Coil of Rope', 2, 'stowed', '1'],
          ['Rations', 3, 'stowed', ''],
        ]);
        expect(shared.filter((e) => e.event === 'sheetUpdated')).toHaveLength(2);
      });

      it('adds to what they carry, and comes once: a second FINISH is refused, the items as they were', async () => {
        await turnOnKits({ inventory: JSON.stringify([{ name: 'Knife', qty: 1, carry: 'readied' }, { name: 'Rations', qty: 9, carry: 'stash' }]), _creating: { at: 'kits', kit: 'traveler' } });
        const { kes } = await table();
        kes.handlers.creationAction({ kind: 'finish' });
        await until(async () => (await stored())._creating.done === true, { label: 'finished' });
        const first = await lines();
        expect(first.find((l) => l[0] === 'Knife')[1]).toBe(3);
        expect(first.filter((l) => l[0] === 'Rations').map((l) => [l[1], l[2]])).toEqual([[9, 'stash'], [3, 'stowed']]);
        kes.handlers.creationAction({ kind: 'finish' });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['This character isn\'t being made']);
        expect(await lines()).toEqual(first);
      });

      it('FINISH without a pick is refused, giving nothing', async () => {
        await turnOnKits();
        const { kes } = await table();
        kes.handlers.creationAction({ kind: 'finish' });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['Pick a kit first']);
        expect(await lines()).toEqual([]);
        expect((await stored())._creating.done).toBeUndefined();
      });

      it('a game with no lists still works out a kit\'s requirement as a stat changes', async () => {
        const def = JSON.stringify({ format: 1, name: 'Hearth', stats: HEARTH.stats, creation: { on: true, kits: [{ id: 'potions', name: 'POTIONS', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', requires: '@int >= 13' }] } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Kestrel', _creating: {} }), 'kes']);
        const { kes } = await table();
        kes.handlers.updateSheetField({ fieldId: 'int', value: 4 });
        await until(async () => (await stored()).int === 4, { label: 'low' });
        expect((await stored())[WORKED_KEY].kitsUnmet).toEqual(['potions']);
        kes.handlers.updateSheetField({ fieldId: 'int', value: 14 });
        await until(async () => (await stored()).int === 14, { label: 'high' });
        expect((await stored())[WORKED_KEY].kitsUnmet).toEqual([]);
      });

      it('a game with neither writes nothing of it', async () => {
        const def = JSON.stringify({ format: 1, name: 'Hearth', stats: HEARTH.stats, creation: { on: true, kits: [{ id: 'all', name: 'ALL', items: [{ name: 'Mortar', qty: 1 }], who: 'all' }] } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        const { kes } = await table();
        kes.handlers.updateSheetField({ fieldId: 'int', value: 4 });
        await until(async () => (await stored()).int === 4, { label: 'saved' });
        expect((await stored())[WORKED_KEY]).toBeUndefined();
      });

      it('an upload gives no kits: taken as it is', async () => {
        await turnOnKits();
        const { kes } = await table();
        kes.handlers.importSheetFields({ fields: { name: 'Wren' }, replace: true });
        await until(async () => (await stored()).name === 'Wren', { label: 'the upload' });
        expect(await lines()).toEqual([]);
      });
    });

    describe('kits in GIVE (7c4c)', () => {
      const KITS = [
        { id: 'traveler', name: 'TRAVELER', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' },
        { id: 'potions', name: 'POTIONS', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', requires: '@int >= 99' },
        { id: 'rook', name: 'ROOK', items: [{ name: 'Letter', qty: 1 }], who: 'gm' },
      ];
      const turnOnKits = async () => {
        const def = JSON.stringify({ ...HEARTH, creation: { kits: KITS } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
      };
      const lines = async () => readInventory(await stored()).map((i) => [i.name, i.qty]);
      const answer = (who, event) => until(() => who.heard.some((e) => e.event === event), { label: event }).then(() => who.heard.filter((e) => e.event === event).pop().data);

      it('every kit is listed for the GM, what is in each said; to a player, nothing', async () => {
        await turnOnKits();
        const { gm, kes } = await table();
        gm.handlers.requestGivable();
        const reply = await answer(gm, 'givableItems');
        expect(reply.catalogues.find((c) => c.catalogue === 'kits').items).toEqual([
          { id: 'traveler', name: 'TRAVELER', price: 0, holds: 'Rope, 3x Rations' },
          { id: 'potions', name: 'POTIONS', price: 0, holds: 'Mortar' },
          { id: 'rook', name: 'ROOK', price: 0, holds: 'Letter' },
        ]);
        kes.handlers.requestGivable();
        await drain(db);
        expect(kes.heard.some((e) => e.event === 'givableItems')).toBe(false);
      });

      it('with no kits, none listed', async () => {
        const { gm } = await table();
        gm.handlers.requestGivable();
        const reply = await answer(gm, 'givableItems');
        expect(reply.catalogues.some((c) => c.catalogue === 'kits')).toBe(false);
      });

      it('the preview says where it lands and writes nothing; the GIVE lands it, on the GIVEN list', async () => {
        await turnOnKits();
        const { gm } = await table();
        gm.handlers.giveItem({ catalogue: 'kits', id: 'traveler', qty: 1, players: true, preview: true });
        const preview = await answer(gm, 'itemGiven');
        expect(preview.item).toEqual({ catalogue: 'kits', id: 'traveler', name: 'TRAVELER', price: 0 });
        expect(preview.recipients.find((r) => r.username === 'kes')).toMatchObject({ given: false, lands: { shape: 'kit', items: 4 } });
        expect(await lines()).toEqual([]);
        gm.heard.length = 0;
        gm.handlers.giveItem({ catalogue: 'kits', id: 'traveler', qty: 1, players: ['kes'], note: 'For the road' });
        const given = await answer(gm, 'itemGiven');
        expect(given.recipients.find((r) => r.username === 'kes')).toMatchObject({ given: true, lands: { shape: 'kit', items: 4 } });
        expect(await lines()).toEqual([['Rope', 1], ['Rations', 3]]);
        expect(given.given[0]).toMatchObject({ catalogue: 'kits', item: 'TRAVELER', qty: 1, to: ['Kestrel'], note: 'For the road' });
      });

      it('how many is that many of each; whatever way it goes, the GM can give it, even one not met', async () => {
        await turnOnKits();
        const { gm } = await table();
        gm.handlers.giveItem({ catalogue: 'kits', id: 'traveler', qty: 2, players: ['kes'] });
        const two = await answer(gm, 'itemGiven');
        expect(two.recipients.find((r) => r.username === 'kes').lands).toEqual({ shape: 'kit', items: 8 });
        expect(await lines()).toEqual([['Rope', 2], ['Rations', 6]]);
        gm.heard.length = 0;
        gm.handlers.giveItem({ catalogue: 'kits', id: 'potions', qty: 1, players: ['kes'] });
        await answer(gm, 'itemGiven');
        gm.heard.length = 0;
        gm.handlers.giveItem({ catalogue: 'kits', id: 'rook', qty: 1, players: ['kes'] });
        await answer(gm, 'itemGiven');
        expect((await lines()).map((l) => l[0])).toEqual(['Rope', 'Rations', 'Mortar', 'Letter']);
      });

      it('a kit it doesn\'t have is refused; a player can\'t give one', async () => {
        await turnOnKits();
        const { gm, kes } = await table();
        gm.handlers.giveItem({ catalogue: 'kits', id: 'nope', qty: 1, players: ['kes'] });
        const refused = await answer(gm, 'itemGiven');
        expect(refused).toEqual({ ok: false, reason: 'Not something this game can give.' });
        kes.handlers.giveItem({ catalogue: 'kits', id: 'traveler', qty: 1, players: ['kes'] });
        await drain(db);
        expect(await lines()).toEqual([]);
      });

      it('the player is told what was in it, privately', async () => {
        await turnOnKits();
        await table();
        const notify = vi.fn();
        const io = { emit: vi.fn() };
        await giving.giveItem(db, io, { system: ID, catalogue: 'kits', id: 'traveler', qty: 1, players: ['kes'], note: 'Go' }, notify);
        expect(notify).toHaveBeenCalledWith('kes', { item: 'TRAVELER', catalogue: 'kits', qty: 1, note: 'Go', holds: 'Rope, 3x Rations' });
        expect(io.emit.mock.calls.map((c) => c[0])).toEqual(['sheetUpdated']);
      });

      it('an item from a shelf is told as it was', async () => {
        await turnOnKits();
        await table();
        const notify = vi.fn();
        catalogues.load(ID, { gear: [{ id: 'coin', name: 'Coin', price: 5, fields: {} }] });
        await giving.giveItem(db, { emit: vi.fn() }, { system: ID, catalogue: 'gear', id: 'coin', qty: 1, players: ['kes'] }, notify);
        expect(notify).toHaveBeenCalledWith('kes', { item: 'Coin', catalogue: 'gear', qty: 1, note: '' });
        expect(await lines()).toEqual([['Coin', 1]]);
      });
    });

    describe('starting money (7c4d)', () => {
      const turnOnMoney = async (money, currencies) => {
        const def = JSON.stringify({ ...HEARTH, ...(currencies ? { currencies } : {}), creation: { on: true, money } });
        await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
        await new Promise((resolve) => runtime.load(db, resolve));
        await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Kestrel', _creating: { at: 'money' } }), 'kes']);
      };
      const account = () => new Promise((ok, no) => bankAccounts.get(db, 'kes', ID, (e, r) => (e ? no(e) : ok(r ? r.balance : 0))));
      const extra = (currency) => get(db, 'SELECT balance FROM bank_balances WHERE username = ? AND system = ? AND currency = ?', ['kes', ID, currency]);

      it('a roll is kept, in the log and thrown; nothing is paid until FINISH, then once', async () => {
        await turnOnMoney({ main: { how: 'roll', each: '3d6 * 10' } });
        const { kes, shared } = await table();
        kes.handlers.creationAction({ kind: 'moneyRoll', id: 'main' });
        await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'the throw' });
        const amount = (await stored())._creating.money.main;
        expect(amount).toBeGreaterThanOrEqual(30);
        expect(amount % 10).toBe(0);
        const thrown = shared.find((e) => e.event === 'diceRollBroadcast').data;
        expect(thrown.historyString).toBe(`Kestrel rolled MONEY (3d6 * 10): ${amount}`);
        expect(thrown.results[6]).toHaveLength(3);
        expect(await account()).toBe(0);
        kes.handlers.creationAction({ kind: 'finish' });
        await until(async () => (await account()) === amount, { label: 'paid' });
        await until(() => shared.some((e) => e.event === 'bankUpdate' && e.data.balance === amount), { label: 'told' });
        kes.handlers.creationAction({ kind: 'finish' });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        await drain(db);
        expect(await account()).toBe(amount);
      });

      it('each currency into its own account, the first the main one; typed as they said, a number as it is', async () => {
        await turnOnMoney({ gold: { how: 'typed' }, honor: { how: 'number', amount: 5 } }, [{ id: 'gold', name: 'Gold' }, { id: 'honor', name: 'Honor' }]);
        const { kes } = await table();
        kes.handlers.creationAction({ kind: 'moneyTyped', id: 'gold', amount: 70 });
        await until(async () => (await stored())._creating.money?.gold === 70, { label: 'typed' });
        kes.handlers.creationAction({ kind: 'finish' });
        await until(async () => (await account()) === 70, { label: 'gold paid' });
        await until(async () => (await extra('honor'))?.balance === 5, { label: 'honor paid' });
      });

      it('FINISH without it is refused, paying nothing', async () => {
        await turnOnMoney({ main: { how: 'typed' } });
        const { kes } = await table();
        kes.handlers.creationAction({ kind: 'finish' });
        await until(() => kes.refused().length === 1, { label: 'the refusal' });
        expect(kes.refused()).toEqual(['Say how much Money first']);
        expect(await account()).toBe(0);
      });

      it('an upload is paid nothing: taken as it is', async () => {
        await turnOnMoney({ main: { how: 'number', amount: 100 } });
        const { kes } = await table();
        kes.handlers.importSheetFields({ fields: { name: 'Wren' }, replace: true });
        await until(async () => (await stored()).name === 'Wren', { label: 'the upload' });
        await drain(db);
        expect(await account()).toBe(0);
      });
    });

    it('a player can\'t write their place as a field, and the GM may move theirs', async () => {
      await turnOn();
      const { kes, gm } = await table();
      kes.handlers.updateSheetField({ fieldId: '_creating', value: { done: true } });
      await drain(db);
      expect((await stored())._creating).toBeUndefined();
      gm.handlers.creationAction({ kind: 'open', username: 'kes' });
      await until(async () => !!(await stored())._creating, { label: 'opened by the GM' });
    });
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

  it('the starter sheet has one when the system has lists, on CHARACTER after IDENTITY, named for the one list', () => {
    const sheet = effectiveSheet({ ...HEARTH, choices: [HEARTH.choices[0]] });
    expect(sheet.sections.slice(0, 2).map((s) => s.id)).toEqual(['identity', 'choices']);
    expect(sheet.tabs).toEqual(['CHARACTER', 'STATS', 'GEAR', 'NOTES']);
    expect(sheet.opens).toBe('STATS');
    expect(block({ ...HEARTH, choices: [HEARTH.choices[0]] })).toEqual({ id: 'choices', label: 'CLASSES', layout: 'choices', tab: 'CHARACTER', fields: [] });
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
