import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import { cyberpunkRed } from '../../sheets/templates/cyberpunk_red';
import { PHARMA_FIELD } from '../../sheets/cwnPharma';

/**
 * Pharmaceuticals, in the two places they appear.
 *
 * A dose is an item, so it is TAKEN from its INVENTORY row - Readied only, because
 * injecting is a Main Action (p60) and reaching a Stowed item is another (p48).
 *
 * What is RUNNING lives in the sheet header, above the tab bar, so it follows the player
 * onto every tab. A drug that wears off at the end of a scene and bills System Strain for
 * it is not something to hide behind a tab somebody might not open.
 *
 * The arithmetic is in sheets/__tests__/cwnPharma.test.ts and the resolver wiring in
 * backend/__tests__/cwn_pharma.test.js.
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

/** An inventory holding one drug row, carried however the test wants it. */
const kit = (...rows: { name: string; qty: number; carry?: string }[]) =>
  JSON.stringify(rows.map((r) => ({
    carry: 'readied', enc: '', bundled: false, location: '', ...r,
  })));

describe('the CONSUME button on an inventory row', () => {
  it('is there for a drug', async () => {
    show({ str: 10, inventory: kit({ name: 'Boneshaker', qty: 2 }) });
    await gear();
    expect(screen.getByRole('button', { name: 'CONSUME Boneshaker' })).toBeEnabled();
  });

  it('is not there for a thing that is not a drug', async () => {
    show({ str: 10, inventory: kit({ name: 'Rope', qty: 1 }) });
    await gear();
    expect(screen.queryByRole('button', { name: /CONSUME/ })).not.toBeInTheDocument();
  });

  it('is disabled while the dose is only Stowed, and says why', async () => {
    // Two Main Actions is two turns: one to reach it, one to inject.
    show({ str: 10, inventory: kit({ name: 'Boneshaker', qty: 1, carry: 'stowed' }) });
    await gear();
    const btn = screen.getByRole('button', { name: 'CONSUME Boneshaker' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('Ready it first'));
  });

  it('is disabled for a stashed dose, which is not on you at all', async () => {
    show({ str: 10, inventory: kit({ name: 'Boneshaker', qty: 1, carry: 'stash' }) });
    await gear();
    const btn = screen.getByRole('button', { name: 'CONSUME Boneshaker' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('not on you'));
  });

  it('does not appear on Cyberpunk RED, whose drugs are its own', async () => {
    show({ inventory: kit({ name: 'Boneshaker', qty: 1 }) }, cyberpunkRed);
    await gear();
    expect(screen.queryByRole('button', { name: /CONSUME/ })).not.toBeInTheDocument();
  });
});

describe('taking the dose', () => {
  it('starts the drug and spends the row in one write', async () => {
    const { onFieldsChange } = show({ str: 10, inventory: kit({ name: 'Boneshaker', qty: 3 }) });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'CONSUME Boneshaker' }));
    const written = onFieldsChange.mock.calls[0][0];
    expect(written[PHARMA_FIELD]).toBe(JSON.stringify(['boneshaker']));
    expect(JSON.parse(written.inventory as string)).toEqual([
      expect.objectContaining({ name: 'Boneshaker', qty: 2 }),
    ]);
  });

  it('drops the row when the last dose goes', async () => {
    const { onFieldsChange } = show({ str: 10, inventory: kit({ name: 'Olympus', qty: 1 }) });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'CONSUME Olympus' }));
    expect(JSON.parse(onFieldsChange.mock.calls[0][0].inventory as string)).toEqual([]);
  });

  it('takes the row that was pressed, not merely the first of that drug', async () => {
    // Readied and stowed Boneshaker are different rows and only one has a live button.
    const { onFieldsChange } = show({
      str: 10,
      inventory: kit(
        { name: 'Boneshaker', qty: 1, carry: 'stowed' },
        { name: 'Boneshaker', qty: 2, carry: 'readied' },
      ),
    });
    await gear();
    const buttons = screen.getAllByRole('button', { name: 'CONSUME Boneshaker' });
    await userEvent.click(buttons[1]);
    const rows = JSON.parse(onFieldsChange.mock.calls[0][0].inventory as string);
    expect(rows.map((r: { qty: number; carry: string }) => [r.carry, r.qty]))
      .toEqual([['stowed', 1], ['readied', 1]]);
  });

  it('hands over Avalanche\'s hit points at the same time', async () => {
    const { onFieldsChange } = show({
      str: 10, hp: 4, hp_max: 20, inventory: kit({ name: 'Avalanche', qty: 1 }),
    });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'CONSUME Avalanche' }));
    // Above maximum, as the book says.
    expect(onFieldsChange.mock.calls[0][0].hp).toBe(14);
  });

  it('spends a second dose of something already running without stacking it', async () => {
    const { onFieldsChange } = show({
      str: 10, [PHARMA_FIELD]: ['boneshaker'], inventory: kit({ name: 'Boneshaker', qty: 2 }),
    });
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'CONSUME Boneshaker' }));
    const written = onFieldsChange.mock.calls[0][0];
    // Swallowed, so the row drops; listed once, so nothing stacks.
    expect(written[PHARMA_FIELD]).toBe(JSON.stringify(['boneshaker']));
    expect(JSON.parse(written.inventory as string)[0].qty).toBe(1);
  });
});

