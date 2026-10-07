import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StatsRulesPage } from '../StatsRulesPage';
import type { Definition } from '../../sheets/systemsApi';

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
