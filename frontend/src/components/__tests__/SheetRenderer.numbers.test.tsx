import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import type { SheetSection } from '../../sheets/types';

/**
 * Typing into a number field.
 *
 * A `type="number"` input reports '' for anything it cannot parse yet, and a lone minus
 * sign is one of those. The renderer coerced with Number(), so the instant you pressed
 * minus the field was overwritten with 0 and the digits you typed next landed on a
 * positive number - which meant NO number field on ANY sheet could be given a negative
 * value by typing. It surfaced on MOVE MOD, where negatives are the main use: encumbrance
 * and prone both reduce a Move rate.
 */

const combat = citiesWithoutNumber.sections.find((s) => s.id === 'combat')! as SheetSection;

/**
 * Stateful, because the bug lives in the round trip.
 *
 * With a fixed `data` prop the input never shows what was written, so a test could not
 * tell a field that kept its minus from one that threw it away. This feeds every write
 * back in, the way the app does.
 */
const renderCombat = () => {
  const onFieldChange = vi.fn();
  function Harness() {
    const [data, setData] = React.useState<Record<string, unknown>>({});
    return (
      <SheetRenderer
        template={{ ...citiesWithoutNumber, tabs: ['STATS'], sections: [combat] }}
        data={data as never}
        readOnly={false}
        onFieldChange={(id, value) => {
          onFieldChange(id, value);
          setData((d) => ({ ...d, [id]: value }));
        }}
      />
    );
  }
  render(<Harness />);
  return onFieldChange;
};

/** The last value written for a field. */
const lastValue = (fn: ReturnType<typeof vi.fn>, id: string) =>
  fn.mock.calls.filter((c) => c[0] === id).at(-1)?.[1];

describe('a number field accepts a negative', () => {
  /**
   * What the browser actually does, which jsdom does not.
   *
   * A real `type="number"` input sanitises: while its contents are "-" it reports value
   * ''. jsdom hands back the raw string instead, so userEvent.type('-3') never reproduces
   * the bug and a test written that way passes whether or not the fix is present - I
   * checked, by removing the fix and watching it still pass. So the empty string is fired
   * directly, which is the event Chrome really sends.
   */
  const partialMinus = (box: HTMLElement) => fireEvent.change(box, { target: { value: '' } });

  /** Seed a value first: firing '' at an already-empty box is not a change at all. */
  const seeded = async () => {
    const wrote = renderCombat();
    const box = screen.getByLabelText('MOVE MOD');
    await userEvent.type(box, '5');
    return { wrote, box };
  };

  it('does not write a zero when the minus is pressed', async () => {
    const { wrote, box } = await seeded();
    partialMinus(box);
    // The regression: Number('') is 0, so the field was overwritten with a number nobody
    // typed, and the digits that followed landed on a positive.
    expect(lastValue(wrote, 'move_mod')).not.toBe(0);
  });

  it('arrives at the negative once the digits follow', async () => {
    const { wrote, box } = await seeded();
    partialMinus(box);
    fireEvent.change(box, { target: { value: '-3' } });
    expect(lastValue(wrote, 'move_mod')).toBe(-3);
  });

  it('keeps a lone minus if the browser does report one', async () => {
    // Belt and braces: not every engine blanks the field, and one that hands back '-'
    // must not have it coerced to zero either.
    const { wrote, box } = await seeded();
    fireEvent.change(box, { target: { value: '-' } });
    expect(lastValue(wrote, 'move_mod')).not.toBe(0);
  });

  it('still writes plain numbers as numbers', async () => {
    const wrote = renderCombat();
    await userEvent.type(screen.getByLabelText('BHB'), '4');
    expect(lastValue(wrote, 'base_hit_bonus')).toBe(4);
  });

  it('lets a field be cleared rather than snapping to zero', async () => {
    const wrote = renderCombat();
    const box = screen.getByLabelText('MOVE MOD');
    await userEvent.type(box, '7');
    await userEvent.clear(box);
    expect(lastValue(wrote, 'move_mod')).toBe('');
  });
});

describe('a number that means nothing on its own says what it is', () => {
  it('captions MOVE and MOVE MOD as meters', () => {
    renderCombat();
    // In the strip ROLL and REFILL sit in, so the box keeps one shape either way.
    expect(screen.getAllByText('METERS')).toHaveLength(2);
  });

  it('captions nothing that has no unit', () => {
    renderCombat();
    // Guards the guard: a caption on every field would make the test above pass for free.
    expect(screen.queryByText('undefined')).toBeNull();
    expect(screen.getAllByText('METERS').length).toBeLessThan(
      screen.getAllByRole('spinbutton').length,
    );
  });
});
