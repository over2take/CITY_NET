import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber, CWN_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { STASH_FIELD } from '../../sheets/cwnWeaponStash';

/**
 * Moving a weapon between the stash and the carried rows.
 *
 * The risk in both directions is the same: a weapon that ends up in both places, or in
 * neither. So each move is ONE save carrying every field it touches - the row and the
 * shortened stash land together or not at all.
 */

const stash = (rows: unknown[]) => JSON.stringify(rows);

const show = (data: Record<string, unknown>) => {
  const onFieldsChange = vi.fn();
  const onFieldChange = vi.fn();
  render(
    <SheetRenderer
      template={citiesWithoutNumber}
      data={data as never}
      readOnly={false}
      onFieldChange={onFieldChange}
      onFieldsChange={onFieldsChange}
    />,
  );
  return { onFieldsChange, onFieldChange };
};

const gear = async () => userEvent.click(screen.getByRole('button', { name: 'GEAR' }));

const RIFLE = {
  name: 'Combat Rifle', dmg: '1d12', skill: 'shoot', attr: 'dex',
  trauma: 'd8/x3', shock: '', atk: 1, enc: '2', mods: '[]', location: 'safehouse',
};

describe('taking one out of the stash', () => {
  it('fills the first free row and shortens the stash in one save', async () => {
    const { onFieldsChange } = show({ [STASH_FIELD]: stash([RIFLE]), weapon1_name: 'gun' });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'CARRY' }));

    const [saved] = onFieldsChange.mock.calls[0];
    // Row 2, because row 1 is taken.
    expect(saved).toMatchObject({ weapon2_name: 'Combat Rifle', weapon2_dmg: '1d12', weapon2_enc: '2' });
    // And it left the stash in the same write, so it cannot exist twice.
    expect(JSON.parse(saved[STASH_FIELD])).toEqual([]);
  });

  it('lands it stowed', async () => {
    const { onFieldsChange } = show({ [STASH_FIELD]: stash([RIFLE]) });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'CARRY' }));
    expect(onFieldsChange.mock.calls[0][0].weapon1_carry).toBe('stowed');
  });

  it('refuses when every row is full, and says why', async () => {
    const full: Record<string, unknown> = { [STASH_FIELD]: stash([RIFLE]) };
    for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) full[`weapon${i}_name`] = 'gun';
    const { onFieldsChange } = show(full);
    await gear();

    expect(screen.getByRole('button', { name: 'CARRY' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`All ${CWN_WEAPON_ROWS} weapon rows are full`))).toBeInTheDocument();
    expect(onFieldsChange).not.toHaveBeenCalled();
  });
});

describe('putting one away', () => {
  it('empties the row and lengthens the stash in one save', async () => {
    const { onFieldsChange } = show({
      weapon2_name: 'Shotgun', weapon2_dmg: '3d4', weapon2_enc: '2', weapon2_carry: 'readied',
    });
    await gear();
    await userEvent.selectOptions(screen.getByLabelText('Stash a carried weapon'), '2');

    const [saved] = onFieldsChange.mock.calls[0];
    expect(saved.weapon2_name).toBe('');
    expect(saved.weapon2_carry).toBe('');
    // Cleared to empty, not to zero: a zero would keep the row on screen forever.
    expect(saved.weapon2_atk).toBe('');
    expect(JSON.parse(saved[STASH_FIELD])[0]).toMatchObject({ name: 'Shotgun', dmg: '3d4', enc: '2' });
  });

  it('closes the gap so no blank row is left behind', async () => {
    // What the owner hit: stashing the first of two weapons left an empty row on screen
    // that nothing could remove.
    const { onFieldsChange } = show({
      weapon1_name: 'gun', weapon1_dmg: '1d6',
      weapon2_name: 'knife', weapon2_dmg: '1d12',
    });
    await gear();
    await userEvent.selectOptions(screen.getByLabelText('Stash a carried weapon'), '1');

    const [saved] = onFieldsChange.mock.calls[0];
    expect(saved.weapon1_name).toBe('knife');
    expect(saved.weapon2_name).toBe('');
    expect(JSON.parse(saved[STASH_FIELD])[0]).toMatchObject({ name: 'gun' });
  });

  it('offers only rows that have a weapon in them', async () => {
    show({ weapon1_name: 'gun', weapon4_name: 'knife' });
    await gear();
    const picker = screen.getByLabelText('Stash a carried weapon') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent))
      .toEqual(['+ PUT ONE AWAY…', 'gun', 'knife']);
  });

  it('offers nothing to put away when nothing is carried', async () => {
    show({ [STASH_FIELD]: stash([RIFLE]) });
    await gear();
    expect(screen.queryByLabelText('Stash a carried weapon')).toBeNull();
  });
});

describe('what the list shows', () => {
  it('says where a stashed weapon is, and lets it be changed', async () => {
    const { onFieldChange } = show({ [STASH_FIELD]: stash([RIFLE]) });
    await gear();
    const where = screen.getByLabelText('Location of Combat Rifle') as HTMLInputElement;
    expect(where.value).toBe('safehouse');

    await userEvent.clear(where);
    await userEvent.type(where, 'K');
    const last = onFieldChange.mock.calls.at(-1)!;
    expect(last[0]).toBe(STASH_FIELD);
  });

  it('explains itself when empty rather than showing a bare heading', async () => {
    show({});
    await gear();
    expect(screen.getByText(/Nothing stashed/)).toBeInTheDocument();
  });
});
