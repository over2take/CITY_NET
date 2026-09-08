import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import { cyberpunkRed } from '../../sheets/templates/cyberpunk_red';
import { PHARMA_FIELD } from '../../sheets/cwnPharma';

/**
 * The PHARMACEUTICALS section.
 *
 * The arithmetic lives in sheets/__tests__/cwnPharma.test.ts and the resolver wiring in
 * backend/__tests__/cwn_pharma.test.js. What is tested here is the two places this
 * section writes more than one field at once - Avalanche handing over hit points, and
 * END SCENE billing System Strain - because those are where a one-field write would look
 * fine on screen and quietly lose half the effect.
 */

const show = (data: Record<string, unknown>, template = citiesWithoutNumber) => {
  const onFieldChange = vi.fn();
  const onFieldsChange = vi.fn();
  render(
    <SheetRenderer
      template={template}
      data={data as never}
      readOnly={false}
      onFieldChange={onFieldChange}
      onFieldsChange={onFieldsChange}
    />,
  );
  return { onFieldChange, onFieldsChange };
};

const gear = () => userEvent.click(screen.getByRole('button', { name: 'GEAR' }));
const picker = () => screen.getByRole('combobox', { name: 'Take a dose' });

describe('what is running', () => {
  it('says nothing is, on a clean sheet', async () => {
    show({ str: 10 });
    await gear();
    expect(screen.getByText(/Nothing running/)).toBeInTheDocument();
  });

  it('lists a dose as a chip', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker'] });
    await gear();
    expect(screen.getByText('BONESHAKER')).toBeInTheDocument();
  });

  it('says what the drugs are actually doing', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker'] });
    await gear();
    expect(screen.getByText(/\+2 to hit · \+2 damage · \+2 Shock/)).toBeInTheDocument();
    expect(screen.getByText(/Trauma Dice against you/)).toBeInTheDocument();
  });

  it('shows the highest bonus rather than the sum when two are running', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker', 'olympus'] });
    await gear();
    expect(screen.getByText(/\+2 to hit/)).toBeInTheDocument();
    expect(screen.queryByText(/\+4 to hit/)).not.toBeInTheDocument();
  });

  it('says nothing about numbers for a drug that changes none', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['sand'] });
    await gear();
    expect(screen.getByText('SAND')).toBeInTheDocument();
    expect(screen.queryByText(/to hit/)).not.toBeInTheDocument();
  });

  it('does not offer a drug already running', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker'] });
    await gear();
    expect(screen.queryByRole('option', { name: /BONESHAKER/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /OLYMPUS/ })).toBeInTheDocument();
  });
});

describe('taking a dose', () => {
  it('writes the one field for an ordinary drug', async () => {
    const { onFieldChange } = show({ str: 10 });
    await gear();
    await userEvent.selectOptions(picker(), 'boneshaker');
    expect(onFieldChange).toHaveBeenCalledWith(PHARMA_FIELD, JSON.stringify(['boneshaker']));
  });

  it('hands over Avalanche\'s hit points in the same write', async () => {
    // The one drug that grants HP. A real write, not an overlay: hit points get spent, and
    // a number recomputed on read would hand the +10 back every time the sheet opened.
    const { onFieldsChange } = show({ str: 10, hp: 4 });
    await gear();
    await userEvent.selectOptions(picker(), 'avalanche');
    expect(onFieldsChange).toHaveBeenCalledWith({
      [PHARMA_FIELD]: JSON.stringify(['avalanche']),
      hp: 14,
    });
  });

  it('lets Avalanche take hit points above maximum, as the book says', async () => {
    const { onFieldsChange } = show({ str: 10, hp: 18, hp_max: 20 });
    await gear();
    await userEvent.selectOptions(picker(), 'avalanche');
    expect(onFieldsChange.mock.calls[0][0].hp).toBe(28);
  });

  it('keeps what is already running', async () => {
    const { onFieldChange } = show({ str: 10, [PHARMA_FIELD]: ['olympus'] });
    await gear();
    await userEvent.selectOptions(picker(), 'psycho');
    expect(onFieldChange).toHaveBeenCalledWith(
      PHARMA_FIELD, JSON.stringify(['olympus', 'psycho']),
    );
  });
});

