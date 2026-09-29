/**
 * Skillplugs over the socket.
 *
 * The rules are tested on their own in cwn_skillplugs.test.js. What is tested HERE is the
 * wiring, which is the half that hides: a plug that grants a skill nothing ever rolls with,
 * or a crash the resolver computes and never applies, would pass every unit test while
 * doing nothing. Both halves are asserted against a real roll through the real handler.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { until, untilValue, drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;
const skillplugs = require('../sheets/cwnSkillplugs');

function boot(db) {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  const socket = {
    id: 'sock-1',
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    broadcast: { emit: (event, data) => emitted.push({ event, data, broadcast: true }) },
    use: () => {}, join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
});

const jack = (name = 'Skillplug Jack II') => [{ name, type: 'head', placed: true, equipped: true }];

const seed = async (extra = {}) => {
  const data = {
    level: 1, base_hit_bonus: 1,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    fix: 0, shoot: 0, int_mod: 0, dex_mod: 0,
    cyberware: jack(),
    ...extra,
  };
  await run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
    [JSON.stringify(data)]);
  await run(db,
    `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
};

const sheet = async () =>
  JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`)).data);

const identified = async (db2) => {
  const booted = boot(db2);
  booted.handlers['identify']('GHOST');
  await drain(db2);
  return booted;
};

const lastRoll = (emitted) =>
  [...emitted].reverse().find((e) => e.event === 'diceRollBroadcast');

describe('a loaded plug reaches the dice', () => {
  it('rolls a granted skill the character does not have', async () => {
    // Fix-0 with a Fix-1 plug. The breakdown has to show the 1, or the plug granted
    // nothing and only looked like it did.
    await seed({ [skillplugs.FIELD]: [{ skill: 'fix', level: 1 }] });
    const { handlers, emitted } = await identified(db);
    handlers['requestSheetRoll']({ fieldId: 'fix' });
    const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Fix roll' });
    expect(roll.data.historyString).toContain('+ 1');
  });

  it('leaves an unplugged character exactly as they were', async () => {
    await seed({ fix: 0 });
    const { handlers, emitted } = await identified(db);
    handlers['requestSheetRoll']({ fieldId: 'fix' });
    const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Fix roll' });
    // No modifier term at all: 0 skill, 0 mod.
    expect(roll.data.historyString).not.toContain('+ 1');
  });

  it('takes the better of the plug and the skill already earned', async () => {
    await seed({ fix: 2, [skillplugs.FIELD]: [{ skill: 'fix', level: 0 }] });
    const { handlers, emitted } = await identified(db);
    handlers['requestSheetRoll']({ fieldId: 'fix' });
    const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Fix roll' });
    expect(roll.data.historyString).toContain('+ 2');
  });

  it('grants nothing through a jack that cannot carry it', async () => {
    // Jack I and a Shoot plug: the book's own counter-example.
    await seed({
      cyberware: jack('Skillplug Jack I'),
      shoot: 0, [skillplugs.FIELD]: [{ skill: 'shoot', level: 1 }],
    });
    const { handlers, emitted } = await identified(db);
    handlers['requestSheetRoll']({ fieldId: 'shoot' });
    const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Shoot roll' });
    expect(roll.data.historyString).not.toContain('+ 1');
  });
});

describe('the jack crashes on the worst the dice can do', () => {
  // A d6 that always shows 1, so every skill check is a natural 2.
  const snakeEyes = () => vi.spyOn(Math, 'random').mockReturnValue(0);

  it('fails the check and says so, however good the total was', async () => {
    // Fix-3 with INT +2 rolls 2 for a total of 7, which would beat most difficulties.
    await seed({ fix: 3, int_mod: 2, [skillplugs.FIELD]: [{ skill: 'fix', level: 1 }] });
    const { handlers, emitted } = await identified(db);
    const spy = snakeEyes();
    try {
      handlers['requestSheetRoll']({ fieldId: 'fix' });
      const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Fix roll' });
      expect(roll.data.historyString).toContain('PLUG CRASH');
      expect(roll.data.historyString).toContain('AUTOMATIC FAILURE');
    } finally { spy.mockRestore(); }
  });

  it('locks the jack on the sheet, so it is down for the scene', async () => {
    await seed({ fix: 0, [skillplugs.FIELD]: [{ skill: 'fix', level: 1 }] });
    const { handlers } = await identified(db);
    const spy = snakeEyes();
    try {
      handlers['requestSheetRoll']({ fieldId: 'fix' });
      await untilValue(() => sheet(), (s) => s[skillplugs.LOCKED_FIELD] === true,
        { label: 'the jack locking' });
    } finally { spy.mockRestore(); }
  });

  it('takes the granted skill down with it', async () => {
    await seed({ fix: 0, [skillplugs.FIELD]: [{ skill: 'fix', level: 1 }] });
    const { handlers } = await identified(db);
    const spy = snakeEyes();
    try {
      handlers['requestSheetRoll']({ fieldId: 'fix' });
      const locked = await untilValue(() => sheet(), (s) => s[skillplugs.LOCKED_FIELD] === true,
        { label: 'the jack locking' });
      // The plug is still loaded - the scene ending brings it back - but it grants
      // nothing while the jack is down.
      expect(skillplugs.loaded(locked)).toHaveLength(1);
      expect(skillplugs.effectiveSkill(locked, 'fix')).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it('does not crash an unplugged character on the same roll', async () => {
    // The identical natural 2 with no plug in: CWN has no general snake-eyes rule, and
    // this must not have invented one.
    await seed({ fix: 0 });
    const { handlers, emitted } = await identified(db);
    const spy = snakeEyes();
    try {
      handlers['requestSheetRoll']({ fieldId: 'fix' });
      const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Fix roll' });
      expect(roll.data.historyString).not.toContain('PLUG CRASH');
      expect((await sheet())[skillplugs.LOCKED_FIELD]).toBeUndefined();
    } finally { spy.mockRestore(); }
  });

  it('does not crash on a roll above the band', async () => {
    await seed({ fix: 0, [skillplugs.FIELD]: [{ skill: 'fix', level: 1 }] });
    const { handlers, emitted } = await identified(db);
    // Every d6 shows 4, so the natural is 8 - nowhere near the band.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    try {
      handlers['requestSheetRoll']({ fieldId: 'fix' });
      const roll = await untilValue(() => lastRoll(emitted), Boolean, { label: 'a Fix roll' });
      expect(roll.data.historyString).not.toContain('PLUG CRASH');
      expect((await sheet())[skillplugs.LOCKED_FIELD]).toBeUndefined();
    } finally { spy.mockRestore(); }
  });
});
