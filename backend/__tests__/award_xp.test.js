import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, run } from './helpers/testDb.js';

const xp = require('../sheets/awardXp');

/**
 * Awarding experience (CWN p44).
 *
 * Modelled on Pay Players and deliberately different in one way: money is a pot the GM
 * splits between whoever was on the job, experience is per character. Divide it and a
 * full party earns less each than a pair would, which is the opposite of the rule.
 */

let db;

const sheet = (username, data, system = 'cities_without_number') =>
  run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)',
    [username, system, JSON.stringify(data)]);

const readXp = (username, system = 'cities_without_number') => new Promise((resolve) => {
  db.get('SELECT data FROM character_sheets WHERE username = ? AND system = ?', [username, system],
    (e, row) => resolve(row ? JSON.parse(row.data).xp : undefined));
});

const award = (opts) => new Promise((resolve) => {
  xp.awardXp(db, opts, (reason, results) => resolve({ reason, results }));
});

beforeEach(async () => { db = await makeTestDb(); });

describe('which systems have experience at all', () => {
  it('knows where Cities Without Number keeps it', () => {
    expect(xp.xpFieldFor('cities_without_number')).toBe('xp');
    expect(xp.supportsXp('cities_without_number')).toBe(true);
  });

  it('claims nothing for a system with a different currency', () => {
    // Cyberpunk RED spends Improvement Points and Shadowrun spends Karma. Both are real
    // and neither is this, so awarding into them would be inventing a rule.
    for (const s of ['cyberpunk_red', 'shadowrun_6e', 'generic', '', null]) {
      expect(xp.xpFieldFor(s), String(s)).toBeNull();
      expect(xp.supportsXp(s), String(s)).toBe(false);
    }
  });
});

describe('what an award does to one total', () => {
  it('adds', () => {
    expect(xp.applyAward(4, 3)).toEqual({ from: 4, to: 7, delta: 3 });
  });

  it('takes away', () => {
    expect(xp.applyAward(9, -4)).toEqual({ from: 9, to: 5, delta: -4 });
  });

  it('never leaves anyone owing experience', () => {
    // Taking 5 from a character with 2 leaves them at 0, and says only 2 moved.
    expect(xp.applyAward(2, -5)).toEqual({ from: 2, to: 0, delta: -2 });
  });

  it('reads a sheet that has never had any', () => {
    expect(xp.applyAward(undefined, 3).to).toBe(3);
    expect(xp.applyAward('nonsense', 3).to).toBe(3);
  });
});

describe('what it refuses', () => {
  const cases = [
    ['a system with no experience', { system: 'cyberpunk_red', usernames: ['a'], amount: 3 }],
    ['nobody selected', { system: 'cities_without_number', usernames: [], amount: 3 }],
    ['no list at all', { system: 'cities_without_number', usernames: null, amount: 3 }],
    ['an amount that is not a number', { system: 'cities_without_number', usernames: ['a'], amount: 'lots' }],
    ['zero, which is always a mistake', { system: 'cities_without_number', usernames: ['a'], amount: 0 }],
    ['a fraction, since experience is whole points', { system: 'cities_without_number', usernames: ['a'], amount: 1.5 }],
  ];

  for (const [what, opts] of cases) {
    it(`refuses ${what}, with a reason`, async () => {
      const { reason, results } = await award(opts);
      expect(reason, what).toBeTruthy();
      expect(results).toBeNull();
    });
  }
});

