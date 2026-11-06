import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { ChoicesSection } from '../ChoicesSection';
import { WORKED_KEY, type ChoiceListShown } from '../../sheets/choicesShown';

/**
 * Lists inside lists on the sheet (7a5a2). Approved mockup nested-choices (2026-10-28): a list picked
 * through features shows only under the feature that opens it, with PICK A <ONE> while it has room;
 * a pick whose feature locked is shown there greyed, kept; one with nothing to wait under is at the
 * foot, KEPT, WAITING, for the GM to take away; a list everyone has shows what every character has,
 * nothing to pick or drop. Drawn from what the server's own workedOf writes.
 */

afterEach(() => cleanup());

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/choices.js');

const NEST = {
  format: 1, name: 'Nest',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard Stance' },
        { id: 'specialty', label: 'Specialty', at: 3, choice: 'specs' },
      ] },
    ] },
    { id: 'specs', one: 'Specialty', many: 'Specialties', picked: 'features', options: [
      { id: 'duelist', label: 'Duelist', features: [{ id: 'riposte', label: 'Riposte' }] }, { id: 'vanguard', label: 'Vanguard', requires: '@int >= 13' },
    ] },
    { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [
      { id: 'breath', label: 'Second Wind', features: [{ id: 'b1', label: 'Breath' }, { id: 'b4', label: 'Improvement', at: 4 }] },
    ] },
  ],
};
const lists = backend.choicesShown(NEST) as ChoiceListShown[];
const draw = (stored: Record<string, unknown>, { gm = false, readOnly = false } = {}) => {
  const data = { int: 10, _choices: stored };
  const onChoices = vi.fn();
  render(<ChoicesSection lists={lists} data={{ ...data, [WORKED_KEY]: backend.workedOf(NEST, data) }} readOnly={readOnly} onChoices={onChoices} gm={gm} />);
  return onChoices;
};
const under = (name: string) => within(screen.getByRole('group', { name: `Under ${name}` }));

describe('what an option gives (7c4e), on a plain sheet', () => {
  it('says nothing, as only finishing NEW_CHARACTER.EXE gives it', () => {
    const lists = [{ id: 'bgs', one: 'Background', many: 'Backgrounds', picks: 2, again: false, levelled: false, options: [
      { id: 'noble', label: 'Noble', gives: { items: [{ name: 'Rope', qty: 1 }] }, features: [] },
      { id: 'scribe', label: 'Scribe', gives: { items: [{ name: 'Ink', qty: 1 }] }, features: [] },
    ] }];
    const data = { [WORKED_KEY]: { picks: [{ list: 'bgs', option: 'noble' }], opens: [], levels: {}, from: {}, uses: {}, unmet: [], recovery: null } };
    render(<ChoicesSection lists={lists as never} data={data} readOnly={false} onChoices={() => {}} />);
    expect(screen.getByRole('button', { name: 'SCRIBE' })).toBeTruthy();
    expect(screen.queryByText(/GIVE/)).toBeNull();
    expect(screen.queryByText(/Rope|Ink/)).toBeNull();
  });
});

