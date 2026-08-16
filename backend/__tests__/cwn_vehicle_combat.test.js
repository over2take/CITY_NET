/**
 * Shooting at someone who is sitting in a car.
 *
 * The vehicle is sheet data with no presence on the map, so none of this can work by
 * the attack looking at the target token — it has to read the defender's sheet before
 * it rolls, which is the one structural change underneath all of these.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';

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
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  // Trauma multiplies damage on a die roll, which would make every damage assertion
  // below probabilistic. The rule is tested on its own elsewhere.
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_trauma', '0')`);
});

// BHB 30 puts the to-hit at 31 or better: a guaranteed hit against anything reasonable.
// The damage die stays random, so every assertion below is written against the damage the
// server reports rather than a number picked in advance.
const ATTACKER = {
  base_hit_bonus: 30, shoot: 1, dex_mod: 0,
  weapon1_name: 'Pistol', weapon1_dmg: '1d6', weapon1_skill: 'shoot', weapon1_atk: 0,
};

const sheet = (username, data) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, 'cities_without_number', ?, 0)`,
    [username, JSON.stringify(data)]);

const token = (username, hp = 30) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max)
           VALUES (?, 0, 0, 0, 'rhombus', ?, 10, 10, ?, ?)`, [username, username, hp, hp]);

/** AR 3, AC 12 base, and enough HP to survive one hit so damage can be checked. */
const CAR_HP = 100;
const CAR = {
  vehicle1_name: 'Kestrel', vehicle1_hp_max: CAR_HP, vehicle1_armor: 3, vehicle1_ac: 12,
};

const attack = async (extra = {}) => {
  const { handlers, emitted } = boot(db);
  handlers['identify']('GHOST');
  await flush(50);
  const targetRow = await get(db, `SELECT id FROM locations WHERE owner = 'MOUSE'`);
  handlers['sheetAttack']({ targetId: targetRow.id, weaponIndex: 1, ...extra });
  await waitFor(() => emitted.some(e => e.event === 'attackResult'));
  return {
    result: emitted.find(e => e.event === 'attackResult').data,
    history: emitted.filter(e => e.event === 'diceRollBroadcast').map(r => r.data.historyString),
  };
};

/** The refusal path emits an error instead of an attackResult, so it needs its own wait. */
const attackExpectingError = async (extra = {}) => {
  const { handlers, emitted } = boot(db);
  handlers['identify']('GHOST');
  await flush(50);
  const targetRow = await get(db, `SELECT id FROM locations WHERE owner = 'MOUSE'`);
  handlers['sheetAttack']({ targetId: targetRow.id, ...extra });
  await waitFor(() => emitted.some(e => e.event === 'sheetAttackError'));
  return { errors: emitted.filter(e => e.event === 'sheetAttackError').map(e => e.data) };
};

const vehicleHp = async (username) => {
  const row = await get(db, `SELECT data FROM character_sheets WHERE username = ?`, [username]);
  return JSON.parse(row.data).vehicle1_hp;
};
const tokenHp = async (username) => {
  const row = await get(db, `SELECT hp_current FROM locations WHERE owner = ?`, [username]);
  return row.hp_current;
};

beforeEach(async () => {
  await sheet('GHOST', ATTACKER);
  await token('GHOST');
});

