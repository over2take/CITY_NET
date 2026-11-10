import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { PDFDocument } from 'pdf-lib';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * An uploaded sheet's maximum (7d7c; the user's call of 2026-11-08): where health is per level, the token's HP MAX is
 * asked for on the form, the JSON template and by the importer, and a whole upload keeps it as the base for the levels
 * it has, each level gained here adding to it. Its levels are the base's while it counts; the GM clears it.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { HEALTH_LEVELS_KEY, HEALTH_BASE_KEY, healthBaseOf, healthBaseFrom, XP_KEY } = require_('../systemBuilder/levels');
const { healthByLevel, withUploadedHealth, rerollAll } = require_('../systemBuilder/healthLevels');
const { levelAction } = require_('../systemBuilder/levelUp');
const { healthLines, leftOut, customImporter, jsonTemplate } = require_('../systemBuilder/sheetImport');
const { buildCustomTemplate, leftLine } = require_('../sheets/pdfTemplate');
const { extractPdfFields } = require_('../sheets/importers');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');
const sheetsRouteFactory = require_('../routes/sheets.js');

const BASED = {
  format: 1, name: 'Based', core: { health: { model: 'pool' }, advancement: ['levels'] },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', die: 10 }] }],
  levels: { top: 8, first: 100, ranges: [{ to: 8, x: 2 }], health: { how: 'level', gain: 'roll', adds: '2' } },
};
const holding = (level) => ({ [PICKS_KEY]: { classes: [{ option: 'soldier', level }] } });
const act = (data, action, opts = {}) => levelAction(BASED, data, action, opts);
const GM = { gm: true };

