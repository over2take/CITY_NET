import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import { cyberpunkRed } from '../../sheets/templates/cyberpunk_red';
import { INVENTORY_FIELD } from '../../sheets/inventory';

/**
 * The inventory table, as a player uses it.
 *
 * The module's arithmetic is tested in sheets/__tests__/inventory.test.ts. What is tested
 * here is that the table edits one field cleanly - it is a JSON array behind a grid of
 * inputs, and every keystroke rewrites the whole array.
 */

const show = (data: Record<string, unknown>, template = citiesWithoutNumber) => {
  const onFieldChange = vi.fn();
  function Harness() {
    const [d, setD] = React.useState<Record<string, unknown>>(data);
    return (
      <SheetRenderer
        template={template}
        data={d as never}
        readOnly={false}
        onFieldChange={(id, v) => { onFieldChange(id, v); setD((p) => ({ ...p, [id]: v })); }}
      />
    );
  }
  render(<Harness />);
  return onFieldChange;
};

const gear = () => userEvent.click(screen.getByRole('button', { name: 'GEAR' }));

const written = (fn: ReturnType<typeof vi.fn>) => {
  const call = fn.mock.calls.filter((c) => c[0] === INVENTORY_FIELD).at(-1);
  return call ? JSON.parse(call[1] as string) : null;
};

const inv = (rows: unknown[]) => ({ [INVENTORY_FIELD]: JSON.stringify(rows) });

describe('adding and removing', () => {
  it('says what the table is for when it is empty', async () => {
    show({});
    await gear();
    expect(screen.getByText(/Ammunition, stims, rations, rope/)).toBeInTheDocument();
  });

  it('adds a blank row, stowed', async () => {
    const wrote = show({});
    await gear();
    await userEvent.click(screen.getByRole('button', { name: '+ ITEM' }));
    expect(written(wrote)).toEqual([
      { name: '', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '' },
    ]);
  });

  it('removes the row asked for and no other', async () => {
    const wrote = show(inv([{ name: 'Rope' }, { name: 'Medkit' }, { name: 'Stim' }]));
    await gear();
    await userEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
    expect(written(wrote).map((r: { name: string }) => r.name)).toEqual(['Rope', 'Stim']);
  });
});

describe('editing a row', () => {
  it('writes the name', async () => {
    const wrote = show(inv([{ name: '' }]));
    await gear();
    await userEvent.type(screen.getByLabelText('Item 1 name'), 'R');
    expect(written(wrote)[0].name).toBe('R');
  });

  it('never lets a quantity drop below one', async () => {
    // Fired directly rather than typed: clearing the box already writes 1, so typing a 0
    // after it makes 10 and tests nothing. This is the value the browser really sends when
    // somebody selects the contents and types zero.
    const wrote = show(inv([{ name: 'Stim', qty: 3 }]));
    await gear();
    const qty = screen.getByLabelText('Item 1 quantity');
    for (const bad of ['0', '-5', '']) {
      fireEvent.change(qty, { target: { value: bad } });
      expect(written(wrote)[0].qty, bad).toBe(1);
    }
  });

  it('moves an item between carried and stashed', async () => {
    const wrote = show(inv([{ name: 'Rope', carry: 'stowed' }]));
    await gear();
    await userEvent.selectOptions(screen.getByLabelText('Item 1 carried'), 'stash');
    expect(written(wrote)[0].carry).toBe('stash');
  });

  it('marks a stack as bundling three-to-one', async () => {
    const wrote = show(inv([{ name: 'Grenade', qty: 6, enc: '1', carry: 'stowed' }]));
    await gear();
    await userEvent.click(screen.getByLabelText('Item 1 bundles'));
    expect(written(wrote)[0].bundled).toBe(true);
  });

  it('leaves the other rows untouched when one is edited', async () => {
    // The whole array is rewritten on every keystroke, so this is the thing to be sure of.
    const wrote = show(inv([{ name: 'Rope', qty: 2 }, { name: 'Medkit', qty: 5 }]));
    await gear();
    await userEvent.type(screen.getByLabelText('Item 1 name'), 'X');
    expect(written(wrote)[1]).toMatchObject({ name: 'Medkit', qty: 5 });
  });
});

describe('the Encumbrance column', () => {
  it('is shown on Cities Without Number, which has a carrying rule', async () => {
    show(inv([{ name: 'Rope' }]));
    await gear();
    expect(screen.getByLabelText('Item 1 encumbrance')).toBeInTheDocument();
    expect(screen.getByLabelText('Item 1 bundles')).toBeInTheDocument();
  });

  it('is hidden on a system that has none', async () => {
    // Cyberpunk RED has no Encumbrance. A column there would be a rule invented for it.
    show(inv([{ name: 'Rope' }]), cyberpunkRed);
    await gear();
    expect(screen.getByLabelText('Item 1 name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Item 1 encumbrance')).toBeNull();
    expect(screen.queryByLabelText('Item 1 bundles')).toBeNull();
  });

  it('totals what is actually on you', async () => {
    show(inv([
      { name: 'Medkit', qty: 2, enc: '2', carry: 'readied' },
      { name: 'Spare rifle', qty: 1, enc: '9', carry: 'stash' },
    ]));
    await gear();
    expect(screen.getByText(/4 Enc of this is on you/)).toBeInTheDocument();
  });
});
