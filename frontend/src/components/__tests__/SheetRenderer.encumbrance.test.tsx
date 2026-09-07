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

  it('adds what the player totalled for the gear notes', async () => {
    show({ ...LOADED, gear_enc_readied: 3, gear_enc_stowed: 4 });
    await gear();
    expect(screen.getByText(/READIED 5\/5 · STOWED 6\/10/)).toBeInTheDocument();
  });
});

describe('whether being over costs anything', () => {
  const OVER = { ...LOADED, gear_enc_readied: 4 };  // 6 readied against a limit of 5

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
    show({ ...LOADED, gear_enc_readied: 20 }, true);
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

  /**
   * The weapon's, specifically.
   *
   * Armor has an ENC too, and it is a number box rather than a picker - both are labelled
   * ENC and both live on the GEAR tab, so the first match is whichever renders first.
   */
  const weaponEnc = () =>
    screen.getAllByLabelText('ENC').find((el) => el.tagName === 'SELECT') as HTMLSelectElement;

  it('offers only the sizes the book prints', async () => {
    show(LOADED);
    await gear();
    expect([...weaponEnc().options].map((o) => o.value)).toEqual(['', '0', '1', '2', '5', '12']);
  });

  it('writes the size to that weapon', async () => {
    const wrote = show(LOADED);
    await gear();
    await userEvent.selectOptions(weaponEnc(), '2');
    expect(wrote).toHaveBeenCalledWith('weapon1_enc', '2');
  });

  it("keeps armor's own ENC as a number box, not a picker", async () => {
    // Two fields share the label on one tab. They mean the same thing and are entered
    // differently: armor's comes off the book's armor table as a plain number.
    show(LOADED);
    await gear();
    const armorEnc = screen.getAllByLabelText('ENC').find((el) => el.tagName === 'INPUT');
    expect(armorEnc).toBeTruthy();
  });
});
