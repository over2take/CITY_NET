import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { StatsRulesPage } from '../StatsRulesPage';
import { systemsApi, type Definition } from '../../sheets/systemsApi';

/**
 * The builder's STATS & RULES page, STATS and TABLES (4b2d1). Approved mockup builder-stats-rules
 * (2026-10-06): stats in groups with a SAMPLE column; tables as "up to / gives" rows with TRY IT.
 */

afterEach(() => cleanup());

const open = (start: Definition = { format: 1, name: 'Hearth' }) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <StatsRulesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const HEARTH: Definition = { format: 1, name: 'Hearth', stats: [
  { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'dex', label: 'Dexterity' }] },
  { id: 'skills', label: 'SKILLS', stats: [{ id: 'shoot', label: 'Shoot', tie: 'dex' }] },
], samples: { str: 16 } };
const stat = (id: string) => screen.getByTestId(`stat-${id}`);

describe('STATS', () => {
  it('shows each group with its stats, ids, ranges, ties and samples', () => {
    open(HEARTH);
    expect(screen.getByRole('tab', { name: 'STATS' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByLabelText('Group name').map((i) => (i as HTMLInputElement).value)).toEqual(['ABILITIES', 'SKILLS']);
    expect(stat('str').textContent).toContain('@str');
    expect((within(stat('str')).getByLabelText('Strength lowest') as HTMLInputElement).value).toBe('3');
    expect((within(stat('dex')).getByLabelText('Dexterity lowest') as HTMLInputElement).value).toBe('');
    expect((within(stat('shoot')).getByLabelText('Shoot tied to') as HTMLSelectElement).value).toBe('dex');
    expect((within(stat('str')).getByLabelText('Strength sample') as HTMLInputElement).value).toBe('16');
    expect((within(stat('dex')).getByLabelText('Dexterity sample') as HTMLInputElement).value).toBe('');
  });

  it('adds a group and a stat, and renames them', async () => {
    const { last } = open();
    await userEvent.click(screen.getByText('+ GROUP'));
    await userEvent.click(screen.getByText('+ STAT'));
    expect(last().stats).toEqual([{ id: 'new_group', label: 'NEW GROUP', stats: [{ id: 'new_stat', label: 'New stat', min: 0, max: 10 }] }]);
    const group = screen.getByLabelText('Group name');
    await userEvent.clear(group);
    await userEvent.type(group, 'ABILITIES');
    const name = screen.getByLabelText('New stat name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Grit');
    expect(last().stats).toEqual([{ id: 'new_group', label: 'ABILITIES', stats: [{ id: 'new_stat', label: 'Grit', min: 0, max: 10 }] }]);
  });

  it('sets and clears a range, a tie and a sample', async () => {
    const { last } = open(HEARTH);
    fireEvent.change(within(stat('str')).getByLabelText('Strength highest'), { target: { value: '' } });
    fireEvent.change(within(stat('dex')).getByLabelText('Dexterity lowest'), { target: { value: '2.6' } });
    await userEvent.selectOptions(within(stat('shoot')).getByLabelText('Shoot tied to'), '');
    fireEvent.change(within(stat('dex')).getByLabelText('Dexterity sample'), { target: { value: '14' } });
    fireEvent.change(within(stat('str')).getByLabelText('Strength sample'), { target: { value: '' } });
    const stats = (last().stats as { stats: object[] }[]).flatMap((g) => g.stats);
    expect(stats).toEqual([{ id: 'str', label: 'Strength', min: 3 }, { id: 'dex', label: 'Dexterity', min: 3 }, { id: 'shoot', label: 'Shoot' }]);
    expect(last().samples).toEqual({ dex: 14 });
  });

  it('offers any other stat to tie to, never itself', () => {
    open(HEARTH);
    const options = [...(within(stat('shoot')).getByLabelText('Shoot tied to') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['none', 'Strength', 'Dexterity']);
  });

  it('removes a stat, and a whole group', async () => {
    const { last } = open(HEARTH);
    await userEvent.click(screen.getByLabelText('Remove Strength'));
    expect('samples' in last()).toBe(false);
    await userEvent.click(screen.getByLabelText('Remove the SKILLS group'));
    expect(last().stats).toEqual([{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'dex', label: 'Dexterity' }] }]);
  });
});

describe('FORMULAS', () => {
  const req = createRequire(import.meta.url);
  const { previewDerived } = req('../../../../backend/systemBuilder/derived.js');
  /** The route's own work, done here with the server's engine. */
  const server = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { definition } = JSON.parse(String(init!.body));
    const body = previewDerived({ lookups: definition.lookups, derived: definition.derived }, definition.samples || {});
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  const SYSTEM: Definition = { ...HEARTH, samples: { str: 16, dex: 14 },
    lookups: { mod: { bands: [{ upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } },
    derived: [{ id: 'str_mod', label: 'Strength mod', formula: 'mod(@str)' }, { id: 'save', label: 'Save', formula: '16 - @str_mod' }] };
  const openFormulas = async (start: Definition = SYSTEM) => {
    const edits: Definition[] = [];
    const Harness = () => {
      const [def, setDef] = useState(start);
      return <StatsRulesPage definition={def} api={systemsApi('gm', server as typeof fetch)} edit={(next) => { edits.push(next); setDef(next); }} />;
    };
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'FORMULAS' }));
    return { last: () => edits[edits.length - 1] };
  };
  const value = (id: string) => screen.getByTestId(`value-${id}`).textContent;

  it('shows each formula with its name, id, users, and its value for the sample', async () => {
    await openFormulas();
    expect(screen.getByTestId('formula-str_mod').textContent).toContain('@str_mod · used by Save');
    await waitFor(() => expect(value('save')).toBe('15'));
    expect(value('str_mod')).toBe('1');
  });

  it('works the values out again a moment after typing stops', async () => {
    await openFormulas();
    await waitFor(() => expect(value('save')).toBe('15'));
    const calls = server.mock.calls.length;
    const formula = screen.getByLabelText('Save formula');
    await userEvent.clear(formula);
    await userEvent.type(formula, '20 - @str_mod');
    await waitFor(() => expect(value('save')).toBe('19'));
    // Asked once for the whole burst of typing, not once a key.
    expect(server.mock.calls.length - calls).toBeLessThanOrEqual(2);
  });

  it('never lets a late answer for an older formula overwrite a newer one', async () => {
    const answers: ((body: object) => void)[] = [];
    const slow = vi.fn(() => new Promise<Response>((resolve) => {
      answers.push((body) => resolve({ ok: true, status: 200, json: async () => body } as unknown as Response));
    }));
    const Harness = () => {
      const [def, setDef] = useState<Definition>(SYSTEM);
      return <StatsRulesPage definition={def} api={systemsApi('gm', slow as unknown as typeof fetch)} edit={setDef} />;
    };
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'FORMULAS' }));
    await waitFor(() => expect(answers).toHaveLength(1));
    const formula = screen.getByLabelText('Save formula');
    await userEvent.clear(formula);
    await userEvent.type(formula, '20');
    await waitFor(() => expect(answers).toHaveLength(2));
    answers[1]({ values: { save: 20 }, problems: [] });
    await waitFor(() => expect(value('save')).toBe('20'));
    answers[0]({ values: { save: 15 }, problems: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(value('save')).toBe('20');
  });

  it('shows a mistake under its formula, keeping the others\' values', async () => {
    await openFormulas({ ...SYSTEM, derived: [...(SYSTEM.derived as object[]), { id: 'broken', formula: 'mod(' }] });
    expect((await screen.findByRole('alert')).textContent).toMatch(/.+/);
    expect(screen.getByLabelText('broken formula').getAttribute('aria-invalid')).toBe('true');
    expect(value('broken')).toBe('·');
    expect(value('save')).toBe('15');
  });

  it('names, adds and removes formulas', async () => {
    const { last } = await openFormulas({ format: 1, name: 'Hearth' });
    await userEvent.click(screen.getByText('+ FORMULA'));
    expect(last().derived).toEqual([{ id: 'new_formula', label: 'New formula', formula: '0' }]);
    const name = screen.getByLabelText('New formula name');
    await userEvent.clear(name);
    expect(last().derived).toEqual([{ id: 'new_formula', formula: '0' }]);
    await userEvent.click(screen.getByLabelText('Remove new_formula'));
    expect('derived' in last()).toBe(false);
  });

  it('puts a name from INSERT at the cursor, once a formula is clicked', async () => {
    const { last } = await openFormulas();
    const chip = screen.getByRole('button', { name: '@dex' });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    const formula = screen.getByLabelText('Save formula') as HTMLInputElement;
    await userEvent.click(formula);
    formula.setSelectionRange(2, 2);
    fireEvent.select(formula);
    await userEvent.click(screen.getByRole('button', { name: '@dex' }));
    expect((last().derived as { id: string; formula: string }[]).find((f) => f.id === 'save')!.formula).toBe('16@dex - @str_mod');
    await userEvent.click(screen.getByRole('button', { name: 'max()' }));
    expect((last().derived as { id: string; formula: string }[]).find((f) => f.id === 'save')!.formula).toBe('16@dexmax() - @str_mod');
    expect(screen.getByRole('button', { name: 'mod()' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '@str_mod' })).toBeTruthy();
  });

  it('shows a condition without editing it', async () => {
    await openFormulas({ ...SYSTEM, derived: [{ id: 'hurt', kind: 'condition', when: '@str < 5', then: '1', else: '0' }] });
    expect(screen.getByTestId('formula-hurt').textContent).toContain('A condition: if @str < 5 then 1 else 0.');
    expect(screen.queryByLabelText('hurt formula')).toBeNull();
  });
});

