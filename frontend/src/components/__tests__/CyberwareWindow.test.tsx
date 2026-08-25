/**
 * The augmentation window.
 *
 * jsdom has no layout, so the wires cannot be tested here — every rectangle is zero by
 * zero and the anchor maths has nothing to measure. What is testable is everything that
 * decides *what* is drawn: which rows land in which panel, what an import leaves unfiled,
 * how the table sorts, and that editing writes one array back rather than a field per row.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CyberwareWindow } from '../CyberwareWindow';

const ROWS = [
  { name: 'Cybereye', type: 'cybereye', side: 'r', hl: 2, cost: 100, data: 'Foundation' },
  { name: 'Low Light', type: 'cybereye', side: 'r', hl: 0, cost: 500, data: 'See in dark' },
  { name: 'Cyberarm', type: 'cyberarm', side: 'l', hl: 7, cost: null, data: '' },
  { name: 'Neuroport', type: '', side: null, hl: 0, cost: null, data: '' },
];

const show = (rows = ROWS, extra = {}) => {
  const onFieldChange = vi.fn();
  render(
    <CyberwareWindow
      data={{ cyberware: rows }}
      onFieldChange={onFieldChange}
      onClose={vi.fn()}
      who="nyx"
      {...extra}
    />,
  );
  return onFieldChange;
};

describe('what goes where', () => {
  it('puts a piece in the panel for its type and side', () => {
    show();
    // Both eyes' worth of chrome is on the right eye, so the left eye panel is empty. A
    // panel that showed both sides would be lying about which eye you can see in the dark
    // with.
    expect(screen.getByText(/CYBEREYE R · 2/)).toBeInTheDocument();
    expect(screen.getByText(/CYBEREYE L · EMPTY/)).toBeInTheDocument();
    expect(screen.getByText(/CYBERARM L · 1/)).toBeInTheDocument();
    expect(screen.getByText(/CYBERARM R · EMPTY/)).toBeInTheDocument();
  });

  it('shows unfiled chrome rather than hiding it', () => {
    // Every imported piece arrives unfiled, because the export says nothing about where it
    // was installed. Somewhere visible or it may as well not have imported.
    show();
    expect(screen.getByText(/1 NOT YET PLACED/)).toBeInTheDocument();
  });

  it('says nothing about unfiled when everything is placed', () => {
    show(ROWS.slice(0, 3));
    expect(screen.queryByText(/NOT YET PLACED/)).not.toBeInTheDocument();
  });

  it('totals humanity loss and money separately', () => {
    show();
    expect(screen.getByText(/HUMANITY LOSS 9/)).toBeInTheDocument();
    expect(screen.getByText(/600eb/)).toBeInTheDocument();
  });
});

describe('the table', () => {
  const names = () => screen.getAllByRole('row').slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent)
    .filter(Boolean);

  it('sorts by cost with unpriced last, not as if it were free', async () => {
    show();
    await userEvent.click(screen.getByText(/^EB/));
    // Cyberarm and Neuroport have no price. Sorting them as 0 would put them first and
    // imply they were free; they belong at the end however the column is sorted. Which of
    // the two comes last is not meaningful — the sort is stable, so they keep their order.
    expect(names().slice(-2).sort()).toEqual(['Cyberarm', 'Neuroport']);
    expect(names()[0]).toBe('Cybereye');
  });

  it('reverses when the same column is clicked again', async () => {
    show();
    const header = screen.getByText(/^NAME/);
    await userEvent.click(header);
    const up = names();
    await userEvent.click(header);
    expect(names()).toEqual([...up].reverse());
  });
});

describe('editing', () => {
  it('writes the whole array back under one field', async () => {
    // The point of the array: adding chrome is an append, not a hunt for the first free
    // numbered field, and there is no maximum to run out of.
    const onFieldChange = show();
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Kerenzikov');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));

    expect(onFieldChange).toHaveBeenCalledTimes(1);
    const [field, value] = onFieldChange.mock.calls[0];
    expect(field).toBe('cyberware');
    expect(value).toHaveLength(ROWS.length + 1);
    expect(value.at(-1).name).toBe('Kerenzikov');
  });

  it('refuses a nameless piece rather than storing a blank row', async () => {
    const onFieldChange = show();
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    expect(screen.getByRole('button', { name: 'ADD' })).toBeDisabled();
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('fills in the location when adding from a panel', async () => {
    const onFieldChange = show();
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg R' }));
    // ROWS has an unfiled piece, so the panel asks what to put there before offering a
    // blank form. Filing something you already have is the commoner answer.
    await userEvent.click(screen.getByRole('button', { name: 'NEW PIECE' }));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Jump Booster');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));

    const added = onFieldChange.mock.calls[0][1].at(-1);
    expect(added.type).toBe('cyberleg');
    expect(added.side).toBe('r');
  });

  it('drops a side the new type cannot have', async () => {
    // Otherwise a Fashionware stays marked R because it was an arm a moment ago.
    const onFieldChange = show();
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberarm R' }));
    await userEvent.click(screen.getByRole('button', { name: 'NEW PIECE' }));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Light Tattoo');
    await userEvent.selectOptions(screen.getByLabelText('Install type'), 'fashionware');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));

    const added = onFieldChange.mock.calls[0][1].at(-1);
    expect(added.type).toBe('fashionware');
    expect(added.side).toBeNull();
  });

  it('removes the row you clicked, not the one at that position', async () => {
    // The table is sorted, so screen order is not stored order. Removing by index deletes
    // whatever happens to sit at that spot in the array.
    const onFieldChange = show();
    await userEvent.click(screen.getByText(/^EB/));              // reorder first
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cyberarm' }));

    const left = onFieldChange.mock.calls[0][1];
    expect(left.map((r: { name: string }) => r.name)).not.toContain('Cyberarm');
    expect(left).toHaveLength(ROWS.length - 1);
  });

  it('offers nothing to edit when the sheet is read-only', () => {
    show(ROWS, { readOnly: true });
    expect(screen.queryByRole('button', { name: /ADD CYBERWARE/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

describe('a sheet that holds something unexpected', () => {
  it('opens empty rather than throwing', () => {
    // The field is free-form JSON on a sheet people import into and edit by hand.
    for (const bad of [undefined, 'text', 42, [null, 'x']]) {
      const { unmount } = render(
        <CyberwareWindow data={{ cyberware: bad }} onFieldChange={vi.fn()} onClose={vi.fn()} />,
      );
      // Two things say it, the header count and the empty table, so both are accepted.
      expect(screen.getAllByText(/0 INSTALLED|Nothing installed/).length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('filing chrome that is already on the sheet', () => {
  const UNFILED = [
    { name: 'Cybereye', type: '', side: null, hl: 2, cost: null, data: '' },
    { name: 'Grafted Muscle', type: '', side: null, hl: 14, cost: null, data: '' },
    { name: 'Cyberarm', type: '', side: null, hl: 7, cost: null, data: '' },
  ];

  it('offers what you already have rather than a blank form', async () => {
    // The flow straight after an import: everything arrives unfiled, so pressing + on an
    // arm almost always means "put one of those here", not "let me retype one".
    show(UNFILED);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberarm R' }));

    expect(screen.getByText(/PUT SOMETHING IN CYBERARM R/)).toBeInTheDocument();
    // A name predicate rather than a regex: the offered buttons carry a "fits" marker and
    // an interpunct, and matching the whole label is brittle for no gain.
    const offers = (needle: string) => screen.getAllByRole('button')
      .filter((b) => (b.textContent || '').startsWith(needle));
    expect(offers('Cyberarm HL 7')).toHaveLength(1);
    expect(offers('Grafted Muscle')).toHaveLength(1);
  });

  it('puts the pieces that read like a match first', async () => {
    show(UNFILED);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberarm R' }));

    const offered = screen.getAllByRole('button')
      .map((b) => b.textContent || '')
      .filter((t) => /HL \d/.test(t));
    expect(offered[0]).toMatch(/Cyberarm/);
    expect(offered[0]).toMatch(/fits/);
  });

  it('files the piece into the panel that asked', async () => {
    const onFieldChange = show(UNFILED);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberarm R' }));
    const offer = screen.getAllByRole('button')
      .find((b) => (b.textContent || '').startsWith('Cyberarm HL 7'));
    await userEvent.click(offer!);

    const [, value] = onFieldChange.mock.calls[0];
    const moved = value.find((r: { name: string }) => r.name === 'Cyberarm');
    expect(moved.type).toBe('cyberarm');
    expect(moved.side).toBe('r');
    // Filing moves a piece; it must not add one.
    expect(value).toHaveLength(UNFILED.length);
  });

  it('still offers a new piece from the chooser', async () => {
    show(UNFILED);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg L' }));
    await userEvent.click(screen.getByRole('button', { name: 'NEW PIECE' }));

    expect(screen.getByLabelText('Cyberware name')).toBeInTheDocument();
    expect(screen.getByLabelText('Install type')).toHaveValue('cyberleg');
    expect(screen.getByLabelText('Side')).toHaveValue('l');
  });

  it('goes straight to the form when nothing is waiting to be placed', async () => {
    // With nothing unfiled there is nothing to ask about, and a chooser showing an empty
    // list is a click that buys nothing.
    show(ROWS.slice(0, 3));
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg R' }));

    expect(screen.queryByText(/PUT SOMETHING IN/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cyberware name')).toBeInTheDocument();
  });
});

describe('where the chooser appears', () => {
  it('opens above the diagram rather than below the table', async () => {
    // It is opened from a panel beside the figure. Below the table it is a screenful away
    // from the thing that opened it, which is what made it look like nothing happened.
    show([{ name: 'Neuroport', type: '', side: null, hl: 0, cost: null, data: '' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberarm R' }));

    const chooser = screen.getByText(/PUT SOMETHING IN/);
    const table = screen.getByText(/ALL CYBERWARE/);
    // compareDocumentPosition: 4 means the table follows the chooser in the document.
    expect(chooser.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not fall over where scrollIntoView is missing', async () => {
    // jsdom has no scrollIntoView. An unguarded call takes the window down on open.
    show([{ name: 'Neuroport', type: '', side: null, hl: 0, cost: null, data: '' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg L' }));
    expect(screen.getByText(/PUT SOMETHING IN CYBERLEG L/)).toBeInTheDocument();
  });
});
