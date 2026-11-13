import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * Ranks making a character and levelling up (7f1c2; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a stat
 * held as a rank is picked by name in NEW CHARACTER, never given a number by its step's way, and never past AT START while
 * the character is being made (the GM may); a level-up INCREASE raises it a step a point, up to its top rank.
 */

const require_ = createRequire(import.meta.url);
const { creationShown, lockedWhileCreating, pastStart, CREATING_KEY } = require_('../systemBuilder/creation');
const { PICKS_KEY, choicesShown, effectiveData } = require_('../systemBuilder/choices');
const { levelAction } = require_('../systemBuilder/levelUp');
const { XP_KEY } = require_('../systemBuilder/levels');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const PROFICIENCY = { id: 'proficiency', label: 'PROFICIENCY', list: [
  { name: 'UNTRAINED', worth: '0' }, { name: 'TRAINED', worth: '2' }, { name: 'EXPERT', worth: '4' }, { name: 'MASTER', worth: '6' },
] };
const STARTED = {
  format: 1, name: 'Started', core: { health: { model: 'pool' }, advancement: ['levels'] }, levels: { top: 6, first: 100, ranges: [{ to: 6, x: 2 }] },
  stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'lore', label: 'Lore', rank: 'proficiency', atStart: 1 }] },
  ],
  ranks: [PROFICIENCY],
  creation: { on: true, ways: { stats: { way: 'array', numbers: [14] } } },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
    { id: 'mage', label: 'Mage', features: [{ id: 'spark', label: 'Spark', at: 2, increase: { points: 2, cap: 20 } }] },
  ] }],
};
const making = (more = {}) => ({ [CREATING_KEY]: { at: 'stats' }, ...more });

describe('making a character', () => {
  it('the system is sound', () => {
    expect(checkDefinition(STARTED).problems).toEqual([]);
  });

  it('a ranked stat is told with its ranks and AT START, and no way gives it a number', () => {
    expect(creationShown(STARTED).stats[0].stats).toEqual([
      { id: 'might', label: 'Might' },
      { id: 'lore', label: 'Lore', ranks: ['UNTRAINED', 'TRAINED', 'EXPERT', 'MASTER'], atStart: 1 },
    ]);
    // The array's numbers go on Might alone: Lore is never locked as a number placed.
    expect([...lockedWhileCreating(STARTED, making())]).toEqual(['might']);
    // Without AT START, any rank to start.
    const any = { ...STARTED, stats: [{ ...STARTED.stats[0], stats: [STARTED.stats[0].stats[0], { id: 'lore', label: 'Lore', rank: 'proficiency' }] }] };
    expect(creationShown(any).stats[0].stats[1]).toEqual({ id: 'lore', label: 'Lore', ranks: ['UNTRAINED', 'TRAINED', 'EXPERT', 'MASTER'] });
  });

  it('a rank past AT START while being made; up to it, or once made, never', () => {
    expect(pastStart(STARTED, making(), 'lore_rank', '2')).toBe(true);
    expect(pastStart(STARTED, making(), 'lore_rank', 2.6)).toBe(true);
    expect(pastStart(STARTED, making(), 'lore_rank', '1')).toBe(false);
    expect(pastStart(STARTED, making(), 'lore_rank', '1.4')).toBe(false);
    expect(pastStart(STARTED, making(), 'lore_rank', 'x')).toBe(false);
    expect(pastStart(STARTED, making(), 'might', 99)).toBe(false);
    expect(pastStart(STARTED, { [CREATING_KEY]: { at: 'stats', done: true } }, 'lore_rank', '3')).toBe(false);
    expect(pastStart(STARTED, {}, 'lore_rank', '3')).toBe(false);
    expect(pastStart(null, making(), 'lore_rank', '3')).toBe(false);
    const any = { ...STARTED, stats: [{ ...STARTED.stats[0], stats: [{ id: 'lore', label: 'Lore', rank: 'proficiency' }] }] };
    expect(pastStart(any, making(), 'lore_rank', '3')).toBe(false);
  });

  it('over the socket: a player\'s rank past AT START left as it was, by one field or many; the GM\'s kept', async () => {
    const db = await makeTestDb();
    const ID = 'sys_startedstarted12';
    const def = JSON.stringify(STARTED);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Started', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', ...making() })]);
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const handlers = {};
      connection({ id: `start-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      return handlers;
    };
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    const kes = await join('kes', 'kes');
    kes.updateSheetField({ fieldId: 'lore_rank', value: '3' });
    kes.updateSheetField({ fieldId: 'name', value: 'Kesh' });
    await until(async () => (await stored()).name === 'Kesh', { label: 'the edit after MASTER' });
    expect((await stored()).lore_rank).toBeUndefined();
    kes.updateSheetField({ fieldId: 'lore_rank', value: '1' });
    await until(async () => (await stored()).lore_rank === '1', { label: 'TRAINED kept' });
    kes.importSheetFields({ fields: { lore_rank: '2', name: 'Kestrel' } });
    await until(async () => (await stored()).name === 'Kestrel', { label: 'the batch' });
    expect((await stored()).lore_rank).toBe('1');
    // The GM, making their own: past AT START is theirs to give.
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'gm\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Warden', ...making() })]);
    const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.updateSheetField({ fieldId: 'lore_rank', value: '3' });
    const theirs = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['gm'])).data);
    await until(async () => (await theirs()).lore_rank === '3', { label: 'the GM\'s MASTER' });
    expect((await theirs()).lore).toBe(6);
  });
});

describe('levelling up', () => {
  // Mage 1 to 2 by the level-up, so Spark is newly unlocked and spent with it.
  const sheet = (more = {}) => ({ [XP_KEY]: 9e9, might: 14, [PICKS_KEY]: { classes: [{ option: 'mage', level: 1 }] }, ...more });
  const up = (data, increases) => levelAction(STARTED, data, { kind: 'up', list: 'classes', option: 'mage', increases });

  it('an INCREASE raises a ranked stat a step a point, up to its top rank, whatever a number stops at', () => {
    // Spark's points: Lore from TRAINED two steps to MASTER.
    const done = up(sheet({ lore_rank: '1' }), { spark: { lore: 2 } });
    expect(done.error).toBeUndefined();
    expect(effectiveData(STARTED, done.data).lore_rank).toBe(3);
    // From EXPERT, two steps is past the top.
    expect(up(sheet({ lore_rank: '2' }), { spark: { lore: 2 } }).error).toBe('Spark: Lore stops at MASTER');
    // A number still stops where it says.
    expect(up(sheet({ might: 19 }), { spark: { might: 2 } }).error).toBe('Spark: Might stops at 20');
    // And a rank never stops at a number: EXPERT's worth 4 + 1 is past a cap of 4, but MASTER is a rank.
    const low = { ...STARTED, choices: [{ ...STARTED.choices[0], options: [{ ...STARTED.choices[0].options[0], features: [{ id: 'spark', label: 'Spark', at: 2, increase: { points: 1, cap: 4 } }] }] }] };
    expect(levelAction(low, sheet({ lore_rank: '2', lore: 4 }), { kind: 'up', list: 'classes', option: 'mage', increases: { spark: { lore: 1 } } }).error).toBeUndefined();
  });

  it('the sheet is told the ranked stat\'s ranks by name', () => {
    expect(choicesShown(STARTED)[0].options[0].features[0].increase.stats).toEqual([
      { id: 'might', label: 'Might' }, { id: 'lore', label: 'Lore', ranks: ['UNTRAINED', 'TRAINED', 'EXPERT', 'MASTER'] },
    ]);
  });
});