describe('what is running follows you across the tabs', () => {
  it('shows nothing at all on a sober character', () => {
    show({ str: 10 });
    expect(screen.queryByText(/END SCENE/)).not.toBeInTheDocument();
    expect(screen.queryByText('BONESHAKER')).not.toBeInTheDocument();
  });

  it('is in the header, so it is there before any tab is chosen', () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker'] });
    expect(screen.getByText('BONESHAKER')).toBeInTheDocument();
    expect(screen.getByText(/\+2 to hit · \+2 damage · \+2 Shock/)).toBeInTheDocument();
  });

  it('stays put on every tab', async () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker'] });
    for (const tab of ['STATS', 'SKILLS', 'GEAR', 'NOTES']) {
      await userEvent.click(screen.getByRole('button', { name: tab }));
      expect(screen.getByText('BONESHAKER'), tab).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /END SCENE/ }), tab).toBeInTheDocument();
    }
  });

  it('shows the highest bonus rather than the sum', () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker', 'olympus'] });
    expect(screen.getByText(/\+2 to hit/)).toBeInTheDocument();
    expect(screen.queryByText(/\+4 to hit/)).not.toBeInTheDocument();
  });

  it('says nothing about numbers for a drug that changes none', () => {
    show({ str: 10, [PHARMA_FIELD]: ['sand'] });
    expect(screen.getByText('SAND')).toBeInTheDocument();
    expect(screen.queryByText(/to hit/)).not.toBeInTheDocument();
  });

  it('does not appear on Cyberpunk RED', () => {
    show({ [PHARMA_FIELD]: ['boneshaker'] }, cyberpunkRed);
    expect(screen.queryByText('BONESHAKER')).not.toBeInTheDocument();
  });
});

describe('ending the scene', () => {
  it('is not offered when nothing scene-length is running', () => {
    show({ str: 10, [PHARMA_FIELD]: ['avalanche'] });
    expect(screen.getByText('AVALANCHE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /END SCENE/ })).not.toBeInTheDocument();
  });

  it('says what it will cost before you press it', () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker', 'olympus'] });
    expect(screen.getByRole('button', { name: /END SCENE \(\+3 STRAIN\)/ })).toBeInTheDocument();
  });

  it('clears the scene doses and bills the Strain in one write', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 1, system_strain_max: 10,
      [PHARMA_FIELD]: ['boneshaker', 'olympus'],
    });
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(onFieldsChange).toHaveBeenCalledWith({
      [PHARMA_FIELD]: JSON.stringify([]),
      system_strain: 4,
    });
  });

  it('leaves an hour-long dose running, because a fight is not an hour', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 0, system_strain_max: 10,
      [PHARMA_FIELD]: ['boneshaker', 'avalanche'],
    });
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(onFieldsChange).toHaveBeenCalledWith({
      [PHARMA_FIELD]: JSON.stringify(['avalanche']),
      system_strain: 2,
    });
  });

  it('clamps the Strain at the maximum rather than writing past it', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 9, system_strain_max: 10, [PHARMA_FIELD]: ['boneshaker'],
    });
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(onFieldsChange.mock.calls[0][0].system_strain).toBe(10);
  });

  it('charges nothing for Window, which bills per use instead', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 2, system_strain_max: 10, [PHARMA_FIELD]: ['window'],
    });
    await userEvent.click(screen.getByRole('button', { name: 'END SCENE' }));
    expect(onFieldsChange.mock.calls[0][0].system_strain).toBe(2);
  });
});


describe('taking a drug off bills what it cost', () => {
  // Reported in use: removing a chip left System Strain untouched while END SCENE charged
  // for the same thing. The book bills when the drug ENDS - "adds 2 System Strain at the
  // end of it" (p60) - and taking the chip off is the drug ending.
  it('charges the Strain for the one removed', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 1, system_strain_max: 10,
      [PHARMA_FIELD]: ['boneshaker', 'olympus'],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove BONESHAKER' }));
    expect(onFieldsChange).toHaveBeenCalledWith({
      [PHARMA_FIELD]: JSON.stringify(['olympus']),
      system_strain: 3,
    });
  });

  it('says the price on the button before it is pressed', () => {
    show({ str: 10, [PHARMA_FIELD]: ['boneshaker'] });
    expect(screen.getByRole('button', { name: 'Remove BONESHAKER' }))
      .toHaveAttribute('title', 'End BONESHAKER — +2 System Strain');
  });

  it('charges nothing for a drug that costs nothing', () => {
    show({ str: 10, [PHARMA_FIELD]: ['avalanche'] });
    expect(screen.getByRole('button', { name: 'Remove AVALANCHE' }))
      .toHaveAttribute('title', 'End AVALANCHE');
  });

  it('clamps at the maximum like the scene does', async () => {
    const { onFieldsChange } = show({
      str: 10, system_strain: 9, system_strain_max: 10, [PHARMA_FIELD]: ['boneshaker'],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove BONESHAKER' }));
    expect(onFieldsChange.mock.calls[0][0].system_strain).toBe(10);
  });

  it('agrees with END SCENE when they end the same drug', async () => {
    // The two paths were the bug. One function now, so they cannot disagree again.
    const data = {
      str: 10, system_strain: 2, system_strain_max: 10, [PHARMA_FIELD]: ['boneshaker'],
    };
    const a = show(data);
    await userEvent.click(screen.getByRole('button', { name: 'Remove BONESHAKER' }));
    const byHand = a.onFieldsChange.mock.calls[0][0];
    cleanup();
    const b = show(data);
    await userEvent.click(screen.getByRole('button', { name: /END SCENE/ }));
    expect(b.onFieldsChange.mock.calls[0][0]).toEqual(byHand);
  });
});
