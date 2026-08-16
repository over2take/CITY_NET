/**
 * Damaging and repairing a vehicle by hand.
 *
 * Combat writes the hull field on its own. This is the path for everything it does not
 * model — a crash, a ram, and above all the repair afterwards, which used to mean opening
 * the owner's sheet and editing the number.
 *
 * The clamp is the point of the whole function: `destroyed` is derived from HP rather than
 * stored, so a client that could push HP past the hull or below zero could invent a state
 * the rules have no name for.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vehicleState = require('../sheets/vehicleState.js');

const adjust = (db, args) => new Promise((r) => vehicleState.adjustHp(db, args, r));

let db;
beforeEach(async () => {
  db = await makeTestDb();
});

const sheet = (username, data) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, 'cities_without_number', ?, 0)`,
    [username, JSON.stringify(data)]);

const hp = async (username, i = 1) => {
  const row = await get(db, `SELECT data FROM character_sheets WHERE username = ?`, [username]);
  return JSON.parse(row.data)[`vehicle${i}_hp`];
};

const CAR = { vehicle1_name: 'Kestrel', vehicle1_hp_max: 30, vehicle1_hp: 30, vehicle1_ac: 12 };

describe('adjusting a vehicle hull', () => {
  it('takes damage off and puts repairs back', async () => {
    await sheet('CODY', { ...CAR });

    expect(await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -12 })).toBeNull();
    expect(await hp('CODY')).toBe(18);

    expect(await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: 5 })).toBeNull();
    expect(await hp('CODY')).toBe(23);
  });

  it('will not repair past the hull maximum', async () => {
    await sheet('CODY', { ...CAR, vehicle1_hp: 28 });
    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: 999 });
    expect(await hp('CODY')).toBe(30);
  });

  it('will not drive the hull below zero', async () => {
    await sheet('CODY', { ...CAR, vehicle1_hp: 4 });
    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -999 });
    expect(await hp('CODY')).toBe(0);
  });

  it('reads a blank current HP as undamaged, the way combat does', async () => {
    await sheet('CODY', { vehicle1_name: 'Kestrel', vehicle1_hp_max: 30, vehicle1_ac: 12 });
    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -10 });
    expect(await hp('CODY')).toBe(20);
  });

  it('leaves the wreck at zero rather than erroring', async () => {
    await sheet('CODY', { ...CAR, vehicle1_hp: 0 });
    expect(await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -5 })).toBeNull();
    expect(await hp('CODY')).toBe(0);
  });

  it('touches only the vehicle named, not its neighbours', async () => {
    await sheet('CODY', {
      ...CAR,
      vehicle2_name: 'Mule', vehicle2_hp_max: 35, vehicle2_hp: 35, vehicle2_ac: 11,
    });
    await adjust(db, { owner: 'CODY', vehicleIndex: 2, delta: -7 });
    expect(await hp('CODY', 1)).toBe(30);
    expect(await hp('CODY', 2)).toBe(28);
  });

  it('refuses a vehicle that is not there', async () => {
    await sheet('CODY', { ...CAR });
    expect(await adjust(db, { owner: 'CODY', vehicleIndex: 4, delta: -5 })).toBe('NO_SUCH_VEHICLE');
    expect(await adjust(db, { owner: 'NOBODY', vehicleIndex: 1, delta: -5 })).toBe('NO_SUCH_VEHICLE_OWNER');
  });

  it('refuses a delta that is not a usable number', async () => {
    await sheet('CODY', { ...CAR });
    for (const delta of [0, '', null, undefined, NaN, 'lots']) {
      expect(await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta })).toBe('NO_CHANGE');
    }
    expect(await hp('CODY')).toBe(30);
  });

  it('keeps the rest of the sheet intact', async () => {
    await sheet('CODY', { ...CAR, name: 'Cody', drive: 3, in_vehicle: 'own:1' });
    await adjust(db, { owner: 'CODY', vehicleIndex: 1, delta: -6 });
    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'CODY'`);
    expect(JSON.parse(row.data)).toMatchObject({ name: 'Cody', drive: 3, in_vehicle: 'own:1', vehicle1_hp: 24 });
  });
});
