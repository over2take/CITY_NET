/**
 * MAX HEALTH: A FORMULA (7d4; approved mockup docs/mockups/level-up.html, 2026-11-07): set on the LEVELS page,
 * checked as a formula is, worked out from the sheet as a derived value is (stats, formulas, levels), and the
 * token's maximum set to it and any feature's bonus after each change to the sheet, the current moving with it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { healthOf, HEALTH_HOWS } = require_('../systemBuilder/levels');
const { healthFormulaValue } = require_('../systemBuilder/healthFormula');
const { TOKEN_MAX_KEY, moveToFormula, syncTokenMax } = require_('../systemBuilder/tokenMax');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const formula = (text, more = {}) => ({ health: { how: 'formula', formula: text }, ...more });
const KEEP = {
  format: 1, name: 'Keep',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON mod', formula: 'floor(@con / 2)' }],
  lookups: { grit: { bands: [{ upTo: 9, value: 1 }, { value: 5 }] } },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
      { id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'hp_max', amount: '2 * @level' }] }] },
    ] },
  ],
  levels: formula('10 + @con_mod * @level'),
};
const problems = (levels) => checkDefinition({ ...KEEP, levels }).problems.map((p) => `${p.where}: ${p.message}`);
const sheet = (con, level = 3, feats = []) => ({ con, [PICKS_KEY]: { classes: [{ option: 'fighter', level }], feats: feats.map((option) => ({ option })) } });

describe('the setting', () => {
  it('AS IT IS unless it says A FORMULA, the formula kept either way', () => {
    expect(HEALTH_HOWS).toEqual(['as_is', 'formula', 'level']);
    const D = { dieOn: 'class', gain: 'average', beat: { way: 'pool', count: 6, die: 10, gain: 6 } };
    expect(healthOf({})).toEqual({ how: 'as_is', ...D });
    expect(healthOf(null)).toEqual({ how: 'as_is', ...D });
    expect(healthOf({ levels: { health: { how: 'dice' } } })).toEqual({ how: 'as_is', ...D });
    expect(healthOf(KEEP)).toEqual({ how: 'formula', formula: '10 + @con_mod * @level', ...D });
    expect(healthOf({ levels: { health: { how: 'as_is', formula: '7' } } })).toEqual({ how: 'as_is', formula: '7', ...D });
    expect(healthOf({ levels: { health: { how: 'formula', formula: 7 } } })).toEqual({ how: 'formula', ...D });
  });

  it('checks clean as written, and with a formula kept while AS IT IS', () => {
    expect(problems(KEEP.levels)).toEqual([]);
    expect(problems({ health: { how: 'as_is', formula: '10 +' } })).toEqual([]);
    expect(problems({ health: { how: 'as_is' } })).toEqual([]);
    expect(problems(formula('grit(@con) + 1'))).toEqual([]);
  });

  it('says what is wrong', () => {
    expect(problems({ health: 'formula' })).toEqual(['levels, health: Must say how max health is set']);
    expect(problems({ health: { how: 'roll' } })).toEqual(['levels, health, how: AS IT IS, A FORMULA or PER LEVEL']);
    expect(problems({ health: { how: 'formula', dice: 8, formula: '1' } })).toEqual(['levels, health, dice: Not part of max health']);
    expect(problems({ health: { how: 'formula' } })).toEqual(['levels, health, formula: Write the formula max health is worked out from']);
    expect(problems({ health: { how: 'formula', formula: '  ' } })).toEqual(['levels, health, formula: Write the formula max health is worked out from']);
    expect(problems({ health: { how: 'as_is', formula: 3 } })).toEqual(['levels, health, formula: Must be a formula']);
    expect(problems(formula('1+'.repeat(600) + '1'))).toEqual(['levels, health, formula: At most 1000 characters']);
    expect(problems(formula('10 +'))[0]).toMatch(/^levels, health, formula: /);
    expect(problems(formula('1'.padEnd(1000, ' ')))).toEqual([]);
  });

  it('travels in the system file, unchanged', () => {
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: KEEP, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.levels).toEqual(KEEP.levels);
  });
});

describe('what it comes to', () => {
  it('reads stats, formulas and levels, whole and never below 0', () => {
    expect(healthFormulaValue(KEEP, sheet(14))).toBe(31);
    expect(healthFormulaValue(KEEP, sheet(14, 5))).toBe(45);
    expect(healthFormulaValue({ ...KEEP, levels: formula('@con / 4') }, sheet(14))).toBe(3);
    expect(healthFormulaValue({ ...KEEP, levels: formula('@con - 20') }, sheet(14))).toBe(0);
    expect(healthFormulaValue({ ...KEEP, levels: formula('grit(@con)') }, sheet(14))).toBe(5);
    expect(healthFormulaValue(KEEP, null)).toBe(10);
    // A system with no formulas of its own, or no lookups.
    const { derived, lookups, ...plain } = KEEP;
    expect(healthFormulaValue({ ...plain, levels: formula('10 + @con * 2') }, sheet(3))).toBe(16);
  });

  it('nothing where max health is as it is, or the formula or the system can\'t be worked out', () => {
    expect(healthFormulaValue({ ...KEEP, levels: { health: { how: 'as_is', formula: '5' } } }, sheet(14))).toBeNull();
    expect(healthFormulaValue({ ...KEEP, levels: formula('  ') }, sheet(14))).toBeNull();
    expect(healthFormulaValue({ ...KEEP, levels: formula('10 +') }, sheet(14))).toBeNull();
    expect(healthFormulaValue({ ...KEEP, derived: [{ id: 'con_mod', formula: '@con_mod' }] }, sheet(14))).toBeNull();
    // Dividing by nothing reads as 0, as every formula's does.
    expect(healthFormulaValue({ ...KEEP, levels: formula('1 / 0') }, sheet(14))).toBe(0);
  });

  it('a token\'s move: to the formula and the bonus, the sheet noting the bonus; nothing when it is there', () => {
    expect(moveToFormula(KEEP, sheet(14), 7, 20)).toEqual({ by: 11, data: { ...sheet(14), [TOKEN_MAX_KEY]: { token: 7, amount: 0 } } });
    expect(moveToFormula(KEEP, sheet(14, 3, ['tough']), 7, 20).by).toBe(17);
    expect(moveToFormula(KEEP, sheet(14, 3, ['tough']), 7, 20).data[TOKEN_MAX_KEY]).toEqual({ token: 7, amount: 6 });
    expect(moveToFormula(KEEP, { ...sheet(14), [TOKEN_MAX_KEY]: { token: 7, amount: 0 } }, 7, 31)).toBeNull();
    // Where it is, but the bonus the sheet names is another token's: noted for this one, moving nothing.
    const tough = sheet(14, 3, ['tough']);
    expect(moveToFormula(KEEP, { ...tough, [TOKEN_MAX_KEY]: { token: 6, amount: 6 } }, 7, 37)).toEqual({ by: 0, data: { ...tough, [TOKEN_MAX_KEY]: { token: 7, amount: 6 } } });
    expect(moveToFormula(KEEP, { ...tough, [TOKEN_MAX_KEY]: { token: 7, amount: 6 } }, 7, 37)).toBeNull();
    expect(moveToFormula(KEEP, sheet(14), 7, null).by).toBe(31);
    expect(moveToFormula(KEEP, sheet(14), 7, undefined).by).toBe(31);
    expect(moveToFormula({ ...KEEP, levels: {} }, sheet(14), 7, 20)).toBeNull();
  });
});

describe('at the table', () => {
  const ID = 'sys_healthhealthhealth';
  let db;
  let emitUpdate;
  const install = async (definition) => {
    const def = JSON.stringify(definition);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, published = excluded.published', [ID, definition.name, def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const join = async (who, identity) => {
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
    const handlers = {};
    connection({ id: `hf-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    return { handlers };
  };
  const tokenOf = () => get(db, `SELECT hp_current, hp_max FROM locations WHERE owner = 'kes' AND shape = 'rhombus' ORDER BY id LIMIT 1`);
  const healthIs = (current, max, label) => until(async () => { const t = await tokenOf(); return t.hp_current === current && t.hp_max === max; }, { label });
  const sync = () => new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve));

  beforeEach(async () => {
    db = await makeTestDb();
    emitUpdate = vi.fn();
    await install(KEEP);
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify(sheet(10))]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', 20, 20)`);
  });

  it('a stat the player types sets the maximum, the current moving by as much', async () => {
    const kes = await join('kes', 'kes');
    kes.handlers.updateSheetField({ fieldId: 'con', value: 14 });
    await healthIs(31, 31, 'CON 14 at level 3: 10 + 7 * 3');
    await run(db, `UPDATE locations SET hp_current = 12 WHERE owner = 'kes'`);
    kes.handlers.updateSheetField({ fieldId: 'con', value: 10 });
    await healthIs(6, 25, 'down 6, hurt');
    await run(db, `UPDATE locations SET hp_current = 2 WHERE owner = 'kes'`);
    kes.handlers.updateSheetField({ fieldId: 'con', value: 6 });
    await healthIs(0, 19, 'down 6 again: never below 0');
    expect(emitUpdate).toHaveBeenCalledWith({ isRhombusOnly: true });
  });

  it('a feature\'s bonus still adds on top, and a level moves it', async () => {
    const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.choicesAction({ kind: 'pick', list: 'feats', option: 'tough', username: 'kes' });
    await healthIs(31, 31, '10 + 5 * 3, and Tough\'s 6');
    gm.handlers.choicesAction({ kind: 'level', list: 'classes', option: 'fighter', level: 4, username: 'kes' });
    await healthIs(38, 38, '10 + 5 * 4, and 8');
    expect(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data)[TOKEN_MAX_KEY]).toEqual({ token: expect.any(Number), amount: 8 });
  });

  it('typed over on the token, the next change to the sheet puts it back', async () => {
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 25 });
    await run(db, `UPDATE locations SET hp_max = 40, hp_current = 40 WHERE owner = 'kes'`);
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 25 });
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 25 });
  });

  it('works with no HP MAX field on the sheet, and not with token health off', async () => {
    await install({ ...KEEP, core: { health: { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER' }] } } });
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 25 });
    await install({ ...KEEP, parts: { token_health: { on: false } } });
    await run(db, `UPDATE locations SET hp_max = 20, hp_current = 20 WHERE owner = 'kes'`);
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 20, hp_max: 20 });
  });

  it('a formula that won\'t work out leaves the GM\'s number, with the bonus as before', async () => {
    await install({ ...KEEP, derived: [{ id: 'con_mod', label: 'CON mod', formula: 'floor(@con / 2)' }, { id: 'loop_a', label: 'A', formula: '@loop_b' }, { id: 'loop_b', label: 'B', formula: '@loop_a' }] });
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify(sheet(10, 3, ['tough'])), 'kes']);
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 26, hp_max: 26 });
  });

  it('AS IT IS, the token keeps its own number and only the bonus moves it', async () => {
    await install({ ...KEEP, levels: { health: { how: 'as_is', formula: '99' } } });
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 20, hp_max: 20 });
  });
});
