import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber, CWN_VEHICLE_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { VEHICLE_PRESETS, VEHICLE_TYPE_OPTIONS, getPreset, presetFields, isPresetName } from '../../sheets/vehiclePresets';

/**
 * Repeated entries collapse.
 *
 * Six vehicles declared and all six rendered gave thirty rows of empty fields on a blank
 * sheet. Visibility is derived from the data instead — which also means the vehicles you
 * filled in are the ones that come back after a reload, with nothing remembering anything.
 */

const vehicles = citiesWithoutNumber.sections.find(s => s.id === 'vehicles')!;

const renderSheet = (
  data: Record<string, unknown>,
  handlers: { onFieldChange?: ReturnType<typeof vi.fn>; onFieldsChange?: ReturnType<typeof vi.fn> } = {},
) =>
  render(
    <SheetRenderer
      // One tab holding only the vehicles section, so it is the active tab on render.
      template={{ ...citiesWithoutNumber, tabs: ['GEAR'], sections: [vehicles] }}
      data={data as never}
      readOnly={false}
      onFieldChange={handlers.onFieldChange ?? vi.fn()}
      onFieldsChange={handlers.onFieldsChange}
    />
  );

describe('vehicles section', () => {
  it('declares more vehicles than it shows at rest', () => {
    // The template has to declare every field it might ever need, because ids are
    // static. Showing them all is the thing being avoided.
    expect(vehicles.fields.filter(f => /^vehicle\d+_name$/.test(f.id))).toHaveLength(6);
    // Fourteen stat fields, three mounts of six, a fittings list and a notes box.
    expect(vehicles.groupSize).toBe(34);
    expect(vehicles.fields.length % vehicles.groupSize!).toBe(0);
  });

  it('carries a mount row per hardpoint the book allows', () => {
    // A Tank mounts three. Declaring fewer would leave its guns unfireable.
    expect(CWN_VEHICLE_WEAPON_ROWS).toBe(3);
    expect(Math.max(...VEHICLE_PRESETS.map(p => p.hrdpt))).toBe(CWN_VEHICLE_WEAPON_ROWS);
  });

  it('shows nothing at all until a vehicle is added', () => {
    renderSheet({});
    // A blank entry full of placeholder text reads like real data at a glance.
    expect(screen.queryByLabelText('VEHICLE')).toBeNull();
    expect(screen.getByText(/\+ ADD/)).toBeInTheDocument();
  });

  it('seeds a motorcycle when you add one', async () => {
    const onFieldsChange = vi.fn();
    renderSheet({}, { onFieldsChange });
    await userEvent.click(screen.getByText(/\+ ADD/));
    // Not a blank row: an unset type meant no crew, no hardpoints and no Trauma Target.
    expect(onFieldsChange).toHaveBeenCalledTimes(1);
    expect(onFieldsChange.mock.calls[0][0]).toMatchObject({
      vehicle1_type: 'motorcycle', vehicle1_crew: 1, vehicle1_hrdpt: 0, vehicle1_tt: 10,
    });
  });

  it('adds the next one after the ones already there', async () => {
    const onFieldsChange = vi.fn();
    renderSheet({ ...presetFields(1, getPreset('car')!) }, { onFieldsChange });
    await userEvent.click(screen.getByText(/\+ ADD/));
    expect(onFieldsChange.mock.calls[0][0]).toHaveProperty('vehicle2_type', 'motorcycle');
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

  it('gives each vehicle its own notes box', () => {
    // A single box at the foot of the page cannot say which vehicle it describes.
    expect(citiesWithoutNumber.sections.find(s => s.id === 'vehicle_notes')).toBeUndefined();
    expect(vehicles.fields.filter(f => /^vehicle\d+_notes$/.test(f.id))).toHaveLength(6);
    expect(vehicles.fields.find(f => f.id === 'vehicle1_notes')!.fullWidth).toBe(true);
  });

  it('shows exactly one entry for one vehicle', () => {
    // A spare blank below it rendered one vehicle as two, the second full of ghost
    // placeholder text that reads like real data at a glance.
    renderSheet({ ...presetFields(1, getPreset('truck')!) });
    expect(screen.getAllByLabelText('VEHICLE')).toHaveLength(1);
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

describe('the sheet reacting to the vehicle type', () => {
  const typeField = vehicles.fields.find(f => f.id === 'vehicle1_type')!;
  const fill = (value: string, data: Record<string, unknown> = {}) =>
    typeField.presetFill!(value, data as never);

  it('fills the stat block when a type is picked', () => {
    expect(fill('car')).toMatchObject({
      vehicle1_hp: 30, vehicle1_hp_max: 30, vehicle1_ac: 11, vehicle1_armor: 6,
      vehicle1_tt: 12, vehicle1_crew: 5, vehicle1_hrdpt: 1,
    });
  });

  it('does not rename a vehicle someone has already named', () => {
    expect(fill('car')).toHaveProperty('vehicle1_name', 'CAR');
    // Their Betty stays Betty.
    expect(fill('car', { vehicle1_name: 'Betty' })).not.toHaveProperty('vehicle1_name');
  });

  it('renames one still carrying a type label', () => {
    // A vehicle called MOTORCYCLE has not been named at all, so changing it to a Tank
    // should not leave it called MOTORCYCLE.
    expect(fill('tank', { vehicle1_name: 'MOTORCYCLE' })).toHaveProperty('vehicle1_name', 'TANK');
    expect(fill('tank', { vehicle1_name: '  micro flyer ' })).toHaveProperty('vehicle1_name', 'TANK');
  });

  it('offers no CUSTOM type', () => {
    // A vehicle with no type had no crew, no hardpoints and no Trauma Target: it seated
    // one person, refused to fire mounts you could still fill in, and took traumatic hits
    // twice as often as any real vehicle.
    expect(VEHICLE_TYPE_OPTIONS.some(o => o.value === '')).toBe(false);
    expect(VEHICLE_TYPE_OPTIONS).toHaveLength(VEHICLE_PRESETS.length);
    expect(isPresetName('TANK')).toBe(true);
    expect(isPresetName('Betty')).toBe(false);
  });

  it('writes the immunity rule into that vehicle’s own notes, once', () => {
    const first = fill('tank');
    expect(String(first.vehicle1_notes)).toMatch(/Immune/);
    // One shared notes box for six vehicles could not say which one it described.
    expect(first).not.toHaveProperty('vehicles_notes');
    // Re-picking the same type must not stack the note up.
    expect(fill('tank', { vehicle1_notes: first.vehicle1_notes })).not.toHaveProperty('vehicle1_notes');
  });

  it('leaves a note the player wrote alone', () => {
    const out = fill('tank', { vehicle1_notes: 'Stolen from a cop' });
    expect(String(out.vehicle1_notes).startsWith('Stolen from a cop\n')).toBe(true);
  });

  it('writes nothing for a custom vehicle', () => {
    expect(fill('')).toEqual({});
  });

  it('hides the mounts a vehicle has no hardpoints for', () => {
    const hidden = vehicles.rowHidden!;
    const mount2 = vehicles.fields.filter(f => f.id.startsWith('vehicle1_weapon2_'));
    const statRow = vehicles.fields.slice(0, 6);

    // A motorcycle carries none, so drawing three empty mount rows says something false.
    expect(hidden(mount2, { vehicle1_hrdpt: 0 } as never)).toBe(true);
    expect(hidden(mount2, { vehicle1_hrdpt: 1 } as never)).toBe(true);
    expect(hidden(mount2, { vehicle1_hrdpt: 2 } as never)).toBe(false);
    // Stat rows are never hidden.
    expect(hidden(statRow, { vehicle1_hrdpt: 0 } as never)).toBe(false);
  });

  it('never hides a mount that has something in it', () => {
    const hidden = vehicles.rowHidden!;
    const mount3 = vehicles.fields.filter(f => f.id.startsWith('vehicle1_weapon3_'));
    // Past the hardpoints and empty: hidden. Past them but filled in: shown, because
    // vanishing someone's data reads as loss and a GM may have overloaded it on purpose.
    expect(hidden(mount3, { vehicle1_hrdpt: 1 } as never)).toBe(true);
    expect(hidden(mount3, { vehicle1_hrdpt: 1, vehicle1_weapon3_dmg: '2d8' } as never)).toBe(false);
    // Whitespace is not data, same reading as everywhere else on the sheet.
    expect(hidden(mount3, { vehicle1_hrdpt: 1, vehicle1_weapon3_dmg: '  ' } as never)).toBe(true);
  });

  it('hides mounts per vehicle, not across the section', () => {
    const hidden = vehicles.rowHidden!;
    const data = { vehicle1_hrdpt: 0, vehicle2_hrdpt: 3 } as never;
    expect(hidden(vehicles.fields.filter(f => f.id.startsWith('vehicle1_weapon1_')), data)).toBe(true);
    expect(hidden(vehicles.fields.filter(f => f.id.startsWith('vehicle2_weapon3_')), data)).toBe(false);
  });

  it('draws no mounts on a motorcycle and three on a tank', () => {
    renderSheet({ ...presetFields(1, getPreset('motorcycle')!) });
    expect(screen.queryByText('MOUNT 1')).toBeNull();

    document.body.innerHTML = '';
    renderSheet({ ...presetFields(1, getPreset('tank')!) });
    expect(screen.getByText('MOUNT 3')).toBeInTheDocument();
  });
});

describe('the fittings list', () => {
  const fittings = vehicles.fields.find(f => f.id === 'vehicle1_fittings')!;
  const car = { ...presetFields(1, getPreset('car')!) } as Record<string, unknown>;

  it('is a list rather than a set of fields', () => {
    // A fitting can be stripped out again; a control that wrote "+25% HP" into the stat
    // block would have no way to take it back.
    expect(fittings.type).toBe('tag_list');
    expect(fittings.fullWidth).toBe(true);
  });

  it('offers only what the hull can take', () => {
    const onL = fittings.tagOptions!({ vehicle1_size: 'L' } as never).map(o => o.value);
    const onS = fittings.tagOptions!({ vehicle1_size: 'S' } as never).map(o => o.value);
    expect(onL).toContain('living_quarters');
    expect(onS).not.toContain('living_quarters');
    expect(onS).toContain('cargo_space');
  });

  it('reports the budget, counting mounted weapons too', () => {
    // A Car is 3 power / 7 mass. A drone cannon is 1/1, a medbay 1/2.
    const data = { ...car, vehicle1_weapon1_type: 'drone_cannon' } as never;
    expect(fittings.tagSummary!(['medbay'], data)).toEqual({ text: 'POWER 2/3 · MASS 3/7', warn: false });
  });

  it('shows a power supply in the total, not as a negative spend', () => {
    // POWER -6/8 was nonsense: a Power System adds to the pool rather than un-spending.
    const tank = { ...presetFields(1, getPreset('tank')!) } as never;
    const out = fittings.tagSummary!(['tool_rack', 'power_medium', 'power_small'], tank);
    expect(out.text.startsWith('POWER 0/14 (+6)')).toBe(true);
    expect(out.text.includes('-')).toBe(false);
    expect(out.warn).toBe(false);
  });

  it('says so when the vehicle is overloaded', () => {
    const out = fittings.tagSummary!(['medbay', 'ecm_emitter', 'jack_control_port'], car as never);
    expect(out.warn).toBe(true);
    expect(out.text).toMatch(/OVER BUDGET/);
  });

  it('installs and removes through the sheet', async () => {
    const onFieldChange = vi.fn();
    renderSheet(car, { onFieldChange });

    await userEvent.selectOptions(screen.getByLabelText('Add FITTINGS'), 'medbay');
    expect(onFieldChange).toHaveBeenCalledWith('vehicle1_fittings', '["medbay"]');

    onFieldChange.mockClear();
    renderSheet({ ...car, vehicle1_fittings: '["medbay"]' }, { onFieldChange });
    await userEvent.click(screen.getAllByLabelText('Remove medbay')[0]);
    expect(onFieldChange).toHaveBeenCalledWith('vehicle1_fittings', '[]');
  });
});

describe('picking a type writes once', () => {
  it('sends the whole stat block as a single change', async () => {
    const onFieldsChange = vi.fn();
    const onFieldChange = vi.fn();
    renderSheet({ vehicle1_name: 'Betty' }, { onFieldsChange, onFieldChange });

    await userEvent.selectOptions(screen.getAllByLabelText('TYPE')[0], 'car');

    // One save, not a dozen: the server rewrites the whole sheet per field change, so
    // separate saves race and all but the last are lost.
    expect(onFieldsChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange).not.toHaveBeenCalled();
    const batch = onFieldsChange.mock.calls[0][0];
    expect(batch).toMatchObject({ vehicle1_type: 'car', vehicle1_hp_max: 30, vehicle1_crew: 5 });
    // The type itself has to be in the batch, or it saves as CUSTOM.
    expect(batch.vehicle1_type).toBe('car');
  });

  it('falls back to single writes when no batch handler is given', async () => {
    const onFieldChange = vi.fn();
    renderSheet({ ...presetFields(1, getPreset('car')!) }, { onFieldChange });
    await userEvent.selectOptions(screen.getAllByLabelText('TYPE')[0], 'tank');
    expect(onFieldChange.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('removing a vehicle', () => {
  const filled = { ...presetFields(1, getPreset('car')!) } as Record<string, unknown>;

  it('offers no remove on an entry with nothing in it', () => {
    renderSheet({});
    expect(screen.queryByText('REMOVE')).toBeNull();
  });

  it('takes two clicks, so a stray one cannot wipe thirty fields', async () => {
    const onFieldsChange = vi.fn();
    renderSheet(filled, { onFieldsChange });

    await userEvent.click(screen.getByText('REMOVE'));
    expect(onFieldsChange).not.toHaveBeenCalled();
    expect(screen.getByText('REMOVE — CONFIRM')).toBeInTheDocument();

    await userEvent.click(screen.getByText('REMOVE — CONFIRM'));
    expect(onFieldsChange).toHaveBeenCalledTimes(1);
  });

  it('blanks every field of that vehicle and no other', async () => {
    const onFieldsChange = vi.fn();
    renderSheet({ ...filled, vehicle2_name: 'Mule' }, { onFieldsChange });

    await userEvent.click(screen.getAllByText('REMOVE')[0]);
    await userEvent.click(screen.getByText('REMOVE — CONFIRM'));

    const cleared = onFieldsChange.mock.calls[0][0];
    expect(Object.keys(cleared)).toHaveLength(vehicles.groupSize);
    expect(cleared.vehicle1_notes).toBe('');
    expect(cleared.vehicle1_name).toBe('');
    expect(cleared.vehicle1_hp_max).toBe('');
    expect(cleared.vehicle1_weapon3_dmg).toBe('');
    // Entries are referenced by position elsewhere, so nothing shifts up.
    expect(cleared).not.toHaveProperty('vehicle2_name');
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
