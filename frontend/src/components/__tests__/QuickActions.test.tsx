/**
 * Your own token's QUICK ACTIONS.
 *
 * Runs on the real sheet hook against a fake socket, so pressing a button is checked all the
 * way to what goes to the server: the sheet's own roll request by field id, the same one the
 * sheet's roll buttons send - never a formula the client made up.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickActions } from '../QuickActions';

function fakeSocket() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  return {
    emitted: [] as { event: string; payload: unknown }[],
    emit(event: string, payload?: unknown) { this.emitted.push({ event, payload }); },
    on(event: string, fn: (payload: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) || []), fn]);
    },
    off() {},
    deliver(event: string, payload: unknown) {
      act(() => { (listeners.get(event) || []).forEach((fn) => fn(payload)); });
    },
    sent(event: string) { return this.emitted.filter((e) => e.event === event).map((e) => e.payload); },
  };
}

const defense = { label: 'AC', melee: 13, ranged: 15 };

const show = (system: string, data: Record<string, unknown> = {}) => {
  const socket = fakeSocket();
  const onRolled = vi.fn();
  render(<QuickActions socket={socket} userName="ghost" defense={defense} onRolled={onRolled} />);
  socket.deliver('sheetData', { username: 'ghost', system, data });
  return { socket, onRolled };
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => vi.unstubAllGlobals());

describe('QUICK ACTIONS', () => {
  it('shows your defense, read only', () => {
    show('cities_without_number');
    expect(screen.getByText('MELEE_AC').parentElement).toHaveTextContent('13');
    expect(screen.getByText('RANGED_AC').parentElement).toHaveTextContent('15');
    expect(screen.queryByRole('button', { name: 'EDIT_AC' })).toBeNull();
  });

  it('CWN: every save button rolls that save through the sheet, and pops the dice tray', async () => {
    const { socket, onRolled } = show('cities_without_number');
    for (const [label, fieldId] of [
      ['PHYSICAL SAVE', 'save_physical'], ['EVASION SAVE', 'save_evasion'],
      ['MENTAL SAVE', 'save_mental'], ['LUCK SAVE', 'save_luck'],
    ]) {
      await userEvent.click(screen.getByRole('button', { name: label }));
      expect(socket.sent('requestSheetRoll').at(-1)).toMatchObject({ fieldId });
    }
    expect(onRolled).toHaveBeenCalledTimes(4);
  });

  it('CP:R: a stat button rolls that stat', async () => {
    const { socket } = show('cyberpunk_red');
    await userEvent.click(screen.getByRole('button', { name: 'REF' }));
    expect(socket.sent('requestSheetRoll')).toEqual([expect.objectContaining({ fieldId: 'ref' })]);
  });

  it('SR6: rolls initiative and composure', async () => {
    const { socket } = show('shadowrun_6e');
    await userEvent.click(screen.getByRole('button', { name: 'INITIATIVE' }));
    await userEvent.click(screen.getByRole('button', { name: 'COMPOSURE' }));
    expect(socket.sent('requestSheetRoll').map((p: any) => p.fieldId)).toEqual(['initiative_score', 'composure']);
  });

  it('rolls the picked skill, and ROLL waits until one is picked', async () => {
    const { socket } = show('cities_without_number', { shoot: 2 });
    const roll = screen.getByRole('button', { name: 'ROLL' });
    expect(roll).toBeDisabled();
    const picker = screen.getByLabelText('Skill') as HTMLSelectElement;
    const shoot = Array.from(picker.options).find((o) => o.value === 'shoot');
    // The level from the sheet, so the player sees what they are rolling.
    expect(shoot?.textContent).toMatch(/\(2\)$/);
    await userEvent.selectOptions(picker, 'shoot');
    await userEvent.click(roll);
    expect(socket.sent('requestSheetRoll')).toEqual([expect.objectContaining({ fieldId: 'shoot' })]);
  });

  it('says so when there is no sheet, and offers nothing to roll', () => {
    const socket = fakeSocket();
    render(<QuickActions socket={socket} userName="ghost" defense={defense} />);
    expect(screen.getByText(/NO SHEET ON FILE/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
