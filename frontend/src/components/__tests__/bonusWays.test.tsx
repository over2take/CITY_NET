import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FeaturesEditor } from '../FeaturesEditor';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';
import { choiceLists, featureList, withHow, withCap, tokenMaxTarget } from '../../sheets/choices';
import { wordsOf, sampleLine, insertGroups, serverKind } from '../../sheets/formulaBox';

/**
 * The ways a bonus counts, in the builder (7e1b; approved mockup docs/mockups/items.html, 2026-11-10; the cap moved onto
 * the bonus, the user's call the same day): ADD or AT LEAST on each modifier, an ADD saying where it STOPS AT, the token's
 * maximum only ever added to.
 */

afterEach(() => cleanup());

const HARDY = {
  format: 1, name: 'Hardy', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }, { id: 'str', label: 'Str' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @con' }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
    { id: 'amulet', label: 'Amulet', features: [{ id: 'vigor', label: 'Vigor', modifiers: [{ target: 'con', amount: '19', how: 'least' }, { target: 'str', amount: '2', cap: 20 }] }] },
  ] }],
} as unknown as Definition;

const openFeature = (start: Definition = HARDY) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    const list = choiceLists(def)[0];
    return <FeaturesEditor definition={def} edit={(next) => { edits.push(next); setDef(next); }} list={list} option={list.options[0]} />;
  };
  render(<Harness />);
  return { mods: () => featureList(choiceLists(edits[edits.length - 1]).find((c) => c.id === 'feats')!.options[0])[0].modifiers };
};
const how = (i: number) => within(screen.getByRole('group', { name: `Modifier ${i}: how` }));
const vigor = () => userEvent.click(screen.getByRole('button', { name: /VIGOR/ }));

describe('ADD or AT LEAST on a modifier', () => {
  it('each says which; a click switches it, kept as `how` only for AT LEAST', async () => {
    const { mods } = openFeature();
    await vigor();
    expect(how(1).getByRole('button', { name: 'AT LEAST' }).getAttribute('aria-pressed')).toBe('true');
    expect(how(2).getByRole('button', { name: 'ADD' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(how(1).getByRole('button', { name: 'ADD' }));
    expect(mods()![0]).toEqual({ target: 'con', amount: '19' });
    await userEvent.click(how(2).getByRole('button', { name: 'AT LEAST' }));
    // AT LEAST is a value already: its STOPS AT goes.
    expect(mods()![1]).toEqual({ target: 'str', amount: '2', how: 'least' });
  });

  it('the token\'s maximum is only added to: AT LEAST off there, and AT LEAST and STOPS AT dropped on choosing it', async () => {
    const { mods } = openFeature();
    await vigor();
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1: changes'), 'hp_max');
    expect(mods()![0]).toEqual({ target: 'hp_max', amount: '19' });
    const atLeast = how(1).getByRole('button', { name: 'AT LEAST' }) as HTMLButtonElement;
    expect(atLeast.disabled).toBe(true);
    expect(atLeast.title).toBe('The token\'s maximum is only added to');
    await userEvent.selectOptions(screen.getByLabelText('Modifier 2: changes'), 'hp_max');
    expect(mods()![1]).toEqual({ target: 'hp_max', amount: '2' });
    expect(screen.queryByLabelText('STOPS AT')).toBeNull();
    // Another target keeps what it had.
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1: changes'), 'con');
    await userEvent.click(how(1).getByRole('button', { name: 'AT LEAST' }));
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1: changes'), 'str');
    expect(mods()![0]).toEqual({ target: 'str', amount: '19', how: 'least' });
  });

  it('the logic: which field is the token\'s maximum, and a modifier\'s way', () => {
    expect(tokenMaxTarget(HARDY)).toBe('hp_max');
    expect(tokenMaxTarget({ ...HARDY, core: { health: { model: 'harm', levels: [{ id: 'hurt', label: 'Hurt' }] } } } as Definition)).toBeNull();
    expect(withHow({ target: 'con', amount: '1', cap: 20 }, true)).toEqual({ target: 'con', amount: '1', how: 'least' });
    expect(withHow({ target: 'con', amount: '1', cap: 20 }, false)).toEqual({ target: 'con', amount: '1', cap: 20 });
    expect(withHow({ target: 'con', amount: '1', how: 'least' }, false)).toEqual({ target: 'con', amount: '1' });
  });
});

describe('STOPS AT on an ADD', () => {
  it('beside an ADD only, saying where it stops; set, changed and emptied', async () => {
    const { mods } = openFeature();
    await vigor();
    const boxes = screen.getAllByLabelText('STOPS AT') as HTMLInputElement[];
    // Only the ADD has one.
    expect(boxes).toHaveLength(1);
    expect(boxes[0].value).toBe('20');
    expect(screen.getByText('NEVER TAKES IT PAST 20')).toBeTruthy();
    fireEvent.change(boxes[0], { target: { value: '22' } });
    expect(mods()![1]).toEqual({ target: 'str', amount: '2', cap: 22 });
    fireEvent.change(boxes[0], { target: { value: '' } });
    expect(mods()![1]).toEqual({ target: 'str', amount: '2' });
    expect(screen.getByText('NO LIMIT')).toBeTruthy();
    fireEvent.change(boxes[0], { target: { value: '19.7' } });
    expect(mods()![1]).toEqual({ target: 'str', amount: '2', cap: 19 });
    // Switched to ADD, the AT LEAST gets one too.
    await userEvent.click(how(1).getByRole('button', { name: 'ADD' }));
    expect(screen.getAllByLabelText('STOPS AT')).toHaveLength(2);
  });

  it('the logic: set, changed, taken away, the rest kept', () => {
    expect(withCap({ target: 'con', amount: '2' }, 20)).toEqual({ target: 'con', amount: '2', cap: 20 });
    expect(withCap({ target: 'con', amount: '2', cap: 20 }, null)).toStrictEqual({ target: 'con', amount: '2' });
    expect(withCap({ target: 'con', amount: '2', how: 'least' }, null)).toEqual({ target: 'con', amount: '2', how: 'least' });
  });
});

describe('the words', () => {
  it('an AT LEAST says so, never "+19, always"', async () => {
    openFeature();
    await vigor();
    expect(screen.getByText('at least 19')).toBeTruthy();
    expect(screen.queryByText('+19, always')).toBeNull();
    await userEvent.click(how(1).getByRole('button', { name: 'ADD' }));
    expect(screen.getByText('+19, always')).toBeTruthy();
  });

  it('the words, the sample and INSERT for an AT LEAST; the server reads it as an amount', () => {
    expect(wordsOf('least', '19')).toBe('at least 19');
    expect(wordsOf('least', '@con')).toBe('at least your con');
    expect(wordsOf('least', '10 + @level')).toBe('at least worked out from level');
    expect(sampleLine('least', { ok: true, value: 19, reads: [] } as never)).toBe('at least 19');
    expect(insertGroups(HARDY, 'least').map((g) => g.title)).not.toContain('FORMULAS');
    expect(insertGroups(HARDY, 'formula').map((g) => g.title)).toContain('FORMULAS');
    expect(serverKind('least')).toBe('amount');
    expect(serverKind('uses')).toBe('uses');
  });

  it('the "?" says AT LEAST and STOPS AT', () => {
    expect(HINTS['choices.modifiers']).toMatch(/or with AT LEAST sets it that high unless it is already higher/);
    expect(HINTS['choices.modifiers']).toMatch(/An ADD may say where it STOPS AT \(\+2 CON, never past 20\)/);
  });
});
