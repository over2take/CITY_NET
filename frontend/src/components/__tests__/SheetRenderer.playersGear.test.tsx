import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { SheetRenderer } from '../SheetRenderer';

/**
 * PLAYERS CHANGE GEAR on the sheet (G6b; decided 2026-11-20, all A, the user: "the GM can still open, view and change
 * things"): switched off at the table, a player's GEAR card shows every column but changes none; the GM's never locks.
 */

afterEach(cleanup);

const template = {
  id: 'sys_x', name: 'Blades', tabs: ['GEAR'],
  items: {
    slots: [], list: [{ id: 'cutlass', label: 'Cutlass', needs: 'carried', features: [], type: 'weapons', values: { damage: '1d8' } }],
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
  },
  sections: [{ id: 'inventory', label: 'INVENTORY', layout: 'inventory', tab: 'GEAR', fields: [] }],
} as never;
const data = { inventory: JSON.stringify([{ name: 'Cutlass', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' }]) };

const opened = (extra: object) => {
  render(<SheetRenderer template={template} onFieldChange={() => {}} data={data as never} {...extra} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit item 1' }));
  return within(screen.getByRole('group', { name: 'Item 1 columns' }));
};

describe('PLAYERS CHANGE GEAR, from the table to the card', () => {
  it('off, for a player: DAMAGE shown, not changed, said; the name still theirs', () => {
    const card = opened({ playersChangeGear: false });
    expect((card.getByLabelText('Item 1 DAMAGE') as HTMLInputElement).readOnly).toBe(true);
    expect(card.getByRole('note', { name: 'Item 1 columns' }).textContent).toBe('ONLY THE GM CHANGES THESE AT THIS TABLE');
    expect((card.getByLabelText('Item 1 name') as HTMLInputElement).readOnly).toBe(false);
  });

  it('off, for the GM: as ever', () => {
    const card = opened({ playersChangeGear: false, gm: true });
    expect((card.getByLabelText('Item 1 DAMAGE') as HTMLInputElement).readOnly).toBe(false);
    expect(card.queryByRole('note', { name: 'Item 1 columns' })).toBeNull();
  });

  it('on, or not said: as ever', () => {
    expect((opened({ playersChangeGear: true }).getByLabelText('Item 1 DAMAGE') as HTMLInputElement).readOnly).toBe(false);
    cleanup();
    expect((opened({}).getByLabelText('Item 1 DAMAGE') as HTMLInputElement).readOnly).toBe(false);
  });
});
