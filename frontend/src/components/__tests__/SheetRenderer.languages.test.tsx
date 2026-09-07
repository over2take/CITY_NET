import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';

/**
 * Adding a language, including one the list could never contain.
 *
 * A tag_list picks from a fixed set. Languages cannot work that way: the two every
 * character starts with are their city's common tongue and their enclave's native one,
 * and the city is invented per campaign. So the picker gained a typed entry beside it.
 */

const languages = citiesWithoutNumber.sections.find((s) => s.id === 'languages')!;

const show = (data: Record<string, unknown> = {}) => {
  const onFieldChange = vi.fn();
  function Harness() {
    const [d, setD] = React.useState<Record<string, unknown>>(data);
    return (
      <SheetRenderer
        template={{ ...citiesWithoutNumber, tabs: ['NOTES'], sections: [languages] }}
        data={d as never}
        readOnly={false}
        onFieldChange={(id, v) => { onFieldChange(id, v); setD((p) => ({ ...p, [id]: v })); }}
      />
    );
  }
  render(<Harness />);
  return onFieldChange;
};

const written = (fn: ReturnType<typeof vi.fn>) =>
  JSON.parse((fn.mock.calls.at(-1)?.[1] as string) ?? '[]');

describe('picking one from the list', () => {
  it('adds it as a chip', async () => {
    const wrote = show();
    await userEvent.selectOptions(
      screen.getByLabelText('Add Languages spoken'), 'Cantonese',
    );
    expect(written(wrote)).toEqual(['Cantonese']);
  });
});

describe('typing one the list does not have', () => {
  it('adds what was typed', async () => {
    const wrote = show();
    await userEvent.type(screen.getByLabelText('Add a custom Languages spoken'), 'Sperantu');
    await userEvent.click(screen.getByLabelText('Add typed Languages spoken'));
    expect(written(wrote)).toEqual(['Sperantu']);
  });

  it('takes Enter as well as the button', async () => {
    // A text box beside a list is a thing people press Enter in.
    const wrote = show();
    await userEvent.type(screen.getByLabelText('Add a custom Languages spoken'), 'Nuyorican{Enter}');
    expect(written(wrote)).toEqual(['Nuyorican']);
  });

  it('trims what was typed, and refuses nothing but spaces', async () => {
    const wrote = show();
    const box = screen.getByLabelText('Add a custom Languages spoken');
    await userEvent.type(box, '   {Enter}');
    expect(wrote).not.toHaveBeenCalled();

    await userEvent.type(box, '  Kreyòl  {Enter}');
    expect(written(wrote)).toEqual(['Kreyòl']);
  });

  it('clears the box after adding, so the next one starts empty', async () => {
    show();
    const box = screen.getByLabelText('Add a custom Languages spoken') as HTMLInputElement;
    await userEvent.type(box, 'Sperantu{Enter}');
    expect(box.value).toBe('');
  });

  it('does not add the same language twice', async () => {
    const wrote = show({ languages: JSON.stringify(['Cantonese']) });
    await userEvent.type(screen.getByLabelText('Add a custom Languages spoken'), 'Cantonese{Enter}');
    expect(wrote).not.toHaveBeenCalled();
  });
});

describe('the line under the list', () => {
  it('counts what is known against what Connect and Know allow', () => {
    show({ languages: JSON.stringify(['English (GB)', 'Cantonese']), connect: 0, know: -1 });
    expect(screen.getByText(/2 \/ 3 known/)).toBeInTheDocument();
  });

  it('says so when there are more than the skills allow', () => {
    show({ languages: JSON.stringify(['a', 'b', 'c', 'd']), connect: -1, know: -1 });
    expect(screen.getByText(/2 more than Connect and Know allow/)).toBeInTheDocument();
  });
});
