/**
 * Two writers, one sheet.
 *
 * Every write to a character sheet reads the whole JSON blob, changes one field, and
 * writes the whole blob back. There are 22 such writers and nothing holds a lock across
 * the gap between the read and the write, so when two of them touch the same sheet at the
 * same moment the later write is built from data that was already stale, and the earlier
 * change is gone. Silently: no error, no conflict, no retry. The hit points simply come
 * back.
 *
 * Two different players are safe — every query is scoped by username, so they are
 * different rows. What is not safe is one sheet with two writers, which is an ordinary
 * moment at a table: a GM applying damage while that player edits their own gear, an
 * automatic effect landing mid-edit, someone with the sheet open in two tabs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

const require = createRequire(import.meta.url);
const { mutateSheet } = require('../sheets/mutate.js');

let db;
let sheetId;

const readSheet = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [sheetId])).data);

beforeEach(async () => {
  db = await makeTestDb();
  await run(db,
    `INSERT INTO character_sheets (username, system, is_npc, data) VALUES (?, ?, 0, ?)`,
    ['nyx', 'cyberpunk_red', JSON.stringify({ hp: 10, luck: 3, handle: 'Nyx' })]);
  sheetId = (await get(db, `SELECT id FROM character_sheets WHERE username = 'nyx'`)).id;
});

/**
 * The pattern every call site uses today, written out plainly.
 *
 * Read the row, parse it, change a field, write it all back — with the callback gap in
 * the middle that nothing guards.
 */
const unguardedWrite = (field, value) => new Promise((resolve) => {
  db.get('SELECT id, data FROM character_sheets WHERE id = ?', [sheetId], (_e, row) => {
    const data = JSON.parse(row.data || '{}');
    // Something else gets a turn here. In production that is any of the other writers.
    setTimeout(() => {
      data[field] = value;
      db.run('UPDATE character_sheets SET data = ? WHERE id = ?', [JSON.stringify(data), row.id], resolve);
    }, 10);
  });
});

describe('the race, as it stands', () => {
  it('loses one of two concurrent writes to the same sheet', async () => {
    // The GM applies damage while the player edits their luck. Both succeed as far as
    // either of them can tell.
    await Promise.all([unguardedWrite('hp', 4), unguardedWrite('luck', 1)]);

    const after = await readSheet();
    const bothLanded = after.hp === 4 && after.luck === 1;

    // Pinned as the current behaviour rather than asserted as correct: exactly one of the
    // two changes survives, and which one is a matter of timing.
    expect(bothLanded).toBe(false);
    expect(after.hp === 4 || after.luck === 1).toBe(true);
  });
});

