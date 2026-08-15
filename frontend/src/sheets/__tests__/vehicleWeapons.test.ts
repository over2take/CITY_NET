import { describe, it, expect } from 'vitest';
import { VEHICLE_WEAPONS, getVehicleWeapon, weaponMountFields, fitsVehicle } from '../vehicleWeapons';

/**
 * The mount table, p.81. Ten weapons a hardpoint can carry — five purpose-built for
 * vehicles, the rest Heavy weapons from the personal tables that a mount can hold.
 */

describe('vehicle weapons', () => {
  it('has all ten', () => {
    expect(VEHICLE_WEAPONS).toHaveLength(10);
  });

  it('matches the book for the main tank gun', () => {
    expect(getVehicleWeapon('main_tank_gun')).toMatchObject({
      power: 1, mass: 4, minSize: 'L', dmg: '4d12', trauma: 'd20/x4', cost: 100000, mag: 1,
    });
  });

  it('leaves damage off the weapons the book gives none', () => {
    // A grenade launcher fires whatever you loaded; "other small arms" is a category.
    expect(getVehicleWeapon('grenade_launcher')!.dmg).toBeUndefined();
    expect(getVehicleWeapon('other_small_arms')!.dmg).toBeUndefined();
    for (const id of ['grenade_launcher', 'other_small_arms']) {
      expect(getVehicleWeapon(id)!.note, `${id} should explain itself`).toBeTruthy();
    }
  });

  it('keeps the damage clean and puts the marker on the trauma', () => {
    // The book prints 4d12! — a ! in the damage would be fed to the dice roller.
    const fields = weaponMountFields(2, 1, getVehicleWeapon('main_tank_gun')!);
    expect(fields.vehicle2_weapon1_dmg).toBe('4d12');
    expect(fields.vehicle2_weapon1_trauma).toBe('d20/x4!');
  });

  it('gives a weapon with no trauma die a blank rather than a stale one', () => {
    // A shrieker gun cannot traumatise anything; it must not inherit the last value.
    expect(weaponMountFields(1, 1, getVehicleWeapon('shrieker_gun')!).vehicle1_weapon1_trauma).toBe('');
  });

  it('writes onto the mount it was picked for', () => {
    const fields = weaponMountFields(4, 3, getVehicleWeapon('drone_cannon')!);
    expect(Object.keys(fields).every(k => k.startsWith('vehicle4_weapon3_'))).toBe(true);
    expect(fields.vehicle4_weapon3_name).toBe('DRONE CANNON');
    expect(fields.vehicle4_weapon3_skill).toBe('shoot');
  });

  it('knows which hulls can carry which weapon', () => {
    const tankGun = getVehicleWeapon('main_tank_gun')!;   // L
    const droneCannon = getVehicleWeapon('drone_cannon')!; // M
    expect(fitsVehicle(tankGun, 'L')).toBe(true);
    expect(fitsVehicle(tankGun, 'M')).toBe(false);
    expect(fitsVehicle(droneCannon, 'L')).toBe(true);
    expect(fitsVehicle(droneCannon, 'S')).toBe(false);
    // An unknown or unset size should not block anything.
    expect(fitsVehicle(tankGun, '')).toBe(true);
  });

  it('costs power and mass, which is what the budget will spend', () => {
    for (const w of VEHICLE_WEAPONS) {
      expect(w.power, `${w.label} power`).toBeGreaterThanOrEqual(0);
      expect(w.mass, `${w.label} mass`).toBeGreaterThanOrEqual(1);
    }
  });
});
