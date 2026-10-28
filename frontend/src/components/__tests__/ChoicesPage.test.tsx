import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChoicesPage } from '../ChoicesPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';
import { choiceLists, LIMITS } from '../../sheets/choices';

/**
 * The builder's CHOICES page (7a2b1). Approved mockup builder-choices (2026-10-27): the lists down the
 * left; the open list with ONE / MANY, A CHARACTER PICKS, MORE THAN ONCE, LEVELLED and its options;
 * the open option with its name, words and requirement. DELETE asks first.
 */

afterEach(() => cleanup());

const HEARTH = {
  format: 1, name: 'Hearth',
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', features: [{ id: 'guard', label: 'Guard Stance' }] },
      { id: 'mage', label: 'Mage', requires: '@int >= 13' },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [] },
  ],
} as unknown as Definition;

const open = (start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <ChoicesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const lists = () => within(screen.getByRole('list', { name: 'Lists' }));
const listPanel = (name: string) => within(screen.getByRole('region', { name: `${name} list` }));
const optionPanel = (name: string) => within(screen.getByRole('region', { name: `${name} option` }));

describe('the lists', () => {
  it('shows each list with its options, the first open with its first option', () => {
    open();
    expect(lists().getAllByRole('button').map((b) => b.textContent)).toEqual(['CLASSES2 OPTIONS · LEVELLED', 'FEATS0 OPTIONS']);
    expect(listPanel('Classes').getByRole('textbox', { name: 'Many' })).toHaveProperty('value', 'Classes');
    expect(optionPanel('Soldier').getByRole('textbox', { name: 'NAME' })).toHaveProperty('value', 'Soldier');
  });

  it('+ LIST makes one, opened to name it; none says what a list is', async () => {
    const { last } = open({ format: 1, name: 'Empty' } as Definition);
    expect(screen.getByText(/None yet\. A list is something characters pick from/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '+ LIST' }));
    expect(choiceLists(last())).toEqual([{ id: 'new_list', one: 'NEW CHOICE', many: 'NEW CHOICES', options: [] }]);
    expect(listPanel('NEW CHOICES').getByText(/No options yet/)).toBeTruthy();
  });

  it('is renamed one and many; blank is shown as needing a name', () => {
    const { last } = open();
    fireEvent.change(listPanel('Classes').getByRole('textbox', { name: 'One' }), { target: { value: 'Path' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Many' }), { target: { value: '' } });
    expect(choiceLists(last())[0]).toMatchObject({ id: 'classes', one: 'Path', many: '' });
    expect(lists().getAllByRole('button')[0].textContent).toContain('NEEDS A NAME');
  });

  it('A CHARACTER PICKS: one, several with how many, or any; MORE THAN ONCE off with any', async () => {
    const { last } = open();
    const panel = listPanel('Classes');
    const picks = within(panel.getByRole('group', { name: 'A character picks' }));
    expect(picks.getByRole('button', { name: 'ONE' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(picks.getByRole('button', { name: 'SEVERAL' }));
    expect(choiceLists(last())[0].picks).toBe(2);
    fireEvent.change(panel.getByRole('spinbutton', { name: 'How many' }), { target: { value: '3' } });
    expect(choiceLists(last())[0].picks).toBe(3);
    // SEVERAL again keeps the number set.
    await userEvent.click(picks.getByRole('button', { name: 'SEVERAL' }));
    expect(choiceLists(last())[0].picks).toBe(3);
    await userEvent.click(picks.getByRole('button', { name: 'ANY' }));
    expect(choiceLists(last())[0].picks).toBe('any');
    expect(panel.getByRole('switch', { name: '◉ MORE THAN ONCE' })).toHaveProperty('disabled', true);
    await userEvent.click(picks.getByRole('button', { name: 'ONE' }));
    expect(choiceLists(last())[0]).not.toHaveProperty('picks');
  });

  it('MORE THAN ONCE and LEVELLED switch, and say what the list now means', async () => {
    const { last } = open();
    const panel = listPanel('Classes');
    expect(panel.getByText(/One Class, and more can be added later\. Each has its own level; together they read as @classes_level\./)).toBeTruthy();
    await userEvent.click(panel.getByRole('switch', { name: '◉ MORE THAN ONCE' }));
    await userEvent.click(panel.getByRole('switch', { name: '◉ LEVELLED' }));
    expect(choiceLists(last())[0]).not.toHaveProperty('again');
    expect(choiceLists(last())[0]).not.toHaveProperty('levelled');
    expect(panel.getByText('One Class per character.')).toBeTruthy();
  });

  it('DELETE asks first, saying what goes, and KEEP keeps it', async () => {
    const { last, edits } = open();
    const panel = listPanel('Classes');
    await userEvent.click(panel.getAllByRole('button', { name: 'DELETE' })[0]);
    const ask = within(panel.getByRole('group', { name: 'Delete Classes' }));
    expect(ask.getByText(/Its 2 options go with it, and characters lose these picks\./)).toBeTruthy();
    await userEvent.click(ask.getByRole('button', { name: 'KEEP' }));
    expect(edits).toHaveLength(0);
    await userEvent.click(panel.getAllByRole('button', { name: 'DELETE' })[0]);
    await userEvent.click(within(panel.getByRole('group', { name: 'Delete Classes' })).getByRole('button', { name: 'DELETE' }));
    expect(choiceLists(last()).map((c) => c.id)).toEqual(['feats']);
  });

  it('stops at the limit', () => {
    open({ format: 1, name: 'Full', choices: Array.from({ length: LIMITS.lists }, (_, i) => ({ id: `l${i}`, one: 'A', many: `As ${i}`, options: [] })) } as unknown as Definition);
    expect(screen.getByRole('button', { name: '+ LIST' })).toHaveProperty('disabled', true);
  });
});

describe('the options', () => {
  it('are picked from the list, and + OPTION makes one, opened', async () => {
    const { last } = open();
    const panel = listPanel('Classes');
    await userEvent.click(within(panel.getByRole('group', { name: 'Options' })).getByRole('button', { name: 'MAGE' }));
    expect(optionPanel('Mage').getByRole('textbox', { name: 'REQUIRES' })).toHaveProperty('value', '@int >= 13');
    await userEvent.click(panel.getByRole('button', { name: '+ OPTION' }));
    expect(choiceLists(last())[0].options.map((o) => o.id)).toEqual(['soldier', 'mage', 'new_option']);
    expect(optionPanel('NEW OPTION').getByRole('textbox', { name: 'NAME' })).toHaveProperty('value', 'NEW OPTION');
  });

  it('a name, words and a requirement; in a levelled list, its level\'s name', () => {
    const { last } = open();
    const panel = optionPanel('Soldier');
    expect(panel.getByText('Its level reads as @soldier_level in formulas: 0 for a character without it.')).toBeTruthy();
    fireEvent.change(panel.getByRole('textbox', { name: 'WHAT IT IS' }), { target: { value: 'Trained to fight.' } });
    fireEvent.change(panel.getByRole('textbox', { name: 'REQUIRES' }), { target: { value: '@str >= 13' } });
    fireEvent.change(panel.getByRole('textbox', { name: 'NAME' }), { target: { value: 'Veteran' } });
    expect(choiceLists(last())[0].options[0]).toMatchObject({ id: 'soldier', label: 'Veteran', description: 'Trained to fight.', requires: '@str >= 13' });
  });

  it('shows the features it has, and deleting it asks first', async () => {
    const { last } = open();
    const panel = optionPanel('Soldier');
    expect(panel.getByRole('button', { name: /GUARD STANCE/ })).toBeTruthy();
    await userEvent.click(panel.getByRole('button', { name: 'DELETE' }));
    expect(panel.getByText(/Its 1 feature go with it\./)).toBeTruthy();
    await userEvent.click(within(panel.getByRole('group', { name: 'Delete Soldier' })).getByRole('button', { name: 'DELETE' }));
    expect(choiceLists(last())[0].options.map((o) => o.id)).toEqual(['mage']);
  });

  it('a list that isn\'t levelled says no level name', async () => {
    open();
    await userEvent.click(lists().getByRole('button', { name: /^FEATS/ }));
    await userEvent.click(listPanel('Feats').getByRole('button', { name: '+ OPTION' }));
    expect(optionPanel('NEW OPTION').queryByText(/Its level reads as/)).toBeNull();
  });
});

describe('help', () => {
  it('a "?" beside every setting, each named for screen readers', () => {
    open();
    // The page's own; a feature's are FeaturesEditor.test's, shown once one is open.
    const keys = ['choices.lists', 'choices.names', 'choices.picks', 'choices.again', 'choices.levelled', 'choices.options', 'choices.optionName', 'choices.description', 'choices.requires', 'choices.features'] as (keyof typeof HINTS)[];
    expect(Object.keys(HINTS).filter((k) => k.startsWith('choices.'))).toHaveLength(18);
    for (const k of keys) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  });
});
