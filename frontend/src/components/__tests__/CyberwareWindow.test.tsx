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
import type { CyberRow } from '../../sheets/cyberwareRows';
import { getTemplate } from '../../sheets';

// The modifier pickers read this system's stats and skills off the template.
const CPR = getTemplate('cyberpunk_red');

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
      template={CPR}
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
    expect(screen.getByText(/use \+ on a body part/)).toBeInTheDocument();
  });

  it('says nothing about unfiled when everything is placed', () => {
    show(ROWS.slice(0, 3));
    expect(screen.queryByText(/use \+ on a body part/)).not.toBeInTheDocument();
  });

  it('totals humanity loss and money separately', () => {
    show();
    expect(screen.getByText(/HUMANITY LOSS 9/)).toBeInTheDocument();
    expect(screen.getByText(/600eb/)).toBeInTheDocument();
  });
});

describe('the table', () => {
  // Cell 1, not 0: the first column is the placed/unplaced dot.
  const names = () => screen.getAllByRole('row').slice(1)
    .map((r) => within(r).getAllByRole('cell')[1]?.textContent)
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

  it('leaves a paired piece waiting to be placed rather than guessing a side', async () => {
    // The form does not ask which side, because the same eye fits either socket. A
    // Cybereye added from the generic form is therefore in neither eye yet, and has to
    // read as unplaced — otherwise it is in the table but nowhere on the body.
    const onFieldChange = show([]);
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Low Light');
    await userEvent.selectOptions(screen.getByLabelText('Install type'), 'cybereye');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));

    const added = onFieldChange.mock.calls[0][1].at(-1);
    expect(added.type).toBe('cybereye');
    expect(added.side).toBeNull();
  });

  it('shows a sided piece with no side as still needing a place', () => {
    show([{ name: 'Low Light', type: 'cybereye', side: null, hl: 0, cost: null, data: '' }]);
    expect(screen.getByText(/use \+ on a body part/)).toBeInTheDocument();
    expect(screen.getByText(/CYBEREYE R · EMPTY/)).toBeInTheDocument();
    expect(screen.getByText(/CYBEREYE L · EMPTY/)).toBeInTheDocument();
  });

  it('starts the humanity box empty rather than showing a 0 nobody typed', async () => {
    // A 0 sitting in the box reads as a value that was entered, and hides the heading a
    // placeholder would have shown. Empty until someone means to put a number in it.
    show([]);
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    expect(screen.getByLabelText('Humanity loss')).toHaveValue(null);
    expect(screen.getByLabelText('Price in eddies')).toHaveValue(null);
  });

  it('stores an untouched humanity box as 0, not as missing', async () => {
    // Humanity loss and price differ here: an unpriced piece stays unpriced, because
    // nobody knows what it cost, but a piece with no humanity loss cost you nothing.
    const onFieldChange = show([]);
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Light Tattoo');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));

    const added = onFieldChange.mock.calls[0][1].at(-1);
    expect(added.hl).toBe(0);
    expect(added.cost).toBeNull();
  });

  it('labels every box with a heading that survives typing', async () => {
    // Scoped to each control's own label rather than the whole window, because the table
    // underneath has columns by the same names.
    show([]);
    await userEvent.click(screen.getByRole('button', { name: /ADD CYBERWARE/ }));
    const headingOver = (field: string) =>
      screen.getByLabelText(field).closest('label');

    expect(headingOver('Cyberware name')).toHaveTextContent('NAME');
    expect(headingOver('Install type')).toHaveTextContent('LOCATION');
    expect(headingOver('Humanity loss')).toHaveTextContent('HUMANITY');
    expect(headingOver('Price in eddies')).toHaveTextContent('EDDIES');
    expect(headingOver('Effect')).toHaveTextContent('EFFECT');

    // The point of a heading over a placeholder: it is still there once there is a value.
    await userEvent.type(screen.getByLabelText('Humanity loss'), '7');
    expect(headingOver('Humanity loss')).toHaveTextContent('HUMANITY');
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

  it('still offers a new piece from the chooser, on the leg you asked for', async () => {
    // The side is never asked for — the same leg fits either hip, so which one it goes on
    // is a fact about the panel you pressed + on, and is checked on what gets written
    // rather than on a control.
    const onFieldChange = show(UNFILED);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg L' }));
    await userEvent.click(screen.getByRole('button', { name: 'NEW PIECE' }));

    expect(screen.getByLabelText('Cyberware name')).toBeInTheDocument();
    expect(screen.getByLabelText('Install type')).toHaveValue('cyberleg');
    expect(screen.queryByLabelText('Side')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Jump Booster');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
    expect(onFieldChange.mock.calls[0][1].at(-1).side).toBe('l');
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

describe('choosing what to put in a panel', () => {
  // A piece can reach this list already knowing what it is: a paired type with no side
  // yet, from the form or an import. That is not a guess and it outranks the name.
  // The typed piece is stored LAST on purpose. Put it first and the assertion passes
  // whatever the ranking does, because a stable sort simply leaves it there.
  const WAITING = [
    { name: 'Self ICE', type: '', side: null, hl: 3, cost: null, data: '' },
    { name: 'Neuroport', type: '', side: null, hl: 0, cost: null, data: '' },
    { name: 'my stuff', type: 'cyberleg', side: null, hl: 3, cost: 500, data: '' },
  ];

  const offered = () => screen.getAllByRole('button')
    .map((b) => b.textContent?.trim())
    .filter((t) => t && WAITING.some((r) => t.startsWith(r.name)));

  it('puts a piece already typed for this panel at the top', async () => {
    // The reported bug: a custom piece marked Cyberleg sat at the bottom of the list when
    // placing into a leg, because only its name was being read.
    show(WAITING);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg L' }));
    expect(offered()[0]).toMatch(/^my stuff/);
  });

  it('still reads the name of a piece with no type at all', async () => {
    show([
      { name: 'Plain', type: '', side: null, hl: 0, cost: null, data: '' },
      { name: 'Cyberleg Booster', type: '', side: null, hl: 0, cost: null, data: '' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg R' }));
    const names = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(names.findIndex((n) => n?.startsWith('Cyberleg Booster')))
      .toBeLessThan(names.findIndex((n) => n?.startsWith('Plain')));
  });

  it('does not offer a piece typed as something else, whatever it is called', async () => {
    // The type is the answer. A Cyberarm named "Leg Booster" does not belong in a leg, and
    // ranking it as a match would invite filing it there.
    show([{ name: 'Leg Booster', type: 'cyberarm', side: null, hl: 0, cost: null, data: '' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add to Cyberleg R' }));
    const button = screen.getAllByRole('button').find((b) => b.textContent?.startsWith('Leg Booster'));
    expect(button).toBeDefined();
    // Present, because it still needs a side — but not marked as fitting this panel.
    expect(button).toHaveStyle({ color: 'var(--grid-section)' });
  });
});

describe('taking chrome out again', () => {
  it('unplaces a piece without throwing it away', async () => {
    // Uninstalling and never having owned it are different things. The table's × does the
    // second; a panel needs the first, or the only way out of an arm is deletion.
    const onFieldChange = show();
    await userEvent.click(screen.getByRole('button', { name: 'Take Cyberarm out of Cyberarm L' }));

    const [, value] = onFieldChange.mock.calls[0];
    expect(value).toHaveLength(ROWS.length);
    const moved = value.find((r: { name: string }) => r.name === 'Cyberarm');
    expect(moved.type).toBe('');
    expect(moved.side).toBeNull();
  });

  it('leaves everything else where it was', async () => {
    const onFieldChange = show();
    await userEvent.click(screen.getByRole('button', { name: 'Take Low Light out of Cybereye R' }));

    const [, value] = onFieldChange.mock.calls[0];
    const eye = value.find((r: { name: string }) => r.name === 'Cybereye');
    expect(eye.type).toBe('cybereye');
    expect(eye.side).toBe('r');
  });

  it('offers no way out on a read-only sheet', () => {
    show(ROWS, { readOnly: true });
    expect(screen.queryByRole('button', { name: /^Take / })).not.toBeInTheDocument();
  });

});

describe('modifiers', () => {
  const withMods = {
    cyberware: [{
      name: 'EMP Threading', type: 'fashionware', hl: 0, cost: null, data: '',
      mods: [
        { kind: 'skill', target: 'Business', value: 6 },
        { kind: 'statSet', target: 'Cool', value: 3 },
      ],
    }],
  };

  it('shows what a piece actually does, sign and all', () => {
    // The sign is explicit because -2 and +2 differ only by that character, and a bare
    // "2" reads as neither.
    render(<CyberwareWindow data={withMods} template={CPR} onFieldChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('+6 Business')).toBeInTheDocument();
  });

  it('shows a set value as a value rather than as an adjustment', () => {
    render(<CyberwareWindow data={withMods} template={CPR} onFieldChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Cool = 3')).toBeInTheDocument();
    expect(screen.queryByText('+3 Cool')).not.toBeInTheDocument();
  });

  it('lets a player add one by hand', async () => {
    const onFieldChange = vi.fn();
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={onFieldChange} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Sandevistan');
    await userEvent.click(screen.getByText('+ MODIFIER'));
    // Picked from this system's stats rather than typed: a typo is not a stat.
      await userEvent.selectOptions(screen.getByLabelText('Modifier 1 target'), 'REF');
    await userEvent.clear(screen.getByLabelText('Modifier 1 value'));
    await userEvent.type(screen.getByLabelText('Modifier 1 value'), '2');
    await userEvent.click(screen.getByText('ADD'));

    const [, written] = onFieldChange.mock.calls.at(-1)!;
    expect((written as CyberRow[])[0].mods).toEqual([
      { kind: 'stat', target: 'REF', value: 2 },
    ]);
  });

  it('does not store a modifier line left blank', async () => {
    // Pressing + MODIFIER and then thinking better of it should not leave the row
    // claiming to do something.
    const onFieldChange = vi.fn();
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={onFieldChange} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Plain');
    await userEvent.click(screen.getByText('+ MODIFIER'));
    await userEvent.click(screen.getByText('ADD'));

    const [, written] = onFieldChange.mock.calls.at(-1)!;
    expect((written as CyberRow[])[0].mods).toEqual([]);
  });

  it('clears the target when it cannot survive the new kind', async () => {
    // Business is a skill, not a stat. Switching a skill modifier to a stat one while
    // keeping the word would leave the piece pointed at something that does not exist.
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.click(screen.getByText('+ MODIFIER'));
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 kind'), 'skill');
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 target'), 'Business');
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 kind'), 'stat');

    expect(screen.getByLabelText('Modifier 1 target')).toHaveValue('');
  });

  it('keeps a target that exists under both kinds', async () => {
    // Setting a skill and adjusting one choose from the same list, so switching between
    // them should not make anyone pick the skill again.
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.click(screen.getByText('+ MODIFIER'));
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 kind'), 'skill');
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 target'), 'Business');
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 kind'), 'skillSet');

    expect(screen.getByLabelText('Modifier 1 target')).toHaveValue('Business');
  });

  it('heads the amount column BY for an adjustment and TO for a set', async () => {
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.click(screen.getByText('+ MODIFIER'));
    expect(screen.getByText('BY')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Modifier 1 kind'), 'statSet');
    expect(screen.getByText('TO')).toBeInTheDocument();
    expect(screen.queryByText('BY')).not.toBeInTheDocument();
  });

  it('says both when the list holds one of each', async () => {
    // One heading over a mixed list has to be true of both rows or it is wrong about one.
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.click(screen.getByText('+ MODIFIER'));
    await userEvent.click(screen.getByText('+ MODIFIER'));
    await userEvent.selectOptions(screen.getByLabelText('Modifier 2 kind'), 'statSet');

    expect(screen.getByText('BY / TO')).toBeInTheDocument();
  });

  it('lets one be taken back off', async () => {
    const onFieldChange = vi.fn();
    render(<CyberwareWindow data={{}} template={CPR} onFieldChange={onFieldChange} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.click(screen.getByText('+ MODIFIER'));
    expect(screen.getByLabelText('Modifier 1 target')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Remove modifier 1'));
    expect(screen.queryByLabelText('Modifier 1 target')).not.toBeInTheDocument();
  });
});
