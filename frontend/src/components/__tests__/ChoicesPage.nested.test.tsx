import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { ChoicesPage } from '../ChoicesPage';
import type { Definition } from '../../sheets/systemsApi';
import { choiceLists, featureList, openedBy, pickedOf, unlocksByLevel, withList, withFeature, LIMITS } from '../../sheets/choices';

/**
 * Lists inside lists on the CHOICES page (7a5a2). Approved mockup nested-choices (2026-10-28): PICKED,
 * ON ITS OWN / THROUGH FEATURES / BOTH / EVERYONE HAS IT, saying what each means; OPENED BY naming the
 * features that open a list, and a nudge when they do but it is picked on its own; HOW MANY on a
 * feature opening a list; a list everyone has with no picks or levels of its own, its features still
 * unlocking at a level. Every edit held to the server's own checks.
 */

afterEach(() => cleanup());

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

const HEARTH = {
  format: 1, name: 'Hearth',
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [{ id: 'specialty', label: 'Specialty', at: 3, choice: 'paths' }] },
    ] },
    { id: 'paths', one: 'Path', many: 'Paths', options: [{ id: 'duelist', label: 'Duelist', features: [{ id: 'riposte', label: 'Riposte' }] }] },
  ],
} as unknown as Definition;

const open = (start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <ChoicesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { last: () => edits[edits.length - 1] };
};
const toList = async (name: RegExp) => userEvent.click(within(screen.getByRole('list', { name: 'Lists' })).getByRole('button', { name }));
const panel = (name: string) => within(screen.getByRole('region', { name: `${name} list` }));
const paths = (def: Definition) => choiceLists(def).find((c) => c.id === 'paths')!;

describe('PICKED and OPENED BY', () => {
  it('names the features that open a list, and nudges while it is picked on its own', async () => {
    open();
    await toList(/PATHS/);
    expect(panel('Paths').getByLabelText('Opened by').textContent).toBe('OPENED BY · SOLDIER: SPECIALTY (LV 3)');
    expect(panel('Paths').getByText(/Features open this list: THROUGH FEATURES or BOTH puts their picks under them\./)).toBeTruthy();
    expect(openedBy(HEARTH, 'classes')).toEqual([]);
    // A list naming itself (refused by the server) isn't opened by anything.
    expect(openedBy(withFeature(HEARTH, 'classes', 'soldier', 'specialty', { choice: 'classes' }), 'classes')).toEqual([]);
  });

  it('switches how a list is picked, each way saying what it means, the settings that don\'t apply put away', async () => {
    const { last } = open();
    await toList(/PATHS/);
    const way = within(panel('Paths').getByRole('group', { name: 'Picked' }));
    expect(way.getByRole('button', { name: 'ON ITS OWN' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(way.getByRole('button', { name: 'THROUGH FEATURES' }));
    expect(paths(last()).picked).toBe('features');
    expect(panel('Paths').getByText(/Only under the features that open it/)).toBeTruthy();
    expect(panel('Paths').queryByText(/Features open this list/)).toBeNull();
    expect(panel('Paths').queryByRole('group', { name: 'A character picks' })).toBeNull();
    expect(panel('Paths').queryByRole('switch', { name: /MORE THAN ONCE/ })).toBeNull();
    expect(problems(last())).toEqual([]);
    await userEvent.click(way.getByRole('button', { name: 'BOTH' }));
    expect(panel('Paths').getByRole('group', { name: 'A character picks' })).toBeTruthy();
    expect(panel('Paths').getByText('One Path per character at the start.')).toBeTruthy();
    await userEvent.click(way.getByRole('button', { name: 'ON ITS OWN' }));
    expect(paths(last())).not.toHaveProperty('picked');
  });

  it('EVERYONE HAS IT: no picks or levels of its own, a levelled list losing its levels, the server content', async () => {
    const { last } = open();
    const way = within(panel('Classes').getByRole('group', { name: 'Picked' }));
    await userEvent.click(way.getByRole('button', { name: 'EVERYONE HAS IT' }));
    const classes = choiceLists(last()).find((c) => c.id === 'classes')!;
    expect([classes.picked, classes.levelled]).toEqual(['everyone', undefined]);
    expect(panel('Classes').queryByRole('switch', { name: /LEVELLED/ })).toBeNull();
    expect(panel('Classes').queryByRole('group', { name: 'A character picks' })).toBeNull();
    expect(panel('Classes').getByText(/Nothing to pick: every character has each option/)).toBeTruthy();
    // Its features still unlock at a level: SPECIALTY keeps its 3.
    expect(unlocksByLevel(classes)).toBe(true);
    expect(featureList(classes.options[0])[0].at).toBe(3);
    expect(problems(last())).toEqual([]);
  });
});

describe('HOW MANY on a feature opening a list', () => {
  it('shown once a list is opened, 1 stored as nothing, kept within the most, gone with the list', () => {
    let def = withFeature(HEARTH, 'classes', 'soldier', 'specialty', { choice_count: 3 });
    expect(featureList(choiceLists(def)[0].options[0])[0].choice_count).toBe(3);
    def = withFeature(def, 'classes', 'soldier', 'specialty', { choice_count: 99 });
    expect(featureList(choiceLists(def)[0].options[0])[0].choice_count).toBe(LIMITS.opens);
    expect(problems(def)).toEqual([]);
    expect(featureList(choiceLists(withFeature(def, 'classes', 'soldier', 'specialty', { choice_count: 1 }))[0].options[0])[0]).not.toHaveProperty('choice_count');
    expect(featureList(choiceLists(withFeature(def, 'classes', 'soldier', 'specialty', { choice: null }))[0].options[0])[0]).not.toHaveProperty('choice_count');
  });

  it('on the feature\'s form, saying when the list it opens is picked on its own', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: /SPECIALTY/ }));
    const form = within(screen.getByRole('group', { name: 'Feature Specialty' }));
    fireEvent.change(form.getByRole('spinbutton', { name: 'HOW MANY' }), { target: { value: '2' } });
    expect(featureList(choiceLists(last())[0].options[0])[0].choice_count).toBe(2);
    expect(form.getByText(/PATHS is picked on its own, so this only names it/)).toBeTruthy();
    const through = withList(HEARTH, 'paths', { picked: 'features' });
    cleanup();
    open(through);
    await userEvent.click(screen.getByRole('button', { name: /SPECIALTY/ }));
    expect(screen.queryByText(/is picked on its own, so this only names it/)).toBeNull();
  });

  it('never offers a list everyone has to open', async () => {
    open(withList(HEARTH, 'paths', { picked: 'everyone' }));
    await userEvent.click(screen.getByRole('button', { name: /SPECIALTY/ }));
    const select = within(screen.getByRole('group', { name: 'Feature Specialty' })).getByRole('combobox', { name: 'OPENS A LIST' });
    expect(within(select).queryByRole('option', { name: 'PATH' })).toBeNull();
    expect(pickedOf(paths(withList(HEARTH, 'paths', { picked: 'everyone' })))).toBe('everyone');
  });
});