describe('doses come out of the inventory', () => {
  // A dose is a countable miscellaneous thing, so it lives in INVENTORY like ammunition.
  // This section is what is in the bloodstream, which is a state and not a possession.
  const kit = (...rows: { name: string; qty: number; carry?: string }[]) =>
    JSON.stringify(rows.map((r) => ({ carry: 'stowed', enc: '', bundled: false, location: '', ...r })));

  it('offers what you are carrying, with the count', async () => {
    show({ str: 10, inventory: kit({ name: 'Boneshaker', qty: 3 }) });
    await gear();
    expect(screen.getByRole('option', { name: /BONESHAKER ×3/ })).toBeInTheDocument();
  });

  it('spends one and keeps the rest, in the same write', async () => {
    const { onFieldsChange } = show({ str: 10, inventory: kit({ name: 'Boneshaker', qty: 3 }) });
    await gear();
    await userEvent.selectOptions(picker(), 'boneshaker');
    const written = onFieldsChange.mock.calls[0][0];
    expect(written[PHARMA_FIELD]).toBe(JSON.stringify(['boneshaker']));
    expect(JSON.parse(written.inventory as string)).toEqual([
      expect.objectContaining({ name: 'Boneshaker', qty: 2 }),
    ]);
  });

  it('drops the row when the last dose is used', async () => {
    const { onFieldsChange } = show({ str: 10, inventory: kit({ name: 'Olympus', qty: 1 }) });
    await gear();
    await userEvent.selectOptions(picker(), 'olympus');
    expect(JSON.parse(onFieldsChange.mock.calls[0][0].inventory as string)).toEqual([]);
  });

  it('still lets a GM hand over a dose nobody was carrying', async () => {
    // Refusing would make the sheet argue with the table. Nothing is deducted, because
    // there was nothing to deduct.
    const { onFieldChange, onFieldsChange } = show({ str: 10 });
    await gear();
    await userEvent.selectOptions(picker(), 'olympus');
    expect(onFieldChange).toHaveBeenCalledWith(PHARMA_FIELD, JSON.stringify(['olympus']));
    expect(onFieldsChange).not.toHaveBeenCalled();
  });

  it('will not spend a stashed dose, which is not on you', async () => {
    const { onFieldChange } = show({
      str: 10, inventory: kit({ name: 'Olympus', qty: 2, carry: 'stash' }),
    });
    await gear();
    await userEvent.selectOptions(picker(), 'olympus');
    expect(onFieldChange).toHaveBeenCalledWith(PHARMA_FIELD, JSON.stringify(['olympus']));
  });

  it('spends the dose and grants the hit points together', async () => {
    const { onFieldsChange } = show({
      str: 10, hp: 4, inventory: kit({ name: 'Avalanche', qty: 2 }),
    });
    await gear();
    await userEvent.selectOptions(picker(), 'avalanche');
    const written = onFieldsChange.mock.calls[0][0];
    expect(written.hp).toBe(14);
    expect(JSON.parse(written.inventory as string)[0].qty).toBe(1);
  });
});

describe('ending the scene', () => {
  it('is not offered when nothing scene-length is running', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['avalanche'] });
    await gear();
    expect(screen.queryByRole('button', { name: /END SCENE/ })).not.toBeInTheDocument();
  });

  it('says what it will cost before you press it', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker', 'olympus'] });
    await gear();
    expect(screen.getByRole('button', { name: /END SCENE \(\+3 STRAIN\)/ })).toBeInTheDocument();
  });

  it('clears the scene doses and bills the Strain in one write', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 1, system_strain_max: 10,
      [PHARMA_FIELD]: ['boneshaker', 'olympus'],
    });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(onFieldsChange).toHaveBeenCalledWith({
      [PHARMA_FIELD]: JSON.stringify([]),
      system_strain: 4,
    });
  });

  it('leaves an hour-long dose running', async () => {
    // Avalanche lasts an hour and a fight is not an hour. Clearing everything would be
    // the easy implementation and the wrong one.
    const { onFieldsChange } = show({
      str: 10, system_strain: 0, system_strain_max: 10,
      [PHARMA_FIELD]: ['boneshaker', 'avalanche'],
    });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(onFieldsChange).toHaveBeenCalledWith({
      [PHARMA_FIELD]: JSON.stringify(['avalanche']),
      system_strain: 2,
    });
  });

  it('clamps the Strain at the maximum rather than writing past it', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 9, system_strain_max: 10,
      [PHARMA_FIELD]: ['boneshaker'],
    });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(onFieldsChange.mock.calls[0][0].system_strain).toBe(10);
  });

  it('charges nothing for Window, which bills per use instead', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 2, system_strain_max: 10, [PHARMA_FIELD]: ['window'],
    });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'END SCENE' }));
    expect(onFieldsChange.mock.calls[0][0].system_strain).toBe(2);
  });
});

describe('removing a dose', () => {
  it('takes it off without touching anything else', async () => {
    const { onFieldChange } = show({ str: 10, [PHARMA_FIELD]: ['boneshaker', 'olympus'] });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'Remove BONESHAKER' }));
    expect(onFieldChange).toHaveBeenCalledWith(PHARMA_FIELD, JSON.stringify(['olympus']));
  });
});

describe('system isolation', () => {
  it('does not appear on Cyberpunk RED', async () => {
    // p60-61 is a CWN table. Cyberpunk has its own drugs with their own numbers, and
    // showing this one there would be stating something false about that game.
    show({}, cyberpunkRed);
    await gear();
    expect(screen.queryByText(/PHARMACEUTICALS/)).not.toBeInTheDocument();
  });
});
