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

/** Cyberware sits under GEAR, likewise. */
const openGear = () => userEvent.click(screen.getByRole('button', { name: 'GEAR' }));

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

describe('a whole loadout on the sheet', () => {
  const piece = (name: string, mods: unknown[], extra = {}) => ({
    name, equipped: true, type: 'neural', side: null, hl: 0, cost: null, data: '', mods, ...extra,
  });

  it('shows the combined total from two pieces, and names both', () => {
    show({ cool: 5, cyberware: [
      piece('Kerenzikov', [{ kind: 'stat', target: 'COOL', value: 2 }]),
      piece('Tattoo', [{ kind: 'stat', target: 'Cool', value: 1 }]),
    ] });
    const badge = screen.getByTitle(/5 → 8/);
    expect(badge).toHaveTextContent('8');
    expect(badge.title).toContain('Kerenzikov +2');
    expect(badge.title).toContain('Tattoo +1');
  });

  it('applies a set from one piece before an adjustment from another', () => {
    show({ cool: 9, cyberware: [
      piece('Sets', [{ kind: 'statSet', target: 'COOL', value: 3 }]),
      piece('Adds', [{ kind: 'stat', target: 'COOL', value: 2 }]),
    ] });
    expect(screen.getByTitle(/9 → 5/)).toBeInTheDocument();
  });

  it('badges each stat separately when pieces touch different ones', () => {
    show({ cool: 5, ref: 6, cyberware: [
      piece('A', [{ kind: 'stat', target: 'COOL', value: 2 }]),
      piece('B', [{ kind: 'stat', target: 'REF', value: 3 }]),
    ] });
    expect(screen.getByTitle(/5 → 7/)).toBeInTheDocument();
    expect(screen.getByTitle(/6 → 9/)).toBeInTheDocument();
    expect(screen.getAllByTitle(/→/)).toHaveLength(2);
  });

  it('lets one piece carry modifiers for several different things', () => {
    show({ cool: 5, ref: 6, cyberware: [
      piece('Multi', [
        { kind: 'stat', target: 'COOL', value: 2 },
        { kind: 'stat', target: 'REF', value: 1 },
      ]),
    ] });
    expect(screen.getAllByTitle(/→/)).toHaveLength(2);
  });

  it('counts only the installed pieces out of a mixed loadout', () => {
    show({ cool: 5, cyberware: [
      piece('Installed', [{ kind: 'stat', target: 'COOL', value: 2 }]),
      piece('Unplaced', [{ kind: 'stat', target: 'COOL', value: 40 }], { type: '' }),
      piece('Off', [{ kind: 'stat', target: 'COOL', value: 90 }], { equipped: false }),
      piece('No side', [{ kind: 'stat', target: 'COOL', value: 70 }], { type: 'cyberarm', side: null }),
    ] });
    expect(screen.getByTitle(/5 → 7/)).toBeInTheDocument();
    expect(screen.getAllByTitle(/→/)).toHaveLength(1);
  });

  it('shows nothing when two pieces cancel each other out', () => {
    // Net zero is not a change, and a badge reading "5" beside a 5 is noise.
    show({ cool: 5, cyberware: [
      piece('Good', [{ kind: 'stat', target: 'COOL', value: 3 }]),
      piece('Bad', [{ kind: 'stat', target: 'COOL', value: -3 }]),
    ] });
    expect(screen.queryByTitle(/→/)).not.toBeInTheDocument();
  });

  it('survives an imported loadout where most pieces do nothing', () => {
    const filler = Array.from({ length: 9 }, (_, i) => piece(`Filler ${i}`, []));
    show({ cool: 5, cyberware: [
      ...filler,
      piece('Tattoo', [{ kind: 'stat', target: 'Cool', value: 3 }]),
    ] });
    expect(screen.getByTitle(/5 → 8/)).toBeInTheDocument();
  });
});

describe('an NPC sheet gets the same treatment', () => {
  // NPCs render through the same SheetRenderer with the same template, so this should all
  // work — but "should" is how the socket wiring went untested for a week. A GM's NPCs
  // carry chrome too, and generated CP:R NPCs now arrive with some.
  const chromed = {
    int: 4, perception: 3, cool: 5,
    cyberware: [{
      name: 'Cybereye', equipped: true, type: 'cybereye', side: 'r', placed: true,
      hl: 2, cost: null, data: '',
      mods: [{ kind: 'skill', target: 'Perception', value: 2 }],
    }],
  };

  it('offers the cyberware section and the way into the window', async () => {
    show(chromed);
    await openGear();
    expect(screen.getByRole('button', { name: /AUGMENTATION/ })).toBeInTheDocument();
  });

  it('counts the chrome as installed', async () => {
    show(chromed);
    await openGear();
    expect(screen.getByText(/1 INSTALLED/)).toBeInTheDocument();
  });

  it('rolls the modified skill, as a player sheet would', async () => {
    show(chromed);
    await openSkills();
    const row = skillRow('Perception');
    // 1d10 + INT(4) + Perception(3 + 2 from the chrome)
    expect(within(row).getByRole('button', { name: 'Roll Perception' })).toHaveTextContent('+9');
  });
});