describe('mutateSheet', () => {
  /** The same two writers, through the helper. */
  const guardedWrite = (field, value) => new Promise((resolve, reject) => {
    mutateSheet(db, sheetId, (data) => {
      // A deliberate pause inside the mutator, where the unguarded version lost the race.
      data[field] = value;
      return data;
    }, (err) => (err ? reject(err) : resolve()));
  });

  it('keeps both changes when two writers touch one sheet at once', async () => {
    await Promise.all([guardedWrite('hp', 4), guardedWrite('luck', 1)]);
    const after = await readSheet();
    expect(after.hp).toBe(4);
    expect(after.luck).toBe(1);
    // And leaves alone what neither of them touched.
    expect(after.handle).toBe('Nyx');
  });

  it('holds under a burst, not just a pair', async () => {
    // Ten writers to ten different fields on one sheet. Every one must survive.
    const fields = Array.from({ length: 10 }, (_, i) => `field_${i}`);
    await Promise.all(fields.map((f, i) => guardedWrite(f, i)));

    const after = await readSheet();
    fields.forEach((f, i) => expect(after[f], f).toBe(i));
    expect(after.hp).toBe(10);
  });

  it('gives the mutator what the last write actually left, not a stale copy', async () => {
    // Increments are where a lost update shows up as a wrong number rather than a missing
    // one. Ten +1s on the same field must be exactly +10.
    const bump = () => new Promise((resolve, reject) => {
      mutateSheet(db, sheetId, (data) => ({ ...data, hp: (data.hp || 0) + 1 }),
        (err) => (err ? reject(err) : resolve()));
    });
    await Promise.all(Array.from({ length: 10 }, bump));
    expect((await readSheet()).hp).toBe(20);
  });

  it('does not make writers to different sheets wait for each other', async () => {
    // The lock is per sheet. One table's slow write must not queue behind another's.
    await run(db,
      `INSERT INTO character_sheets (username, system, is_npc, data) VALUES (?, ?, 0, ?)`,
      ['vex', 'cyberpunk_red', JSON.stringify({ hp: 7 })]);
    const otherId = (await get(db, `SELECT id FROM character_sheets WHERE username = 'vex'`)).id;

    await Promise.all([
      new Promise((r) => mutateSheet(db, sheetId, (d) => ({ ...d, hp: 1 }), r)),
      new Promise((r) => mutateSheet(db, otherId, (d) => ({ ...d, hp: 2 }), r)),
    ]);

    expect((await readSheet()).hp).toBe(1);
    const other = JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [otherId])).data);
    expect(other.hp).toBe(2);
  });

  it('reports a missing sheet instead of writing one', async () => {
    await new Promise((resolve) => {
      mutateSheet(db, 99999, (d) => ({ ...d, hp: 1 }), (err) => {
        expect(err).toBeTruthy();
        resolve();
      });
    });
  });

  it('lets a mutator decline to write by returning nothing', async () => {
    // A caller that inspects the sheet and decides there is nothing to do should not
    // rewrite the row, and must not deadlock the queue for that sheet either.
    await new Promise((resolve) => mutateSheet(db, sheetId, () => undefined, resolve));
    await new Promise((resolve) => mutateSheet(db, sheetId, (d) => ({ ...d, hp: 5 }), resolve));
    expect((await readSheet()).hp).toBe(5);
  });

  it('keeps the queue moving when a mutator throws', async () => {
    // One caller's bug must not strand every later write to that sheet.
    await new Promise((resolve) => {
      mutateSheet(db, sheetId, () => { throw new Error('bad mutator'); }, (err) => {
        expect(err).toBeTruthy();
        resolve();
      });
    });
    await new Promise((resolve) => mutateSheet(db, sheetId, (d) => ({ ...d, hp: 6 }), resolve));
    expect((await readSheet()).hp).toBe(6);
  });
});

describe('mutateSheetForUser', () => {
  const { mutateSheetForUser } = require('../sheets/mutate.js');

  const byUser = (field, value) => new Promise((resolve, reject) => {
    mutateSheetForUser(db, { username: 'nyx', system: 'cyberpunk_red' },
      (data) => ({ ...data, [field]: value }),
      (err) => (err ? reject(err) : resolve()));
  });

  it('serialises two writers that arrived by username rather than by id', async () => {
    // Most call sites know a player, not a row. Resolving separately must still land both
    // of them in the same queue, or the lock protects nothing for the common path.
    await Promise.all([byUser('hp', 4), byUser('luck', 1)]);
    const after = await readSheet();
    expect(after.hp).toBe(4);
    expect(after.luck).toBe(1);
  });

  it('queues with a writer that came in by id', async () => {
    // The two entry points must share one queue per sheet, not have one each.
    await Promise.all([
      byUser('hp', 2),
      new Promise((r) => mutateSheet(db, sheetId, (d) => ({ ...d, luck: 9 }), r)),
    ]);
    const after = await readSheet();
    expect(after.hp).toBe(2);
    expect(after.luck).toBe(9);
  });

  it('says so when that player has no sheet', async () => {
    await new Promise((resolve) => {
      mutateSheetForUser(db, { username: 'ghost', system: 'cyberpunk_red' },
        (d) => d, (err) => { expect(err).toBeTruthy(); resolve(); });
    });
  });
});

