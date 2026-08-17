/**
 * Friendly NPCs riding with players.
 *
 * Players invite them, which is a table matter rather than a permission one — a GM who does
 * not like where it goes can turn anyone out, and tokens have no autonomy to protect.
 *
 * The load-bearing part is that a seat can now be claimed two ways: a player's occupancy
 * lives on their own sheet, an NPC's lives in `vehicle_occupants`. "One seat, one occupant"
 * has to hold across both, in both directions, or a car quietly seats two people in one
 * place and nobody notices until the shooting starts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vehicleState = require('../sheets/vehicleState.js');

const CWN = 'cities_without_number';

const rosterOf = (db, level = null) =>
  new Promise((r) => vehicleState.roster(db, r, CWN, level));
const seat = (db, args) => new Promise((r) => vehicleState.seatIn(db, { system: CWN, ...args }, r));
const unseatGuest = (db, id) => new Promise((r) => vehicleState.unseatGuest(db, id, r));

let db;
beforeEach(async () => { db = await makeTestDb(); });

const CAR = {
  vehicle1_name: 'Kestrel', vehicle1_type: 'car',
  vehicle1_hp: 30, vehicle1_hp_max: 30, vehicle1_ac: 11, vehicle1_crew: 4,
};

const player = (username, data = {}) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`,
    [username, CWN, JSON.stringify(data)]);

const token = (name, shape, battleMapId = null, floorIndex = null) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, battle_map_id, floor_index) VALUES (?, 0, 0, 0, ?, ?, ?)`,
    [name, shape, battleMapId, floorIndex]);

const locIdOf = async (name) => (await get(db, `SELECT id FROM locations WHERE name = ?`, [name])).id;
const car = async () => (await rosterOf(db)).vehicles[0];

describe('who a player may invite', () => {
  beforeEach(async () => {
    await player('CODY', CAR);
    await token('STREET DOC', 'friendly_rhombus');
    await token('GANGER', 'enemy_rhombus');
  });

  it('offers friendly tokens and not hostile ones', async () => {
    const { guestTokens } = await rosterOf(db);
    expect(guestTokens.map(t => t.name)).toEqual(['STREET DOC']);
  });

  it('refuses a hostile outright, not just in the picker', async () => {
    // A picker is a suggestion; this is the rule. A player putting an enemy in their back
    // seat is not something the fiction supports.
    expect(await seat(db, {
      owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: await locIdOf('GANGER'),
    })).toBe('NOT_INVITABLE');
  });

  it('seats a friendly and reports them aboard', async () => {
    const doc = await locIdOf('STREET DOC');
    expect(await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: doc })).toBeNull();
    expect((await car()).guests).toEqual({
      seat2: { locationId: doc, name: 'STREET DOC', shape: 'friendly_rhombus' },
    });
  });

  it('refuses a seat the car does not have', async () => {
    expect(await seat(db, {
      owner: 'CODY', vehicleIndex: 1, seat: 'seat9', guestId: await locIdOf('STREET DOC'),
    })).toBe('NO_SUCH_SEAT');
  });

  it('filters the invite list to the map level, like the enemy window', async () => {
    await token('ROOF MEDIC', 'friendly_rhombus', 4, 3);
    expect((await rosterOf(db, { battleMapId: null, floorIndex: null })).guestTokens.map(t => t.name))
      .toEqual(['STREET DOC']);
    expect((await rosterOf(db, { battleMapId: 4, floorIndex: 3 })).guestTokens.map(t => t.name))
      .toEqual(['ROOF MEDIC']);
  });
});

describe('one seat, one occupant, across both mechanisms', () => {
  beforeEach(async () => {
    await player('CODY', CAR);
    await player('MOUSE', {});
    await token('STREET DOC', 'friendly_rhombus');
    await token('MEDIC', 'friendly_rhombus');
  });

  it('an NPC taking a seat turns out the player in it', async () => {
    await seat(db, { occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'seat2' });
    expect((await car()).occupants).toEqual({ seat2: 'MOUSE' });

    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: await locIdOf('STREET DOC') });

    const after = await car();
    expect(after.guests.seat2.name).toBe('STREET DOC');
    // MOUSE is out of the car entirely, not sharing the seat.
    expect(after.occupants).toEqual({});
  });

  it('a player taking a seat turns out the NPC in it', async () => {
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: await locIdOf('STREET DOC') });
    await seat(db, { occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'seat2' });

    const after = await car();
    expect(after.occupants).toEqual({ seat2: 'MOUSE' });
    expect(after.guests).toEqual({});
  });

  it('an NPC taking a seat turns out the NPC in it', async () => {
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: await locIdOf('STREET DOC') });
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: await locIdOf('MEDIC') });

    const after = await car();
    expect(Object.keys(after.guests)).toEqual(['seat2']);
    expect(after.guests.seat2.name).toBe('MEDIC');
  });

  it('moves an NPC between seats rather than cloning them', async () => {
    const doc = await locIdOf('STREET DOC');
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: doc });
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat3', guestId: doc });
    expect(Object.keys((await car()).guests)).toEqual(['seat3']);
  });

  it('lets anyone turn an NPC out, since a token has no autonomy to protect', async () => {
    // The "only you can take yourself out" rule is there for people. A GM who dislikes
    // where a player has taken this can undo it, and so can anyone else.
    const doc = await locIdOf('STREET DOC');
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: doc });
    expect(await unseatGuest(db, doc)).toBeNull();
    expect((await car()).guests).toEqual({});
  });

  it('empties the seat when the token leaves the map', async () => {
    const doc = await locIdOf('STREET DOC');
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat2', guestId: doc });

    await run(db, `PRAGMA foreign_keys = ON`);
    await run(db, `DELETE FROM locations WHERE id = ?`, [doc]);
    expect((await car()).guests).toEqual({});
  });
});

describe('players and NPCs share a car without colliding', () => {
  it('seats a person and an NPC in different seats', async () => {
    await player('CODY', CAR);
    await player('MOUSE', {});
    await token('STREET DOC', 'friendly_rhombus');

    await seat(db, { occupant: 'CODY', owner: 'CODY', vehicleIndex: 1, seat: 'driver' });
    await seat(db, { occupant: 'MOUSE', owner: 'CODY', vehicleIndex: 1, seat: 'seat2' });
    await seat(db, { owner: 'CODY', vehicleIndex: 1, seat: 'seat3', guestId: await locIdOf('STREET DOC') });

    const after = await car();
    expect(after.occupants).toEqual({ driver: 'CODY', seat2: 'MOUSE' });
    expect(after.guests.seat3.name).toBe('STREET DOC');
  });
});
