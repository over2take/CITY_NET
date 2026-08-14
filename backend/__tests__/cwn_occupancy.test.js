import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const attackCwn = require('../sheets/attackCwn.js');

/**
 * Reading where a character is, and which vehicle is standing between them and a bullet.
 *
 * Every unreadable state has to come back as "on foot", because that is the behaviour
 * that existed before vehicles did — a bad reference should cost the character their
 * cover, never make them impossible to hit.
 */

const vehicle = (i, over = {}) => ({
  [`vehicle${i}_name`]: 'Kestrel',
  [`vehicle${i}_hp_max`]: 20,
  [`vehicle${i}_armor`]: 5,
  [`vehicle${i}_ac`]: 12,
  ...over,
});

describe('readOccupancy', () => {
  it('reads on foot as nothing at all', () => {
    expect(attackCwn.readOccupancy({})).toBeNull();
    expect(attackCwn.readOccupancy({ in_vehicle: '' })).toBeNull();
    expect(attackCwn.readOccupancy({ in_vehicle: '   ' })).toBeNull();
  });

  it('reads one of your own vehicles without naming an owner', () => {
    // No owner means no second sheet to fetch, which is the common case.
    expect(attackCwn.readOccupancy({ in_vehicle: 'own:2' }))
      .toMatchObject({ owner: null, vehicleIndex: 2, moving: false });
  });

  it('reads riding in another player’s vehicle', () => {
    expect(attackCwn.readOccupancy({ in_vehicle: 'ride', ride_owner: 'cody', ride_vehicle: 3 }))
      .toMatchObject({ owner: 'cody', vehicleIndex: 3 });
  });

  it('carries the declared movement', () => {
    expect(attackCwn.readOccupancy({ in_vehicle: 'own:1', vehicle_moving: '1' }).moving).toBe(true);
    expect(attackCwn.readOccupancy({ in_vehicle: 'own:1', vehicle_moving: '' }).moving).toBe(false);
  });

  it('falls back to on foot when a ride names no one', () => {
    expect(attackCwn.readOccupancy({ in_vehicle: 'ride', ride_vehicle: 1 })).toBeNull();
    expect(attackCwn.readOccupancy({ in_vehicle: 'ride', ride_owner: '  ', ride_vehicle: 1 })).toBeNull();
  });

  it('rejects an index outside the rows the sheet declares', () => {
    expect(attackCwn.readOccupancy({ in_vehicle: 'own:0' })).toBeNull();
    expect(attackCwn.readOccupancy({ in_vehicle: `own:${attackCwn.VEHICLE_ROWS + 1}` })).toBeNull();
    expect(attackCwn.readOccupancy({ in_vehicle: 'ride', ride_owner: 'cody', ride_vehicle: 99 })).toBeNull();
    expect(attackCwn.readOccupancy({ in_vehicle: 'own:abc' })).toBeNull();
  });
});

describe('getVehicle', () => {
  it('reads a vehicle off its owner’s sheet', () => {
    const v = attackCwn.getVehicle(vehicle(1), 1);
    expect(v).toMatchObject({ name: 'Kestrel', hpMax: 20, armorRating: 5, hpField: 'vehicle1_hp' });
  });

  it('treats blank current HP as undamaged', () => {
    // Same reading as token HP: a sheet that has never been hit has no number in it.
    expect(attackCwn.getVehicle(vehicle(1), 1).hp).toBe(20);
    expect(attackCwn.getVehicle(vehicle(1, { vehicle1_hp: 7 }), 1).hp).toBe(7);
  });

  it('is not a vehicle until it has an HP maximum', () => {
    // A half-filled row must not start soaking damage on its owner’s behalf.
    expect(attackCwn.getVehicle({ vehicle1_name: 'Kestrel' }, 1)).toBeNull();
    expect(attackCwn.getVehicle(vehicle(1, { vehicle1_hp_max: 0 }), 1)).toBeNull();
  });

  it('takes -4 while stationary and the driver’s Drive while moving', () => {
    const data = { ...vehicle(1), drive: 3 };
    expect(attackCwn.getVehicle(data, 1, { moving: false }).ac).toBe(8);
    expect(attackCwn.getVehicle(data, 1, { moving: true }).ac).toBe(15);
  });

  it('marks a wreck as destroyed so it stops being cover', () => {
    expect(attackCwn.getVehicle(vehicle(1, { vehicle1_hp: 0 }), 1).destroyed).toBe(true);
    expect(attackCwn.getVehicle(vehicle(1, { vehicle1_hp: 1 }), 1).destroyed).toBe(false);
  });

  it('names an unnamed vehicle so the roll history reads', () => {
    expect(attackCwn.getVehicle({ vehicle4_hp_max: 10 }, 4).name).toBe('VEHICLE 4');
  });

  it('refuses an index outside the declared rows', () => {
    expect(attackCwn.getVehicle(vehicle(1), 0)).toBeNull();
    expect(attackCwn.getVehicle(vehicle(1), attackCwn.VEHICLE_ROWS + 1)).toBeNull();
  });
});
