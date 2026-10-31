import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { SheetRenderer } from '../SheetRenderer';
import { WORKED_KEY, type ChoiceListShown } from '../../sheets/choicesShown';
import type { SheetTemplate } from '../../sheets';

/**
 * A character sheet's CHOICES block (7a3b1). Approved mockup builder-choices (2026-10-27): each list
 * with the character's picks, their levels (the total broken down on hover), the features unlocked with
 * uses to tick, the next to come, and the options left to pick, one not met saying what it needs. It
 * asks the server; it never decides. Drawn through the sheet itself, from a section laid out 'choices'.
 */

afterEach(() => cleanup());

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/choices.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'rally', label: 'Rally', uses: { count: '2', refill: 'short_rest' }, text: 'Catch your breath.' },
        { id: 'veteran', label: 'Veteran', at: 5 },
      ] },
      { id: 'mage', label: 'Mage', requires: '@int >= 13' },
      { id: 'scout', label: 'Scout' },
    ] },
  ],
};
const lists = backend.choicesShown(HEARTH) as ChoiceListShown[];
const template: SheetTemplate = {
  id: 'sys_hearthhearthhear', name: 'Hearth', choices: lists,
  sections: [{ id: 'choices', label: 'CLASSES', layout: 'choices', fields: [] }],
} as SheetTemplate;
const sheet = (data: Record<string, unknown>) => ({ ...data, [WORKED_KEY]: backend.workedOf(HEARTH, data) });

const draw = (data: Record<string, unknown>, more: Partial<React.ComponentProps<typeof SheetRenderer>> = {}) => {
  const onChoices = vi.fn();
  render(<SheetRenderer template={template} data={sheet(data) as never} onFieldChange={() => {}} onChoices={onChoices} {...more} />);
  return onChoices;
};
const soldier = () => within(screen.getByRole('group', { name: 'Soldier' }));

