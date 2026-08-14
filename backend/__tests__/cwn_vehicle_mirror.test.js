/**
 * Mirroring vehicle state onto tokens.
 *
 * The vehicle lives in private sheet data, but an attacker has to be able to see the
 * cover before they waste a turn on it. The server derives the combat numbers and writes
 * only those onto the token, the same way it already mirrors the character's name.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vehicleState = require('../sheets/vehicleState.js');

const sync = (db, username) => new Promise((r) => vehicleState.syncTokens(db, username, r));

let db;
beforeEach(async () => {
  db = await makeTestDb();
});

const sheet = (username, data) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, 'cities_without_number', ?, 0)`,
    [username, JSON.stringify(data)]);

const token = (username) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner) VALUES (?, 0, 0, 0, 'rhombus', ?)`, [username, username]);

const state = async (username) => {
  const row = await get(db, `SELECT vehicle_state FROM locations WHERE owner = ?`, [username]);
  return row.vehicle_state ? JSON.parse(row.vehicle_state) : null;
};

const CAR = { vehicle1_name: 'Kestrel', vehicle1_hp_max: 20, vehicle1_armor: 5, vehicle1_ac: 12 };

describe('vehicle state on the token', () => {
  it('writes the derived numbers, not the sheet', async () => {
    await sheet('CODY', { ...CAR, in_vehicle: 'own:1', drive: 3, vehicle_moving: '1', name: 'Cody' });
    await token('CODY');
    await sync(db, 'CODY');

    const s = await state('CODY');
    expect(s).toMatchObject({ name: 'Kestrel', ac: 15, armorRating: 5, hp: 20, hpMax: 20, moving: true });
    // Nothing else from the sheet rides along.
    expect(Object.keys(s).sort()).toEqual(['ac', 'armorRating', 'hp', 'hpMax', 'moving', 'name']);
  });

  it('clears when the player gets out', async () => {
    await sheet('CODY', { ...CAR, in_vehicle: 'own:1' });
    await token('CODY');
    await sync(db, 'CODY');
    expect(await state('CODY')).not.toBeNull();

    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'CODY'`, [JSON.stringify(CAR)]);
    await sync(db, 'CODY');
    expect(await state('CODY')).toBeNull();
  });

  it('shows a rider the car they are actually in', async () => {
    await sheet('CODY', CAR);
    await token('CODY');
    await sheet('MOUSE', { in_vehicle: 'ride', ride_owner: 'CODY', ride_vehicle: 1 });
    await token('MOUSE');
    await sync(db, 'MOUSE');

    expect(await state('MOUSE')).toMatchObject({ name: 'Kestrel', armorRating: 5 });
    // The owner is not in it, so their own token stays clear.
    expect(await state('CODY')).toBeNull();
  });

  it('refreshes riders when the owner changes the car', async () => {
    await sheet('CODY', CAR);
    await token('CODY');
    await sheet('MOUSE', { in_vehicle: 'ride', ride_owner: 'CODY', ride_vehicle: 1 });
    await token('MOUSE');
    await sync(db, 'MOUSE');
    expect((await state('MOUSE')).armorRating).toBe(5);

    // A passenger's badge is derived from someone else's sheet, so saving that sheet has
    // to refresh them too or every passenger is quietly stale.
    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'CODY'`,
      [JSON.stringify({ ...CAR, vehicle1_armor: 9 })]);
    await sync(db, 'CODY');
    expect((await state('MOUSE')).armorRating).toBe(9);
  });

  it('leaves a rider clear when the owner is gone', async () => {
    await sheet('MOUSE', { in_vehicle: 'ride', ride_owner: 'GHOST', ride_vehicle: 1 });
    await token('MOUSE');
    await sync(db, 'MOUSE');
    expect(await state('MOUSE')).toBeNull();
  });

  it('shows no cover for a wreck', async () => {
    await sheet('CODY', { ...CAR, vehicle1_hp: 0, in_vehicle: 'own:1' });
    await token('CODY');
    await sync(db, 'CODY');
    // It is still declared on the sheet, but it has stopped protecting anyone.
    expect(await state('CODY')).toBeNull();
  });
});