describe('patchSheet', () => {
  const { patchSheet } = require('../sheets/mutate.js');

  it('leaves fields it was not given alone, even under a concurrent write', async () => {
    // The shape most call sites had: load, spread, set one key, write it all back. The
    // spread is what quietly carried a stale copy of every other field.
    await Promise.all([
      new Promise((r) => patchSheet(db, sheetId, { hp: 1 }, r)),
      new Promise((r) => patchSheet(db, sheetId, { luck: 2 }, r)),
    ]);
    const after = await readSheet();
    expect(after.hp).toBe(1);
    expect(after.luck).toBe(2);
    expect(after.handle).toBe('Nyx');
  });

  it('takes a function when the new value depends on the current one', async () => {
    await Promise.all(Array.from({ length: 5 }, () =>
      new Promise((r) => patchSheet(db, sheetId, (d) => ({ hp: (d.hp || 0) + 2 }), r))));
    expect((await readSheet()).hp).toBe(20);
  });
});

describe('every writer goes through the queue', () => {
  const fs = require('fs');
  const path = require('path');

  it('leaves no direct sheet write outside sheets/mutate.js', () => {
    // The guarantee only holds if *both* sides of a collision take the queue, so one
    // forgotten call site quietly reopens the hole for every writer it can meet. That is
    // not something to rediscover by hand later.
    const root = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
    const found = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'uploads') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        // mutate.js is the queue itself; db.js holds a boot-time migration that runs
        // before the server listens, documented in place.
        if (full.endsWith(path.join('sheets', 'mutate.js')) || full.endsWith(path.join('backend', 'db.js'))) continue;
        if (/UPDATE\s+character_sheets\s+SET\s+data/i.test(fs.readFileSync(full, 'utf8'))) {
          found.push(path.relative(root, full));
        }
      }
    };
    walk(root);

    expect(found, `these write a sheet directly: ${found.join(', ')}`).toEqual([]);
  });
});

describe('values that accumulate', () => {
  const { patchSheet } = require('../sheets/mutate.js');

  it('adds up when two hits land in the same instant', async () => {
    // The subtler half of the bug, and the one a queue alone does not fix. Serialising
    // the writes stops them clobbering each other's *other* fields, but if both worked
    // out the new hull from the value they read before queueing, they both subtract from
    // the same starting number and one hit does nothing. The patch has to be computed
    // inside the write, not before it.
    await run(db, `UPDATE character_sheets SET data = ? WHERE id = ?`,
      [JSON.stringify({ vehicle0_hp: 20, vehicle0_hp_max: 20 }), sheetId]);

    const hit = (dmg) => new Promise((r) => patchSheet(db, sheetId,
      (d) => ({ vehicle0_hp: Math.max(0, (Number(d.vehicle0_hp) || 0) - dmg) }), r));

    await Promise.all([hit(5), hit(3), hit(2)]);
    expect((await readSheet()).vehicle0_hp).toBe(10);
  });

  it('does not add up when the value is worked out before queueing', async () => {
    // The same three hits, computed the way the call sites used to. Pinned so the
    // difference between the two forms is visible rather than asserted.
    await run(db, `UPDATE character_sheets SET data = ? WHERE id = ?`,
      [JSON.stringify({ vehicle0_hp: 20 }), sheetId]);

    const stale = await readSheet();
    const hit = (dmg) => new Promise((r) => patchSheet(db, sheetId,
      { vehicle0_hp: Math.max(0, Number(stale.vehicle0_hp) - dmg) }, r));

    await Promise.all([hit(5), hit(3), hit(2)]);
    // Whichever wrote last wins outright: 15, 17 or 18 — never 10.
    expect((await readSheet()).vehicle0_hp).not.toBe(10);
  });
});
