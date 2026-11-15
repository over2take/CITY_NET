import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventorySection } from '../InventorySection';
import type { SheetSection } from '../../sheets/types';
import type { ItemsShown } from '../../sheets/gearItems';

/**
 * The GEAR tab as a table per item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14): each type's
 * lines and columns, an item's values faint under a line's own, + to add a line of a type by hand, and the one list
 * without types.
 */

afterEach(() => cleanup());

const SECTION: SheetSection = { id: 'gear', label: 'GEAR', layout: 'inventory', fields: [] };
const ITEMS: ItemsShown = {
  slots: [],
  list: [
    { id: 'pistol', label: 'Pistol', needs: 'carried', features: [], type: 'weapons', values: { damage: '2d6', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT' } },
    { id: 'ring', label: 'Ring of Might', needs: 'worn', features: [], type: 'gear', values: {} },
  ],
  types: [
    { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' },
      { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
      { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
    { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
  ],
};
const line = (name: string, more = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });

const show = (lines: object[], { readOnly = false, items = ITEMS as ItemsShown | undefined, onGearRoll = undefined as ((line: number, column: string) => void) | undefined } = {}) => {
  const writes: object[][] = [];
  const Harness = () => {
    const [data, setData] = useState<Record<string, unknown>>({ inventory: JSON.stringify(lines) });
    return <InventorySection section={SECTION} data={data as never} readOnly={readOnly} itemsShown={items} onGearRoll={onGearRoll}
      onFieldChange={(id, v) => { writes.push(JSON.parse(v as string)); setData((d) => ({ ...d, [id]: v })); }} />;
  };
  render(<Harness />);
  return () => writes[writes.length - 1] as Record<string, unknown>[];
};
const table = (name: string) => within(screen.getByRole('region', { name: `${name} gear` }));

describe('a table per type', () => {
  it('each type\'s lines under its own heads, units said; an empty type its heading and + only', () => {
    show([line('Rope'), line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })]);
    expect(table('WEAPONS').getByText('WEAPONS · 3')).toBeTruthy();
    expect(table('WEAPONS').getAllByText(/^(NAME|QTY|DAMAGE|RANGE|AMMO|WEIGHT \(LB\)|GRADE|WHERE|LOCATION)$/).map((e) => e.textContent))
      .toEqual(['NAME', 'QTY', 'DAMAGE', 'RANGE', 'AMMO', 'WEIGHT (LB)', 'GRADE', 'WHERE', 'LOCATION']);
    expect((table('WEAPONS').getByLabelText('Item 2 name') as HTMLInputElement).value).toBe('Pistol');
    expect((table('WEAPONS').getByLabelText('Item 3 name') as HTMLInputElement).value).toBe('A stick');
    // Rope is no item of the system: the first type... which is WEAPONS.
    expect((table('WEAPONS').getByLabelText('Item 1 name') as HTMLInputElement).value).toBe('Rope');
    expect(table('GEAR').getByText('GEAR · 0')).toBeTruthy();
    expect(table('GEAR').queryByText('NAME')).toBeNull();
    // No one list, and no + ITEM under it.
    expect(screen.queryByRole('button', { name: '+ ITEM' })).toBeNull();
  });

  it('an item\'s values faint until typed over; typed, the line\'s own; blank, the item\'s again', () => {
    const last = show([line('Pistol')]);
    const range = table('WEAPONS').getByLabelText('Item 1 RANGE') as HTMLInputElement;
    expect(range.value).toBe('');
    expect(range.placeholder).toBe('30 m');
    expect((table('WEAPONS').getByLabelText('Item 1 AMMO') as HTMLInputElement).placeholder).toBe('6');
    expect((table('WEAPONS').getByLabelText('Item 1 GRADE') as HTMLSelectElement).options[0].textContent).toBe('LIGHT');
    fireEvent.change(range, { target: { value: '50 m' } });
    expect(last()[0]).toMatchObject({ name: 'Pistol', values: { range: '50 m' } });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 GRADE'), { target: { value: 'HEAVY' } });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 WEIGHT'), { target: { value: '2.5' } });
    expect(last()[0].values).toEqual({ range: '50 m', grade: 'HEAVY', weight: 2.5 });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 RANGE'), { target: { value: '' } });
    expect(last()[0].values).toEqual({ grade: 'HEAVY', weight: 2.5 });
  });

  it('+ a type\'s one adds a line of it by hand, which stays in its table as it is named', async () => {
    const last = show([line('Pistol')]);
    await userEvent.click(table('GEAR').getByRole('button', { name: 'Add a Gear by hand' }));
    expect(last()[1]).toEqual(line('', { type: 'gear' }));
    fireEvent.change(table('GEAR').getByLabelText('Item 2 name'), { target: { value: 'Pistol' } });
    // Named like the pistol, it is still GEAR: what was made by hand stays where it was made.
    expect((table('GEAR').getByLabelText('Item 2 name') as HTMLInputElement).value).toBe('Pistol');
    expect(table('GEAR').getByText('GEAR · 1')).toBeTruthy();
    fireEvent.change(table('GEAR').getByLabelText('Item 2 quantity'), { target: { value: '3' } });
    fireEvent.change(table('GEAR').getByLabelText('Item 2 carried'), { target: { value: 'stash' } });
    fireEvent.change(table('GEAR').getByLabelText('Item 2 location'), { target: { value: 'the van' } });
    expect(last()[1]).toEqual(line('Pistol', { type: 'gear', qty: 3, carry: 'stash', location: 'the van' }));
    await userEvent.click(table('GEAR').getByRole('button', { name: 'Remove item 2' }));
    expect(last()).toHaveLength(1);
  });

  it('read only: every box shown, none to change, no + or ×', () => {
    show([line('Pistol')], { readOnly: true });
    expect((table('WEAPONS').getByLabelText('Item 1 name') as HTMLInputElement).readOnly).toBe(true);
    expect((table('WEAPONS').getByLabelText('Item 1 RANGE') as HTMLInputElement).readOnly).toBe(true);
    expect((table('WEAPONS').getByLabelText('Item 1 GRADE') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /by hand/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove item/ })).toBeNull();
  });

  it('ROLL beside each DAMAGE (8a3b): its line and column sent; nothing to roll, nothing to press; read only, still there', async () => {
    const rolled: [number, string][] = [];
    show([line('Rope'), line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })], { onGearRoll: (l, c) => rolled.push([l, c]) });
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Roll Item 2 DAMAGE' }));
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Roll Item 3 DAMAGE' }));
    expect(rolled).toEqual([[1, 'damage'], [2, 'damage']]);
    // Only DAMAGE and DICE roll: RANGE has none.
    expect(table('WEAPONS').queryByRole('button', { name: 'Roll Item 2 RANGE' })).toBeNull();
    expect(table('WEAPONS').getByRole('button', { name: 'Roll Item 2 DAMAGE' }).title).toBe('Roll 2d6');
    const rope = table('WEAPONS').getByRole('button', { name: 'Roll Item 1 DAMAGE' }) as HTMLButtonElement;
    expect(rope.disabled).toBe(true);
    expect(rope.title).toBe('Nothing to roll');
    // The box beside it is the line's own, as without ROLL.
    expect((table('WEAPONS').getByLabelText('Item 2 DAMAGE') as HTMLInputElement).placeholder).toBe('2d6');
    cleanup();
    show([line('Pistol')], { readOnly: true, onGearRoll: () => {} });
    expect(table('WEAPONS').getByRole('button', { name: 'Roll Item 1 DAMAGE' })).toBeTruthy();
    expect((table('WEAPONS').getByLabelText('Item 1 DAMAGE') as HTMLInputElement).readOnly).toBe(true);
    cleanup();
    show([line('Pistol')]);
    expect(table('WEAPONS').queryByRole('button', { name: /^Roll/ })).toBeNull();
  });

  it('a system without types keeps the one list', () => {
    show([line('Pistol')], { items: { slots: [], list: ITEMS.list } });
    expect(screen.queryByRole('region', { name: /gear$/ })).toBeNull();
    expect(screen.getByRole('button', { name: '+ ITEM' })).toBeTruthy();
  });
});
