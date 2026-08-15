/**
 * Putting people in and out of seats.
 *
 * Seating is shared — anyone can put anyone in a car, because piling in is a decision the
 * table makes out loud. Getting out is the one thing that belongs to the occupant, and
 * that has to be enforced on the server: hiding a button proves nothing about what a
 * client will send.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vehicleState = require('../sheets/vehicleState.js');

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const socketsFactory = (await import('../sockets/index.js')).default;

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function boot(db, { admin = false } = {}) {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, {
    elevatedUsers: new Set(admin ? ['GHOST'] : []),
    emitUpdate: vi.fn(),
    recordAction: vi.fn(),
  });
  const handlers = {};
  const socket = {
    id: 'sock-1',
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    use: () => {}, join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (username TEXT PRIMARY KEY, balance REAL, debt REAL)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
});

const CAR = { vehicle1_name: 'Kestrel', vehicle1_hp_max: 20, vehicle1_armor: 3, vehicle1_ac: 12 };
const BIKE = { vehicle1_name: 'Wasp', vehicle1_hp_max: 8, vehicle1_ac: 14, vehicle1_layout: 'bike' };

const sheet = (username, data) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, 'cities_without_number', ?, 0)`,
    [username, JSON.stringify(data)]);

const dataOf = async (username) => {
  const row = await get(db, `SELECT data FROM character_sheets WHERE username = ?`, [username]);
  return JSON.parse(row.data);
};

const seat = (args) => new Promise((r) => vehicleState.seatIn(db, args, r));
const unseat = (who) => new Promise((r) => vehicleState.seatOut(db, who, r));

describe('seating someone', () => {
  beforeEach(async () => {
    await sheet('CODY', CAR);
    await sheet('MOUSE', {});
  });

  it('puts the owner in their own car without a ride reference', async () => {
    expect(await seat({ occupant: 'CODY', owner: 'CODY', vehicleIndex: 1, seat: 'driver' })).toBeNull();
    const d = await dataOf('CODY');
    // Their own vehicle needs no second sheet to resolve.
    expect(d.in_vehicle).toBe('own:1');
    expect(d.vehicle_seat).toBe('driver');
    expect(d.ride_owner).toBeUndefined();
  });

  it('points a passenger at the owner’s sheet', async () => {
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'shotgun' });
    expect(await dataOf('MOUSE')).toMatchObject({
      in_vehicle: 'ride', ride_owner: 'CODY', ride_vehicle: 1, vehicle_seat: 'shotgun',
    });
  });

  it('moves someone rather than putting them in two seats', async () => {
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'shotgun' });
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'gunner' });
    expect((await dataOf('MOUSE')).vehicle_seat).toBe('gunner');
  });

  it('turns out whoever was already in the seat', async () => {
    await sheet('RAY', {});
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'shotgun' });
    await seat({ occupant: 'RAY', owner: 'CODY', vehicleIndex: 1, seat: 'shotgun' });
    // One seat, one person — that is what choosing a name in the dropdown means.
    expect((await dataOf('RAY')).vehicle_seat).toBe('shotgun');
    expect((await dataOf('MOUSE')).in_vehicle).toBeUndefined();
  });

  it('leaves the same seat on a different car alone', async () => {
    await sheet('RAY', { ...CAR, vehicle1_name: 'Mule' });
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'driver' });
    await seat({ occupant: 'RAY', owner: 'RAY', vehicleIndex: 1, seat: 'driver' });
    // Two drivers, two cars.
    expect((await dataOf('MOUSE')).vehicle_seat).toBe('driver');
    expect((await dataOf('RAY')).vehicle_seat).toBe('driver');
  });

  it('refuses a seat the vehicle does not have', async () => {
    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'CODY'`, [JSON.stringify(BIKE)]);
    // A bike has two seats, which is what stops five people boarding one.
    expect(await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'pillion' })).toBeNull();
    expect(await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'back_left' })).toBe('NO_SUCH_SEAT');
  });

  it('refuses a vehicle that is not there', async () => {
    expect(await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 4, seat: 'driver' })).toBe('NO_SUCH_VEHICLE');
    expect(await seat({ occupant: 'MOUSE', owner: 'NOBODY', vehicleIndex: 1, seat: 'driver' })).toBe('NO_SUCH_VEHICLE_OWNER');
  });

  it('refuses a player with no sheet', async () => {
    expect(await seat({ occupant: 'GHOST', owner: 'CODY', vehicleIndex: 1, seat: 'driver' })).toBe('NO_SUCH_PLAYER');
  });
});

describe('getting out', () => {
  beforeEach(async () => {
    await sheet('CODY', CAR);
    await sheet('MOUSE', {});
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'shotgun' });
  });

  it('clears every trace of where they were', async () => {
    expect(await unseat('MOUSE')).toBeNull();
    const d = await dataOf('MOUSE');
    for (const f of vehicleState.OCCUPANCY_FIELDS) expect(d[f]).toBeUndefined();
  });

  it('does not mind being asked twice', async () => {
    await unseat('MOUSE');
    expect(await unseat('MOUSE')).toBeNull();
  });
});

describe('the seatOut permission, over the socket', () => {
  beforeEach(async () => {
    await sheet('CODY', CAR);
    await sheet('MOUSE', {});
    await sheet('GHOST', {});
    await seat({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'shotgun' });
  });

  it('refuses to pull someone else out', async () => {
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['seatOut']({ occupant: 'MOUSE' });
    await flush(60);

    expect(emitted.some(e => e.event === 'vehicleSeatingError' && e.data.message === 'NOT_YOURS')).toBe(true);
    // Refused in the server, not merely hidden in the UI.
    expect((await dataOf('MOUSE')).in_vehicle).toBe('ride');
  });

  it('lets you out of your own seat', async () => {
    const { handlers } = boot(db);
    handlers['identify']('MOUSE');
    await flush(50);
    handlers['seatOut']({ occupant: 'MOUSE' });
    await flush(60);
    expect((await dataOf('MOUSE')).in_vehicle).toBeUndefined();
  });

  it('lets the GM pull anyone out', async () => {
    const { handlers } = boot(db, { admin: true });
    handlers['identify']('GHOST');
    await flush(50);
    handlers['seatOut']({ occupant: 'MOUSE' });
    await flush(60);
    expect((await dataOf('MOUSE')).in_vehicle).toBeUndefined();
  });

  it('lets anyone seat anyone, which is the deliberate asymmetry', async () => {
    const { handlers } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['seatIn']({ occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'gunner' });
    await flush(60);
    expect((await dataOf('MOUSE')).vehicle_seat).toBe('gunner');
  });
});

describe('whether the car is moving', () => {
  it('is set on the vehicle, so everyone aboard agrees', async () => {
    await sheet('CODY', CAR);
    await new Promise((r) => vehicleState.setMoving(db, { owner: 'CODY', vehicleIndex: 1, moving: true }, r));
    expect((await dataOf('CODY')).vehicle1_moving).toBe(1);
    await new Promise((r) => vehicleState.setMoving(db, { owner: 'CODY', vehicleIndex: 1, moving: false }, r));
    expect((await dataOf('CODY')).vehicle1_moving).toBe(0);
  });
});