describe('the base, kept', () => {
  it('a whole number from 1 to 9999, written as it may be; kept with the level it stands for', () => {
    expect(healthBaseFrom(40)).toBe(40);
    expect(healthBaseFrom(' 1,200 ')).toBe(1200);
    for (const bad of [0, -3, 2.5, 'lots', '', 10000, true, null, [31], { max: 31 }]) expect(healthBaseFrom(bad), JSON.stringify(bad)).toBeNull();
    expect(healthBaseFrom(9999)).toBe(9999);
    expect(healthBaseOf({ [HEALTH_BASE_KEY]: { max: 40, level: 3 } })).toEqual({ max: 40, level: 3 });
    for (const bad of [{ max: 0, level: 3 }, { max: 40, level: 0 }, { max: 40 }, { max: 1e4, level: 3 }, 40, null]) {
      expect(healthBaseOf({ [HEALTH_BASE_KEY]: bad }), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the maximum, from the base', () => {
  const based = (level, more = {}) => ({ ...holding(level), [HEALTH_BASE_KEY]: { max: 40, level: 3 }, ...more });

  it('the base for its levels, each after it adding as here; those levels listed, its', () => {
    const at3 = healthByLevel(BASED, based(3));
    expect(at3.max).toBe(40);
    expect(at3.base).toEqual({ max: 40, level: 3 });
    expect(at3.levels.map((l) => [l.level, !!l.base])).toEqual([[1, true], [2, true], [3, true]]);
    // Level 4 rolled 6, +2 each level.
    const at4 = healthByLevel(BASED, based(4, { [HEALTH_LEVELS_KEY]: { 4: { die: 10, took: 6, rolled: true } } }));
    expect(at4.max).toBe(40 + 8);
    expect(at4.levels[3]).toEqual({ level: 4, took: 6, die: 10, rolled: true });
  });

  it('below its level it doesn\'t count: each level as here', () => {
    const at2 = healthByLevel(BASED, based(2));
    expect(at2.max).toBe(12 + 7);
    expect(at2).not.toHaveProperty('base');
    expect(at2.levels.some((l) => l.base)).toBe(false);
  });

  it('a reroll still rolls every level\'s die, the base\'s levels too, against the maximum', () => {
    const all = rerollAll(BASED, based(3), 10, () => 0.99);
    expect(all.rolls).toHaveLength(4);
    expect(all.over).toBe(40);
  });
});

describe('the record, with a base', () => {
  const data = { ...holding(4), [HEALTH_BASE_KEY]: { max: 40, level: 3 }, [HEALTH_LEVELS_KEY]: { 4: { die: 10, took: 6, rolled: true } } };

  it('its levels can\'t be cleared, set or rolled; those after it can', () => {
    const counted = 'Counted in the uploaded maximum: the GM clears that first';
    expect(act(data, { kind: 'setLevel', level: 3, took: 4 }, GM).error).toBe(counted);
    expect(act(data, { kind: 'setLevel', level: 1, took: 4 }, GM).error).toBe(counted);
    expect(act(data, { kind: 'clearLevel', level: 2 }, GM).error).toBe(counted);
    expect(act(data, { kind: 'rollLevel', level: 3 }).error).toBe(counted);
    expect(act(data, { kind: 'clearLevel', level: 4 }, GM).ok).toBe(true);
    // Below its level it doesn't count, so neither does this.
    expect(act({ ...data, ...holding(2) }, { kind: 'setLevel', level: 2, took: 4 }, GM).ok).toBe(true);
  });

  it('the GM clears it: each level counted as here', () => {
    expect(act(data, { kind: 'clearBase' }).error).toBe('That is the GM\'s to do');
    const cleared = act(data, { kind: 'clearBase' }, GM);
    expect(cleared.data).not.toHaveProperty(HEALTH_BASE_KEY);
    expect(healthByLevel(BASED, cleared.data).max).toBe(12 + 7 + 7 + 8);
    expect(act(cleared.data, { kind: 'clearBase' }, GM).error).toBe('No uploaded maximum to clear');
  });
});

describe('a whole upload', () => {
  it('its maximum the base for the level it has; what each level kept, and a base before, gone', () => {
    const before = { ...holding(3), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 9, rolled: true } }, [HEALTH_BASE_KEY]: { max: 99, level: 2 }, might: 12 };
    expect(withUploadedHealth(BASED, before, '31')).toEqual({ ...holding(3), might: 12, [HEALTH_BASE_KEY]: { max: 31, level: 3 } });
    expect(withUploadedHealth(BASED, before, undefined)).toEqual({ ...holding(3), might: 12 });
    expect(withUploadedHealth(BASED, before, 'lots')).toEqual({ ...holding(3), might: 12 });
  });

  it('as it is where health isn\'t per level', () => {
    const formula = { ...BASED, levels: { ...BASED.levels, health: { how: 'formula', formula: '10' } } };
    const before = { [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 9 } } };
    expect(withUploadedHealth(formula, before, 31)).toBe(before);
  });
});

describe('the form, the JSON template and the importer ask for it', () => {
  it('a line under the token\'s maximum\'s own label, only where health is per level on the token', () => {
    expect(healthLines(BASED)).toEqual([expect.objectContaining({ id: '_health_base', label: 'HP MAX', field: 'hp_max', type: 'number', min: 1, max: 9999, section: 'LEVELS' })]);
    for (const none of [
      { ...BASED, levels: { ...BASED.levels, health: { how: 'as_is' } } },
      { ...BASED, parts: { token_health: { on: false } } },
      null,
    ]) expect(healthLines(none), JSON.stringify(none && none.levels)).toEqual([]);
  });

  it('read by its label, its id, or the token field\'s; what isn\'t a whole one from 1 is said, not taken', () => {
    const read = (raw) => customImporter(BASED).mapFields(raw);
    for (const key of ['HP MAX', 'hp_max', '_health_base']) expect(read({ [key]: 31 }).mapped._health_base, key).toBe(31);
    expect(read({ 'HP MAX': 31 }).skipped).toEqual({});
    for (const bad of [0, 'lots', 2.5]) expect(read({ 'HP MAX': bad }).unmapped, String(bad)).toEqual({ 'HP MAX': bad });
    expect(customImporter(BASED).parseText('Might 12\nHP MAX 31')._health_base).toBe('31');
    // Elsewhere where health isn't per level, as before.
    const asIs = { ...BASED, levels: { ...BASED.levels, health: { how: 'as_is' } } };
    expect(customImporter(asIs).mapFields({ 'HP MAX': 31 }).skipped).toEqual({ 'HP MAX': 31 });
  });

  it('under another model\'s own word, and by its field\'s id too', () => {
    const wounds = { ...BASED, core: { ...BASED.core, health: { model: 'wounds' } } };
    expect(healthLines(wounds)).toEqual([expect.objectContaining({ label: 'WOUNDS', field: 'wounds_max' })]);
    const read = (raw) => customImporter(wounds).mapFields(raw);
    for (const key of ['WOUNDS', 'wounds_max']) expect(read({ [key]: 4 }).mapped._health_base, key).toBe(4);
  });

  it('the JSON template asks for it, after XP; the form has its box, no longer said to be left out', async () => {
    const template = jsonTemplate(BASED);
    const keys = Object.keys(template.fields);
    expect(template.fields._health_base).toBeNull();
    expect(template.help._health_base).toBe('HP MAX. Their maximum now, for the levels they have. Left empty, each level counts as here');
    expect(keys.indexOf('_health_base')).toBe(keys.indexOf('_xp') + 1);
    const doc = await PDFDocument.load(await buildCustomTemplate(BASED));
    const names = doc.getForm().getFields().map((f) => f.getName());
    expect(names.indexOf('_health_base')).toBe(names.indexOf('_xp') + 1);
    expect(leftLine(leftOut(BASED))).toBe('Not on this form: HP, Cash (kept elsewhere in CITY_NET).');
    expect(leftLine(leftOut({ ...BASED, levels: { ...BASED.levels, health: { how: 'as_is' } } }))).toBe('Not on this form: HP, HP MAX, Cash (kept elsewhere in CITY_NET).');
  });

  it('comes back from the form filled in; left blank, nothing', async () => {
    const doc = await PDFDocument.load(await buildCustomTemplate(BASED));
    doc.getForm().getTextField('_health_base').setText('31');
    expect(customImporter(BASED).mapFields(await extractPdfFields(Buffer.from(await doc.save()))).mapped._health_base).toBe(31);
    const blank = customImporter(BASED).mapFields(await extractPdfFields(await buildCustomTemplate(BASED)));
    expect(blank.mapped._health_base).toBeUndefined();
    expect(blank.unmapped).toEqual({});
  });
});

describe('through the socket and the GM\'s route', () => {
  it('the GM\'s upload for a player sets the base too; a field patched, as it was', async () => {
    const db = await makeTestDb();
    const ID = 'sys_baseroutebaseroute';
    const def = JSON.stringify(BASED);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Based', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', ...holding(1), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 9 } } })]);
    const app = express();
    app.use(express.json());
    app.use('/api/sheets', sheetsRouteFactory(db, { emit: () => {} }));
    const gm = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    const put = (body) => request(app).put('/api/sheets/user/kes').set('Authorization', `Bearer ${gm}`).send(body);
    expect((await put({ fields: { name: 'Kestrel', _health_base: 31 }, picks: { classes: [{ option: 'soldier', level: 3 }] }, upload: true })).status).toBe(200);
    expect((await stored())[HEALTH_BASE_KEY]).toEqual({ max: 31, level: 3 });
    expect(await stored()).not.toHaveProperty(HEALTH_LEVELS_KEY);
    expect((await stored())._health.max).toBe(31);
  });

  it('a player\'s whole upload sets the base and the token\'s maximum; an edit never does', async () => {
    const db = await makeTestDb();
    const ID = 'sys_basebasebasebase';
    const def = JSON.stringify(BASED);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Based', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', [XP_KEY]: 0, ...holding(1), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 9 } } })]);
    await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES (\'Kes\', 0, 0, 0, \'rhombus\', \'kes\', 12, 12)');
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: 'base-kes', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    const token = async () => get(db, 'SELECT hp_max FROM locations WHERE owner = ?', ['kes']);

    handlers.importSheetFields({ fields: { name: 'Kestrel', _health_base: '31' }, picks: { classes: [{ option: 'soldier', level: 3 }] }, replace: true });
    await until(async () => (await token()).hp_max === 31, { label: 'the token at the base' });
    expect((await stored())[HEALTH_BASE_KEY]).toEqual({ max: 31, level: 3 });
    expect(await stored()).not.toHaveProperty(HEALTH_LEVELS_KEY);
    expect((await stored())._health.max).toBe(31);

    // A field edited, not an upload: the base stays, whatever is sent.
    handlers.importSheetFields({ fields: { name: 'Kes', _health_base: 99 } });
    await until(async () => (await stored()).name === 'Kes', { label: 'edited' });
    expect((await stored())[HEALTH_BASE_KEY]).toEqual({ max: 31, level: 3 });
  });
});