describe('a list picked through features', () => {
  it('isn\'t a block of its own: it waits under the feature, picked there with the feature named', async () => {
    const ask = draw({ classes: [{ option: 'soldier', level: 3 }] });
    expect(screen.queryByRole('region', { name: 'Specialties' })).toBeNull();
    const pick = under('Specialty').getByRole('group', { name: 'Pick a Specialty' });
    expect(within(pick).getByRole('button', { name: 'VANGUARD' })).toHaveProperty('disabled', true);
    expect(within(pick).getByText('NEEDS INTELLECT >= 13')).toBeTruthy();
    await userEvent.click(within(pick).getByRole('button', { name: 'DUELIST' }));
    expect(ask).toHaveBeenCalledWith({ kind: 'pick', list: 'specs', option: 'duelist', from: 'specialty' });
  });

  it('nothing under a feature not yet unlocked', () => {
    draw({ classes: [{ option: 'soldier', level: 2 }] });
    expect(screen.queryByRole('group', { name: 'Under Specialty' })).toBeNull();
    expect(screen.getByText('NEXT · LV 3: Specialty')).toBeTruthy();
  });

  it('the pick under it, a card of its own with its features, and no more to pick', () => {
    draw({ classes: [{ option: 'soldier', level: 3 }], specs: [{ option: 'duelist', from: 'specialty' }] });
    const duelist = within(under('Specialty').getByRole('group', { name: 'Duelist' }));
    expect(duelist.getByText('Riposte')).toBeTruthy();
    expect(under('Specialty').queryByRole('group', { name: 'Pick a Specialty' })).toBeNull();
  });

  it('a pick whose feature locked again: kept, greyed, under it; the GM may take it away', async () => {
    const ask = draw({ classes: [{ option: 'soldier', level: 2 }], specs: [{ option: 'duelist', from: 'specialty' }] }, { gm: true });
    expect(under('Specialty').getByText('DUELIST · WAITS FOR SPECIALTY AT LEVEL 3, KEPT')).toBeTruthy();
    await userEvent.click(under('Specialty').getByRole('button', { name: 'Drop Duelist' }));
    await userEvent.click(screen.getByRole('button', { name: 'YES, DROP' }));
    expect(ask).toHaveBeenCalledWith({ kind: 'drop', list: 'specs', option: 'duelist' });
  });

  it('one with nothing left to wait under: at the foot, KEPT, WAITING', () => {
    draw({ specs: [{ option: 'duelist', from: 'specialty' }] });
    const aside = within(screen.getByRole('region', { name: 'Kept, waiting' }));
    expect(aside.getByText('SPECIALTY · DUELIST: counts again when what gave it comes back')).toBeTruthy();
    expect(aside.queryByRole('button', { name: 'Drop Duelist' })).toBeNull();
  });

  it('read-only: says a pick is waiting to be made, with nothing to click', () => {
    draw({ classes: [{ option: 'soldier', level: 3 }] }, { readOnly: true });
    expect(under('Specialty').getByText('A SPECIALTY TO PICK')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'DUELIST' })).toBeNull();
  });
});

describe('a list everyone has', () => {
  it('what every character has, its features by their level, nothing to pick or drop', () => {
    draw({ classes: [{ option: 'soldier', level: 3 }] }, { gm: true });
    const commons = within(screen.getByRole('region', { name: 'Commons' }));
    expect(commons.getByText('EVERY CHARACTER HAS THESE')).toBeTruthy();
    const breath = within(commons.getByRole('group', { name: 'Second Wind' }));
    expect(breath.getByText('Breath')).toBeTruthy();
    expect(breath.getByText('NEXT · LV 4: Improvement')).toBeTruthy();
    expect(commons.queryByRole('button', { name: 'Drop Second Wind' })).toBeNull();
    expect(commons.queryByRole('group', { name: 'Pick a Common' })).toBeNull();
    expect(commons.queryByText(/No Common picked/)).toBeNull();
  });
});

describe('ROLL FOR IT under a feature (7a5b2)', () => {
  it('rolls with the feature named, and marks what that feature\'s roll landed on', async () => {
    const def = { ...NEST, choices: NEST.choices.map((c) => (c.id === 'specs' ? { ...c, table: 'd6', options: c.options.map((o, i) => ({ ...o, roll: i ? '4-6' : '1-3' })) } : c)) };
    const shown = backend.choicesShown(def) as ChoiceListShown[];
    const data = { int: 10, _choices: { classes: [{ option: 'soldier', level: 3 }] }, _rolled: { 'specs@specialty': { option: 'duelist', roll: 2 }, specs: { option: 'vanguard', roll: 5 } } };
    const onChoices = vi.fn();
    render(<ChoicesSection lists={shown} data={{ ...data, [WORKED_KEY]: backend.workedOf(def, data) }} readOnly={false} onChoices={onChoices} />);
    const pick = within(under('Specialty').getByRole('group', { name: 'Pick a Specialty' }));
    expect(pick.getByText('ROLLED 2 → DUELIST')).toBeTruthy();
    expect(pick.getByRole('button', { name: 'DUELIST · TAKE IT' })).toBeTruthy();
    await userEvent.click(pick.getByRole('button', { name: 'ROLL FOR IT' }));
    expect(onChoices).toHaveBeenCalledWith({ kind: 'roll', list: 'specs', from: 'specialty' });
  });
});
