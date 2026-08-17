/**
 * Ramming.
 *
 * Three things about the rule are easy to get backwards, and they are what these tests are
 * for: it hurts the rammer as much as the target, armour does not apply, and everyone
 * aboard both vehicles takes the injury.
 *
 * The damage is passed in rather than rolled here — the dice are the socket's job, and a
 * test that rolled would be testing the RNG instead of the rule.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const vehicleState = require('../sheets/vehicleState.js');
const ram = require('../sheets/ram.js');

const CPR = 'cyberpunk_red';
const drive = (db, args) => new Promise((r) => vehicleState.ram(db, { system: CPR, ...args }, (reason, out) => r({ reason, out })));

let db;
beforeEach(async () => { db = await makeTestDb(); });

const sheet = (username, data) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`,
    [username, CPR, JSON.stringify(data)]);

const token = (username, hp, hpMax) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES (?, 0, 0, 0, 'rhombus', ?, ?, ?)`,
    [username, username, hp, hpMax]);

const hpOf = async (username, i = 1) =>
  JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE username = ?`, [username])).data)[`vehicle${i}_hp`];

// SP 10 on both, which must make no difference to any of this.
const car = (name, seats = 4) => ({
  vehicle1_name: name, vehicle1_type: 'car',
  vehicle1_hp: 50, vehicle1_hp_max: 50, vehicle1_armor: 10, vehicle1_crew: seats,
});

const seatIn = (occupant, owner, seat) => new Promise((r) =>
  vehicleState.seatIn(db, { occupant, owner, vehicleIndex: 1, seat, system: CPR }, r));

describe('the rule itself', () => {
  it('ignores armour entirely', () => {
    // Every other source of vehicle damage subtracts SP. This one does not, by rule, and
    // that exception is exactly what a later refactor would tidy away.
    expect(ram.applyRamDamage(50, 50, 21)).toBe(29);
    expect(ram.resolveRam({ damage: 21, rammer: { hp: 50, hpMax: 50 }, target: { hp: 50, hpMax: 50 } }))
      .toMatchObject({ rammerHp: 29, targetHp: 29 });
  });

  it('hurts the rammer exactly as much as the target', () => {
    const out = ram.resolveRam({ damage: 18, rammer: { hp: 40, hpMax: 40 }, target: { hp: 60, hpMax: 60 } });
    expect(out.rammerHp).toBe(22);
    expect(out.targetHp).toBe(42);
  });

  it('reads a blank pool as undamaged', () => {
    expect(ram.applyRamDamage(undefined, 35, 10)).toBe(25);
  });

  it('never drives a pool below zero', () => {
    expect(ram.applyRamDamage(4, 50, 21)).toBe(0);
  });

  it('stops the vehicle unless what it hit went down', () => {
    const hit = (targetHp) => ram.resolveRam({ damage: 20, rammer: { hp: 50, hpMax: 50 }, target: { hp: targetHp, hpMax: 50 } });
    expect(hit(50).movementContinues).toBe(false);
    expect(hit(15).movementContinues).toBe(true);
  });

  it('never lets a pedestrian stop a vehicle', () => {
    const out = ram.resolveRam({ damage: 5, rammer: { hp: 50, hpMax: 50 }, target: { hp: 40, hpMax: 40 }, targetIsPerson: true });
    expect(out.movementContinues).toBe(true);
    // Survived, so they may choose to end up on the bonnet.
    expect(out.ridesAlong).toBe(true);
  });

  it('gives everyone aboard both vehicles the injury, once each', () => {
    expect(ram.whiplashed(['CODY', 'MOUSE'], ['VEGA'])).toEqual(['CODY', 'MOUSE', 'VEGA']);
    expect(ram.whiplashed(['CODY'], ['CODY'])).toEqual(['CODY']);
  });
});

describe('driving into another vehicle', () => {
  beforeEach(async () => {
    await sheet('CODY', car('Galena'));
    await sheet('MOUSE', car('Quartz'));
    await sheet('VEGA', {});
    await seatIn('CODY', 'CODY', 'driver');
    await seatIn('VEGA', 'CODY', 'seat2');
    await seatIn('MOUSE', 'MOUSE', 'driver');
  });

  it('damages both hulls and names everyone hurt', async () => {
    const { reason, out } = await drive(db, { actor: 'CODY', targetOwner: 'MOUSE', targetVehicleIndex: 1, damage: 21 });
    expect(reason).toBeNull();

    expect(await hpOf('CODY')).toBe(29);
    expect(await hpOf('MOUSE')).toBe(29);
    // Both crews: the driver, their passenger, and the other driver.
    expect(out.injured.sort()).toEqual(['CODY', 'MOUSE', 'VEGA']);
    expect(out.movementContinues).toBe(false);
  });

  it('lets the vehicle drive on when the target is wrecked', async () => {
    const { out } = await drive(db, { actor: 'CODY', targetOwner: 'MOUSE', targetVehicleIndex: 1, damage: 60 });
    expect(out.targetDown).toBe(true);
    expect(out.movementContinues).toBe(true);
    // And the rammer is wrecked too, on the same numbers.
    expect(out.rammerWrecked).toBe(true);
    expect(await hpOf('CODY')).toBe(0);
  });

  it('refuses anyone who is not in the driver seat', async () => {
    // VEGA is a passenger in the same car. Ramming is the driver's action.
    expect((await drive(db, { actor: 'VEGA', targetOwner: 'MOUSE', targetVehicleIndex: 1, damage: 21 })).reason)
      .toBe('NOT_DRIVING');
    expect(await hpOf('MOUSE')).toBe(50);
  });

  it('refuses someone on foot', async () => {
    await sheet('GHOST', {});
    expect((await drive(db, { actor: 'GHOST', targetOwner: 'MOUSE', targetVehicleIndex: 1, damage: 21 })).reason)
      .toBe('NOT_DRIVING');
  });

  it('takes the ramming vehicle from the seat, never from the payload', async () => {
    // CODY drives their own car; naming someone else's does not let them ram with it.
    const { out } = await drive(db, { actor: 'CODY', targetOwner: 'MOUSE', targetVehicleIndex: 1, damage: 10 });
    expect(out.rammer.owner).toBe('CODY');
  });

  it('will not ram the car it is driving', async () => {
    expect((await drive(db, { actor: 'CODY', targetOwner: 'CODY', targetVehicleIndex: 1, damage: 21 })).reason)
      .toBe('SAME_VEHICLE');
    expect(await hpOf('CODY')).toBe(50);
  });

  it('will not ram from a wreck', async () => {
    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'CODY'`,
      [JSON.stringify({ ...car('Galena'), vehicle1_hp: 0, in_vehicle: 'own:1', vehicle_seat: 'driver' })]);
    expect((await drive(db, { actor: 'CODY', targetOwner: 'MOUSE', targetVehicleIndex: 1, damage: 21 })).reason)
      .toBe('WRECKED');
  });

  it('refuses a vehicle that is not there', async () => {
    expect((await drive(db, { actor: 'CODY', targetOwner: 'NOBODY', targetVehicleIndex: 1, damage: 21 })).reason)
      .toBe('NO_SUCH_TARGET');
  });
});

describe('aiming at a person who is in a car', () => {
  // The attack panel targets a token, not a vehicle. Hitting the person and leaving the
  // car they are sitting in unscratched would be the wrong answer to the obvious question.
  beforeEach(async () => {
    await sheet('CODY', car('Galena'));
    await sheet('MOUSE', car('Quartz'));
    await sheet('VEGA', {});
    await token('VEGA', 30, 30);
    await seatIn('CODY', 'CODY', 'driver');
    await seatIn('MOUSE', 'MOUSE', 'driver');
    await seatIn('VEGA', 'MOUSE', 'seat2');
  });

  it('hits the car they are riding in, not them', async () => {
    const { out } = await drive(db, { actor: 'CODY', targetUsername: 'VEGA', damage: 21 });
    expect(out.target.name).toBe('Quartz');
    expect(out.target.isPerson).toBe(false);
    expect(await hpOf('MOUSE')).toBe(29);

    // Their own token is untouched — the crash injury is what reaches them.
    const row = await get(db, `SELECT hp_current FROM locations WHERE owner = 'VEGA'`);
    expect(row.hp_current).toBe(30);
    expect(out.injured.sort()).toEqual(['CODY', 'MOUSE', 'VEGA']);
  });

  it('refuses to ram a passenger in your own car', async () => {
    await seatIn('VEGA', 'CODY', 'seat2');
    expect((await drive(db, { actor: 'CODY', targetUsername: 'VEGA', damage: 21 })).reason)
      .toBe('SAME_VEHICLE');
  });
});

describe('driving into a person', () => {
  beforeEach(async () => {
    await sheet('CODY', car('Galena'));
    await seatIn('CODY', 'CODY', 'driver');
    await sheet('WALKER', {});
    await token('WALKER', 30, 30);
  });

  it('takes it off the token, and costs the vehicle the same', async () => {
    const { out } = await drive(db, { actor: 'CODY', targetUsername: 'WALKER', damage: 12 });
    const row = await get(db, `SELECT hp_current FROM locations WHERE owner = 'WALKER'`);
    expect(row.hp_current).toBe(18);
    expect(await hpOf('CODY')).toBe(38);
    expect(out.injured.sort()).toEqual(['CODY', 'WALKER']);
  });

  it('keeps moving either way', async () => {
    expect((await drive(db, { actor: 'CODY', targetUsername: 'WALKER', damage: 60 })).out)
      .toMatchObject({ movementContinues: true, ridesAlong: false });
  });

  it('refuses a target with no token', async () => {
    expect((await drive(db, { actor: 'CODY', targetUsername: 'NOBODY', damage: 12 })).reason)
      .toBe('NO_SUCH_TARGET');
  });
});
