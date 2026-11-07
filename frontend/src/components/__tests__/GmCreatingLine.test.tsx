// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GmCreatingLine } from '../GmCreatingLine';
import { CREATING_KEY } from '../../sheets/newCharacterFlow';
import type { SheetTemplate } from '../../sheets';

/**
 * The GM's line on a player's sheet (7c5): where they are, SKIP IT, and START OVER, which asks first.
 * What the line says is tested in newCharacterFlow.test.ts.
 */

const TEMPLATE = {
  id: 'sys_x', name: 'Hearth', header: { nameField: 'name' },
  sections: [{ id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }] }],
  creation: { steps: ['who'], stats: [] },
} as unknown as SheetTemplate;

const open = (data: Record<string, unknown>, refused?: string) => {
  const onAct = vi.fn();
  render(<GmCreatingLine template={TEMPLATE} data={data} system={null} onAct={onAct} refused={refused} />);
  return onAct;
};

afterEach(cleanup);

describe('the GM\'s line', () => {
  it('draws nothing for a character never asked', () => {
    open({ name: 'Old Hand' });
    expect(screen.queryByRole('group', { name: 'New character' })).toBeNull();
  });

  it('being made: says where, and SKIP IT goes straight through', async () => {
    const onAct = open({ [CREATING_KEY]: { at: 'who' } });
    expect(screen.getByText('CREATING · STEP 1 OF 1 · WHO THEY ARE')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'SKIP IT' }));
    expect(onAct).toHaveBeenCalledWith('skip');
  });

  it('finished: no SKIP IT', () => {
    open({ [CREATING_KEY]: { done: true } });
    expect(screen.queryByRole('button', { name: 'SKIP IT' })).toBeNull();
    expect(screen.getByRole('button', { name: 'START OVER' })).toBeTruthy();
  });

  it('never opened: no START OVER', () => {
    open({});
    expect(screen.queryByRole('button', { name: 'START OVER' })).toBeNull();
    expect(screen.getByRole('button', { name: 'SKIP IT' })).toBeTruthy();
  });

  it('START OVER asks first, saying what it takes back; CANCEL does nothing', async () => {
    const onAct = open({ [CREATING_KEY]: { done: true, given: { items: [{ name: 'Rope', qty: 2 }], pay: [] } } });
    await userEvent.click(screen.getByRole('button', { name: 'START OVER' }));
    const asking = within(screen.getByRole('alertdialog', { name: 'START OVER' }));
    expect(asking.getByText(/takes back what FINISH gave: 2x Rope\./)).toBeTruthy();
    expect(onAct).not.toHaveBeenCalled();
    await userEvent.click(asking.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onAct).not.toHaveBeenCalled();
  });

  it('START OVER confirmed: asks once, and the question goes', async () => {
    const onAct = open({ [CREATING_KEY]: { at: 'who' } });
    await userEvent.click(screen.getByRole('button', { name: 'START OVER' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'START OVER' }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct).toHaveBeenCalledWith('startOver');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('says why the server refused, only after the GM has acted here', async () => {
    open({ [CREATING_KEY]: { at: 'who' } }, 'No');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'SKIP IT' }));
    expect(screen.getByRole('alert').textContent).toBe('No');
  });
});
