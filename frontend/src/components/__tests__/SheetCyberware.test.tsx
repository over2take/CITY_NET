/**
 * The sheet showing what the chrome does.
 *
 * `sheetEffects` is tested on its own, but nothing asserted that the renderer actually
 * uses it — the same class of gap as the socket wiring on the server. A correct effects
 * layer that no component reads looks identical to no feature at all.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { getTemplate } from '../../sheets';

const CPR = getTemplate('cyberpunk_red');

const chrome = (mods: unknown[], extra = {}) => ([{
  name: 'Kerenzikov', equipped: true, type: 'neural', side: null, hl: 7, cost: null, data: '',
  mods, ...extra,
}]);

const show = (data: Record<string, unknown>) => render(
  <SheetRenderer template={CPR} data={data} onFieldChange={vi.fn()} />,
);

/** Skills live on their own tab, so every skill assertion has to open it first. */
const openSkills = () => userEvent.click(screen.getByRole('button', { name: 'SKILLS' }));

/** The row for one skill, found by the input carrying its label. */
const skillRow = (label: string) => screen.getByLabelText(label).closest('div') as HTMLElement;

describe('a stat the chrome changes', () => {
  it('shows the modified value beside the stat', () => {
    show({ cool: 5, cyberware: chrome([{ kind: 'stat', target: 'COOL', value: 3 }]) });
    expect(screen.getByTitle(/5 → 8/)).toBeInTheDocument();
  });

  it('names the piece responsible, so the number is explainable', () => {
    show({ cool: 5, cyberware: chrome([{ kind: 'stat', target: 'COOL', value: 3 }]) });
    expect(screen.getByTitle(/Kerenzikov \+3/)).toBeInTheDocument();
  });

  it('says nothing where no chrome touches the stat', () => {
    show({ cool: 5, ref: 6, cyberware: chrome([{ kind: 'stat', target: 'COOL', value: 3 }]) });
    // One badge on the sheet, not one per stat.
    expect(screen.getAllByTitle(/→/)).toHaveLength(1);
  });

  it('shows nothing at all for a character with no chrome', () => {
    show({ cool: 5, cyberware: [] });
    expect(screen.queryByTitle(/→/)).not.toBeInTheDocument();
  });

  it('shows nothing for chrome that is not installed yet', () => {
    show({ cool: 5, cyberware: chrome([{ kind: 'stat', target: 'COOL', value: 3 }], { type: '' }) });
    expect(screen.queryByTitle(/→/)).not.toBeInTheDocument();
  });
});

describe('a skill the chrome changes', () => {
  it('rolls at the modified total, not the typed one', async () => {
    // BASE is level + stat, and it is the number the roll button offers. A sheet showing 3
    // while the server rolls 9 would be worse than showing nothing.
    show({ int: 4, business: 3, cyberware: chrome([{ kind: 'skill', target: 'Business', value: 6 }]) });
    await openSkills();
    const row = skillRow('Business');
    expect(within(row).getByRole('button', { name: 'Roll Business' })).toHaveTextContent('+13');
  });

  it('rolls at the plain total without chrome', async () => {
    show({ int: 4, business: 3, cyberware: [] });
    await openSkills();
    const row = skillRow('Business');
    expect(within(row).getByRole('button', { name: 'Roll Business' })).toHaveTextContent('+7');
  });

  it('keeps the input showing what the player typed', async () => {
    // The input edits and stores the typed value; showing 9 in a box that saves 3 would be
    // a bug report waiting to happen. The badge carries the total instead.
    show({ int: 4, business: 3, cyberware: chrome([{ kind: 'skill', target: 'Business', value: 6 }]) });
    await openSkills();
    expect(screen.getByLabelText('Business')).toHaveValue(3);
    expect(screen.getByTitle(/3 → 9/)).toBeInTheDocument();
  });

  it('carries a stat modifier into every skill built on that stat', async () => {
    // BASE = level + stat, so chrome on INT lifts the roll for an INT skill.
    show({ int: 4, business: 3, cyberware: chrome([{ kind: 'stat', target: 'INT', value: 2 }]) });
    await openSkills();
    const row = skillRow('Business');
    expect(within(row).getByRole('button', { name: 'Roll Business' })).toHaveTextContent('+9');
  });
});
