import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StatsRulesPage } from '../StatsRulesPage';
import { FeaturesEditor } from '../FeaturesEditor';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';
import { choiceLists, featureList, withHow, tokenMaxTarget } from '../../sheets/choices';
import { withFormula, withStat } from '../../sheets/statsRules';
import { wordsOf, sampleLine, insertGroups, serverKind } from '../../sheets/formulaBox';

/**
 * Three ways a bonus counts, in the builder (7e1b; approved mockup docs/mockups/items.html, 2026-11-10): BONUSES STOP AT
 * on a stat (a STOPS AT column) and on a formula (under its name), and ADD or AT LEAST on each modifier, the token's
 * maximum only ever added to.
 */

afterEach(() => cleanup());

const HARDY = {
  format: 1, name: 'Hardy', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con', stop: 20 }, { id: 'str', label: 'Str' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @con' }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
    { id: 'amulet', label: 'Amulet', features: [{ id: 'vigor', label: 'Vigor', modifiers: [{ target: 'con', amount: '19', how: 'least' }, { target: 'str', amount: '1' }] }] },
  ] }],
} as unknown as Definition;

const harness = (Page: (p: { def: Definition; edit: (d: Definition) => void }) => React.ReactElement, start: Definition = HARDY) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <Page def={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return () => edits[edits.length - 1];
};

describe('BONUSES STOP AT on STATS & RULES', () => {
  it('a STOPS AT column on each stat: set, changed, emptied', () => {
    const last = harness(({ def, edit }) => <StatsRulesPage definition={def} edit={edit} />);
    const con = within(screen.getByTestId('stat-con'));
    expect((con.getByLabelText('Con bonuses stop at') as HTMLInputElement).value).toBe('20');
    expect((within(screen.getByTestId('stat-str')).getByLabelText('Str bonuses stop at') as HTMLInputElement).placeholder).toBe('none');
    fireEvent.change(within(screen.getByTestId('stat-str')).getByLabelText('Str bonuses stop at'), { target: { value: '30' } });
    expect((last().stats as { stats: object[] }[])[0].stats[1]).toEqual({ id: 'str', label: 'Str', stop: 30 });
    fireEvent.change(con.getByLabelText('Con bonuses stop at'), { target: { value: '' } });
    expect((last().stats as { stats: object[] }[])[0].stats[0]).toEqual({ id: 'con', label: 'Con' });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('STOPS AT?');
  });

  it('BONUSES STOP AT under a formula\'s name', async () => {
    const last = harness(({ def, edit }) => <StatsRulesPage definition={def} edit={edit} />);
    await userEvent.click(screen.getByRole('tab', { name: 'FORMULAS' }));
    const row = within(screen.getByTestId('formula-defense'));
    fireEvent.change(row.getByLabelText('BONUSES STOP AT'), { target: { value: '25' } });
    expect((last().derived as object[])[0]).toEqual({ id: 'defense', label: 'Defense', formula: '10 + @con', stop: 25 });
    fireEvent.change(row.getByLabelText('BONUSES STOP AT'), { target: { value: '' } });
    expect((last().derived as object[])[0]).toEqual({ id: 'defense', label: 'Defense', formula: '10 + @con' });
  });

  it('the logic: a cap kept, changed and taken away; nothing else touched', () => {
    expect(withStat(HARDY, 'str', { stop: 18 }).stats).toEqual([{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con', stop: 20 }, { id: 'str', label: 'Str', stop: 18 }] }]);
    expect(withFormula(HARDY, 'defense', { stop: 12 }).derived).toEqual([{ id: 'defense', label: 'Defense', formula: '10 + @con', stop: 12 }]);
    expect(withFormula(withFormula(HARDY, 'defense', { stop: 12 }), 'defense', { label: 'Def' }).derived).toEqual([{ id: 'defense', label: 'Def', formula: '10 + @con', stop: 12 }]);
    expect(withFormula(withFormula(HARDY, 'defense', { stop: 12 }), 'defense', { stop: null }).derived).toEqual([{ id: 'defense', label: 'Defense', formula: '10 + @con' }]);
  });

  it('its "?" says what it does', () => {
    expect(HINTS['rules.stop']).toMatch(/^BONUSES STOP AT: the most that features and increases can take it to/);
  });
});

describe('ADD or AT LEAST on a modifier', () => {
  const openFeature = (start: Definition = HARDY) => {
    const last = harness(({ def, edit }) => {
      const list = choiceLists(def)[0];
      return <FeaturesEditor definition={def} edit={edit} list={list} option={list.options[0]} />;
    }, start);
    return { last, mods: () => featureList(choiceLists(last()).find((c) => c.id === 'feats')!.options[0])[0].modifiers };
  };
  const how = (i: number) => within(screen.getByRole('group', { name: `Modifier ${i}: how` }));

  it('each says which; a click switches it, kept as `how` only for AT LEAST', async () => {
    const { mods } = openFeature();
    await userEvent.click(screen.getByRole('button', { name: /VIGOR/ }));
    expect(how(1).getByRole('button', { name: 'AT LEAST' }).getAttribute('aria-pressed')).toBe('true');
    expect(how(2).getByRole('button', { name: 'ADD' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(how(1).getByRole('button', { name: 'ADD' }));
    expect(mods()![0]).toEqual({ target: 'con', amount: '19' });
    await userEvent.click(how(2).getByRole('button', { name: 'AT LEAST' }));
    expect(mods()![1]).toEqual({ target: 'str', amount: '1', how: 'least' });
  });

  it('the token\'s maximum is only added to: AT LEAST off there, and dropped on choosing it', async () => {
    const { mods } = openFeature();
    await userEvent.click(screen.getByRole('button', { name: /VIGOR/ }));
    await userEvent.selectOptions(screen.getByLabelText('Modifier 1: changes'), 'hp_max');
    expect(mods()![0]).toEqual({ target: 'hp_max', amount: '19' });
    const atLeast = how(1).getByRole('button', { name: 'AT LEAST' }) as HTMLButtonElement;
    expect(atLeast.disabled).toBe(true);
    expect(atLeast.title).toBe('The token\'s maximum is only added to');
    // Another target keeps the way it had.
    await userEvent.click(how(2).getByRole('button', { name: 'AT LEAST' }));
    await userEvent.selectOptions(screen.getByLabelText('Modifier 2: changes'), 'con');
    expect(mods()![1]).toEqual({ target: 'con', amount: '1', how: 'least' });
  });

  it('the logic: which field is the token\'s maximum, and a modifier\'s way', () => {
    expect(tokenMaxTarget(HARDY)).toBe('hp_max');
    expect(tokenMaxTarget({ ...HARDY, core: { health: { model: 'harm', levels: [{ id: 'hurt', label: 'Hurt' }] } } } as Definition)).toBeNull();
    expect(withHow({ target: 'con', amount: '1' }, true)).toEqual({ target: 'con', amount: '1', how: 'least' });
    expect(withHow({ target: 'con', amount: '1', how: 'least' }, false)).toEqual({ target: 'con', amount: '1' });
  });

  it('its words say AT LEAST, never "+19, always"', async () => {
    openFeature();
    await userEvent.click(screen.getByRole('button', { name: /VIGOR/ }));
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

  it('its "?" says AT LEAST', () => {
    expect(HINTS['choices.modifiers']).toMatch(/or with AT LEAST sets it that high unless it is already higher/);
  });
});
