import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NewCharacterPage } from '../NewCharacterPage';
import { HINTS } from '../../sheets/builderHelp';
import type { Definition } from '../../sheets/systemsApi';

/**
 * The builder's NEW CHARACTER page (7c1). Approved mockup new-character (2026-11-03): GUIDED NEW
 * CHARACTER, off to start; the steps in the GM's order, each on or off but WHO THEY ARE; what each asks.
 */

afterEach(() => cleanup());

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'mage', label: 'Mage', requires: '@grit >= 13' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picked: 'both', options: [] },
  ],
} as unknown as Definition;

const open = (start: Definition = HEARTH, onGoTo?: (page: string, list?: string) => void) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <NewCharacterPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} onGoTo={onGoTo} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const steps = () => within(screen.getByRole('list', { name: 'The steps' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
const step = (name: string) => within(screen.getByRole('listitem', { name }));
const flow = () => screen.getByRole('switch', { name: /GUIDED NEW CHARACTER/ });

describe('the page', () => {
  it('is off to start, and says so', () => {
    open();
    expect(flow().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Off: a player gets a blank sheet, as always/)).toBeTruthy();
  });

  it('turns on, says what it means, and turns off again leaving nothing behind', async () => {
    const { last } = open();
    await userEvent.click(flow());
    expect(last().creation).toEqual({ on: true });
    expect(screen.getByText(/A player opening a blank sheet is walked through these steps/)).toBeTruthy();
    await userEvent.click(flow());
    expect(last()).toEqual(HEARTH);
  });

  it('lists the steps; the ends can\'t move past the ends', () => {
    open();
    expect(steps()).toEqual(['WHO THEY ARE', 'THE STATS', 'CLASS', 'FEAT', 'KITS', 'MONEY']);
    expect(step('WHO THEY ARE').getByRole('button', { name: 'WHO THEY ARE up' })).toHaveProperty('disabled', true);
    expect(step('MONEY').getByRole('button', { name: 'MONEY down' })).toHaveProperty('disabled', true);
  });

  it('moves a step, and warns when a list comes before a stat it needs', async () => {
    const { last } = open();
    expect(screen.queryByRole('note', { name: '' })).toBeNull();
    await userEvent.click(step('CLASS').getByRole('button', { name: 'CLASS up' }));
    expect(steps()).toEqual(['WHO THEY ARE', 'CLASS', 'THE STATS', 'FEAT', 'KITS', 'MONEY']);
    expect((last().creation as { order: string[] }).order[1]).toBe('list:classes');
    expect(screen.getByText(/CLASS comes before THE STATS, and MAGE needs a stat/)).toBeTruthy();
    await userEvent.click(step('CLASS').getByRole('button', { name: 'CLASS down' }));
    expect(screen.queryByText(/comes before THE STATS/)).toBeNull();
  });

  it('switches a step off, says so on the step, and on again; WHO THEY ARE has no switch', async () => {
    const { last } = open();
    expect(step('WHO THEY ARE').getByText('ALWAYS')).toBeTruthy();
    expect(step('WHO THEY ARE').queryByRole('switch')).toBeNull();
    await userEvent.click(step('KITS').getByRole('switch', { name: 'KITS on' }));
    expect(last().creation).toEqual({ off: ['kits'] });
    await userEvent.click(step('KITS').getByRole('button', { name: 'KITS' }));
    expect(screen.getByText(/Off: players aren't asked/)).toBeTruthy();
    await userEvent.click(step('KITS').getByRole('switch', { name: 'KITS on' }));
    expect(last()).toEqual(HEARTH);
    expect(screen.queryByText(/Off: players aren't asked/)).toBeNull();
  });

  it('says what each step asks; WHO THEY ARE is open to start', async () => {
    open();
    const panel = () => screen.getByText(/^THE STEP · /).parentElement!;
    expect(panel().textContent).toContain('THE STEP · WHO THEY ARE');
    expect(panel().textContent).toContain('always asked');
    await userEvent.click(step('THE STATS').getByRole('button', { name: 'THE STATS' }));
    expect(panel().textContent).toContain('Every stat, typed in by the player');
    await userEvent.click(step('KITS').getByRole('button', { name: 'KITS' }));
    expect(panel().textContent).toContain('Named kits of items');
    await userEvent.click(step('MONEY').getByRole('button', { name: 'MONEY' }));
    expect(panel().textContent).toContain('a number, a roll, or typed in');
    await userEvent.click(step('CLASS').getByRole('button', { name: 'CLASS' }));
    expect(panel().textContent).toContain('From CHOICES: CLASSES');
    expect(panel().textContent).not.toContain('under that feature');
    await userEvent.click(step('FEAT').getByRole('button', { name: 'FEAT' }));
    expect(panel().textContent).toContain('picked under that feature');
  });

  it('a list\'s step goes to its list on CHOICES; no button without somewhere to go, nor on other steps', async () => {
    const onGoTo = vi.fn();
    open(HEARTH, onGoTo);
    expect(screen.queryByRole('button', { name: 'GO TO CHOICES' })).toBeNull();
    await userEvent.click(step('FEAT').getByRole('button', { name: 'FEAT' }));
    await userEvent.click(screen.getByRole('button', { name: 'GO TO CHOICES' }));
    expect(onGoTo).toHaveBeenCalledWith('choices', 'feats');
    cleanup();
    open();
    await userEvent.click(step('FEAT').getByRole('button', { name: 'FEAT' }));
    expect(screen.queryByRole('button', { name: 'GO TO CHOICES' })).toBeNull();
  });

  it('a step deleted from under it falls back to the first', () => {
    const Harness = () => {
      const [def, setDef] = useState(HEARTH);
      return <><button type="button" onClick={() => setDef({ ...HEARTH, choices: [] } as unknown as Definition)}>GONE</button><NewCharacterPage definition={def} edit={setDef} /></>;
    };
    render(<Harness />);
    return userEvent.click(step('CLASS').getByRole('button', { name: 'CLASS' })).then(() => userEvent.click(screen.getByRole('button', { name: 'GONE' }))).then(() => {
      expect(screen.getByText(/^THE STEP · /).textContent).toBe('THE STEP · WHO THEY ARE');
    });
  });

  it('has a "?" on the switch and the steps', () => {
    open();
    for (const k of ['creation.on', 'creation.steps'] as const) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  });
});

describe('the stats, one way for all or group by group (7c3a)', () => {
  const GROUPS = {
    ...HEARTH,
    stats: [
      { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] },
      { id: 'stress', label: 'STRESS', stats: [{ id: 'worry', label: 'Worry' }] },
      { id: 'empty', label: 'EMPTY', stats: [] },
    ],
  } as unknown as Definition;
  const panel = () => screen.getByText(/^THE STEP · /).parentElement!;
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
  const onStats = async (start: Definition = GROUPS) => {
    const opened = open(start);
    await userEvent.click(step('THE STATS').getByRole('button', { name: 'THE STATS' }));
    return opened;
  };

  it('offers neither on another step', () => {
    open(GROUPS);
    expect(screen.queryByRole('group', { name: 'How the stats are asked' })).toBeNull();
  });

  it('is one way for all to start, listing the groups with stats in them', async () => {
    await onStats();
    expect([pressed('ONE WAY FOR ALL'), pressed('GROUP BY GROUP')]).toEqual(['true', 'false']);
    const groups = within(screen.getByRole('list', { name: 'Groups asked' }));
    expect(groups.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['ABILITIES', 'STRESS']);
    expect(groups.getByText('ABILITIES · 2 STATS')).toBeTruthy();
    expect(groups.getByText('STRESS · 1 STAT')).toBeTruthy();
    expect(panel().textContent).toContain('Every stat, typed in by the player');
  });

  it('leaves a group out, says so, and takes it back leaving nothing behind', async () => {
    const { last } = await onStats();
    await userEvent.click(screen.getByRole('switch', { name: 'STRESS asked' }));
    expect(last().creation).toEqual({ off: ['stats:stress'] });
    expect(panel().textContent).toContain('Every stat but STRESS, typed in by the player');
    expect(steps()).toContain('THE STATS');
    await userEvent.click(screen.getByRole('switch', { name: 'STRESS asked' }));
    expect(last()).toEqual(GROUPS);
  });

  it('with every group left out, says there is nothing to ask', async () => {
    await onStats({ ...GROUPS, creation: { off: ['stats:abilities', 'stats:stress'] } } as unknown as Definition);
    expect(panel().textContent).toContain('Every group is left out, so there is nothing to ask.');
  });

  it('group by group, a step each, staying on the stats; the switches are in the list then', async () => {
    const { last } = await onStats();
    await userEvent.click(screen.getByRole('button', { name: 'GROUP BY GROUP' }));
    expect(last().creation).toEqual({ statsBy: 'group' });
    expect(steps()).toEqual(['WHO THEY ARE', 'ABILITIES', 'STRESS', 'CLASS', 'FEAT', 'KITS', 'MONEY']);
    expect(panel().textContent).toContain('THE STEP · ABILITIES');
    expect(panel().textContent).toContain('2 stats, typed in by the player');
    expect(screen.queryByRole('list', { name: 'Groups asked' })).toBeNull();
    await userEvent.click(step('STRESS').getByRole('button', { name: 'STRESS' }));
    expect(panel().textContent).toContain('1 stat, typed in by the player');
    await userEvent.click(step('STRESS').getByRole('switch', { name: 'STRESS on' }));
    expect(last().creation).toEqual({ statsBy: 'group', off: ['stats:stress'] });
    expect(screen.getByText(/Off: players aren't asked/)).toBeTruthy();
  });

  it('back to one way for all, THE STATS is open again, what was left out still left out', async () => {
    const { last } = open({ ...GROUPS, creation: { statsBy: 'group', off: ['stats:stress'] } } as unknown as Definition);
    await userEvent.click(step('ABILITIES').getByRole('button', { name: 'ABILITIES' }));
    await userEvent.click(screen.getByRole('button', { name: 'ONE WAY FOR ALL' }));
    expect(last().creation).toEqual({ off: ['stats:stress'] });
    expect(panel().textContent).toContain('THE STEP · THE STATS');
    expect(panel().textContent).toContain('Every stat but STRESS');
    expect(screen.getByRole('switch', { name: 'STRESS asked' }).getAttribute('aria-checked')).toBe('false');
  });

  it('has a "?" on each', async () => {
    await onStats();
    for (const k of ['creation.statsBy', 'creation.statsGroups'] as const) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  });
});
