/**
 * The GM's enemy vehicles.
 *
 * The point worth proving first is that nothing needed storing: NPC sheets already render the
 * whole template, vehicle section included, and already live in folders. So an enemy vehicle
 * has persisted from session to session since before this module existed — what was missing
 * was a read, because every roster query filtered `is_npc = 0`.
 *
 * The rest is the seam: this path is keyed by sheet id because NPC sheets have no username,
 * and it must not be able to touch a player's car.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const enemyVehicles = require('../sheets/enemyVehicles.js');
const vehicleState = require('../sheets/vehicleState.js');

const CWN = 'cities_without_number';
const CPR = 'cyberpunk_red';

const rosterOf = (db, system = CWN) => new Promise((r) => enemyVehicles.roster(db, r, system));
const damage = (db, args) => new Promise((r) => enemyVehicles.adjustHp(db, args, r));
const moving = (db, args) => new Promise((r) => enemyVehicles.setMoving(db, args, r));

let db;
beforeEach(async () => { db = await makeTestDb(); });

const npc = (label, data, folder = null, system = CWN) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label, folder) VALUES (?, ?, ?, 1, ?, ?)`,
    [label, system, JSON.stringify(data), label, folder]);

const player = (username, data, system = CWN) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`,
    [username, system, JSON.stringify(data)]);

const VAN = {
  vehicle1_name: 'Gang Van', vehicle1_type: 'van',
  vehicle1_hp: 35, vehicle1_hp_max: 35, vehicle1_armor: 6, vehicle1_ac: 11, vehicle1_crew: 3,
};

const sheetIdOf = async (label) =>
  (await get(db, `SELECT id FROM character_sheets WHERE npc_label = ?`, [label])).id;

const hpOf = async (label, i = 1) =>
  JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE npc_label = ?`, [label])).data)[`vehicle${i}_hp`];

describe('the enemy roster', () => {
  it('lists a vehicle typed on an NPC sheet, which is where it already persisted', async () => {
    await npc('ROAD GANG', VAN, 'Session 4');
    const { vehicles } = await rosterOf(db);

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({
      owner: 'ROAD GANG', folder: 'Session 4', index: 1, name: 'Gang Van',
      hp: 35, hpMax: 35, armorRating: 6, crew: 3, destroyed: false,
    });
    // Keyed by sheet id, not by a username, because an NPC sheet has none.
    expect(vehicles[0].sheetId).toBe(await sheetIdOf('ROAD GANG'));
  });

  it('derives the seats from the crew count, same as the player path', async () => {
    await npc('ROAD GANG', VAN);
    expect((await rosterOf(db)).vehicles[0].seats).toEqual(['driver', 'seat2', 'seat3']);
  });

  it('groups by folder so a campaign of antagonists stays findable', async () => {
    await npc('LATER', VAN, 'Session 9');
    await npc('EARLIER', VAN, 'Session 2');
    await npc('UNFILED', VAN, null);
    const { vehicles } = await rosterOf(db);
    expect(vehicles.map(v => v.folder)).toEqual([null, 'Session 2', 'Session 9']);
  });

  it('offers every NPC as possible crew, vehicle or not', async () => {
    await npc('DRIVER', VAN);
    await npc('PASSENGER', {});
    const { crew } = await rosterOf(db);
    expect(crew.map(c => c.label).sort()).toEqual(['DRIVER', 'PASSENGER']);
  });

  it('lists several vehicles on one sheet', async () => {
    await npc('MOTOR POOL', {
      ...VAN,
      vehicle2_name: 'Chase Car', vehicle2_hp_max: 30, vehicle2_hp: 30, vehicle2_crew: 4,
    });
    expect((await rosterOf(db)).vehicles.map(v => v.name)).toEqual(['Gang Van', 'Chase Car']);
  });

  it('counts a vehicle only once it has a damage pool', async () => {
    // The same bar the player roster uses: a half-filled row is not a vehicle yet.
    await npc('NOBODY', { vehicle1_name: 'Idea Of A Car' });
    expect((await rosterOf(db)).vehicles).toEqual([]);
  });

  it('shows nothing for a system with no enemy sheets', async () => {
    await npc('ROAD GANG', VAN, null, CWN);
    expect((await rosterOf(db, CPR)).vehicles).toEqual([]);
  });
});

describe('the enemy path and the player path do not touch', () => {
  beforeEach(async () => {
    await npc('ROAD GANG', VAN);
    await player('CODY', {
      vehicle1_name: 'Kestrel', vehicle1_hp: 30, vehicle1_hp_max: 30, vehicle1_crew: 5, vehicle1_ac: 11,
    });
  });

  it('keeps players off the enemy roster', async () => {
    expect((await rosterOf(db)).vehicles.map(v => v.name)).toEqual(['Gang Van']);
    expect((await rosterOf(db)).crew.map(c => c.label)).toEqual(['ROAD GANG']);
  });

  it('keeps enemies off the player roster', async () => {
    const { vehicles, players } = await new Promise((r) => vehicleState.roster(db, r, CWN));
    expect(vehicles.map(v => v.name)).toEqual(['Kestrel']);
    expect(players.map(p => p.username)).toEqual(['CODY']);
  });

  it('will not damage a player car through the enemy path', async () => {
    const playerSheet = (await get(db, `SELECT id FROM character_sheets WHERE username = 'CODY'`)).id;
    expect(await damage(db, { sheetId: playerSheet, vehicleIndex: 1, delta: -10 })).toBe('NO_SUCH_SHEET');

    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'CODY'`);
    expect(JSON.parse(row.data).vehicle1_hp).toBe(30);
  });
});

describe('damaging an enemy hull', () => {
  beforeEach(async () => { await npc('ROAD GANG', VAN); });

  it('takes damage off and puts repairs back', async () => {
    const sheetId = await sheetIdOf('ROAD GANG');
    expect(await damage(db, { sheetId, vehicleIndex: 1, delta: -12 })).toBeNull();
    expect(await hpOf('ROAD GANG')).toBe(23);

    await damage(db, { sheetId, vehicleIndex: 1, delta: 5 });
    expect(await hpOf('ROAD GANG')).toBe(28);
  });

  it('clamps at both ends, since destroyed is derived rather than stored', async () => {
    const sheetId = await sheetIdOf('ROAD GANG');
    await damage(db, { sheetId, vehicleIndex: 1, delta: 999 });
    expect(await hpOf('ROAD GANG')).toBe(35);

    await damage(db, { sheetId, vehicleIndex: 1, delta: -999 });
    expect(await hpOf('ROAD GANG')).toBe(0);
    expect((await rosterOf(db)).vehicles[0].destroyed).toBe(true);
  });

  it('refuses what is not there, and a delta that is not a number', async () => {
    const sheetId = await sheetIdOf('ROAD GANG');
    expect(await damage(db, { sheetId, vehicleIndex: 4, delta: -5 })).toBe('NO_SUCH_VEHICLE');
    expect(await damage(db, { sheetId: 9999, vehicleIndex: 1, delta: -5 })).toBe('NO_SUCH_SHEET');
    expect(await damage(db, { sheetId, vehicleIndex: 1, delta: 'lots' })).toBe('NO_CHANGE');
  });

  it('leaves the rest of the NPC sheet intact', async () => {
    const sheetId = await sheetIdOf('ROAD GANG');
    await run(db, `UPDATE character_sheets SET data = ? WHERE id = ?`,
      [JSON.stringify({ ...VAN, name: 'Rook', hp: 12 }), sheetId]);
    await damage(db, { sheetId, vehicleIndex: 1, delta: -6 });

    const data = JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE id = ?`, [sheetId])).data);
    expect(data).toMatchObject({ name: 'Rook', hp: 12, vehicle1_hp: 29 });
  });
});

describe('moving an enemy vehicle', () => {
  it('toggles on the car, not on anyone aboard', async () => {
    await npc('ROAD GANG', VAN);
    const sheetId = await sheetIdOf('ROAD GANG');

    expect(await moving(db, { sheetId, vehicleIndex: 1, moving: true })).toBeNull();
    expect((await rosterOf(db)).vehicles[0].moving).toBe(true);

    await moving(db, { sheetId, vehicleIndex: 1, moving: false });
    expect((await rosterOf(db)).vehicles[0].moving).toBe(false);
  });
});
