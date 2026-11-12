import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { InventorySection } from '../InventorySection';
import type { SheetSection } from '../../sheets/types';
import type { ItemsShown } from '../../sheets/gearItems';

/**
 * WEAR and ATTUNE on the GEAR tab (7e3b): the counters over the gear, an item's line under its gear row, what pressing
 * asks the server, the GM's ATTUNE ANYWAY and own count, the uses ticking, a refusal said. What each says is
 * sheets/gearItems.ts's, tested there.
 */

const SECTION: SheetSection = { id: 'gear', label: 'GEAR', layout: 'inventory', fields: [] };
const ITEMS: ItemsShown = {
  slots: [{ id: 'attuned', label: 'ATTUNED', count: 1 }],
  list: [
    { id: 'ring', label: 'Ring of Might', description: 'A plain band.', needs: 'attuned', features: [{ id: 'mighty', label: 'Mighty' }] },
    { id: 'boots', label: 'Boots of Quiet', needs: 'worn', features: [{ id: 'quiet', label: 'Quiet', uses: { refill: 'Long rest' } }] },
  ],
};
const gear = (...names: string[]) => JSON.stringify(names.map((name) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' })));

const show = (worked: Record<string, unknown>, { gm = false, readOnly = false, refused = null as string | null, noItems = false } = {}) => {
  const onItem = vi.fn();
  const onChoices = vi.fn();
  const data = { inventory: gear('Rope', 'Ring of Might', 'Boots of Quiet'), _worked: worked };
  render(<InventorySection section={SECTION} data={data as never} readOnly={readOnly} onFieldChange={() => {}} itemsShown={noItems ? undefined : ITEMS} gm={gm} onItem={onItem} onChoices={onChoices} refused={refused} />);
  return { onItem, onChoices };
};

const WORN_RING = { items: [{ id: 'ring', needs: 'attuned', worn: true }, { id: 'boots', needs: 'worn', worn: true, working: true }], slots: [{ id: 'attuned', count: 1, used: 0 }], uses: { quiet: { max: 2, spent: 1 } } };

describe('the GEAR tab with items', () => {
  it('the counter over the gear, and an item\'s line under its own row only', () => {
    show(WORN_RING);
    expect(screen.getByRole('group', { name: 'ATTUNED slots' }).textContent).toBe('ATTUNED 0 OF 1');
    const ring = screen.getByTestId('gear-item-ring');
    expect(within(ring).getByText('NEEDS ATTUNED')).toBeTruthy();
    expect(within(ring).getByText('RING OF MIGHT').getAttribute('title')).toBe('A plain band.');
    expect(within(ring).getByRole('note', { name: 'Ring of Might: what it is doing' }).textContent).toBe('WORN, NOT ATTUNED: DOES NOTHING YET');
    expect(screen.queryByTestId('gear-item-rope')).toBeNull();
    expect(screen.getAllByTestId(/^gear-item-/)).toHaveLength(2);
  });

  it('pressing asks the server: take off, attune; a button not to press is disabled and says why', () => {
    const { onItem } = show(WORN_RING);
    fireEvent.click(screen.getByRole('button', { name: 'WORN · TAKE OFF Ring of Might' }));
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'takeOff', item: 'ring' });
    fireEvent.click(screen.getByRole('button', { name: 'ATTUNE Ring of Might' }));
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'attune', item: 'ring' });
    expect(screen.getByRole('button', { name: 'WORN · TAKE OFF Ring of Might' }).getAttribute('aria-pressed')).toBe('true');
    onItem.mockClear();
    show({ ...WORN_RING, slots: [{ id: 'attuned', count: 1, used: 1 }] });
    const full = screen.getAllByRole('button', { name: 'ATTUNE Ring of Might' }).at(-1)!;
    expect((full as HTMLButtonElement).disabled).toBe(true);
    expect(full.getAttribute('title')).toBe('No ATTUNED slot free: end one first, or ask your GM');
    fireEvent.click(full);
    expect(onItem).not.toHaveBeenCalled();
    expect(screen.getAllByRole('group', { name: 'ATTUNED slots' }).at(-1)!.getAttribute('style')).toContain('var(--warning)');
  });

  it('the GM: ATTUNE ANYWAY past a full count, and their own count for this character', () => {
    const { onItem } = show({ ...WORN_RING, slots: [{ id: 'attuned', count: 1, used: 1 }] }, { gm: true });
    fireEvent.click(screen.getByRole('button', { name: 'ATTUNE ANYWAY Ring of Might' }));
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'attune', item: 'ring' });
    const box = screen.getByRole('spinbutton', { name: 'ATTUNED: how many this character has' });
    fireEvent.change(box, { target: { value: '3' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'slots', slot: 'attuned', count: 3 });
    // Nonsense asks nothing, and the box goes back.
    onItem.mockClear();
    fireEvent.change(box, { target: { value: '30' } });
    fireEvent.blur(box);
    expect(onItem).not.toHaveBeenCalled();
    expect((box as HTMLInputElement).value).toBe('1');
  });

  it('their own count says so; the system\'s count shown back by blank', () => {
    const { onItem } = show({ ...WORN_RING, slots: [{ id: 'attuned', count: 3, used: 0 }] }, { gm: true });
    expect(screen.getByText('· THEIR OWN (SYSTEM 1)')).toBeTruthy();
    const box = screen.getByRole('spinbutton', { name: 'ATTUNED: how many this character has' });
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.blur(box);
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'slots', slot: 'attuned', count: null });
  });

  it('a player has no box; read-only, nothing to press', () => {
    show(WORN_RING);
    expect(screen.queryByRole('spinbutton', { name: /how many this character has/ })).toBeNull();
    const { onItem } = show(WORN_RING, { gm: true, readOnly: true });
    expect(screen.queryAllByRole('spinbutton', { name: /how many this character has/ })).toHaveLength(0);
    const off = screen.getAllByRole('button', { name: 'WORN · TAKE OFF Ring of Might' }).at(-1) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    fireEvent.click(off);
    expect(onItem).not.toHaveBeenCalled();
  });

  it('an item feature\'s uses tick as the CHOICES block\'s do', () => {
    const { onChoices } = show(WORN_RING);
    const uses = screen.getByRole('group', { name: 'Quiet uses' });
    expect(uses.textContent).toContain('1 OF 2 · LONG REST');
    fireEvent.click(within(uses).getByRole('button', { name: 'Quiet use 2' }));
    expect(onChoices).toHaveBeenLastCalledWith({ kind: 'use', feature: 'quiet', spent: 2 });
  });

  it('a refusal is said under the gear; none, or a system without items, says nothing', () => {
    show(WORN_RING, { refused: 'No ATTUNED free: end one first, or ask your GM' });
    expect(screen.getByRole('alert').textContent).toBe('No ATTUNED free: end one first, or ask your GM');
    show(WORN_RING, { refused: 'Something else', noItems: true });
    expect(screen.queryByText('Something else')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('a system without items: the table as it was', () => {
    show({}, { noItems: true });
    expect(screen.queryByTestId(/^gear-item-/)).toBeNull();
    expect(screen.queryByRole('group', { name: /slots$/ })).toBeNull();
  });
});

describe('the GEAR tab with installs (7e4c)', () => {
  const WIRED: ItemsShown = {
    slots: [],
    installs: [{ id: 'cyber', label: 'CYBERWARE', against: 'Strain', way: 'adds' }],
    list: [
      { id: 'jack', label: 'Cranial Jack', needs: 'cyber', cost: 1, features: [] },
      { id: 'plate', label: 'Dermal Plating', needs: 'cyber', cost: 1.5, features: [] },
    ],
  };
  const lines = (...names: [string, string][]) => JSON.stringify(names.map(([name, carry]) => ({ name, qty: 1, enc: '', bundled: false, carry, location: '' })));
  const draw = (worked: Record<string, unknown>, { gm = false } = {}) => {
    const onItem = vi.fn();
    const onFieldChange = vi.fn();
    const data = { inventory: lines(['Cranial Jack', 'stash'], ['Dermal Plating', 'stowed']), _worked: worked };
    render(<InventorySection section={SECTION} data={data as never} readOnly={false} onFieldChange={onFieldChange} itemsShown={WIRED} gm={gm} onItem={onItem} />);
    return { onItem, onFieldChange };
  };
  const INSTALLED = { items: [{ id: 'jack', needs: 'cyber', installed: true, working: true }, { id: 'plate', needs: 'cyber' }], slots: [], installs: [{ id: 'cyber', used: 1, value: 1, limit: 2 }] };

  it('the cost against its limit over the gear; an installed line locked; REMOVE and INSTALL asked of the server', () => {
    const { onItem, onFieldChange } = draw(INSTALLED);
    expect(screen.getByRole('group', { name: 'CYBERWARE installs' }).textContent).toBe('CYBERWARE · STRAIN 1 OF 2');
    expect(screen.getByRole('group', { name: 'CYBERWARE installs' }).getAttribute('style')).toContain('var(--green)');
    const jack = within(screen.getByTestId('gear-item-jack'));
    expect(jack.getByText('CYBERWARE · COSTS 1 STRAIN')).toBeTruthy();
    expect(jack.getByRole('note', { name: 'Cranial Jack: what it is doing' }).textContent).toBe('WORKING');
    // Line 1 is the jack: kept as it is, stash and all, until removed.
    expect((screen.getByLabelText('Item 1 name') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Item 1 carried') as HTMLSelectElement).disabled).toBe(true);
    const x = screen.getByRole('button', { name: 'Remove item 1' }) as HTMLButtonElement;
    expect(x.disabled).toBe(true);
    expect(x.getAttribute('title')).toBe('Installed: REMOVE it first');
    fireEvent.click(x);
    expect(onFieldChange).not.toHaveBeenCalled();
    // Line 2, not installed, is the player's as ever.
    expect((screen.getByLabelText('Item 2 name') as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByRole('button', { name: 'Remove item 2' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(jack.getByRole('button', { name: 'INSTALLED · REMOVE Cranial Jack' }));
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'uninstall', item: 'jack' });
    // 1 + 1.5 is past 2: a player's INSTALL can't be pressed, and says why.
    const plate = within(screen.getByTestId('gear-item-plate'));
    const install = plate.getByRole('button', { name: 'INSTALL Dermal Plating' }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(plate.getByRole('note', { name: 'Dermal Plating: what it is doing' }).textContent).toBe("PAST CYBERWARE'S LIMIT · ONLY YOUR GM CAN");
  });

  it("the GM's INSTALL ANYWAY past it; with room, INSTALL for anyone; full, amber", () => {
    const { onItem } = draw(INSTALLED, { gm: true });
    fireEvent.click(within(screen.getByTestId('gear-item-plate')).getByRole('button', { name: 'INSTALL ANYWAY Dermal Plating' }));
    expect(onItem).toHaveBeenLastCalledWith({ kind: 'install', item: 'plate' });
    cleanup();
    const roomy = draw({ ...INSTALLED, installs: [{ id: 'cyber', used: 1, value: 1, limit: 4 }] });
    fireEvent.click(within(screen.getByTestId('gear-item-plate')).getByRole('button', { name: 'INSTALL Dermal Plating' }));
    expect(roomy.onItem).toHaveBeenLastCalledWith({ kind: 'install', item: 'plate' });
    cleanup();
    draw({ ...INSTALLED, installs: [{ id: 'cyber', used: 2, value: 2, limit: 2 }] });
    expect(screen.getByRole('group', { name: 'CYBERWARE installs' }).getAttribute('style')).toContain('var(--warning)');
  });
});