describe('the CHOICES block', () => {
  it('each pick with its level and the features it has, the next to come, the total broken down on hover', () => {
    draw({ int: 10, _choices: { classes: [{ option: 'soldier', level: 3 }] } });
    expect(soldier().getByText('LV 3')).toBeTruthy();
    expect(soldier().getByText('Guard Stance')).toBeTruthy();
    expect(soldier().getByText('+ DEFENSE')).toBeTruthy();
    expect(soldier().getByText('Catch your breath.')).toBeTruthy();
    expect(soldier().getByText('NEXT · LV 5: Veteran')).toBeTruthy();
    expect(soldier().queryByText('Veteran')).toBeNull();
    expect(screen.getByLabelText('Level 3: SOLDIER 3').getAttribute('title')).toBe('SOLDIER 3');
  });

  it('a level raised and lowered, asked of the server, never below 1', async () => {
    const onChoices = draw({ _choices: { classes: [{ option: 'soldier', level: 1 }] } });
    expect(soldier().getByRole('button', { name: 'Soldier level down' })).toHaveProperty('disabled', true);
    await userEvent.click(soldier().getByRole('button', { name: 'Soldier level up' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'level', list: 'classes', option: 'soldier', level: 2 });
  });

  it('uses as pips, left and spent, with how many and the rest that refills them; a click spends or takes back', async () => {
    const onChoices = draw({ _choices: { classes: [{ option: 'soldier', level: 1 }] }, _uses: { rally: 1 } });
    const pips = within(soldier().getByRole('group', { name: 'Rally uses' }));
    expect(pips.getByText('1 OF 2 · SHORT REST')).toBeTruthy();
    expect(pips.getByRole('button', { name: 'Rally use 1' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(pips.getByRole('button', { name: 'Rally use 2' }));
    expect(onChoices).toHaveBeenLastCalledWith({ kind: 'use', feature: 'rally', spent: 2 });
    await userEvent.click(pips.getByRole('button', { name: 'Rally use 1' }));
    expect(onChoices).toHaveBeenLastCalledWith({ kind: 'use', feature: 'rally', spent: 0 });
  });

  it('options left to pick; one not met is off, saying what it needs', async () => {
    const onChoices = draw({ int: 10, _choices: { classes: [{ option: 'soldier', level: 1 }] } });
    const pick = within(screen.getByRole('group', { name: 'Pick a Class' }));
    expect(pick.getByRole('button', { name: 'MAGE' })).toHaveProperty('disabled', true);
    expect(pick.getByText('NEEDS INTELLECT >= 13')).toBeTruthy();
    await userEvent.click(pick.getByRole('button', { name: 'SCOUT' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'pick', list: 'classes', option: 'scout' });
  });

  it('each list folds away on its own, saying how many are picked, and opens again (2026-10-31)', async () => {
    draw({ int: 10, _choices: { classes: [{ option: 'soldier', level: 3 }] } });
    const block = within(screen.getByRole('region', { name: 'Classes' }));
    const head = block.getByRole('button', { name: 'Classes: fold away' });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(block.queryByText('1 PICKED')).toBeNull();
    await userEvent.click(head);
    expect(screen.queryByRole('group', { name: 'Soldier' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Pick a Class' })).toBeNull();
    expect(block.getByText('1 PICKED')).toBeTruthy();
    expect(block.getByText('LEVEL 3')).toBeTruthy();
    const shut = block.getByRole('button', { name: 'Classes: show' });
    expect(shut.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(shut);
    expect(soldier().getByText('LV 3')).toBeTruthy();
  });

  it('a full list offers nothing more to pick', () => {
    const once = [{ ...lists[0], again: false }];
    render(<SheetRenderer template={{ ...template, choices: once }} data={sheet({ _choices: { classes: [{ option: 'soldier', level: 1 }] } }) as never} onFieldChange={() => {}} onChoices={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Pick a Class' })).toBeNull();
  });

  it('nothing picked yet says so, and offers every option', () => {
    draw({ int: 14 });
    expect(screen.getByText('No Class picked yet.')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Pick a Class' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['SOLDIER', 'MAGE', 'SCOUT']);
  });

  it('read-only, or with nothing to ask: no buttons that change anything', () => {
    draw({ _choices: { classes: [{ option: 'soldier', level: 2 }] }, _uses: {} }, { readOnly: true });
    expect(screen.queryByRole('button', { name: 'Soldier level up' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Pick a Class' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Rally uses' })).getByRole('button', { name: 'Rally use 1' })).toHaveProperty('disabled', true);
    cleanup();
    draw({ _choices: { classes: [{ option: 'soldier', level: 2 }] } }, { onChoices: undefined });
    expect(screen.queryByRole('button', { name: 'Soldier level up' })).toBeNull();
  });

  it('says why the server said no', () => {
    draw({}, { choicesRefused: 'Mage needs INTELLECT >= 13' });
    expect(screen.getByRole('alert').textContent).toBe('Mage needs INTELLECT >= 13');
  });

  it('in the builder\'s previews, with nothing published, says what will be there', () => {
    render(<SheetRenderer template={{ ...template, choices: undefined }} data={{} as never} onFieldChange={() => {}} />);
    expect(screen.getByText(/A character's picks from the system's lists show here/)).toBeTruthy();
  });
});

describe('the GM (7a3b2)', () => {
  it('takes a pick away, asked first; KEEP keeps it', async () => {
    const onChoices = draw({ _choices: { classes: [{ option: 'soldier', level: 2 }] } }, { gm: true });
    await userEvent.click(soldier().getByRole('button', { name: 'Drop Soldier' }));
    const ask = within(soldier().getByRole('group', { name: 'Take Soldier away' }));
    expect(ask.getByText('TAKE SOLDIER AWAY, AND WHAT IT GIVES?')).toBeTruthy();
    await userEvent.click(ask.getByRole('button', { name: 'KEEP' }));
    expect(onChoices).not.toHaveBeenCalled();
    await userEvent.click(soldier().getByRole('button', { name: 'Drop Soldier' }));
    await userEvent.click(soldier().getByRole('button', { name: 'YES, DROP' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'drop', list: 'classes', option: 'soldier' });
  });

  it('adds an option not met anyway', async () => {
    const onChoices = draw({ int: 10, _choices: { classes: [{ option: 'soldier', level: 1 }] } }, { gm: true });
    const pick = within(screen.getByRole('group', { name: 'Pick a Class' }));
    expect(pick.getByText('NEEDS INTELLECT >= 13 · ADD ANYWAY')).toBeTruthy();
    await userEvent.click(pick.getByRole('button', { name: 'MAGE' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'pick', list: 'classes', option: 'mage' });
  });

  it('a player has neither', () => {
    draw({ int: 10, _choices: { classes: [{ option: 'soldier', level: 1 }] } });
    expect(soldier().queryByRole('button', { name: 'Drop Soldier' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Pick a Class' })).getByRole('button', { name: 'MAGE' })).toHaveProperty('disabled', true);
  });
});

describe('what the picks do, on the fields (7a3b2)', () => {
  it('a badge beside a stat changed, its value with the bonus and where it came from', () => {
    const withStats = { ...template, sections: [...template.sections, { id: 'stats', label: 'STATS', layout: 'grid', fields: [{ id: 'defense', label: 'Defense', type: 'number', derived: true }] }] } as SheetTemplate;
    render(<SheetRenderer template={withStats} data={sheet({ defense: 11, _choices: { classes: [{ option: 'soldier', level: 1 }] } }) as never} onFieldChange={() => {}} />);
    const badge = screen.getByTitle('10 → 11 (Guard Stance +1)');
    expect(badge.textContent).toBe('11');
  });
});
