/**
 * Cyberpunk RED vehicles reaching the shared seating machinery.
 *
 * The whole point of the registry is that this file needs almost nothing new: the same
 * roster, the same seatIn, the same hull bar, told which system is live. So what is worth
 * testing is not that seating works again — it is that the system actually gates, because
 * a table that has played both should never find last campaign's cars on this one's roster.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vehicleState = require('../sheets/vehicleState.js');
const { hasVehicles, VEHICLE_SYSTEMS } = require('../sheets/vehicleSystems.js');

const CPR = 'cyberpunk_red';
const CWN = 'cities_without_number';

const rosterOf = (db, system) => new Promise((r) => vehicleState.roster(db, r, system));
const seat = (db, args) => new Promise((r) => vehicleState.seatIn(db, args, r));
const adjust = (db, args) => new Promise((r) => vehicleState.adjustHp(db, args, r));

let db;
beforeEach(async () => {
  db = await makeTestDb();
});

const sheet = (username, system, data) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`,
    [username, system, JSON.stringify(data)]);

// SDP and SP on screen; hp and armor in storage, which is what lets one implementation
// serve both systems.
const GALENA = {
  vehicle1_name: 'Galena', vehicle1_type: 'car',
  vehicle1_hp: 50, vehicle1_hp_max: 50, vehicle1_armor: 10, vehicle1_crew: 4,
};

describe('the vehicle system registry', () => {
  it('knows both systems and nothing else', () => {
    expect(hasVehicles(CWN)).toBe(true);
    expect(hasVehicles(CPR)).toBe(true);
    expect(hasVehicles('shadowrun_6e')).toBe(false);
    expect(hasVehicles('')).toBe(false);
    expect(hasVehicles(undefined)).toBe(false);
    expect(VEHICLE_SYSTEMS).toContain(CPR);
  });
});

describe('a CP:R vehicle on the roster', () => {
  it('appears with its pool, armour and seats', async () => {
    await sheet('CODY', CPR, { ...GALENA, name: 'Vega' });
    const { vehicles } = await rosterOf(db, CPR);

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({
      owner: 'CODY', ownerName: 'Vega', index: 1, name: 'Galena',
      hp: 50, hpMax: 50, armorRating: 10, crew: 4, destroyed: false,
    });
    // Four seats derived from the count, exactly as CWN derives them from Crew.
    expect(vehicles[0].seats).toEqual(['driver', 'seat2', 'seat3', 'seat4']);
  });

  it('counts as a vehicle on its SDP maximum alone', async () => {
    // Everything else can be blank - unlike CWN, there is no preset to fill it in.
    await sheet('CODY', CPR, { vehicle1_hp_max: 35 });
    const { vehicles } = await rosterOf(db, CPR);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].hp).toBe(35);
  });

  it('seats a passenger and reports them aboard', async () => {
    await sheet('CODY', CPR, GALENA);
    await sheet('MOUSE', CPR, {});

    expect(await seat(db, { occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'seat2', system: CPR })).toBeNull();

    const { vehicles } = await rosterOf(db, CPR);
    expect(vehicles[0].occupants).toEqual({ seat2: 'MOUSE' });
  });

  it('refuses a seat the vehicle does not have', async () => {
    await sheet('CODY', CPR, GALENA);
    await sheet('MOUSE', CPR, {});
    // Four seats, so there is no fifth to sit in.
    expect(await seat(db, { occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'seat5', system: CPR })).toBe('NO_SUCH_SEAT');
  });

  it('takes damage and repairs, clamped to the hull', async () => {
    await sheet('CODY', CPR, GALENA);

    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -20, system: CPR });
    expect((await rosterOf(db, CPR)).vehicles[0].hp).toBe(30);

    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: 999, system: CPR });
    expect((await rosterOf(db, CPR)).vehicles[0].hp).toBe(50);
  });

  it('is Destroyed at zero, so it stops being cover', async () => {
    await sheet('CODY', CPR, GALENA);
    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -999, system: CPR });
    expect((await rosterOf(db, CPR)).vehicles[0]).toMatchObject({ hp: 0, destroyed: true });
  });
});

describe('the two systems do not see each other', () => {
  beforeEach(async () => {
    await sheet('CODY', CPR, GALENA);
    await sheet('CODY_CWN', CWN, {
      vehicle1_name: 'Kestrel', vehicle1_hp_max: 30, vehicle1_hp: 30, vehicle1_crew: 5, vehicle1_ac: 11,
    });
  });

  it('lists only the live system\'s vehicles', async () => {
    expect((await rosterOf(db, CPR)).vehicles.map(v => v.name)).toEqual(['Galena']);
    expect((await rosterOf(db, CWN)).vehicles.map(v => v.name)).toEqual(['Kestrel']);
  });

  it('lists only the live system\'s players', async () => {
    // The dropdowns are built from this. Offering a seat to someone playing a different
    // game is the visible form of the leak.
    expect((await rosterOf(db, CPR)).players.map(p => p.username)).toEqual(['CODY']);
    expect((await rosterOf(db, CWN)).players.map(p => p.username)).toEqual(['CODY_CWN']);
  });

  it('will not seat someone across the divide', async () => {
    expect(await seat(db, {
      occupant: 'CODY_CWN', owner: 'CODY', vehicleIndex: 1, seat: 'seat2', system: CPR,
    })).toBe('NO_SUCH_PLAYER');
  });

  it('will not damage the other system\'s car', async () => {
    expect(await adjust(db, {
      owner: 'CODY_CWN', vehicleIndex: 1, delta: -10, system: CPR,
    })).toBe('NO_SUCH_VEHICLE_OWNER');

    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'CODY_CWN'`);
    expect(JSON.parse(row.data).vehicle1_hp).toBe(30);
  });
});
