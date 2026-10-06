import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WordsPage } from '../WordsPage';
import type { Definition } from '../../sheets/systemsApi';

/**
 * The builder's WORDS page (4b1b). Approved mockup builder-words-features (2026-10-06): one table of
 * the app's terms; a blank box is the app's word and nothing is stored; a term whose part is off is
 * greyed.
 */

afterEach(() => cleanup());

const open = (start: Definition = { format: 1, name: 'Hearth' }) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <WordsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const row = (term: string) => screen.getByTestId(`term-${term}`);

describe('WORDS', () => {
  it('lists every term in its group, the app\'s word in each box', () => {
    open();
    const groups = screen.getAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent);
    expect(groups).toEqual(['CHARACTERS', 'MONEY', 'PLAY', 'VEHICLES']);
    expect(screen.getAllByTestId(/^term-/)).toHaveLength(13);
    const hp = row('hp');
    expect((within(hp).getByLabelText('HP one') as HTMLInputElement).placeholder).toBe('HP');
    expect((within(hp).getByLabelText('HP one') as HTMLInputElement).value).toBe('');
    expect(hp.textContent).toContain('1 HP · 3 HP · HP');
    // A term with no short form has no box for one.
    expect(within(row('round')).queryByLabelText('ROUND short')).toBeNull();
  });

  it('renames a term as typed, in capitals, and reads it back', async () => {
    const { last } = open();
    await userEvent.type(screen.getByLabelText('HP one'), 'wound');
    await userEvent.type(screen.getByLabelText('HP many'), 'wounds');
    expect(last().words).toEqual({ hp: { singular: 'WOUND', plural: 'WOUNDS' } });
    expect((screen.getByLabelText('HP one') as HTMLInputElement).value).toBe('WOUND');
    expect(row('hp').textContent).toContain('1 WOUND · 3 WOUNDS · HP');
  });

  it('clearing a box goes back to the app\'s word, storing nothing', async () => {
    const { last } = open({ format: 1, name: 'Hearth', words: { hp: { singular: 'WOUND' } } });
    await userEvent.clear(screen.getByLabelText('HP one'));
    expect(last()).toEqual({ format: 1, name: 'Hearth' });
  });

  it('RESET puts every form of one term back, and is off for a term left alone', async () => {
    const { last } = open({ format: 1, name: 'Hearth', words: { hp: { singular: 'WOUND', short: 'WND' }, xp: { short: 'EXP' } } });
    expect((screen.getByLabelText('Back to the app\'s words for LEVEL') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByLabelText('Back to the app\'s words for HP'));
    expect(last().words).toEqual({ xp: { short: 'EXP' } });
  });

  it('greys a term whose part is off, saying where to turn it on', () => {
    open({ format: 1, name: 'Hearth', parts: { vehicles: { on: false } }, words: { vehicle: { singular: 'MOUNT' } } });
    const vehicle = row('vehicle');
    expect(vehicle.textContent).toContain('VEHICLES is off in FEATURES');
    expect((within(vehicle).getByLabelText('VEHICLE one') as HTMLInputElement).disabled).toBe(true);
    expect((within(vehicle).getByLabelText('Back to the app\'s words for VEHICLE') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('HP one') as HTMLInputElement).disabled).toBe(false);
    expect(row('hp').textContent).toContain('Their health');
  });
});
