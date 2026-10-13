/**
 * GIVE ITEM's GIVEN list (4g2c): a line per GIVE, naming who got it, the last 50 in each game.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

const require_ = createRequire(import.meta.url);
const givenList = require_('../sheets/givenList');

const CWN = 'cities_without_number';
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const line = (n, extra = {}) => ({ system: CWN, by: 'gm', catalogue: 'gear', item: `Thing ${n}`, qty: 1, to: ['Vex'], note: '', ...extra });

let db;
beforeEach(async () => { db = await makeTestDb(); });

describe('the GIVEN list', () => {
  it('keeps who gave what to whom, newest first', async () => {
    await givenList.record(db, line(1));
    const list = await givenList.record(db, line(2, { by: 'ghost', catalogue: 'weapons', qty: 3, to: ['Vex', 'GANGER'], note: 'For the job.' }));
    expect(list).toEqual([
      { id: 2, at: expect.any(String), by: 'ghost', catalogue: 'weapons', item: 'Thing 2', qty: 3, to: ['Vex', 'GANGER'], note: 'For the job.' },
      { id: 1, at: expect.any(String), by: 'gm', catalogue: 'gear', item: 'Thing 1', qty: 1, to: ['Vex'], note: '' },
    ]);
    expect(await givenList.recent(db, CWN)).toEqual(list);
  });

  it('writes nothing for a GIVE nobody got', async () => {
    expect(await givenList.record(db, line(1, { to: [] }))).toEqual([]);
  });

  it('keeps the last 50 of each game, and another game\'s gifts never push them out', async () => {
    for (let n = 1; n <= 52; n += 1) await givenList.record(db, line(n));
    await givenList.record(db, line(1, { system: HEARTH }));
    for (let n = 53; n <= 55; n += 1) await givenList.record(db, line(n, { system: HEARTH }));
    // Stored, not just shown: the oldest are gone from the table.
    const stored = async (system) => (await get(db, 'SELECT COUNT(*) AS n FROM given_items WHERE system = ?', [system])).n;
    expect(await stored(CWN)).toBe(50);
    await givenList.record(db, line(52, { item: 'Thing 52 again' }));
    expect([await stored(CWN), await stored(HEARTH)]).toEqual([50, 4]);
    await givenList.record(db, line(52));
    const cwn = await givenList.recent(db, CWN);
    expect(cwn).toHaveLength(givenList.LIMIT);
    expect([cwn[0].item, cwn[1].item, cwn[49].item]).toEqual(['Thing 52', 'Thing 52 again', 'Thing 5']);
    expect((await givenList.recent(db, HEARTH)).map((l) => l.item)).toEqual(['Thing 55', 'Thing 54', 'Thing 53', 'Thing 1']);
    expect(givenList.LIMIT).toBe(50);
  });

  it('reads names it can\'t make sense of as nobody', async () => {
    await run(db, `INSERT INTO given_items (system, given_by, catalogue, item, recipients) VALUES (?, 'gm', 'gear', 'Odd', ?), (?, 'gm', 'gear', 'Odder', ?)`,
      [CWN, '{nope', CWN, JSON.stringify(['Vex', 7, null])]);
    expect((await givenList.recent(db, CWN)).map((l) => [l.item, l.to, l.qty, l.note])).toEqual([['Odder', ['Vex'], 1, ''], ['Odd', [], 1, '']]);
  });
});
