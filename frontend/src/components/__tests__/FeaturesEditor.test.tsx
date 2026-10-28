import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FeaturesEditor } from '../FeaturesEditor';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';
import { choiceLists, featureList, LIMITS } from '../../sheets/choices';

/**
 * An option's features on the CHOICES page (7a2b2). Approved mockup builder-choices (2026-10-27): grouped
 * by the level each unlocks at, each tagged with what it does; the open one with its name, level,
 * words, modifiers, uses and their rest, rolls it gives, roll changes and a list it opens. DELETE asks.
 */

afterEach(() => cleanup());

const HEARTH = {
  format: 1, name: 'Hearth',
  core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  rests: { vigil: { name: 'Vigil' } },
  rolls: [
    { id: 'spark', label: 'Spark', dice: [{ count: '1', sides: 10 }] },
    { id: 'mind_save', label: 'Mind save', dice: [{ count: '1', sides: 20 }], changes: [{ id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } }] },
    { id: 'body_save', label: 'Body save', dice: [{ count: '1', sides: 20 }], changes: [{ id: 'brace', label: 'Brace', add: '2' }] },
  ],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'rally', label: 'Rally', uses: { count: '1', refill: 'short_rest' }, text: 'Catch your breath.' },
        { id: 'specialty', label: 'Specialty', at: 3, choice: 'paths' },
      ] },
    ] },
    { id: 'paths', one: 'Path', many: 'Paths', options: [{ id: 'duelist', label: 'Duelist' }] },
  ],
} as unknown as Definition;

const open = (start: Definition = HEARTH, listId = 'classes', optionId = 'soldier') => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    const list = choiceLists(def).find((c) => c.id === listId)!;
    const option = list.options.find((o) => o.id === optionId)!;
    return <FeaturesEditor definition={def} edit={(next) => { edits.push(next); setDef(next); }} list={list} option={option} />;
  };
  render(<Harness />);
  const features = () => featureList(choiceLists(edits[edits.length - 1]).find((c) => c.id === listId)!.options.find((o) => o.id === optionId)!);
  return { edits, features };
};
const row = (name: RegExp) => screen.getByRole('button', { name });
const form = (name: string) => within(screen.getByRole('group', { name: `Feature ${name}` }));

