import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventorySection } from '../InventorySection';
import type { SheetSection } from '../../sheets/types';
import type { ItemsShown } from '../../sheets/gearItems';

/**
 * The GEAR tab by item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14), each thing a compact line
 * (8a3c1; approved mockup docs/mockups/gear-compact.html, 2026-11-15): name, how many, where, ✎ and × on top, only the
 * columns it has as words under it, ROLL beside a DAMAGE; ✎ opening every column as a box, an item's values faint under
 * a line's own, one line at a time; + to add a line of a type by hand, opened; and the one list without types.
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

describe('a compact line per thing, by type', () => {
  const note = (name: string, label: string) => table(name).queryByRole('note', { name: new RegExp(`^${label}: `) });
  const edit = (name: string, i: number) => userEvent.click(table(name).getByRole('button', { name: `Edit item ${i}` }));

  it('each type\'s lines under its heading; on a line only the columns it has, as words, its item\'s faint, units said', () => {
    show([line('Rope'), line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })]);
    expect(table('WEAPONS').getByText('WEAPONS · 3')).toBeTruthy();
    expect((table('WEAPONS').getByLabelText('Item 2 name') as HTMLInputElement).value).toBe('Pistol');
    // Rope is no item of the system: the first type... which is WEAPONS; it has no columns at all.
    expect((table('WEAPONS').getByLabelText('Item 1 name') as HTMLInputElement).value).toBe('Rope');
    expect(within(screen.getByTestId('gear-line-0')).queryAllByRole('note').filter((n) => /^Item [0-9]+ /.test(n.getAttribute('aria-label') ?? ''))).toHaveLength(0);
    expect(within(screen.getByTestId('gear-line-0')).getByText('NOTHING FILLED IN · ✎ TO FILL IT')).toBeTruthy();
    // The Pistol: its item's DAMAGE, RANGE, AMMO, WEIGHT with its unit, GRADE.
    expect(within(screen.getByTestId('gear-line-1')).getAllByRole('note').map((n) => n.getAttribute('aria-label')).filter((l) => /^Item [0-9]+ /.test(l ?? '')))
      .toEqual(['Item 2 DAMAGE: 2d6', 'Item 2 RANGE: 30 m', 'Item 2 AMMO: 6', 'Item 2 WEIGHT: 2 LB', 'Item 2 GRADE: LIGHT']);
    expect(within(note('WEAPONS', 'Item 2 RANGE')!).getByText('30 m').getAttribute('title')).toBe('As the item has it');
    // A stick: its own DAMAGE, and nothing else (doesn't apply).
    expect(within(screen.getByTestId('gear-line-2')).getAllByRole('note').map((n) => n.getAttribute('aria-label')).filter((l) => /^Item [0-9]+ /.test(l ?? ''))).toEqual(['Item 3 DAMAGE: 1d4']);
    expect(within(note('WEAPONS', 'Item 3 DAMAGE')!).getByText('1d4').getAttribute('title')).toBe('This line\'s own');
    expect(table('GEAR').getByText('GEAR · 0')).toBeTruthy();
    // No boxes for the columns until ✎; no one list, and no + ITEM under it.
    expect(table('WEAPONS').queryByLabelText('Item 2 RANGE')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ ITEM' })).toBeNull();
  });

  it('✎ opens every column as a box, its item\'s faint, "none" where it has none; typed, the line\'s own; blank, the item\'s again', async () => {
    const last = show([line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })]);
    await edit('WEAPONS', 1);
    expect(table('WEAPONS').getByRole('button', { name: 'Edit item 1' }).getAttribute('aria-pressed')).toBe('true');
    // Its words stay over the boxes, as the mockup draws it.
    expect(note('WEAPONS', 'Item 1 RANGE')).toBeTruthy();
    const range = table('WEAPONS').getByLabelText('Item 1 RANGE') as HTMLInputElement;
    expect([range.value, range.placeholder]).toEqual(['', '30 m']);
    expect((table('WEAPONS').getByLabelText('Item 1 AMMO') as HTMLInputElement).placeholder).toBe('6');
    expect((table('WEAPONS').getByLabelText('Item 1 GRADE') as HTMLSelectElement).options[0].textContent).toBe('LIGHT');
    fireEvent.change(range, { target: { value: '50 m' } });
    expect(last()[0]).toMatchObject({ name: 'Pistol', values: { range: '50 m' } });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 GRADE'), { target: { value: 'HEAVY' } });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 WEIGHT'), { target: { value: '2.5' } });
    expect(last()[0].values).toEqual({ range: '50 m', grade: 'HEAVY', weight: 2.5 });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 RANGE'), { target: { value: '' } });
    expect(last()[0].values).toEqual({ grade: 'HEAVY', weight: 2.5 });
    // One open at a time: the stick's ✎ closes the Pistol's; its empty columns say none.
    await edit('WEAPONS', 2);
    expect(table('WEAPONS').queryByLabelText('Item 1 RANGE')).toBeNull();
    expect((table('WEAPONS').getByLabelText('Item 2 RANGE') as HTMLInputElement).placeholder).toBe('none');
    expect((table('WEAPONS').getByLabelText('Item 2 GRADE') as HTMLSelectElement).options[0].textContent).toBe('none');
    // DONE closes it, as ✎ again does.
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'DONE' }));
    expect(table('WEAPONS').queryByLabelText('Item 2 RANGE')).toBeNull();
    await edit('WEAPONS', 2);
    await edit('WEAPONS', 2);
    expect(table('WEAPONS').queryByLabelText('Item 2 RANGE')).toBeNull();
  });

  it('+ a type\'s one adds a line of it by hand, opened to fill, which stays in its table as it is named; a stashed one says where', async () => {
    const last = show([line('Pistol')]);
    await userEvent.click(table('GEAR').getByRole('button', { name: 'Add a Gear by hand' }));
    expect(last()[1]).toEqual(line('', { type: 'gear' }));
    expect(table('GEAR').getByLabelText('Item 2 WEIGHT')).toBeTruthy();
    fireEvent.change(table('GEAR').getByLabelText('Item 2 name'), { target: { value: 'Pistol' } });
    // Named like the pistol, it is still GEAR: what was made by hand stays where it was made.
    expect((table('GEAR').getByLabelText('Item 2 name') as HTMLInputElement).value).toBe('Pistol');
    expect(table('GEAR').getByText('GEAR · 1')).toBeTruthy();
    fireEvent.change(table('GEAR').getByLabelText('Item 2 quantity'), { target: { value: '3' } });
    fireEvent.change(table('GEAR').getByLabelText('Item 2 carried'), { target: { value: 'stash' } });
    fireEvent.change(table('GEAR').getByLabelText('Item 2 location'), { target: { value: 'the van' } });
    expect(last()[1]).toEqual(line('Pistol', { type: 'gear', qty: 3, carry: 'stash', location: 'the van' }));
    await userEvent.click(table('GEAR').getByRole('button', { name: 'DONE' }));
    expect(within(screen.getByTestId('gear-line-1')).getByText('the van')).toBeTruthy();
    expect(within(screen.getByTestId('gear-line-1')).getByText('STASHED')).toBeTruthy();
    await userEvent.click(table('GEAR').getByRole('button', { name: 'Remove item 2' }));
    expect(last()).toHaveLength(1);
  });

  it('read only: the words and nothing to change, no ✎, + or ×', () => {
    // A Rope, with nothing filled in: said only where it could be filled.
    show([line('Pistol'), line('Rope')], { readOnly: true });
    expect((table('WEAPONS').getByLabelText('Item 1 name') as HTMLInputElement).readOnly).toBe(true);
    expect(note('WEAPONS', 'Item 1 RANGE')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Edit item/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /by hand/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove item/ })).toBeNull();
    expect(screen.queryByText('NOTHING FILLED IN · ✎ TO FILL IT')).toBeNull();
  });

  it('ROLL beside each DAMAGE (8a3b): its line and column sent; none where there is no DAMAGE; read only, still there', async () => {
    const rolled: [number, string][] = [];
    show([line('Rope'), line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })], { onGearRoll: (l, c) => rolled.push([l, c]) });
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Roll Item 2 DAMAGE' }));
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Roll Item 3 DAMAGE' }));
    expect(rolled).toEqual([[1, 'damage'], [2, 'damage']]);
    // Only DAMAGE and DICE roll: RANGE has none; the Rope has no DAMAGE, so nothing to roll.
    expect(table('WEAPONS').queryByRole('button', { name: 'Roll Item 2 RANGE' })).toBeNull();
    expect(table('WEAPONS').getByRole('button', { name: 'Roll Item 2 DAMAGE' }).title).toBe('Roll 2d6');
    expect(table('WEAPONS').queryByRole('button', { name: 'Roll Item 1 DAMAGE' })).toBeNull();
    cleanup();
    show([line('Pistol')], { readOnly: true, onGearRoll: () => {} });
    expect(table('WEAPONS').getByRole('button', { name: 'Roll Item 1 DAMAGE' })).toBeTruthy();
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