describe('awarding a party', () => {
  it('gives each character the full amount, not a share of it', async () => {
    // The whole reason this is not Pay Players. Three points each, not one apiece.
    await sheet('ghost', { xp: 0 });
    await sheet('nyx', { xp: 4 });
    await sheet('sam', { xp: 10 });

    const { reason } = await award({
      system: 'cities_without_number', usernames: ['ghost', 'nyx', 'sam'], amount: 3,
    });

    expect(reason).toBeNull();
    expect(await readXp('ghost')).toBe(3);
    expect(await readXp('nyx')).toBe(7);
    expect(await readXp('sam')).toBe(13);
  });

  it('takes it back the same way', async () => {
    await sheet('ghost', { xp: 9 });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: -4 });
    expect(await readXp('ghost')).toBe(5);
  });

  it('floors at zero rather than going negative', async () => {
    await sheet('ghost', { xp: 2 });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: -5 });
    expect(await readXp('ghost')).toBe(0);
  });

  it('leaves the rest of the sheet alone', async () => {
    // An award must not be a sheet rewrite: everything else comes back untouched.
    await sheet('ghost', { xp: 1, name: 'Ghost', level: 2, str: 14, languages: '["Cantonese"]' });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: 2 });

    const row = await new Promise((res) => db.get(
      'SELECT data FROM character_sheets WHERE username = ?', ['ghost'], (e, r) => res(JSON.parse(r.data))));
    expect(row).toMatchObject({ xp: 3, name: 'Ghost', level: 2, str: 14, languages: '["Cantonese"]' });
  });

  it('says which names did nothing rather than failing quietly', async () => {
    // On a night when the GM awards the party and one name does nothing, they are told.
    await sheet('ghost', { xp: 0 });
    const { results } = await award({
      system: 'cities_without_number', usernames: ['ghost', 'nobody'], amount: 3,
    });

    expect(results.find((r) => r.username === 'ghost')).toMatchObject({ ok: true, xp: 3 });
    expect(results.find((r) => r.username === 'nobody')).toMatchObject({ ok: false });
  });

  it('still awards everyone else when one name has no sheet', async () => {
    await sheet('ghost', { xp: 0 });
    await award({ system: 'cities_without_number', usernames: ['nobody', 'ghost'], amount: 5 });
    expect(await readXp('ghost')).toBe(5);
  });

  it('does not touch a sheet on another system', async () => {
    // The active system decides. A Cyberpunk sheet under the same name is a different
    // character and has no xp field to move.
    await sheet('ghost', { xp: 0 });
    await sheet('ghost', { improvement_points: 5 }, 'cyberpunk_red');
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: 3 });

    expect(await readXp('ghost')).toBe(3);
    expect(await readXp('ghost', 'cyberpunk_red')).toBeUndefined();
  });
});

describe('moving a character up or down a level', () => {
  const level = (opts) => new Promise((resolve) => {
    xp.adjustLevel(db, opts, (reason, results) => resolve({ reason, results }));
  });
  const readLevel = (username) => new Promise((resolve) => {
    db.get('SELECT data FROM character_sheets WHERE username = ?', [username],
      (e, row) => resolve(row ? JSON.parse(row.data).level : undefined));
  });

  it('steps down', async () => {
    await sheet('ghost', { level: 4, xp: 20 });
    await level({ system: 'cities_without_number', usernames: ['ghost'], delta: -1 });
    expect(await readLevel('ghost')).toBe(3);
  });

  it('steps up', async () => {
    await sheet('ghost', { level: 4 });
    await level({ system: 'cities_without_number', usernames: ['ghost'], delta: 1 });
    expect(await readLevel('ghost')).toBe(5);
  });

  it('stops at the levels the book has', async () => {
    // 1 is where operators start and 10 is the top of the table. Outside those the
    // thresholds have nothing behind them.
    expect(xp.applyLevel(1, -1)).toEqual({ from: 1, to: 1, delta: 0 });
    expect(xp.applyLevel(10, 1)).toEqual({ from: 10, to: 10, delta: 0 });
    await sheet('ghost', { level: 1 });
    await level({ system: 'cities_without_number', usernames: ['ghost'], delta: -1 });
    expect(await readLevel('ghost')).toBe(1);
  });

  it('reads a blank level as 1, like the sheet does', () => {
    expect(xp.applyLevel(undefined, 1).to).toBe(2);
    expect(xp.applyLevel(0, 1).to).toBe(2);
  });

  it('leaves experience alone', async () => {
    // The two are separate on purpose: taking a level back does not un-earn the XP, and
    // the skill points that came with the level do not undo themselves either.
    await sheet('ghost', { level: 4, xp: 20 });
    await level({ system: 'cities_without_number', usernames: ['ghost'], delta: -1 });
    expect(await readXp('ghost')).toBe(20);
  });

  it('refuses a system with no levels, and a change of zero', async () => {
    expect((await level({ system: 'cyberpunk_red', usernames: ['a'], delta: 1 })).reason).toBeTruthy();
    expect((await level({ system: 'cities_without_number', usernames: ['a'], delta: 0 })).reason).toBeTruthy();
    expect((await level({ system: 'cities_without_number', usernames: [], delta: 1 })).reason).toBeTruthy();
  });

  it('reports each character, and names one with no sheet', async () => {
    await sheet('ghost', { level: 2 });
    const { results } = await level({
      system: 'cities_without_number', usernames: ['ghost', 'nobody'], delta: 1,
    });
    expect(results.find((r) => r.username === 'ghost')).toMatchObject({ ok: true, level: 3 });
    expect(results.find((r) => r.username === 'nobody')).toMatchObject({ ok: false });
  });
});

