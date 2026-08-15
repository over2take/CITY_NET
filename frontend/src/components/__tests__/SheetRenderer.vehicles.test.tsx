import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber, CWN_VEHICLE_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { VEHICLE_PRESETS, getPreset, presetFields } from '../../sheets/vehiclePresets';

/**
 * Repeated entries collapse.
 *
 * Six vehicles declared and all six rendered gave thirty rows of empty fields on a blank
 * sheet. Visibility is derived from the data instead — which also means the vehicles you
 * filled in are the ones that come back after a reload, with nothing remembering anything.
 */

const vehicles = citiesWithoutNumber.sections.find(s => s.id === 'vehicles')!;

const renderSheet = (data: Record<string, unknown>) =>
  render(
    <SheetRenderer
      // One tab holding only the vehicles section, so it is the active tab on render.
      template={{ ...citiesWithoutNumber, tabs: ['GEAR'], sections: [vehicles] }}
      data={data as never}
      readOnly={false}
      onFieldChange={vi.fn()}
    />
  );

describe('vehicles section', () => {
  it('declares more vehicles than it shows at rest', () => {
    // The template has to declare every field it might ever need, because ids are
    // static. Showing them all is the thing being avoided.
    expect(vehicles.fields.filter(f => /^vehicle\d+_name$/.test(f.id))).toHaveLength(6);
    // Twelve stat fields plus three mounts of six.
    expect(vehicles.groupSize).toBe(30);
    expect(vehicles.fields.length % vehicles.groupSize!).toBe(0);
  });

  it('carries a mount row per hardpoint the book allows', () => {
    // A Tank mounts three. Declaring fewer would leave its guns unfireable.
    expect(CWN_VEHICLE_WEAPON_ROWS).toBe(3);
    expect(Math.max(...VEHICLE_PRESETS.map(p => p.hrdpt))).toBe(CWN_VEHICLE_WEAPON_ROWS);
  });

  it('shows one empty vehicle on a blank sheet, not six', () => {
    renderSheet({});
    expect(screen.getByText(/\+ ADD/)).toBeInTheDocument();
  });

  it('offers a way to reveal the next one', async () => {
    renderSheet({});
    const before = document.querySelectorAll('input').length;
    await userEvent.click(screen.getByText(/\+ ADD/));
    expect(document.querySelectorAll('input').length).toBeGreaterThan(before);
  });

  it('shows a filled vehicle without anyone pressing anything', () => {
    // The reload case: state is derived from the data, so a vehicle with a name in it
    // is visible the moment the sheet loads.
    renderSheet({ vehicle1_name: 'Kestrel AV', vehicle2_name: 'Mule' });
    expect(screen.getByDisplayValue('Kestrel AV')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mule')).toBeInTheDocument();
  });

  it('counts any field as data, not just the name', () => {
    // Someone may fill in a mount before naming the vehicle.
    renderSheet({ vehicle1_weapon1_dmg: '2d8' });
    expect(screen.getByDisplayValue('2d8')).toBeInTheDocument();
  });

  it('treats whitespace as empty so a stray space does not pin a row open', () => {
    renderSheet({ vehicle1_name: '   ' });
    expect(screen.getByText(/\+ ADD/)).toBeInTheDocument();
  });

  it('hides the add button once every vehicle is showing', async () => {
    const filled: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) filled[`vehicle${i}_name`] = `V${i}`;
    renderSheet(filled);
    expect(screen.queryByText(/\+ ADD/)).toBeNull();
  });

  it('holds the stats the rules actually resolve', () => {
    const ids = vehicles.fields.map(f => f.id);
    for (const f of ['crew', 'hrdpt', 'tt', 'spd', 'ac', 'armor', 'hp_max']) {
      expect(ids, `vehicle1_${f} missing`).toContain(`vehicle1_${f}`);
    }
  });

  it('no longer carries the occupancy block, which the window replaced', () => {
    // Where people are sitting is shared state, not something each occupant declares on
    // their own sheet where nothing reconciles it.
    expect(citiesWithoutNumber.sections.find(s => s.id === 'vehicle_status')).toBeUndefined();
    for (const gone of ['in_vehicle', 'ride_owner', 'ride_vehicle', 'vehicle_seat', 'vehicle_moving']) {
      expect(citiesWithoutNumber.sections.some(s => s.fields.some(f => f.id === gone))).toBe(false);
    }
  });

  it('leaves the weapons section alone, which declares no group size', () => {
    // Weapons render every row as before; only sections opting in collapse.
    const weapons = citiesWithoutNumber.sections.find(s => s.id === 'weapons')!;
    expect(weapons.groupSize).toBeUndefined();
  });
});

describe('vehicle presets', () => {
  it('matches the book for a car', () => {
    expect(getPreset('car')).toMatchObject({ ac: 11, hp: 30, armor: 6, tt: 12, crew: 5, hrdpt: 1, spd: 0 });
  });

  it('leaves armour unset where the book prints an immunity instead of a number', () => {
    // Inventing a rating for a Tank would be worse than the GM reading the note.
    expect(getPreset('tank')!.armor).toBeNull();
    expect(getPreset('apc')!.armor).toBeNull();
    expect(presetFields(1, getPreset('tank')!)).not.toHaveProperty('vehicle1_armor');
    expect(getPreset('tank')!.note).toBeTruthy();
  });

  it('writes the stat block onto the right vehicle row', () => {
    expect(presetFields(3, getPreset('motorcycle')!)).toMatchObject({
      vehicle3_name: 'MOTORCYCLE', vehicle3_crew: 1, vehicle3_hrdpt: 0, vehicle3_tt: 10,
    });
  });

  it('has a vehicle whose guns outnumber its crew', () => {
    // The Tank: crew 3, three hardpoints. It can never man every gun and drive at once,
    // which is why mounts are not seats — making them seats would hand it a fourth body.
    const tank = getPreset('tank')!;
    expect(tank.hrdpt).toBeGreaterThan(tank.crew - 1);
  });

  it('names only the seats worth naming', () => {
    // An APC seats sixteen; the rest are numbered rather than invented.
    expect(getPreset('car')!.seatNames).toHaveLength(5);
    expect(getPreset('apc')!.seatNames!.length).toBeLessThan(getPreset('apc')!.crew);
  });
});
