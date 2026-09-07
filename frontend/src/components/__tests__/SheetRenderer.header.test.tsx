import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';

/**
 * The HP and EXP bars are two of the same thing and have to read as a stack.
 *
 * jsdom has no layout, so the alignment itself cannot be measured here - it was measured
 * in a browser, where both bars now start at the same x and end at the same x in every
 * state. What is pinned here is the thing that makes that true: fixed widths either side,
 * rather than labels and values that size to their text. "HP" against "EXP" started them
 * at different x, and "35/35" against "0/3" ended them at different x.
 */

const show = (data: Record<string, unknown>) =>
  render(
    <SheetRenderer
      template={citiesWithoutNumber}
      data={data as never}
      readOnly={false}
      onFieldChange={vi.fn()}
    />,
  );

const spanFor = (text: string) =>
  [...document.querySelectorAll('span')].find((s) => s.textContent === text)!;

describe('the two bars are measured the same', () => {
  it('gives both labels the same fixed width', () => {
    show({ hp: 7, hp_max: 35, level: 3, xp: 9, xp_rate: 'fast' });
    const hp = spanFor('HP');
    const xp = spanFor('EXP');
    expect(hp.style.width).toBeTruthy();
    expect(xp.style.width).toBe(hp.style.width);
  });

  it('gives both values the same fixed width, whatever they say', () => {
    // "35/35" and "0/3" are different lengths; the column they sit in must not be.
    show({ hp: 7, hp_max: 35, level: 3, xp: 9, xp_rate: 'fast' });
    const hpValue = spanFor('7/35');
    const xpValue = spanFor('9/12');
    expect(hpValue.style.width).toBeTruthy();
    expect(xpValue.style.width).toBe(hpValue.style.width);
  });

  it('gives the label and the value the same width, which centres the bar', () => {
    // The gutters either side of the track are label+gap and gap+value. Equal widths make
    // them equal, so the bar sits in the middle of the header column - measured at 38px
    // both sides, bar centre and column centre both 366. Unequal, the bar sat 11px off
    // centre and the name and level line centred above and below looked crooked on it.
    show({ hp: 7, hp_max: 35, level: 3, xp: 9, xp_rate: 'fast' });
    expect(spanFor('EXP').style.width).toBe(spanFor('9/12').style.width);
  });

  it('sits the value against its bar rather than out at the far edge', () => {
    show({ hp: 7, hp_max: 35, level: 3, xp: 9, xp_rate: 'fast' });
    expect(spanFor('9/12').style.textAlign).toBe('left');
  });
});

describe('the line under the bar', () => {
  it('says only the level while the bar can speak for itself', () => {
    show({ hp: 7, hp_max: 35, level: 3, xp: 9, xp_rate: 'fast' });
    expect(screen.getByText('LEVEL 3')).toBeInTheDocument();
    // The countdown lives on the end of the bar, where it is not said twice.
    expect(screen.getByText('9/12')).toBeInTheDocument();
  });

  it('speaks up for the two states a bar cannot show', () => {
    const { unmount } = show({ hp: 7, hp_max: 35, level: 3, xp: 12, xp_rate: 'fast' });
    expect(screen.getByText('LEVEL 3 · READY FOR 4')).toBeInTheDocument();
    unmount();

    show({ hp: 7, hp_max: 35, level: 10, xp: 200, xp_rate: 'slow' });
    expect(screen.getByText('LEVEL 10 · MAX')).toBeInTheDocument();
  });

  it('no longer repeats the level as a chip above it', () => {
    show({ hp: 7, hp_max: 35, level: 3, xp: 9, base_hit_bonus: 2 });
    expect(screen.queryByText('LVL')).toBeNull();
    // BHB is still a chip. It also labels the COMBAT field on the active tab, hence All.
    expect(screen.getAllByText('BHB').length).toBeGreaterThan(0);
  });
});
