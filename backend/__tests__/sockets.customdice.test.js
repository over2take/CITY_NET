/**
 * Integration tests for the requestCustomDiceRoll socket handler, booting the
 * real sockets module against an in-memory DB.
 *
 * Focus: the die definition must always come from the server (DB for GM dice,
 * code for built-ins) and never from the client payload, and the broadcast must
 * carry `diceSides` so the tray knows what shape to render.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, all, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;

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
    use: () => {},
    join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

const NUMERIC_FACES = [{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }];
const WORD_FACES = [{ value: 'apple' }, { value: 'bannana' }, { value: 'oragne' }, { value: 'peach' }];
const SIGNED_FACES = [
  { value: '+1' }, { value: '+1' }, { value: '-1' },
  { value: '-1' }, { value: '0' }, { value: '0' },
];

let db;

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')`);
});

const insertDie = async (name, sides, faces) => {
  const r = await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)`,
    [name, sides, JSON.stringify(faces)]);
  return r.lastID;
};

const rolls = (emitted) => emitted.filter(e => e.event === 'diceRollBroadcast');

/**
 * Poll until `predicate` returns something truthy, rather than sleeping a fixed span.
 *
 * The handler chains a DB lookup, the roll, an insert and the broadcast. A fixed sleep
 * is a guess at how long that takes: 30ms passed locally every time and failed
 * intermittently on CI, where the runner is slower and more contended.
 */
const waitFor = async (predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** Wait for at least `n` roll broadcasts to land. */
const waitForRolls = (emitted, n = 1) =>
  waitFor(() => (rolls(emitted).length >= n ? rolls(emitted) : null));

/**
 * Absence cannot be polled for, so these keep a real wait — generous enough that a
 * slow runner does not turn "did not roll" into a false pass.
 */
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));


// ─── GM dice (database) ───────────────────────────────────────────────────────

describe('requestCustomDiceRoll — GM dice', () => {
  it('rolls a die stored in the database', async () => {
    const id = await insertDie('punk', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 1, color: '#0f0' });
    await waitForRolls(emitted);

    expect(rolls(emitted)).toHaveLength(1);
    expect(rolls(emitted)[0].data.results).toHaveProperty('punk');
  });

  it('carries diceSides so the tray renders the right shape', async () => {
    // Regression: without this the tray parsed the die name as a side count,
    // got NaN, and rendered no dice at all.
    const id = await insertDie('punk', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 1, color: '#0f0' });
    await waitForRolls(emitted);

    expect(rolls(emitted)[0].data.diceSides).toEqual({ punk: 4 });
  });

  it('only ever returns faces the die actually has', async () => {
    const id = await insertDie('punk', 4, WORD_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 20, color: '#0f0' });
    await waitForRolls(emitted);

    const allowed = WORD_FACES.map(f => f.value);
    for (const v of rolls(emitted)[0].data.results.punk) {
      expect(allowed).toContain(v);
    }
  });

  it('sums the roll when every face is numeric', async () => {
    const id = await insertDie('nums', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 3, color: '#0f0' });
    await waitForRolls(emitted);

    const { total, results } = rolls(emitted)[0].data;
    const expected = results.nums.reduce((a, v) => a + Number(v), 0);
    expect(total).toBe(expected);
  });

  it('treats signed faces as numeric so they still total', async () => {
    const id = await insertDie('dF', 6, SIGNED_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 4, color: '#0f0' });
    await waitForRolls(emitted);

    const { total, results } = rolls(emitted)[0].data;
    expect(total).toBe(results.dF.reduce((a, v) => a + Number(v), 0));
    expect(total).toBeGreaterThanOrEqual(-4);
    expect(total).toBeLessThanOrEqual(4);
  });

  it('reports a total of 0 and lists faces when they are not numeric', async () => {
    const id = await insertDie('punk', 4, WORD_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 2, color: '#0f0' });
    await waitForRolls(emitted);

    const { total, historyString } = rolls(emitted)[0].data;
    expect(total).toBe(0);
    // Comma-joined list rather than a summed expression
    expect(historyString).toMatch(/\[[^\]]*,[^\]]*\]/);
    expect(historyString).not.toMatch(/=/);
  });

  it('rolls the requested number of dice', async () => {
    const id = await insertDie('nums', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 5, color: '#0f0' });
    await waitForRolls(emitted);

    expect(rolls(emitted)[0].data.results.nums).toHaveLength(5);
  });

  it('clamps the count to at most 20', async () => {
    const id = await insertDie('nums', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 5000, color: '#0f0' });
    await waitForRolls(emitted);

    expect(rolls(emitted)[0].data.results.nums).toHaveLength(20);
  });

  it('treats a missing or junk count as one die', async () => {
    const id = await insertDie('nums', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, color: '#0f0' });
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 'lots', color: '#0f0' });
    await waitForRolls(emitted, 2);

    for (const r of rolls(emitted)) expect(r.data.results.nums).toHaveLength(1);
  });

  it('persists the roll to dice_rolls', async () => {
    const id = await insertDie('nums', 4, NUMERIC_FACES);
    const { handlers } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 1, color: '#0f0' });
    await waitFor(() => get(db, 'SELECT * FROM dice_rolls ORDER BY id DESC LIMIT 1'));

    const row = await get(db, 'SELECT * FROM dice_rolls ORDER BY id DESC LIMIT 1');
    expect(row.username).toBe('GHOST');
    expect(JSON.parse(row.results)).toHaveProperty('nums');
  });
});

