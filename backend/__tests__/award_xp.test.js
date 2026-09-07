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
