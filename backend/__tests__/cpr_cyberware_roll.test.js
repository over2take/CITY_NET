/**
 * Cyberware reaching a sheet roll, through the real socket handler.
 *
 * The effects layer is tested directly and the combat path has its own tests, but the
 * wiring between them — the line in `requestSheetRoll` that pushes cyberware terms onto a
 * resolved formula — had nothing exercising it. That is the failure this file exists for:
 * every piece working, and the roll never asking for any of it.
 *
 * Boots the real sockets module against an in-memory DB, the same way the CWN and SR6
 * socket tests do.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, timeout = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) return;
    await flush(10);
  }
};

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

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (username TEXT PRIMARY KEY, balance REAL, debt REAL)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cyberpunk_red')`);
});

/** A chromed character. `int` and `business` are what the Business roll is built from. */
const seedSheet = (cyberware = []) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', ?, 0)`,
    [JSON.stringify({ int: 4, business: 3, cool: 5, cyberware })]);

const chrome = (mods, extra = {}) => ([{
  name: 'EMP Threading', equipped: true, type: 'fashionware', side: null, mods, ...extra,
}]);

/** Roll `business` and hand back what the tray was told. */
async function rollBusiness() {
  const { handlers, emitted } = boot(db);
  handlers['identify']('GHOST');
  await flush(50);

  handlers['requestSheetRoll']({ fieldId: 'business' });
  await waitFor(() => emitted.some((e) => e.event === 'diceRollBroadcast'));
  return emitted.find((e) => e.event === 'diceRollBroadcast');
}

describe('cyberware in a sheet roll', () => {
  // 1d10 + @int(4) + @business(3), so the modifier total is 7 before any chrome.
  const PLAIN_MODS = 7;

  it('rolls without chrome at stat + skill', async () => {
    await seedSheet();
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('adds a skill modifier to the roll the player actually made', async () => {
    // The wiring this file exists for: the same +6 that shows on the sheet has to reach
    // the dice, and the server is what decides the number.
    await seedSheet(chrome([{ kind: 'skill', target: 'Business', value: 6 }]));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 6]);
  });

  it('adds a stat modifier when the formula uses that stat', async () => {
    await seedSheet(chrome([{ kind: 'stat', target: 'Intelligence', value: 2 }]));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 2]);
  });

  it('applies a set as the difference it makes, not as a bonus', async () => {
    // Business is 3 and the chrome sets it to 1, so the roll is two lower.
    await seedSheet(chrome([{ kind: 'skillSet', target: 'Business', value: 1 }]));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS - 2]);
  });

  it('applies a stat set as the difference it makes', async () => {
    // The fourth kind through this path. INT is 4 and the chrome sets it to 6, so +2.
    await seedSheet(chrome([{ kind: 'statSet', target: 'INT', value: 6 }]));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 2]);
  });

  it('leaves a sheet roll alone for a roll-type modifier', async () => {
    // The fifth kind, and the one that should NOT land here: an Attack modifier belongs to
    // an attack, not to every skill check. It is applied in the combat path instead.
    await seedSheet(chrome([{ kind: 'roll', target: 'Attack', value: 9 }]));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('ignores chrome that modifies something this roll does not use', async () => {
    await seedSheet(chrome([{ kind: 'stat', target: 'Cool', value: 9 }]));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('ignores chrome that is not installed anywhere', async () => {
    await seedSheet(chrome([{ kind: 'skill', target: 'Business', value: 6 }], { type: '' }));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('ignores chrome that is switched off', async () => {
    await seedSheet(chrome([{ kind: 'skill', target: 'Business', value: 6 }], { equipped: false }));
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('never writes the bonus back onto the stored sheet', async () => {
    // The overlay only exists on the way out. If a roll wrote the total back, every
    // subsequent roll would add the bonus again.
    await seedSheet(chrome([{ kind: 'skill', target: 'Business', value: 6 }]));
    await rollBusiness();
    const { get } = await import('./helpers/testDb.js');
    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(row.data).business).toBe(3);
  });
});

describe('a whole loadout in a sheet roll', () => {
  // Every case above carries one piece. A real character carries several, and how they
  // combine is where the interesting failures are.
  const PLAIN_MODS = 7;   // 1d10 + @int(4) + @business(3)

  const piece = (name, mods, extra = {}) =>
    ({ name, equipped: true, type: 'fashionware', side: null, mods, ...extra });

  it('stacks the same skill across two pieces', async () => {
    await seedSheet([
      piece('A', [{ kind: 'skill', target: 'Business', value: 6 }]),
      piece('B', [{ kind: 'skill', target: 'Business', value: 2 }]),
    ]);
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 8]);
  });

  it('adds a stat bonus and a skill bonus from different pieces', async () => {
    // Both are in this formula, so both land: 1d10 + @int + @business.
    await seedSheet([
      piece('Brain', [{ kind: 'stat', target: 'Intelligence', value: 2 }]),
      piece('Threading', [{ kind: 'skill', target: 'Business', value: 6 }]),
    ]);
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 8]);
  });

  it('applies a set from one piece before an adjustment from another', async () => {
    // Business is 3; one piece sets it to 1 and another adds 2, leaving 3 — no change.
    await seedSheet([
      piece('Sets', [{ kind: 'skillSet', target: 'Business', value: 1 }]),
      piece('Adds', [{ kind: 'skill', target: 'Business', value: 2 }]),
    ]);
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('takes the higher of two competing sets', async () => {
    await seedSheet([
      piece('Low', [{ kind: 'skillSet', target: 'Business', value: 1 }]),
      piece('High', [{ kind: 'skillSet', target: 'Business', value: 8 }]),
    ]);
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 5]);
  });

  it('lets a penalty piece cancel a bonus piece', async () => {
    await seedSheet([
      piece('Good', [{ kind: 'skill', target: 'Business', value: 4 }]),
      piece('Bad', [{ kind: 'skill', target: 'Business', value: -4 }]),
    ]);
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS]);
  });

  it('counts only the installed pieces out of a mixed loadout', async () => {
    await seedSheet([
      piece('Installed', [{ kind: 'skill', target: 'Business', value: 2 }]),
      piece('Unplaced', [{ kind: 'skill', target: 'Business', value: 40 }], { type: '' }),
      piece('Off', [{ kind: 'skill', target: 'Business', value: 90 }], { equipped: false }),
      piece('No side', [{ kind: 'skill', target: 'Business', value: 70 }], { type: 'cyberarm', side: null }),
    ]);
    const roll = await rollBusiness();
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 2]);
  });

  it('handles an imported loadout where most pieces do nothing', async () => {
    // Shaped like a real Companion import: eleven pieces, two carrying modifiers.
    const filler = Array.from({ length: 9 }, (_, i) => piece(`Filler ${i}`, []));
    await seedSheet([
      ...filler,
      piece('Threading', [{ kind: 'skill', target: 'Business', value: 6 }]),
      piece('Tattoo', [{ kind: 'stat', target: 'Cool', value: 3 }]),
    ]);
    const roll = await rollBusiness();
    // Only the Business one is in this formula; COOL is not.
    expect(roll.data.modifiers).toEqual([PLAIN_MODS + 6]);
  });
});
