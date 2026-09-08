import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';

/**
 * The encumbrance line at the top of GEAR, and the CARRY/ENC pair on a weapon.
 *
 * The arithmetic is tested in sheets/__tests__/cwnEncumbrance.test.ts. What is tested here
 * is that the sheet actually shows it: the count, whether the house rule is charging for
 * it, and the two controls that feed it.
 */

const show = (data: Record<string, unknown>, enforced = false) => {
  const onFieldChange = vi.fn();
  render(
    <SheetRenderer
      template={citiesWithoutNumber}
      data={data as never}
      readOnly={false}
      onFieldChange={onFieldChange}
      encumbranceEnforced={enforced}
    />,
  );
  return onFieldChange;
};

const gear = () => userEvent.click(screen.getByRole('button', { name: 'GEAR' }));

/** Str 10 readies 5 and stows 10. Armor 1 + a readied pistol 1 = 2 readied. */
const LOADED = {
  str: 10, move: 10, armor_enc: 1,
  weapon1_name: 'Heavy Pistol', weapon1_enc: '1', weapon1_carry: 'readied',
  weapon2_name: 'Combat Rifle', weapon2_enc: '2', weapon2_carry: 'stowed',
};

describe('the count at the top of GEAR', () => {
  it('shows both tracks against their own limits', async () => {
    show(LOADED);
    await gear();
    expect(screen.getByText(/READIED 2\/5 · STOWED 2\/10/)).toBeInTheDocument();
  });

  it('counts worn armor as readied and a stowed weapon as stowed', async () => {
    // The two are limited apart, so which side a thing lands on matters.
    show({ ...LOADED, weapon1_carry: 'stowed' });
    await gear();
    expect(screen.getByText(/READIED 1\/5 · STOWED 3\/10/)).toBeInTheDocument();
  });

  it('adds up the inventory, which used to be prose it could not count', async () => {
    show({
      ...LOADED,
      inventory: JSON.stringify([
        { name: 'Medkit', qty: 3, enc: '1', carry: 'readied' },
        { name: 'Rope', qty: 2, enc: '2', carry: 'stowed' },
      ]),
    });
    await gear();
    expect(screen.getByText(/READIED 5\/5 · STOWED 6\/10/)).toBeInTheDocument();
  });
});

describe('whether being over costs anything', () => {
  // 6 readied against a limit of 5: armor 1, a readied pistol 1, and four of ammunition.
  const OVER = {
    ...LOADED,
    inventory: JSON.stringify([{ name: 'Ammunition', qty: 4, enc: '1', carry: 'readied' }]),
  };

  it('says what it would cost, and that nothing is being charged', async () => {
    show(OVER, false);
    await gear();
    expect(screen.getByText(/overloaded, Move -30%/)).toBeInTheDocument();
    expect(screen.getByText(/Not enforced/)).toBeInTheDocument();
  });

  it('states the effective rate when the house rule is on', async () => {
    show(OVER, true);
    await gear();
    expect(screen.getByText(/Move is 7m rather than 10m/)).toBeInTheDocument();
    expect(screen.queryByText(/Not enforced/)).toBeNull();
  });

  it('says nothing extra while everything fits', async () => {
    show(LOADED, true);
    await gear();
    expect(screen.queryByText(/overloaded/)).toBeNull();
    expect(screen.queryByText(/Not enforced/)).toBeNull();
  });

  it('says when more is being carried than can be hauled', async () => {
    show({
      ...LOADED,
      inventory: JSON.stringify([{ name: 'Anvil', qty: 20, enc: '1', carry: 'readied' }]),
    }, true);
    await gear();
    expect(screen.getByText(/more than can be hauled/)).toBeInTheDocument();
  });
});

describe('the CARRY and ENC pair on a weapon', () => {
  it('draws both on one row rather than two', async () => {
    // The stat row above ran out of space at seven columns, so these share a line. Same
    // grid row means the labels sit level, which they did not when it was a flex pair.
    show(LOADED);
    await gear();
    const carry = screen.getAllByRole('radiogroup', { name: 'CARRY' })[0];
    const grid = carry.closest('div[style*="grid-template-columns"]')!;
    const cells = [...grid.children].map((c) => c.textContent?.trim());
    expect(cells[0]).toBe('CARRY');
    expect(cells[1]).toBe('ENC');
  });

  it('takes any Enc the book prints, not a fixed list', async () => {
    // It was a picker of the five guideline sizes until the Automatic Rifle turned up at
    // 4, which the picker could not express. The weapon and armour tables print their own
    // values and the guideline's last row is "5+", so it is typed.
    const wrote = show(LOADED);
    await gear();
    const boxes = screen.getAllByLabelText('ENC') as HTMLInputElement[];
    expect(boxes.every((b) => b.tagName === 'INPUT')).toBe(true);

    await userEvent.type(boxes[boxes.length - 1], '4');
    expect(wrote.mock.calls.some(([id, v]) => /^weapon\d+_enc$/.test(id) && v === 4)).toBe(true);
  });
});
