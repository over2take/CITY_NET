import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';

/**
 * Repeated entries collapse.
 *
 * Six vehicles declared and all six rendered gave eighteen rows of empty fields on a
 * blank sheet. Visibility is derived from the data instead — which also means the
 * vehicles you filled in are the ones that come back after a reload, with nothing
 * remembering anything.
 */

const vehicles = citiesWithoutNumber.sections.find(s => s.id === 'vehicles')!;

/** The RIDING IN choices are derived from the sheet, so they need data to resolve. */
const inVehicleOptions = (data: Record<string, unknown>) => {
  const field = citiesWithoutNumber.sections
    .find(s => s.id === 'vehicle_status')!.fields.find(f => f.id === 'in_vehicle')!;
  if (typeof field.options !== 'function') throw new Error('expected data-driven options');
  return field.options(data as never);
};

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
    expect(vehicles.groupSize).toBe(18);
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

  it('keeps occupancy out of the collapsing group', () => {
    // Where you are is one block, not one per vehicle — you can only be inside
    // one at a time. Folding it into the vehicle rows would also break the
    // group size, which has to divide the section evenly.
    const status = citiesWithoutNumber.sections.find(s => s.id === 'vehicle_status')!;
    expect(status).toBeTruthy();
    expect(status.groupSize).toBeUndefined();
    expect(vehicles.fields.some(f => f.id === 'in_vehicle')).toBe(false);
    expect(vehicles.fields.length % vehicles.groupSize!).toBe(0);
  });

  it('names the vehicles you own instead of numbering them', () => {
    // You know you drive the Kestrel. You do not know it is vehicle 2.
    const opts = inVehicleOptions({ vehicle1_name: 'Car', vehicle3_name: 'Kestrel AV' });
    expect(opts.map(o => o.label)).toEqual(['ON FOOT', 'CAR', 'KESTREL AV', "ANOTHER PLAYER'S VEHICLE"]);
    expect(opts.map(o => o.value)).toEqual(['', 'own:1', 'own:3', 'ride']);
  });

  it('offers no vehicles at all on an empty sheet', () => {
    // Six placeholder rows in the dropdown are six ways to pick the wrong one.
    expect(inVehicleOptions({}).map(o => o.value)).toEqual(['', 'ride']);
  });

  it('keeps the vehicle you are in listed even if its name is cleared', () => {
    // Otherwise the field holds a selection its own dropdown does not contain, and the
    // browser silently shows the first option instead.
    const opts = inVehicleOptions({ in_vehicle: 'own:2' });
    expect(opts.map(o => o.value)).toContain('own:2');
    expect(opts.find(o => o.value === 'own:2')!.label).toBe('VEHICLE 2');
  });

  it('always offers on foot and riding along', () => {
    const opts = inVehicleOptions({ vehicle1_name: 'Car' });
    // On foot has to be reachable again after mounting, and it names the blank state
    // rather than leaving a bare dash.
    expect(opts[0]).toEqual({ value: '', label: 'ON FOOT' });
    expect(opts.some(o => o.value === 'ride')).toBe(true);
  });

  it('shows the vehicle name in the rendered dropdown, with no stray blank', () => {
    const status = citiesWithoutNumber.sections.find(s => s.id === 'vehicle_status')!;
    render(
      <SheetRenderer
        template={{ ...citiesWithoutNumber, tabs: ['GEAR'], sections: [status] }}
        data={{ vehicle1_name: 'Car', in_vehicle: 'own:1' } as never}
        readOnly={false}
        onFieldChange={vi.fn()}
      />
    );
    const select = screen.getByLabelText('RIDING IN') as HTMLSelectElement;
    expect(select.value).toBe('own:1');
    // The template names its own blank state, so the renderer must not add a second one.
    expect([...select.options].filter(o => o.value === '')).toHaveLength(1);
    expect([...select.options].map(o => o.textContent)).toContain('CAR');
  });

  it('leaves the weapons section alone, which declares no group size', () => {
    // Weapons render every row as before; only sections opting in collapse.
    const weapons = citiesWithoutNumber.sections.find(s => s.id === 'weapons')!;
    expect(weapons.groupSize).toBeUndefined();
  });
});
