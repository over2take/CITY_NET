import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber, CWN_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { getTemplate } from '../../sheets';

/**
 * Readied or Stowed, per weapon (CWN p48).
 *
 * Recorded, not enforced: the app does not stop anyone firing a stowed weapon. It is the
 * first half of Encumbrance - the state has to exist before anything can count it.
 *
 * Radios rather than a select because there are two choices and the answer is glanced at
 * every round and changed rarely; a select hides the alternative behind a click.
 */

const weapons = citiesWithoutNumber.sections.find((s) => s.id === 'weapons')!;

const show = (data: Record<string, unknown> = {}) => {
  const onFieldChange = vi.fn();
  render(
    <SheetRenderer
      template={{ ...citiesWithoutNumber, tabs: ['GEAR'], sections: [weapons] }}
      data={data as never}
      readOnly={false}
      onFieldChange={onFieldChange}
    />,
  );
  return onFieldChange;
};

const group = (n = 1) => screen.getAllByRole('radiogroup', { name: 'CARRY' })[n - 1];

describe('where a weapon is being carried', () => {
  it('offers Readied and Stowed on every weapon row', () => {
    show({ weapon1_name: 'Heavy Pistol' });
    expect(screen.getAllByRole('radiogroup', { name: 'CARRY' })).toHaveLength(CWN_WEAPON_ROWS);
    expect(within(group()).getAllByRole('radio')).toHaveLength(2);
  });

  it('starts undecided rather than assuming you are armed', () => {
    // Blank is a real state. Every sheet written before this column existed reads that
    // way, and defaulting to Readied would arm every character in the game at once.
    show({ weapon1_name: 'Heavy Pistol' });
    for (const r of within(group()).getAllByRole('radio')) {
      expect(r).not.toBeChecked();
    }
  });

  it('writes the choice to that weapon', async () => {
    const wrote = show({ weapon1_name: 'Heavy Pistol' });
    await userEvent.click(within(group()).getByRole('radio', { name: 'S' }));
    expect(wrote).toHaveBeenCalledWith('weapon1_carry', 'stowed');
  });

  it('shows what a stored sheet already says', () => {
    show({ weapon1_name: 'Heavy Pistol', weapon1_carry: 'readied' });
    expect(within(group()).getByRole('radio', { name: 'R' })).toBeChecked();
    expect(within(group()).getByRole('radio', { name: 'S' })).not.toBeChecked();
  });

  it('keeps each weapon in its own group', async () => {
    // The bug a shared radio name would cause: readying one weapon would stow the rest,
    // because the browser treats same-named radios as one set.
    const wrote = show({
      weapon1_name: 'Heavy Pistol', weapon1_carry: 'readied',
      weapon2_name: 'Combat Knife', weapon2_carry: 'stowed',
    });
    await userEvent.click(within(group(2)).getByRole('radio', { name: 'R' }));

    expect(wrote).toHaveBeenCalledWith('weapon2_carry', 'readied');
    // The first weapon was not touched, and still reads as it did.
    expect(wrote.mock.calls.some((c) => c[0] === 'weapon1_carry')).toBe(false);
    expect(within(group(1)).getByRole('radio', { name: 'R' })).toBeChecked();
  });
});

describe('it belongs to Cities Without Number', () => {
  it('puts no carry field on another system', () => {
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const ids = getTemplate(id).sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
      expect(ids.filter((f) => /_carry$/.test(f)), id).toEqual([]);
    }
  });

  it('puts one on every CWN weapon row', () => {
    const ids = citiesWithoutNumber.sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
    for (let i = 1; i <= CWN_WEAPON_ROWS; i++) expect(ids).toContain(`weapon${i}_carry`);
  });
});