// ─── Built-in (system) dice ───────────────────────────────────────────────────

describe('requestCustomDiceRoll — built-in dice', () => {
  it('resolves a builtin id from code without touching the database', async () => {
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: 'builtin:fate_df', count: 4, color: '#0f0' });
    await settle();

    expect(rolls(emitted)).toHaveLength(1);
    expect(rolls(emitted)[0].data.results.dF).toHaveLength(4);
    expect(await all(db, 'SELECT * FROM custom_dice')).toHaveLength(0);
  });

  it('sums 4dF to the Fate ladder', async () => {
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: 'builtin:fate_df', count: 4, color: '#0f0' });
    await waitForRolls(emitted);

    const { total } = rolls(emitted)[0].data;
    expect(total).toBeGreaterThanOrEqual(-4);
    expect(total).toBeLessThanOrEqual(4);
  });

  it('reports 6 sides for dF', async () => {
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: 'builtin:fate_df', count: 1, color: '#0f0' });
    await waitForRolls(emitted);

    expect(rolls(emitted)[0].data.diceSides).toEqual({ dF: 6 });
  });

  it('ignores an unknown builtin id', async () => {
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: 'builtin:nope', count: 1, color: '#0f0' });
    await settle();

    expect(rolls(emitted)).toHaveLength(0);
  });

  it('does not fall through to the DB for a builtin id', async () => {
    // A DB row whose id could collide numerically must not be reachable via a
    // builtin-namespaced id.
    await insertDie('decoy', 4, NUMERIC_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: 'builtin:decoy', count: 1, color: '#0f0' });
    await settle();

    expect(rolls(emitted)).toHaveLength(0);
  });
});

// ─── Bad input ────────────────────────────────────────────────────────────────

describe('requestCustomDiceRoll — bad input', () => {
  it('ignores a die id that does not exist', async () => {
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: 9999, count: 1, color: '#0f0' });
    await settle();

    expect(rolls(emitted)).toHaveLength(0);
  });

  it('ignores a missing die id', async () => {
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', count: 1, color: '#0f0' });
    await settle();

    expect(rolls(emitted)).toHaveLength(0);
  });

  it('ignores a client-supplied die definition', async () => {
    // The payload carries only an id; faces sent by a client must be ignored.
    const id = await insertDie('punk', 4, WORD_FACES);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({
      userName: 'GHOST', dieId: id, count: 1, color: '#0f0',
      die: { name: 'forged', sides: 1, faces: [{ value: '9999' }] },
    });
    await waitForRolls(emitted);

    const { results } = rolls(emitted)[0].data;
    expect(results).not.toHaveProperty('forged');
    expect(WORD_FACES.map(f => f.value)).toContain(results.punk[0]);
  });

  it('survives a row with malformed faces JSON', async () => {
    await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES ('broken', 4, 'not json')`);
    const row = await get(db, `SELECT id FROM custom_dice WHERE name = 'broken'`);
    const { handlers, emitted } = boot(db);
    expect(() => handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: row.id, count: 1, color: '#0f0' })).not.toThrow();
    await settle();

    expect(rolls(emitted)).toHaveLength(0);
  });

  it('ignores a die whose faces array is empty', async () => {
    const id = await insertDie('empty', 4, []);
    const { handlers, emitted } = boot(db);
    handlers['requestCustomDiceRoll']({ userName: 'GHOST', dieId: id, count: 1, color: '#0f0' });
    await settle();

    expect(rolls(emitted)).toHaveLength(0);
  });
});
