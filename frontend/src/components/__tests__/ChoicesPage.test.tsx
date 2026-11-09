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
    expect(panel.getByRole('switch', { name: 'MORE THAN ONCE' })).toHaveProperty('disabled', true);
    await userEvent.click(picks.getByRole('button', { name: 'ONE' }));
    expect(choiceLists(last())[0]).not.toHaveProperty('picks');
  });

  it('MORE THAN ONCE and LEVELLED switch, and say what the list now means', async () => {
    const { last } = open();
    const panel = listPanel('Classes');
    expect(panel.getByText(/One Class, and more can be added later\. Each has its own level; together they read as @classes_level\./)).toBeTruthy();
    await userEvent.click(panel.getByRole('switch', { name: 'MORE THAN ONCE' }));
    await userEvent.click(panel.getByRole('switch', { name: 'LEVELLED' }));
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

  it("opens on the list the map's GO TO names (7a5c), and the first when it isn't there", () => {
    render(<ChoicesPage definition={HEARTH} edit={() => {}} startList="feats" />);
    expect(screen.getByRole('region', { name: 'Feats list' })).toBeTruthy();
    cleanup();
    render(<ChoicesPage definition={HEARTH} edit={() => {}} startList="gone" />);
    expect(screen.getByRole('region', { name: 'Classes list' })).toBeTruthy();
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

  it('a list that isn\'t levelled says no level name, and has no HIT DIE', async () => {
    open();
    await userEvent.click(lists().getByRole('button', { name: /^FEATS/ }));
    await userEvent.click(listPanel('Feats').getByRole('button', { name: '+ OPTION' }));
    expect(optionPanel('NEW OPTION').queryByText(/Its level reads as/)).toBeNull();
    expect(optionPanel('NEW OPTION').queryByRole('group', { name: 'Hit die' })).toBeNull();
  });
});

describe('HIT DIE (R1b)', () => {
  const die = () => within(optionPanel('Soldier').getByRole('group', { name: 'Hit die' }));
  const pressed = () => die().getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

  it('none, the usual dice, or OTHER with its sides typed, saying what rolls it', async () => {
    const { last } = open();
    expect(die().getAllByRole('button').map((b) => b.textContent)).toEqual(['NONE', 'D4', 'D6', 'D8', 'D10', 'D12', 'D20', 'OTHER']);
    expect(pressed()).toEqual(['NONE']);
    await userEvent.click(die().getByRole('button', { name: 'D10' }));
    expect(choiceLists(last())[0].options[0].die).toBe(10);
    expect(pressed()).toEqual(['D10']);
    expect(optionPanel('Soldier').getByText(/Turn on RECOVERY DICE on RESTS to spend its d10 at a rest\./)).toBeTruthy();
    // OTHER starts at 3 and stays open while typing, through 1 on the way to 10.
    await userEvent.click(die().getByRole('button', { name: 'OTHER' }));
    expect(choiceLists(last())[0].options[0].die).toBe(3);
    const sides = optionPanel('Soldier').getByRole('spinbutton', { name: 'Sides' });
    fireEvent.change(sides, { target: { value: '1' } });
    expect(choiceLists(last())[0].options[0].die).toBe(3);
    fireEvent.change(sides, { target: { value: '10' } });
    expect(choiceLists(last())[0].options[0].die).toBe(10);
    expect(pressed()).toEqual(['OTHER']);
    fireEvent.change(sides, { target: { value: '101' } });
    expect(choiceLists(last())[0].options[0].die).toBe(10);
    fireEvent.change(sides, { target: { value: '100' } });
    expect(choiceLists(last())[0].options[0].die).toBe(100);
    await userEvent.click(die().getByRole('button', { name: 'NONE' }));
    expect(choiceLists(last())[0].options[0]).not.toHaveProperty('die');
    expect(optionPanel('Soldier').queryByRole('spinbutton', { name: 'Sides' })).toBeNull();
  });

  it('an uncommon die opens on OTHER; with recovery dice on, says they roll it', () => {
    open({ ...HEARTH, choices: [{ ...(HEARTH.choices as object[])[0], options: [{ id: 'soldier', label: 'Soldier', die: 7 }] }], resting: { recovery: { name: 'Hit Dice', spent_at: 'any' } } } as unknown as Definition);
    expect(pressed()).toEqual(['OTHER']);
    expect(optionPanel('Soldier').getByRole('spinbutton', { name: 'Sides' })).toHaveProperty('value', '7');
    expect(optionPanel('Soldier').getByText(/Its d7 is what its hit dice roll at a rest\./)).toBeTruthy();
    // Typing a usual die keeps OTHER open: it was open from the start.
    fireEvent.change(optionPanel('Soldier').getByRole('spinbutton', { name: 'Sides' }), { target: { value: '12' } });
    expect(pressed()).toEqual(['OTHER']);
    expect(optionPanel('Soldier').getByRole('spinbutton', { name: 'Sides' })).toHaveProperty('value', '12');
  });

  it('pressing OTHER again keeps the die typed: no edit at all', async () => {
    const { edits } = open({ ...HEARTH, choices: [{ ...(HEARTH.choices as object[])[0], options: [{ id: 'soldier', label: 'Soldier', die: 7 }] }] } as unknown as Definition);
    await userEvent.click(die().getByRole('button', { name: 'OTHER' }));
    expect(edits).toEqual([]);
    expect(pressed()).toEqual(['OTHER']);
  });

  it('turning LEVELLED off takes the list\'s dice', async () => {
    const { last } = open({ ...HEARTH, choices: [{ ...(HEARTH.choices as object[])[0], options: [{ id: 'soldier', label: 'Soldier', die: 8 }] }] } as unknown as Definition);
    await userEvent.click(listPanel('Classes').getByRole('switch', { name: /LEVELLED/ }));
    expect(choiceLists(last())[0].options[0]).not.toHaveProperty('die');
    expect(optionPanel('Soldier').queryByRole('group', { name: 'Hit die' })).toBeNull();
  });
});

describe('A TABLE TO ROLL ON (7a5b)', () => {
  const BGS = {
    format: 1, name: 'Hearth', core: { dice: ['d8', '4dF', '3d6'] },
    choices: [{ id: 'bgs', one: 'Background', many: 'Backgrounds', options: [
      { id: 'dock', label: 'Dockhand' }, { id: 'scribe', label: 'Scribe' }, { id: 'thief', label: '' },
    ] }],
  } as unknown as Definition;
  const panel = () => listPanel('Backgrounds');
  const dieBox = () => panel().getByRole('combobox', { name: 'Table die' }) as HTMLSelectElement;
  const rollOf = (name: string) => panel().getByRole('textbox', { name: `${name} roll` }) as HTMLInputElement;
  const bgs = (def: Definition) => choiceLists(def)[0];

  it('offers NONE, the usual dice and the system\'s own a table can roll; NONE shows no table and no PLAYERS PICK', () => {
    open(BGS);
    expect([...dieBox().options].map((o) => o.textContent)).toEqual(['NONE', 'd6', '2d6', 'd20', 'd100', 'd8', '3d6']);
    expect(dieBox().value).toBe('');
    expect(panel().queryByRole('group', { name: 'Table' })).toBeNull();
    expect(panel().queryByRole('group', { name: 'Players pick' })).toBeNull();
    expect(screen.getByRole('note', { name: HINTS['choices.table'] })).toBeTruthy();
  });

  it('picking dice shares the rolls out evenly, BY HAND OR ROLL to start, each with what it means', async () => {
    const { last } = open(BGS);
    fireEvent.change(dieBox(), { target: { value: 'd6' } });
    expect(bgs(last())).toMatchObject({ table: 'd6', options: [{ id: 'dock', roll: '1-2' }, { id: 'scribe', roll: '3-4' }, { id: 'thief', roll: '5-6' }] });
    expect(bgs(last()).players).toBeUndefined();
    expect(panel().getByText('THE TABLE · D6 · 1 TO 6')).toBeTruthy();
    expect(rollOf('Dockhand').value).toBe('1-2');
    // A nameless option is named by its id.
    expect(rollOf('thief').value).toBe('5-6');
    const players = within(panel().getByRole('group', { name: 'Players pick' }));
    expect(players.getByRole('button', { name: 'BY HAND OR ROLL' }).getAttribute('aria-pressed')).toBe('true');
    expect(panel().getByText(/ROLL FOR IT beside picking/)).toBeTruthy();
    expect(screen.getByRole('note', { name: HINTS['choices.players'] })).toBeTruthy();
    await userEvent.click(players.getByRole('button', { name: 'BY ROLL ONLY' }));
    expect(bgs(last()).players).toBe('roll');
    expect(panel().getByText(/picking by hand is off for them/)).toBeTruthy();
    await userEvent.click(players.getByRole('button', { name: 'BY HAND' }));
    expect(bgs(last()).players).toBe('hand');
    expect(panel().getByText(/the table only shows in the builder/)).toBeTruthy();
    // Other dice share them out again.
    fireEvent.change(dieBox(), { target: { value: '2d6' } });
    expect(bgs(last()).options.map((o) => o.roll)).toEqual(['2-5', '6-9', '10-12']);
  });

  it('says what is wrong beside the option, and rolls left on none under the table', () => {
    const { last } = open(BGS);
    fireEvent.change(dieBox(), { target: { value: 'd6' } });
    fireEvent.change(rollOf('Scribe'), { target: { value: '2-3' } });
    fireEvent.change(rollOf('thief'), { target: { value: '9' } });
    expect(bgs(last()).options.map((o) => o.roll)).toEqual(['1-2', '2-3', '9']);
    expect(panel().getByText('2 is both Dockhand and Scribe')).toBeTruthy();
    expect(panel().getByText('A roll from 1 to 6, or a range like 1-2')).toBeTruthy();
    expect(panel().getByText('Nothing on 4, 5, 6')).toBeTruthy();
    expect(rollOf('Scribe').getAttribute('aria-invalid')).toBe('true');
    expect(rollOf('Dockhand').getAttribute('aria-invalid')).toBeNull();
    // Cleared, it has no roll.
    fireEvent.change(rollOf('thief'), { target: { value: '  ' } });
    expect(bgs(last()).options[2]).not.toHaveProperty('roll');
  });

  it('NONE takes the table, how players pick and every roll away; so does EVERYONE HAS IT, which has no table', async () => {
    const { last } = open(BGS);
    fireEvent.change(dieBox(), { target: { value: 'd6' } });
    await userEvent.click(within(panel().getByRole('group', { name: 'Players pick' })).getByRole('button', { name: 'BY ROLL ONLY' }));
    fireEvent.change(dieBox(), { target: { value: '' } });
    expect(bgs(last())).toEqual({ id: 'bgs', one: 'Background', many: 'Backgrounds', options: [{ id: 'dock', label: 'Dockhand' }, { id: 'scribe', label: 'Scribe' }, { id: 'thief', label: '' }] });
    fireEvent.change(dieBox(), { target: { value: 'd6' } });
    await userEvent.click(within(panel().getByRole('group', { name: 'Picked' })).getByRole('button', { name: 'EVERYONE HAS IT' }));
    expect(bgs(last())).not.toHaveProperty('table');
    expect(bgs(last()).options.some((o) => o.roll !== undefined)).toBe(false);
    expect(panel().queryByRole('combobox', { name: 'Table die' })).toBeNull();
  });

  it('a table it can\'t roll still shows as its dice, to be changed', () => {
    open({ ...BGS, choices: [{ ...(BGS.choices as object[])[0], table: '9d6' }] } as unknown as Definition);
    expect(dieBox().value).toBe('9d6');
  });
});

describe('help', () => {
  it('a "?" beside every setting, each named for screen readers', () => {
    open();
    // The page's own; a feature's are FeaturesEditor.test's, shown once one is open.
    const keys = ['choices.lists', 'choices.names', 'choices.picked', 'choices.picks', 'choices.again', 'choices.levelled', 'choices.table', 'choices.options', 'choices.optionName', 'choices.description', 'choices.requires', 'choices.die', 'choices.features'] as (keyof typeof HINTS)[];
    // The two for what an option gives are that panel's: their test is below (7c4e).
    expect(Object.keys(HINTS).filter((k) => k.startsWith('choices.'))).toHaveLength(30);
    for (const k of keys) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  });

  describe('what an option gives (7c4e)', () => {
    const MONIED = { ...HEARTH, currencies: [
      { id: 'gold', name: 'Gold', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] },
      { id: 'honor', name: 'Honor' },
    ] } as unknown as Definition;
    // The first list's first option is open to start.
    const onOption = async (start: Definition = MONIED) => open(start);
    const here = () => within(screen.getByRole('region', { name: 'Soldier option' }));
    const gives = (d: Definition) => ((d.choices as { id: string; options: { id: string; gives?: object }[] }[])[0].options[0].gives);

    it('items as typed, a comma typed through; emptied, nothing stored', async () => {
      const { last } = await onOption();
      const box = here().getByRole('textbox', { name: 'GIVES' }) as HTMLInputElement;
      await userEvent.type(box, 'Crowbar, 3x Rations, ');
      expect(box.value).toBe('Crowbar, 3x Rations, ');
      expect(gives(last())).toEqual({ items: [{ name: 'Crowbar', qty: 1 }, { name: 'Rations', qty: 3 }] });
      await userEvent.clear(box);
      expect(gives(last())).toBeUndefined();
    });

    it('shows what it has, its own for each option', async () => {
      const set = { ...MONIED, choices: [{ ...(MONIED.choices as object[])[0] as object, options: [
        { id: 'soldier', label: 'Soldier', gives: { items: [{ name: 'Rope', qty: 2 }], money: { gold: { how: 'roll', each: '2d6' } } } },
        { id: 'mage', label: 'Mage' },
      ] }] } as unknown as Definition;
      await onOption(set);
      expect((here().getByRole('textbox', { name: 'GIVES' }) as HTMLInputElement).value).toBe('2x Rope');
      expect((here().getByRole('textbox', { name: 'Gold roll' }) as HTMLInputElement).value).toBe('2d6');
      await userEvent.click(within(listPanel('Classes').getByRole('group', { name: 'Options' })).getByRole('button', { name: 'MAGE' }));
      const mage = within(screen.getByRole('region', { name: 'Mage option' }));
      expect((mage.getByRole('textbox', { name: 'GIVES' }) as HTMLInputElement).value).toBe('');
      expect(mage.queryByRole('textbox', { name: 'Gold roll' })).toBeNull();
    });

    it('money per currency, a number or a roll, never typed in; back to nothing stores nothing', async () => {
      const { last } = await onOption();
      const gold = within(here().getByRole('group', { name: 'Gold starts with' }));
      expect(gold.getAllByRole('button').map((b) => b.textContent)).toEqual(['NOTHING', 'A NUMBER', 'A ROLL']);
      await userEvent.click(gold.getByRole('button', { name: 'A ROLL' }));
      expect(gives(last())).toEqual({ money: { gold: { how: 'roll', each: '3d6 * 10' } } });
      await userEvent.click(within(here().getByRole('group', { name: 'Honor starts with' })).getByRole('button', { name: 'A NUMBER' }));
      expect(gives(last())).toEqual({ money: { gold: { how: 'roll', each: '3d6 * 10' }, honor: { how: 'number', amount: 100 } } });
      await userEvent.click(gold.getByRole('button', { name: 'NOTHING' }));
      expect(gives(last())).toEqual({ money: { honor: { how: 'number', amount: 100 } } });
      await userEvent.click(within(here().getByRole('group', { name: 'Honor starts with' })).getByRole('button', { name: 'NOTHING' }));
      expect(gives(last())).toBeUndefined();
    });

    it('items and money sit together', async () => {
      const { last } = await onOption();
      await userEvent.type(here().getByRole('textbox', { name: 'GIVES' }), 'Rope');
      await userEvent.click(within(here().getByRole('group', { name: 'Gold starts with' })).getByRole('button', { name: 'A NUMBER' }));
      expect(gives(last())).toEqual({ items: [{ name: 'Rope', qty: 1 }], money: { gold: { how: 'number', amount: 10000 } } });
      // And the other way about: typing items keeps the money.
      await userEvent.type(here().getByRole('textbox', { name: 'GIVES' }), ', Coin');
      expect(gives(last())).toEqual({ items: [{ name: 'Rope', qty: 1 }, { name: 'Coin', qty: 1 }], money: { gold: { how: 'number', amount: 10000 } } });
    });

    it('the app\'s single money with no currencies; none at all with the bank off', async () => {
      await onOption(HEARTH);
      expect(here().getByRole('group', { name: 'Money starts with' })).toBeTruthy();
      cleanup();
      await onOption({ ...MONIED, parts: { bank: { on: false } } } as unknown as Definition);
      expect(here().queryByRole('group', { name: 'Gold starts with' })).toBeNull();
      expect(here().getByRole('textbox', { name: 'GIVES' })).toBeTruthy();
    });

    it('has a "?" on each', async () => {
      await onOption();
      expect(screen.getByRole('note', { name: HINTS['choices.gives'] })).toBeTruthy();
      expect(screen.getAllByRole('note', { name: HINTS['choices.giveMoney'] })).toHaveLength(2);
    });
  });

  it('a "?" on IMPORT, once it is open', async () => {
    open();
    await userEvent.click(listPanel('Classes').getByRole('button', { name: 'IMPORT' }));
    expect(screen.getByRole('note', { name: HINTS['choices.import'] })).toBeTruthy();
  });
});