describe('attacking someone inside a vehicle', () => {
  it('hits the vehicle, not the person', async () => {
    await sheet('MOUSE', { ...CAR, in_vehicle: 'own:1' });
    await token('MOUSE');

    const { result } = await attack();
    expect(result.hit).toBe(true);
    // Armour Rating is subtraction, not avoidance: what is left lands on the car.
    expect(result.through).toBe(Math.max(0, result.damage - 3));
    expect(await vehicleHp('MOUSE')).toBe(CAR_HP - result.through);
    expect(result.vehicleHp).toBe(CAR_HP - result.through);
    // The person inside is untouched.
    expect(await tokenHp('MOUSE')).toBe(30);
  });

  it('lets armour eat a hit entirely', async () => {
    await sheet('MOUSE', { ...CAR, vehicle1_armor: 10, in_vehicle: 'own:1' });
    await token('MOUSE');

    // AR 10 against a 1d6 weapon: nothing can get through.
    const { history, result } = await attack();
    expect(result.through).toBe(0);
    expect(await vehicleHp('MOUSE')).toBe(CAR_HP);
    expect(await tokenHp('MOUSE')).toBe(30);
    // Otherwise a hit that did nothing reads as a bug rather than as armour.
    expect(history.some(h => /ARMOR HELD/.test(h))).toBe(true);
  });

  it('takes -4 to AC while stationary and adds Drive while moving', async () => {
    await sheet('MOUSE', { ...CAR, in_vehicle: 'own:1', drive: 2 });
    await token('MOUSE');
    expect((await attack()).result.ac).toBe(8);

    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'MOUSE'`,
      [JSON.stringify({ ...CAR, in_vehicle: 'own:1', drive: 2, vehicle1_moving: '1' })]);
    expect((await attack()).result.ac).toBe(14);
  });

  it('stops being cover once it is destroyed', async () => {
    await sheet('MOUSE', { ...CAR, vehicle1_hp: 1, vehicle1_armor: 0, in_vehicle: 'own:1' });
    await token('MOUSE');

    const first = await attack();
    expect(await vehicleHp('MOUSE')).toBe(0);
    expect(first.result.vehicleDestroyed).toBe(true);
    expect(await tokenHp('MOUSE')).toBe(30);

    // The wreck is still declared on the sheet; the next shot must go through it.
    const second = await attack();
    expect(second.result.ac).toBe(10); // the token's AC again, not the car's
    expect(await tokenHp('MOUSE')).toBe(30 - second.result.damage);
  });
});

describe('riding in another player’s vehicle', () => {
  it('takes the damage off the owner’s sheet', async () => {
    await sheet('CODY', CAR);
    await token('CODY');
    await sheet('MOUSE', { in_vehicle: 'ride', ride_owner: 'CODY', ride_vehicle: 1 });
    await token('MOUSE');

    const { result } = await attack();
    // One car, one HP pool — shooting the passenger damages the driver's vehicle.
    expect(await vehicleHp('CODY')).toBe(CAR_HP - result.through);
    expect(await tokenHp('MOUSE')).toBe(30);
  });

  it('leaves a rider exposed when the owner is gone', async () => {
    // No CODY sheet at all: purged, logged out for good, or never a player.
    await sheet('MOUSE', { in_vehicle: 'ride', ride_owner: 'CODY', ride_vehicle: 1 });
    await token('MOUSE');

    const { result } = await attack();
    // Falls back to exactly how they were attacked before vehicles existed.
    expect(result.ac).toBe(10);
    expect(await tokenHp('MOUSE')).toBe(30 - result.damage);
  });

  it('ignores a ride pointing at a vehicle the owner has not filled in', async () => {
    await sheet('CODY', CAR);
    await token('CODY');
    await sheet('MOUSE', { in_vehicle: 'ride', ride_owner: 'CODY', ride_vehicle: 4 });
    await token('MOUSE');

    const { result } = await attack();
    expect(result.ac).toBe(10);
    expect(await tokenHp('MOUSE')).toBe(30 - result.damage);
  });
});

describe('a gunner firing the owner’s mounts', () => {
  const MULE = {
    vehicle1_name: 'Mule', vehicle1_hp_max: CAR_HP, vehicle1_armor: 0, vehicle1_ac: 12,
    vehicle1_hrdpt: 3, vehicle1_weapon1_name: 'Autocannon', vehicle1_weapon1_dmg: '1d6',
    vehicle1_weapon1_skill: 'shoot', vehicle1_weapon1_atk: 0,
  };

  const rideIn = (owner) => run(db, `UPDATE character_sheets SET data = ? WHERE username = 'GHOST'`,
    [JSON.stringify({ ...ATTACKER, in_vehicle: 'ride', ride_owner: owner, ride_vehicle: 1 })]);

  it('fires a mount on a car it does not own', async () => {
    await sheet('CODY', MULE);
    await token('CODY');
    await rideIn('CODY');
    await sheet('MOUSE', {});
    await token('MOUSE');

    const { result, history } = await attack({ rideMount: true, weaponIndex: 1 });
    expect(result.hit).toBe(true);
    expect(result.weaponName).toBe('Autocannon');
    // The gunner rolls their own skill; only the weapon row comes off the owner's sheet.
    expect(history.some(h => /GHOST attacks/.test(h))).toBe(true);
  });

  it('refuses a ride mount from someone on foot', async () => {
    await sheet('CODY', MULE);
    await token('CODY');
    await sheet('MOUSE', {});
    await token('MOUSE');

    // GHOST never declared a ride, so there is no car whose guns they could reach.
    const { errors } = await attackExpectingError({ rideMount: true, weaponIndex: 1 });
    expect(errors.some(e => /INVALID_MOUNT/.test(e.message))).toBe(true);
  });

  it('refuses a mount the owner has not filled in', async () => {
    await sheet('CODY', CAR); // a car with no mounts on it
    await token('CODY');
    await rideIn('CODY');
    await sheet('MOUSE', {});
    await token('MOUSE');

    const { errors } = await attackExpectingError({ rideMount: true, weaponIndex: 2 });
    expect(errors.some(e => /INVALID_MOUNT/.test(e.message))).toBe(true);
  });
});

describe('firing out of a moving vehicle', () => {
  it('takes -4 on the to-hit', async () => {
    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'GHOST'`,
      [JSON.stringify({ ...ATTACKER, ...CAR, in_vehicle: 'own:1', vehicle1_moving: '1' })]);
    await sheet('MOUSE', {});
    await token('MOUSE');

    const { history } = await attack();
    expect(history.some(h => /from a moving vehicle/.test(h))).toBe(true);
  });

  it('takes nothing while parked', async () => {
    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'GHOST'`,
      [JSON.stringify({ ...ATTACKER, ...CAR, in_vehicle: 'own:1' })]);
    await sheet('MOUSE', {});
    await token('MOUSE');

    const { history } = await attack();
    expect(history.some(h => /from a moving vehicle/.test(h))).toBe(false);
  });
});