describe('the features', () => {
  it('grouped by the level each unlocks at, each tagged with what it does', () => {
    open();
    expect(within(screen.getByRole('region', { name: 'Level 1' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['▸ GUARD STANCEMODIFIER', '▸ RALLYUSES']);
    expect(within(screen.getByRole('region', { name: 'Level 3' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['▸ SPECIALTYCHOICE']);
  });

  it('a list that isn\'t levelled shows them all together; none says what a feature is', () => {
    open(HEARTH, 'paths', 'duelist');
    expect(screen.getByText(/None yet\. A feature is what this pick gives a character/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /^Level/ })).toBeNull();
  });

  it('levels in order, whatever order the features were made in', () => {
    const late = { ...HEARTH, choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [
      { id: 'a', label: 'A', at: 3 }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', at: 2 }] }] }] } as unknown as Definition;
    open(late);
    expect(screen.getAllByRole('region', { name: /^Level/ }).map((r) => r.getAttribute('aria-label'))).toEqual(['Level 1', 'Level 2', 'Level 3']);
  });

  it('+ FEATURE makes one at the highest level there is, opened', async () => {
    const { features } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ FEATURE' }));
    expect(features().at(-1)).toEqual({ id: 'new_feature', label: 'NEW FEATURE', at: 3 });
    expect(form('NEW FEATURE').getByRole('textbox', { name: 'NAME' })).toHaveProperty('value', 'NEW FEATURE');
  });

  it('one open at a time; a click closes it again', async () => {
    open();
    await userEvent.click(row(/GUARD STANCE/));
    expect(row(/GUARD STANCE/).getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(row(/RALLY/));
    expect(screen.queryByRole('group', { name: 'Feature Guard Stance' })).toBeNull();
    await userEvent.click(row(/RALLY/));
    expect(screen.queryByRole('group', { name: 'Feature Rally' })).toBeNull();
  });

  it('stops at the limit', () => {
    open({ ...HEARTH, choices: [{ id: 'paths', one: 'Path', many: 'Paths', options: [{ id: 'duelist', label: 'D', features: Array.from({ length: LIMITS.features }, (_, i) => ({ id: `f${i}`, label: 'F' })) }] }] } as unknown as Definition, 'paths', 'duelist');
    expect(screen.getByRole('button', { name: '+ FEATURE' })).toHaveProperty('disabled', true);
  });
});

describe('a feature open', () => {
  it('its name, level and words; moved to another level, it goes with it', async () => {
    const { features } = open();
    await userEvent.click(row(/RALLY/));
    const f = form('Rally');
    expect(f.getByRole('textbox', { name: 'WORDS' })).toHaveProperty('value', 'Catch your breath.');
    fireEvent.change(f.getByRole('textbox', { name: 'NAME' }), { target: { value: 'Second Wind' } });
    // Typed, the level waits for the box to be left: 1 then 12 never moves it to level 1 on the way.
    const level = form('Second Wind').getByRole('spinbutton', { name: 'AT LEVEL' });
    fireEvent.change(level, { target: { value: '1' } });
    fireEvent.change(level, { target: { value: '12' } });
    expect(features()[1]).not.toHaveProperty('at');
    fireEvent.blur(level);
    expect(features()[1]).toMatchObject({ id: 'rally', label: 'Second Wind', at: 12 });
    expect(within(screen.getByRole('region', { name: 'Level 12' })).getByRole('button', { name: /SECOND WIND/ })).toBeTruthy();
    // Enter sets it too; a box left blank goes back to the level it has.
    const again = form('Second Wind').getByRole('spinbutton', { name: 'AT LEVEL' });
    fireEvent.change(again, { target: { value: '2' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(features()[1].at).toBe(2);
    const blank = form('Second Wind').getByRole('spinbutton', { name: 'AT LEVEL' });
    fireEvent.change(blank, { target: { value: '' } });
    fireEvent.blur(blank);
    expect(blank).toHaveProperty('value', '2');
    expect(within(screen.getByRole('region', { name: 'Level 2' })).getByRole('button', { name: /SECOND WIND/ })).toBeTruthy();
  });

  it('modifiers: what each changes, from the stats, formulas and health, and by how much', async () => {
    const { features } = open();
    await userEvent.click(row(/GUARD STANCE/));
    const f = form('Guard Stance');
    const target = f.getByRole('combobox', { name: 'Modifier 1: changes' });
    expect([...target.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'))).toEqual(['STATS', 'FORMULAS', 'HEALTH']);
    fireEvent.change(target, { target: { value: 'con' } });
    fireEvent.change(f.getByRole('textbox', { name: 'Modifier 1: by' }), { target: { value: '@soldier_level' } });
    await userEvent.click(f.getByRole('button', { name: '+ MODIFIER' }));
    expect(features()[0].modifiers).toEqual([{ target: 'con', amount: '@soldier_level' }, { target: 'con', amount: '1' }]);
    await userEvent.click(f.getByRole('button', { name: 'Remove modifier 1' }));
    expect(features()[0].modifiers).toEqual([{ target: 'con', amount: '1' }]);
  });

  it('uses: switched on with a count and a rest, the GM\'s to refill with none, switched off', async () => {
    const { features } = open();
    await userEvent.click(row(/RALLY/));
    const f = form('Rally');
    fireEvent.change(f.getByRole('textbox', { name: 'How many uses' }), { target: { value: '@con' } });
    fireEvent.change(f.getByRole('combobox', { name: 'Refilled by' }), { target: { value: 'vigil' } });
    expect(features()[1].uses).toEqual({ count: '@con', refill: 'vigil' });
    fireEvent.change(f.getByRole('combobox', { name: 'Refilled by' }), { target: { value: '' } });
    expect(features()[1].uses).toEqual({ count: '@con' });
    await userEvent.click(f.getByRole('switch', { name: '◉ HAS USES' }));
    expect(features()[1]).not.toHaveProperty('uses');
    await userEvent.click(f.getByRole('switch', { name: '○ HAS USES' }));
    expect(features()[1].uses).toEqual({ count: '1', refill: 'short_rest' });
  });

  it('rolls it gives, and a roll\'s change it lets the character take', async () => {
    const { features } = open();
    await userEvent.click(row(/GUARD STANCE/));
    const f = form('Guard Stance');
    await userEvent.click(within(f.getByRole('group', { name: 'Gives rolls' })).getByRole('button', { name: 'SPARK' }));
    expect(features()[0].rolls).toEqual(['spark']);
    await userEvent.click(f.getByRole('button', { name: '+ CHANGE' }));
    expect(features()[0].changes).toEqual([{ roll: 'mind_save', change: 'advantage' }]);
    expect(f.getByRole('combobox', { name: 'Change 1: which' })).toHaveProperty('value', 'advantage');
    // Another roll: its own first change, never the last roll's.
    fireEvent.change(f.getByRole('combobox', { name: 'Change 1: roll' }), { target: { value: 'body_save' } });
    expect(features()[0].changes).toEqual([{ roll: 'body_save', change: 'brace' }]);
    await userEvent.click(within(f.getByRole('group', { name: 'Gives rolls' })).getByRole('button', { name: 'SPARK' }));
    expect(features()[0]).not.toHaveProperty('rolls');
  });

  it('opens another list, never its own', async () => {
    const { features } = open();
    await userEvent.click(row(/SPECIALTY/));
    const pick = form('Specialty').getByRole('combobox', { name: 'OPENS A LIST' });
    expect([...pick.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['NOTHING', 'PATH']);
    fireEvent.change(pick, { target: { value: '' } });
    expect(features()[2]).not.toHaveProperty('choice');
  });

  it('says where to make what it could name, when the system has none yet', async () => {
    open({ ...HEARTH, stats: [], derived: [], rolls: [], core: { health: { model: 'none' } } } as unknown as Definition);
    await userEvent.click(row(/GUARD STANCE/));
    const f = form('Guard Stance');
    expect(f.getByText(/No rolls yet: make them on STATS & RULES' ROLLS tab\./)).toBeTruthy();
    expect(f.getByText(/None of the system's rolls has a change to pick yet/)).toBeTruthy();
    expect(f.getByRole('button', { name: '+ CHANGE' })).toHaveProperty('disabled', true);
  });

  it('DELETE FEATURE asks first', async () => {
    const { features, edits } = open();
    await userEvent.click(row(/GUARD STANCE/));
    await userEvent.click(form('Guard Stance').getByRole('button', { name: 'DELETE FEATURE' }));
    const ask = within(screen.getByRole('group', { name: 'Delete Guard Stance' }));
    await userEvent.click(ask.getByRole('button', { name: 'KEEP' }));
    expect(edits).toHaveLength(0);
    await userEvent.click(form('Guard Stance').getByRole('button', { name: 'DELETE FEATURE' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Delete Guard Stance' })).getByRole('button', { name: 'DELETE' }));
    expect(features().map((x) => x.id)).toEqual(['rally', 'specialty']);
  });

  it('a "?" beside every setting', async () => {
    open();
    await userEvent.click(row(/GUARD STANCE/));
    for (const k of ['choices.features', 'choices.featureName', 'choices.at', 'choices.text', 'choices.modifiers', 'choices.uses', 'choices.rolls', 'choices.changes', 'choices.choice'] as const) {
      expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
    }
  });
});
