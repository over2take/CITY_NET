import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { SheetRenderer } from '../SheetRenderer';
import { ChoicesSection } from '../ChoicesSection';
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

  it('where levels go up with LEVEL UP (7d2b), a player has no + or -, and the GM still does', () => {
    const data = { _choices: { classes: [{ option: 'soldier', level: 2 }] } };
    const shown = backend.choicesShown(HEARTH, data);
    const worked = { ...data, [WORKED_KEY]: backend.workedOf(HEARTH, data) };
    const { unmount } = render(<ChoicesSection lists={shown as ChoiceListShown[]} data={worked} onChoices={vi.fn()} levelsFixed />);
    expect(screen.queryByRole('button', { name: 'Soldier level up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Soldier level down' })).toBeNull();
    unmount();
    render(<ChoicesSection lists={shown as ChoiceListShown[]} data={worked} onChoices={vi.fn()} levelsFixed gm />);
    expect(screen.getByRole('button', { name: 'Soldier level up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Soldier level down' })).toBeTruthy();
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

  it('the options one to a line under PICK A CLASS, what one needs beside its own (7c2)', () => {
    draw({ int: 10, _choices: { classes: [{ option: 'soldier', level: 1 }] } });
    const pick = within(screen.getByRole('group', { name: 'Pick a Class' }));
    expect(pick.getByText('PICK A CLASS')).toBeTruthy();
    const mage = pick.getByRole('button', { name: 'MAGE' });
    const scout = pick.getByRole('button', { name: 'SCOUT' });
    expect([mage.style.gridColumn, scout.style.gridColumn]).toEqual(['1', '1']);
    const needs = pick.getByText('NEEDS INTELLECT >= 13');
    expect(mage.nextElementSibling).toBe(needs);
    expect(needs.style.gridColumn).toBe('2');
  });

  it('the words over the options read the same before a vowel (7c2)', () => {
    const archetypes = { ...template, choices: [{ ...lists[0], one: 'Archetype' }] } as SheetTemplate;
    draw({ int: 10 }, { template: archetypes });
    expect(within(screen.getByRole('group', { name: 'Pick an Archetype' })).getByText('PICK AN ARCHETYPE')).toBeTruthy();
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

describe('ROLL FOR IT (7a5b2)', () => {
  const TABLED = (players?: string) => ({
    ...HEARTH,
    choices: [{ id: 'bgs', one: 'Background', many: 'Backgrounds', table: 'd6', ...(players ? { players } : {}), options: [
      { id: 'dock', label: 'Dockhand', roll: '1-3' }, { id: 'scribe', label: 'Scribe', roll: '4-6' },
    ] }],
  });
  const drawRolled = (players: string | undefined, rolled: unknown, more: Partial<React.ComponentProps<typeof SheetRenderer>> = {}) => {
    const def = TABLED(players);
    const onChoices = vi.fn();
    const shown = backend.choicesShown(def) as ChoiceListShown[];
    render(<SheetRenderer template={{ ...template, choices: shown, sections: [{ id: 'choices', label: 'BACKGROUNDS', layout: 'choices', fields: [] }] } as SheetTemplate}
      data={{ ...(rolled ? { _rolled: { bgs: rolled } } : {}), [WORKED_KEY]: backend.workedOf(def, {}) } as never} onFieldChange={() => {}} onChoices={onChoices} {...more} />);
    return { onChoices, pick: within(screen.getByRole('group', { name: 'Pick a Background' })) };
  };

  it('BY HAND OR ROLL: ROLL FOR IT beside picking, asked of the server; nothing rolled, nothing said', async () => {
    const { onChoices, pick } = drawRolled(undefined, null);
    await userEvent.click(pick.getByRole('button', { name: 'ROLL FOR IT' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'roll', list: 'bgs' });
    expect(pick.queryByText(/^ROLLED/)).toBeNull();
    expect(pick.getByRole('button', { name: 'SCRIBE' })).toHaveProperty('disabled', false);
  });

  it('whoever can roll sees the table: the dice, and each option\'s range beside it (7c)', () => {
    const { pick } = drawRolled(undefined, null);
    // Left-aligned, as the window it is in centers text unless told otherwise.
    expect(pick.getByText('PICK A BACKGROUND (d6)').style.textAlign).toBe('left');
    expect(pick.getByText('1-3').nextElementSibling).toBe(pick.getByRole('button', { name: 'DOCKHAND' }));
    expect(pick.getByText('4-6').nextElementSibling).toBe(pick.getByRole('button', { name: 'SCRIBE' }));
    expect(pick.getByRole('button', { name: 'SCRIBE' }).style.gridColumn).toBe('2');
    expect(pick.getByText('1-3').style.gridColumn).toBe('1');
  });

  it('rolled only, a player sees the table before rolling; what came up is picked out on it (7c)', () => {
    const { pick } = drawRolled('roll', { option: 'scribe', roll: 5 });
    expect(pick.getByText('1-3').nextElementSibling).toBe(pick.getByRole('button', { name: 'DOCKHAND' }));
    expect(pick.getByText('ROLLED 5 → SCRIBE').style.textAlign).toBe('left');
    expect(pick.getByText('4-6').style.color).toBe('var(--cyan)');
    expect(pick.getByText('1-3').style.color).toBe('');
  });

  it('BY HAND, a player can\'t roll, so there is no table to read; the GM can, so sees it (7c)', () => {
    const { pick } = drawRolled('hand', null);
    expect(pick.getByText('PICK A BACKGROUND')).toBeTruthy();
    expect(pick.queryByText('1-3')).toBeNull();
    expect(pick.getByRole('button', { name: 'DOCKHAND' }).style.gridColumn).toBe('1');
    cleanup();
    const asGm = drawRolled('hand', null, { gm: true });
    expect(asGm.pick.getByText('1-3')).toBeTruthy();
  });

  it('an option with no range on the table still lines up, and what it needs stays beside it (7c)', () => {
    const def = {
      ...HEARTH,
      choices: [{ id: 'bgs', one: 'Background', many: 'Backgrounds', table: 'd6', options: [
        { id: 'dock', label: 'Dockhand', roll: '1-3', requires: '@int >= 13' }, { id: 'odd', label: 'Odd one' },
      ] }],
    };
    render(<SheetRenderer template={{ ...template, choices: backend.choicesShown(def) as ChoiceListShown[], sections: [{ id: 'choices', label: 'BACKGROUNDS', layout: 'choices', fields: [] }] } as SheetTemplate}
      data={{ [WORKED_KEY]: backend.workedOf(def, {}) } as never} onFieldChange={() => {}} onChoices={vi.fn()} />);
    const pick = within(screen.getByRole('group', { name: 'Pick a Background' }));
    expect(pick.getByRole('button', { name: 'ODD ONE' }).style.gridColumn).toBe('2');
    expect(pick.getByRole('button', { name: 'ODD ONE' }).previousElementSibling?.textContent).toMatch(/^NEEDS /);
    expect(pick.getByText(/^NEEDS /).style.gridColumn).toBe('3');
  });

  it('a roll waiting, one they can\'t take yet: marked and said, with every other off and no second roll', async () => {
    const { onChoices, pick } = drawRolled(undefined, { option: 'scribe', roll: 5 });
    expect(pick.getByText('ROLLED 5 → SCRIBE')).toBeTruthy();
    await userEvent.click(pick.getByRole('button', { name: 'SCRIBE · TAKE IT' }));
    expect(onChoices).toHaveBeenLastCalledWith({ kind: 'pick', list: 'bgs', option: 'scribe' });
    expect(pick.getByRole('button', { name: 'DOCKHAND' })).toHaveProperty('disabled', true);
    expect(pick.getByRole('button', { name: 'ROLL FOR IT' })).toHaveProperty('disabled', true);
    expect(pick.getByRole('button', { name: 'ROLL FOR IT' }).getAttribute('title')).toBe('Rolled: your GM can clear it for another go');
    expect(pick.queryByRole('button', { name: 'CLEAR THE ROLL' })).toBeNull();
  });

  it('BY HAND OR ROLL, nothing rolled: both ways open', () => {
    const { pick } = drawRolled(undefined, null);
    expect(pick.getByRole('button', { name: 'DOCKHAND' })).toHaveProperty('disabled', false);
    expect(pick.getByRole('button', { name: 'ROLL FOR IT' })).toHaveProperty('disabled', false);
  });

  it('BY ROLL ONLY: before a roll, nothing to pick by hand', () => {
    const { pick } = drawRolled('roll', null);
    expect(pick.getByRole('button', { name: 'DOCKHAND' })).toHaveProperty('disabled', true);
    expect(pick.getByRole('button', { name: 'DOCKHAND' }).getAttribute('title')).toBe('Picked by roll: ROLL FOR IT');
    expect(pick.getByRole('button', { name: 'ROLL FOR IT' })).toHaveProperty('disabled', false);
  });

  describe('a pick locked in (2026-11-06)', () => {
    const def = {
      ...HEARTH,
      choices: [{ id: 'bgs', one: 'Background', many: 'Backgrounds', table: 'd6', options: [
        { id: 'dock', label: 'Dockhand', roll: '1-3' }, { id: 'scribe', label: 'Scribe', roll: '4-6' },
      ] }],
    };
    const draw = (entry: Record<string, unknown>, gm = false) => {
      const data = { _choices: { bgs: [{ option: 'dock', ...entry }] } };
      const onChoices = vi.fn();
      render(<ChoicesSection lists={backend.choicesShown(def) as ChoiceListShown[]} data={{ ...data, [WORKED_KEY]: backend.workedOf(def, data) }} readOnly={false} gm={gm} takeBack onChoices={onChoices} />);
      return { onChoices, card: within(screen.getByRole('group', { name: 'Dockhand' })) };
    };

    it('a player is told, and has no way to change it', () => {
      const { card } = draw({ locked: true, roll: 2 });
      expect(card.getByText('ROLLED 2, AND KEPT. YOUR GM CAN CLEAR IT FOR ANOTHER GO.')).toBeTruthy();
      expect(card.queryByRole('button', { name: 'Drop Dockhand' })).toBeNull();
      expect(card.queryByRole('button', { name: /Clear the roll/ })).toBeNull();
      expect(card.queryByRole('button', { name: /Roll again/ })).toBeNull();
    });

    it('one the GM set says so', () => {
      expect(draw({ locked: true }).card.getByText('SET BY THE GM. YOUR GM CAN CLEAR IT FOR ANOTHER GO.')).toBeTruthy();
    });

    it('one picked by hand can still be taken back', () => {
      const { card } = draw({});
      expect(card.getByRole('button', { name: 'Drop Dockhand' })).toBeTruthy();
      expect(card.queryByText(/YOUR GM CAN CLEAR IT/)).toBeNull();
    });

    it('the GM clears it, or rolls again, in place of DROP', async () => {
      const { onChoices, card } = draw({ locked: true, roll: 2 }, true);
      expect(card.getByText('ROLLED 2, AND KEPT')).toBeTruthy();
      expect(card.queryByRole('button', { name: 'Drop Dockhand' })).toBeNull();
      await userEvent.click(card.getByRole('button', { name: 'Clear the roll for Dockhand' }));
      expect(onChoices).toHaveBeenLastCalledWith({ kind: 'clear', list: 'bgs', option: 'dock' });
      await userEvent.click(card.getByRole('button', { name: 'Roll again for Dockhand' }));
      expect(onChoices).toHaveBeenLastCalledWith({ kind: 'roll', list: 'bgs', again: 'dock' });
    });
  });

  it('the GM picks any and ROLLS AGAIN; a roll on nothing says so', async () => {
    const { onChoices, pick } = drawRolled('roll', { option: null, roll: 9 }, { gm: true });
    expect(pick.getByText('ROLLED 9 → NOTHING ON THE TABLE')).toBeTruthy();
    expect(pick.getByRole('button', { name: 'SCRIBE' })).toHaveProperty('disabled', false);
    await userEvent.click(pick.getByRole('button', { name: 'ROLL AGAIN' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'roll', list: 'bgs' });
    await userEvent.click(pick.getByRole('button', { name: 'CLEAR THE ROLL' }));
    expect(onChoices).toHaveBeenLastCalledWith({ kind: 'clear', list: 'bgs' });
  });

  it('BY HAND: no ROLL FOR IT for a player; the GM may still roll', () => {
    drawRolled('hand', null);
    expect(screen.queryByRole('button', { name: 'ROLL FOR IT' })).toBeNull();
    cleanup();
    drawRolled('hand', null, { gm: true });
    expect(screen.getByRole('button', { name: 'ROLL FOR IT' })).toBeTruthy();
  });
});
