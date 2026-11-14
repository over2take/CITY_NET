import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatsRulesPage } from '../StatsRulesPage';
import type { Definition } from '../../sheets/systemsApi';

/**
 * STATS & RULES' RANKS tab and a stat's HOLDS (7f1b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a list
 * from a preset, renamed, its ranks changed, moved, added and removed; a stat holding it, with AT START and a SAMPLE rank.
 */

afterEach(() => cleanup());

const HEARTH: Definition = { format: 1, name: 'Hearth', stats: [
  { id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', min: 0, max: 5 }, { id: 'stealth', label: 'Stealth' }] },
] } as Definition;
type Saved = { ranks?: { id: string; label: string; list: { name: string; worth: string }[] }[]; stats?: { stats: Record<string, unknown>[] }[]; samples?: Record<string, number> };

const open = (start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <StatsRulesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return () => edits[edits.length - 1] as unknown as Saved;
};
const ranksTab = () => userEvent.click(screen.getByRole('tab', { name: 'RANKS' }));
const statsTab = () => userEvent.click(screen.getByRole('tab', { name: 'STATS' }));
const list = (id: string) => within(screen.getByTestId(`ranks-${id}`));
const statRow = (id: string) => within(screen.getByTestId(`stat-${id}`));

describe('the RANKS tab', () => {
  it('a list from a preset, its ranks by step; renamed; a rank changed, moved, added and removed; the list removed', async () => {
    const last = open();
    await ranksTab();
    expect(screen.getByText(/^Ranks a stat can hold instead of a number/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '+ PROFICIENCY' }));
    const p = list('proficiency');
    expect(p.getByText('NO STAT HOLDS IT YET: SET ONE ON STATS')).toBeTruthy();
    expect((p.getByLabelText('PROFICIENCY rank 2 name') as HTMLInputElement).value).toBe('TRAINED');
    expect((p.getByLabelText('PROFICIENCY rank 2 worth') as HTMLInputElement).value).toBe('2 + @level');
    fireEvent.change(p.getByLabelText('Rank list name'), { target: { value: 'TRAINING' } });
    expect(last().ranks![0].label).toBe('TRAINING');
    fireEvent.change(p.getByLabelText('TRAINING rank 1 worth'), { target: { value: '-1' } });
    expect(last().ranks![0].list[0]).toEqual({ name: 'UNTRAINED', worth: '-1' });
    await userEvent.click(p.getByRole('button', { name: 'Move TRAINING rank 2 up' }));
    expect(last().ranks![0].list.slice(1, 3).map((k) => k.name)).toEqual(['EXPERT', 'TRAINED']);
    // The ends: nothing below the lowest, above the highest, and never the last rank removed.
    expect((p.getByRole('button', { name: 'Move TRAINING rank 1 down' }) as HTMLButtonElement).disabled).toBe(true);
    expect((p.getByRole('button', { name: 'Move TRAINING rank 5 up' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(p.getByRole('button', { name: '+ RANK' }));
    expect(last().ranks![0].list).toHaveLength(6);
    await userEvent.click(p.getByRole('button', { name: 'Remove TRAINING rank 6' }));
    expect(last().ranks![0].list).toHaveLength(5);
    await userEvent.click(p.getByRole('button', { name: 'Remove the TRAINING ranks' }));
    expect(last()).not.toHaveProperty('ranks');
    await userEvent.click(screen.getByRole('button', { name: '+ EMPTY LIST' }));
    const empty = list('new_ranks');
    expect((empty.getByRole('button', { name: 'Remove NEW RANKS rank 1' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a stat\'s HOLDS', () => {
  it('only once there are rank lists; held as one: AT START, its range by its ranks, a SAMPLE rank; HELD BY said', async () => {
    const last = open();
    expect(screen.queryByRole('columnheader', { name: 'HOLDS' })).toBeNull();
    await ranksTab();
    await userEvent.click(screen.getByRole('button', { name: '+ DOTS' }));
    await statsTab();
    expect(screen.getByRole('columnheader', { name: 'HOLDS' })).toBeTruthy();
    const holds = statRow('athletics').getByLabelText('Athletics holds') as HTMLSelectElement;
    expect([...holds.options].map((o) => o.textContent)).toEqual(['A NUMBER', 'DOTS']);
    fireEvent.change(holds, { target: { value: 'dots' } });
    expect(last().stats![0].stats[0]).toEqual({ id: 'athletics', label: 'Athletics', rank: 'dots' });
    expect(statRow('athletics').queryByLabelText('Athletics lowest')).toBeNull();
    expect(statRow('athletics').getAllByText('—')).toHaveLength(2);
    const start = statRow('athletics').getByLabelText('Athletics at start, up to') as HTMLSelectElement;
    expect([...start.options].map((o) => o.textContent)).toEqual(['ANY', '•', '••', '•••', '••••', '•••••']);
    fireEvent.change(start, { target: { value: '2' } });
    expect(last().stats![0].stats[0]).toMatchObject({ atStart: 2 });
    fireEvent.change(start, { target: { value: '' } });
    expect(last().stats![0].stats[0]).not.toHaveProperty('atStart');
    const sample = statRow('athletics').getByLabelText('Athletics sample') as HTMLSelectElement;
    fireEvent.change(sample, { target: { value: '3' } });
    expect(last().samples).toEqual({ athletics: 3 });
    // A stat holding a number keeps its boxes.
    expect(statRow('stealth').getByLabelText('Stealth lowest')).toBeTruthy();
    expect(statRow('stealth').queryByLabelText('Stealth at start, up to')).toBeNull();
    await ranksTab();
    expect(list('dots').getByText('HELD BY ATHLETICS')).toBeTruthy();
    await statsTab();
    fireEvent.change(statRow('athletics').getByLabelText('Athletics holds'), { target: { value: '' } });
    expect(last().stats![0].stats[0]).toEqual({ id: 'athletics', label: 'Athletics' });
  });
});