describe('TABLES', () => {
  const MOD: Definition = { format: 1, name: 'Hearth', lookups: { mod: { label: 'Attribute modifier', bands: [{ upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } } };
  const tables = () => userEvent.click(screen.getByRole('tab', { name: 'TABLES' }));

  it('shows each table\'s rows, the last catching everything higher, and tries a number', async () => {
    open(MOD);
    await tables();
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Attribute modifier');
    expect(screen.getByText('mod()')).toBeTruthy();
    expect(screen.getByTestId('band-mod-2').textContent).toContain('anything higher');
    expect(screen.getByTestId('try-mod').textContent).toBe('0');
    fireEvent.change(screen.getByLabelText('Try Attribute modifier'), { target: { value: '15' } });
    expect(screen.getByTestId('try-mod').textContent).toBe('1');
    fireEvent.change(screen.getByLabelText('Try Attribute modifier'), { target: { value: '3' } });
    expect(screen.getByTestId('try-mod').textContent).toBe('-1');
  });

  it('adds, sets and removes rows', async () => {
    const { last } = open(MOD);
    await tables();
    await userEvent.click(screen.getByText('+ ROW'));
    const bands = () => (last().lookups as { mod: { bands: object[] } }).mod.bands;
    expect(bands()).toEqual([{ upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { upTo: 14, value: 0 }, { value: 1 }]);
    fireEvent.change(screen.getByLabelText('Row 3 gives'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Row 1 up to'), { target: { value: '6' } });
    expect(bands()).toEqual([{ upTo: 6, value: -1 }, { upTo: 13, value: 0 }, { upTo: 14, value: 5 }, { value: 1 }]);
    await userEvent.click(screen.getByLabelText('Remove row 2'));
    expect(bands()).toEqual([{ upTo: 6, value: -1 }, { upTo: 14, value: 5 }, { value: 1 }]);
    expect(screen.queryByLabelText('Remove row 3')).toBeNull();
  });

  it('adds, renames and removes a table', async () => {
    const { last } = open();
    await tables();
    await userEvent.click(screen.getByText('+ TABLE'));
    expect(last().lookups).toEqual({ new_table: { label: 'New table', bands: [{ value: 0 }] } });
    const name = screen.getByLabelText('Table name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Armor');
    expect((last().lookups as { new_table: { label: string } }).new_table.label).toBe('Armor');
    await userEvent.click(screen.getByLabelText('Remove the Armor table'));
    expect('lookups' in last()).toBe(false);
  });
});
