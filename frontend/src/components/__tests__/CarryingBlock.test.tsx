import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SheetRenderer } from '../SheetRenderer';

/**
 * CARRYING at the top of GEAR (8a6a; approved mockup docs/mockups/carrying-on-sheet.html, A; the user: "I like A and yes to
 * all"): the count, its band, the meter, what the band means and its condition, on the tab the INVENTORY is on, above it.
 */

afterEach(cleanup);

const template = {
  id: 'sys_x', name: 'Packs', tabs: ['STATS', 'GEAR'], items: { list: [] },
  sections: [
    { id: 'stats', label: 'STATS', layout: 'grid', tab: 'STATS', fields: [{ id: 'speed', label: 'Speed', type: 'number' }] },
    { id: 'inventory', label: 'INVENTORY', layout: 'inventory', tab: 'GEAR', fields: [] },
  ],
} as never;
const carrying = {
  carried: 38, capacity: 50, unit: 'LB', band: 'ENCUMBERED', says: 'Speed -10 ft.', condition: 'slowed', conditionName: 'Slowed',
  bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }], past: 'OVERLOADED',
};
const sheet = (data: object, extra: object = {}) => {
  render(<SheetRenderer template={template} onFieldChange={() => {}} data={data as never} {...extra} />);
  fireEvent.click(screen.getByRole('button', { name: 'GEAR' }));
};

describe('CARRYING on GEAR', () => {
  it('the count, its band, the meter, the bands, what it means and the condition on, above INVENTORY', () => {
    sheet({ _worked: { carrying }, _band_condition: 'slowed' });
    const block = screen.getByTestId('sheet-carrying');
    expect(block.textContent).toContain('CARRYING 38 / 50 LB');
    expect(screen.getByTestId('sheet-carrying-band').textContent).toBe('ENCUMBERED');
    expect(screen.getByTestId('sheet-carrying-band').style.color).toBe('var(--warning)');
    const meter = screen.getByRole('meter', { name: 'Carrying' });
    expect(meter.getAttribute('aria-valuetext')).toBe('38 of 50 LB, ENCUMBERED');
    expect(screen.getByTestId('sheet-carrying-fill').style.width).toBe('76%');
    expect(block.textContent).toContain('LIGHT ≤ 25 · ENCUMBERED ≤ 50 · OVERLOADED');
    expect(block.textContent).toContain('Speed -10 ft.');
    expect(screen.getByTestId('sheet-carrying-condition').textContent).toBe('SLOWED ON WHILE ENCUMBERED');
    // Above the INVENTORY section, not inside it.
    const inventory = screen.getByRole('button', { name: /INVENTORY/ });
    expect(block.compareDocumentPosition(inventory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the first band in green, no condition said while it isn\'t on', () => {
    sheet({ _worked: { carrying: { ...carrying, carried: 10, band: 'LIGHT', says: null } } });
    expect(screen.getByTestId('sheet-carrying-band').style.color).toBe('var(--green)');
    expect(screen.queryByTestId('sheet-carrying-condition')).toBeNull();
  });

  it('the player\'s own sheet with no token: the condition has nothing to go on, said', () => {
    sheet({ _worked: { carrying } }, { vitals: { token: null, owner: 'kes', system: 'sys_x', authToken: '', socket: null, reload: () => {} } });
    expect(screen.getByTestId('sheet-carrying-condition').textContent).toBe('SLOWED · no token on the map');
  });

  it('no CAN CARRY: the number alone, no meter or band', () => {
    sheet({ _worked: { carrying: { carried: 38, capacity: null, unit: 'LB', band: null, says: null, condition: null, conditionName: null, bands: [], past: null } } });
    expect(screen.getByTestId('sheet-carrying').textContent).toBe('CARRYING 38 LB');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('nothing where the system counts no encumbrance, nor on a tab without INVENTORY', () => {
    sheet({});
    expect(screen.queryByTestId('sheet-carrying')).toBeNull();
    cleanup();
    render(<SheetRenderer template={template} onFieldChange={() => {}} data={{ _worked: { carrying } } as never} />);
    expect(screen.queryByTestId('sheet-carrying')).toBeNull();
  });

  it('nothing where the table switched SHOW ENCUMBRANCE off; INVENTORY still there (8a6b)', () => {
    sheet({ _worked: { carrying } }, { carryingShown: false });
    expect(screen.queryByTestId('sheet-carrying')).toBeNull();
    expect(screen.getByRole('button', { name: /INVENTORY/ })).toBeTruthy();
  });
});
