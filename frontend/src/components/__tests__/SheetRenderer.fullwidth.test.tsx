import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SheetRenderer } from '../SheetRenderer';
import { citiesWithoutNumber } from '../../sheets/templates/cities_without_number';
import type { SheetSection } from '../../sheets/types';

/**
 * A fullWidth field spans its section, in every layout that has one.
 *
 * It used to be honoured only by a section that repeats an entry - a vehicle and its
 * mounts. The two layouts that do not repeat, the weapons table and the armor grid, both
 * dropped the flag: their MODS list was squeezed into a single column, which at a normal
 * pane width measures about 64px, so a chip carrying a sentence of effect text wrapped to
 * one word per line. The weapons one lost its heading with it, because only the full-width
 * path draws one.
 *
 * jsdom has no layout, so the wrapping itself cannot be asserted here. The span is an
 * inline style, and it is the thing that was missing.
 */

const sectionById = (id: string) => citiesWithoutNumber.sections.find((s) => s.id === id)!;

const renderOnly = (section: SheetSection, data: Record<string, unknown>) =>
  render(
    <SheetRenderer
      // One tab holding one section, so it is the active tab on render.
      template={{ ...citiesWithoutNumber, tabs: ['GEAR'], sections: [section] }}
      data={data as never}
      readOnly={false}
      onFieldChange={vi.fn()}
    />,
  );

/**
 * The grid span of the cell a label sits in, or null when it spans nothing.
 *
 * The first match: the weapons table draws one MODS heading per weapon row, and they are
 * all the same field repeated with a different index.
 */
const spanOf = (label: string): string | null => {
  let el: HTMLElement | null = screen.getAllByText(label)[0];
  while (el && !el.style.gridColumn) el = el.parentElement;
  return el?.style.gridColumn ?? null;
};

describe('fullWidth spans the section it is in', () => {
  it('spans the weapons table, which does not repeat an entry', () => {
    renderOnly(sectionById('weapons'), { weapon1_name: 'gun', weapon1_mods: '[]' });
    expect(spanOf('WEAPON MODS')).toBe('1 / -1');
  });

  it('gives the weapons list its heading back', () => {
    // Only the full-width path draws a label, so the squeezed version had none at all.
    renderOnly(sectionById('weapons'), { weapon1_name: 'gun', weapon1_mods: '[]' });
    expect(screen.getAllByText('WEAPON MODS').length).toBeGreaterThan(0);
  });

  it('spans the armor grid', () => {
    renderOnly(sectionById('armor'), { armor_name: 'Vest', armor_mods: '[]' });
    expect(spanOf('ARMOR MODS')).toBe('1 / -1');
  });

  it('leaves an ordinary field in its own cell', () => {
    // Guards the guard: if every cell spanned, the three above would pass for free.
    renderOnly(sectionById('armor'), { armor_name: 'Vest' });
    expect(spanOf('MAX DEX')).toBeNull();
  });

  it('still spans in a section that does repeat an entry', () => {
    // The one layout that always honoured it, pinned so the shared fix keeps it working.
    renderOnly(sectionById('vehicles'), { vehicle1_name: 'Mule' });
    expect(spanOf('VEHICLE FITTINGS')).toBe('1 / -1');
  });
});