describe('the level follows the experience', () => {
  const readLevel = (username) => new Promise((resolve) => {
    db.get('SELECT data FROM character_sheets WHERE username = ?', [username],
      (e, row) => resolve(row ? JSON.parse(row.data).level : undefined));
  });

  it('climbs as far as the total reaches, not one step', async () => {
    // The bug this exists for: 3 XP a session, four sessions, and the character sat at
    // level 1 with the bar reading READY FOR 2 forever. 12 XP is level 4 on fast.
    await sheet('ghost', { level: 1, xp: 0 });
    for (let i = 0; i < 4; i += 1) {
      await award({ system: 'cities_without_number', usernames: ['ghost'], amount: 3, rate: 'fast' });
    }
    expect(await readXp('ghost')).toBe(12);
    expect(await readLevel('ghost')).toBe(4);
  });

  it('gets there the same way in one award as in four', async () => {
    await sheet('nyx', { level: 1, xp: 0 });
    await award({ system: 'cities_without_number', usernames: ['nyx'], amount: 12, rate: 'fast' });
    expect(await readLevel('nyx')).toBe(4);
  });

  it('follows the slow column when the table uses it', async () => {
    // 12 XP is only level 2 on slow, where level 3 costs 15.
    await sheet('ghost', { level: 1, xp: 0 });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: 12, rate: 'slow' });
    expect(await readLevel('ghost')).toBe(2);
  });

  it('stops at the top of the table', async () => {
    await sheet('ghost', { level: 1, xp: 0 });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: 500, rate: 'fast' });
    expect(await readLevel('ghost')).toBe(10);
  });

  it('never takes a level away when experience is removed', async () => {
    // A level is not un-earned: the skill points and Focus that came with it do not undo
    // themselves. Correcting one is deliberate, which is what LEVEL_DOWN is for.
    await sheet('ghost', { level: 4, xp: 12 });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: -12, rate: 'fast' });
    expect(await readXp('ghost')).toBe(0);
    expect(await readLevel('ghost')).toBe(4);
  });

  it('leaves a level a GM set by hand above the earned one', async () => {
    // A GM may put an NPC at level 6 with no XP at all. An award must not demote them.
    await sheet('ghost', { level: 6, xp: 0 });
    await award({ system: 'cities_without_number', usernames: ['ghost'], amount: 3, rate: 'fast' });
    expect(await readLevel('ghost')).toBe(6);
  });

  it('reports the level it reached', async () => {
    await sheet('ghost', { level: 1, xp: 0 });
    const { results } = await award({
      system: 'cities_without_number', usernames: ['ghost'], amount: 6, rate: 'fast',
    });
    expect(results[0]).toMatchObject({ ok: true, xp: 6, level: 3 });
  });

  it('works the thresholds the book prints', () => {
    const at = (xp, rate) => xp.level;
    expect(xp.levelForXp(0, 'fast')).toBe(1);
    expect(xp.levelForXp(3, 'fast')).toBe(2);
    expect(xp.levelForXp(5, 'fast')).toBe(2);
    expect(xp.levelForXp(6, 'fast')).toBe(3);
    expect(xp.levelForXp(93, 'fast')).toBe(10);
    expect(xp.levelForXp(6, 'slow')).toBe(2);
    expect(xp.levelForXp(139, 'slow')).toBe(10);
  });
});
