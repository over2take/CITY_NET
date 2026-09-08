import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import { cyberpunkRed } from '../../sheets/templates/cyberpunk_red';
import { shadowrun6e } from '../../sheets/templates/shadowrun_6e';
import { generic } from '../../sheets/templates/generic';
import type { SheetTemplate } from '../../sheets/types';

/**
 * A retired field: one something else has replaced, kept only while it still holds text.
 *
 * The Gear textarea is the case. INVENTORY does its job with rows that can be counted, but
 * sheets that predate those rows have real notes typed into the box, and dropping the field
 * would take them with it. So it renders while it has content and goes once it is emptied.
 *
 * The test that matters most is the second one: an existing sheet must not lose anything.
 */

const show = (template: SheetTemplate, data: Record<string, unknown>) => {
  render(
    <SheetRenderer
      template={template}
      data={data as never}
      readOnly={false}
      onFieldChange={vi.fn()}
    />,
  );
};

const gear = () => userEvent.click(screen.getByRole('button', { name: 'GEAR' }));

describe('the retired Gear box', () => {
  it('is gone on a sheet that never used it', async () => {
    show(citiesWithoutNumber, { str: 10 });
    await gear();
    expect(screen.queryByDisplayValue(/grapnel/)).not.toBeInTheDocument();
    expect(screen.queryByText('Gear', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('still shows what an existing sheet typed into it', async () => {
    show(citiesWithoutNumber, { str: 10, gear_notes: 'A photo of her daughter' });
    await gear();
    expect(screen.getByDisplayValue('A photo of her daughter')).toBeInTheDocument();
  });

  it('treats whitespace as empty, so clearing it really does retire it', async () => {
    // Emptying a textarea in a browser leaves '' - but a sheet imported from a form can
    // arrive holding a stray newline, and that is not content worth keeping the box for.
    show(citiesWithoutNumber, { str: 10, gear_notes: '   \n  ' });
    await gear();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.queryByText('Gear', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('leaves the rest of its section alone', async () => {
    // GEAR & CASH also holds Cash, which is not retired and must survive the filter.
    show(citiesWithoutNumber, { str: 10 });
    await gear();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });

  it('is retired on every system, not only the one that grew the inventory', async () => {
    for (const template of [cyberpunkRed, shadowrun6e, generic]) {
      const { unmount } = render(
        <SheetRenderer template={template} data={{}} readOnly={false} onFieldChange={vi.fn()} />,
      );
      await gear();
      // Each system names its money differently; all three keep it beside the retired box.
      expect(screen.getByText(/^(Cash|Cash \(eb\)|Nuyen)$/)).toBeInTheDocument();
      expect(screen.queryByText(/^Gear/, { selector: 'div' })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('the retired Weapon Notes box on CWN', () => {
  it('takes its whole section with it, being the only field in it', async () => {
    show(citiesWithoutNumber, { str: 10 });
    await gear();
    expect(screen.queryByText(/WEAPON NOTES/)).not.toBeInTheDocument();
    // The sections either side are untouched.
    expect(screen.getByText(/STASH/)).toBeInTheDocument();
    expect(screen.getByText(/INVENTORY/)).toBeInTheDocument();
  });

  it('comes back whole for a sheet that wrote something in it', async () => {
    show(citiesWithoutNumber, { str: 10, weapons_notes: 'monoblade never leaves the boot' });
    await gear();
    expect(screen.getByText(/WEAPON NOTES/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('monoblade never leaves the boot')).toBeInTheDocument();
  });
});

describe('a section left with nothing', () => {
  it('takes its heading with it rather than leaving one over nothing', async () => {
    const template: SheetTemplate = {
      id: 'x',
      name: 'X',
      tabs: ['SHEET'],
      sections: [
        { id: 'keep', label: 'KEEP', layout: 'list', fields: [{ id: 'a', label: 'Kept', type: 'text' }] },
        { id: 'go', label: 'GONE', layout: 'list', fields: [{ id: 'b', label: 'Old', type: 'textarea', retired: true }] },
      ],
    };

    const { unmount } = render(
      <SheetRenderer template={template} data={{}} readOnly={false} onFieldChange={vi.fn()} />,
    );
    expect(screen.queryByText(/GONE/)).not.toBeInTheDocument();
    expect(screen.getByText(/KEEP/)).toBeInTheDocument();
    unmount();

    // ...and comes back whole the moment the field has something in it.
    render(
      <SheetRenderer template={template} data={{ b: 'still here' }} readOnly={false} onFieldChange={vi.fn()} />,
    );
    expect(screen.getByText(/GONE/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('still here')).toBeInTheDocument();
  });
});
