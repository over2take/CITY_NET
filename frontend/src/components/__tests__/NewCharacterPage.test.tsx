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

describe('kits (7c4a)', () => {
  const onKits = async (start: Definition = HEARTH) => {
    const opened = open(start);
    await userEvent.click(step('KITS').getByRole('button', { name: 'KITS' }));
    return opened;
  };
  const kits = (d: Definition) => (d.creation as { kits?: Record<string, unknown>[] } | undefined)?.kits;
  const KITTED = { ...HEARTH, creation: { kits: [{ id: 'traveler', name: 'TRAVELER', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' }] } } as unknown as Definition;

  it('only on the KITS step; none to start, saying so', async () => {
    open();
    expect(screen.queryByRole('button', { name: '+ KIT' })).toBeNull();
    cleanup();
    await onKits();
    expect(screen.getByText('No kits yet.')).toBeTruthy();
  });

  it('+ KIT makes one a player may pick; what it has is shown', async () => {
    const { last } = await onKits();
    await userEvent.click(screen.getByRole('button', { name: '+ KIT' }));
    expect(kits(last())).toEqual([{ id: 'new_kit', name: 'NEW KIT', items: [], who: 'pick' }]);
    expect(screen.queryByText('No kits yet.')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'NEW KIT goes to' }) as HTMLSelectElement).value).toBe('pick');
    await userEvent.click(screen.getByRole('button', { name: '+ KIT' }));
    expect(kits(last())).toHaveLength(2);
  });

  it('shows a kit as it was left, items as they are typed', async () => {
    await onKits(KITTED);
    expect((screen.getByRole('textbox', { name: 'TRAVELER items' }) as HTMLInputElement).value).toBe('Rope, 3x Rations');
    expect((screen.getByRole('textbox', { name: 'Kit name' }) as HTMLInputElement).value).toBe('TRAVELER');
  });

  it('takes a name and items as they are typed, a comma typed through', async () => {
    const { last } = await onKits(KITTED);
    const items = screen.getByRole('textbox', { name: 'TRAVELER items' }) as HTMLInputElement;
    await userEvent.clear(items);
    await userEvent.type(items, 'Knife, 2x Torch, ');
    expect(items.value).toBe('Knife, 2x Torch, ');
    expect(kits(last())?.[0].items).toEqual([{ name: 'Knife', qty: 1 }, { name: 'Torch', qty: 2 }]);
    const name = screen.getByRole('textbox', { name: 'Kit name' });
    await userEvent.clear(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    await userEvent.type(name, 'POTION MAKER');
    expect(kits(last())?.[0].name).toBe('POTION MAKER');
    expect(screen.getByRole('group', { name: 'Kit POTION MAKER' })).toBeTruthy();
  });

  it('says who each goes to, and what that means', async () => {
    const { last } = await onKits(KITTED);
    const goes = screen.getByRole('combobox', { name: 'TRAVELER goes to' });
    expect(screen.getByText(/one kit per character/)).toBeTruthy();
    await userEvent.selectOptions(goes, 'all');
    expect(kits(last())?.[0].who).toBe('all');
    expect(screen.getByText('Every new character starts with this.')).toBeTruthy();
    await userEvent.selectOptions(goes, 'gm');
    expect(screen.getByText(/It is yours to hand out/)).toBeTruthy();
  });

  it('ONLY IF has the same box as a list\'s requirement, gone again with it', async () => {
    const { last } = await onKits(KITTED);
    expect(screen.queryByRole('textbox', { name: 'ONLY IF' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'TRAVELER goes to' }), 'needs');
    const box = screen.getByRole('textbox', { name: 'ONLY IF' });
    expect(kits(last())?.[0].requires).toBe('');
    await userEvent.type(box, '@grit > 1');
    expect(kits(last())?.[0].requires).toBe('@grit > 1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'TRAVELER goes to' }), 'pick');
    expect(screen.queryByRole('textbox', { name: 'ONLY IF' })).toBeNull();
    expect('requires' in (kits(last())?.[0] ?? {})).toBe(false);
  });

  it('asks before deleting one; KEEP keeps it; gone leaves nothing behind', async () => {
    const { last, edits } = await onKits(KITTED);
    await userEvent.click(screen.getByRole('button', { name: 'Delete TRAVELER' }));
    expect(edits).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'KEEP' }));
    expect(screen.queryByRole('button', { name: 'DELETE' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Delete TRAVELER' }));
    await userEvent.click(screen.getByRole('button', { name: 'DELETE' }));
    expect(last()).toEqual(HEARTH);
    expect(screen.getByText('No kits yet.')).toBeTruthy();
  });

  it('has a "?"', async () => {
    await onKits();
    expect(screen.getByRole('note', { name: HINTS['creation.kits'] })).toBeTruthy();
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
    for (const k of ['creation.statsBy', 'creation.statsGroups', 'creation.way'] as const) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'A FIXED ARRAY' }));
    expect(screen.getByRole('note', { name: HINTS['creation.numbers'] })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'ROLL' }));
    for (const k of ['creation.each', 'creation.placed'] as const) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
  });

  describe('how they are set (7c3b)', () => {
    const box = () => screen.getByRole('textbox', { name: 'The numbers' }) as HTMLInputElement;

    it('is typed in to start, with no numbers to give', async () => {
      await onStats();
      expect([pressed('TYPED IN'), pressed('A FIXED ARRAY')]).toEqual(['true', 'false']);
      expect(screen.queryByRole('textbox', { name: 'The numbers' })).toBeNull();
      expect(screen.getByText(/They type what they have/)).toBeTruthy();
    });

    it('a fixed array: says how many it still needs until it has enough, and what the step does', async () => {
      const { last } = await onStats();
      await userEvent.click(screen.getByRole('button', { name: 'A FIXED ARRAY' }));
      expect(last().creation).toEqual({ ways: { stats: { way: 'array', numbers: [] } } });
      expect(screen.getByText('0 numbers for 3 stats: each stat needs one')).toBeTruthy();
      expect(panel().textContent).toContain('Every stat, placed from a fixed array.');
      await userEvent.type(box(), '15, 14, 13');
      expect(last().creation).toEqual({ ways: { stats: { way: 'array', numbers: [15, 14, 13] } } });
      expect(screen.queryByText(/each stat needs one/)).toBeNull();
      expect(box().value).toBe('15, 14, 13');
    });

    it('holds what doesn\'t read as numbers, saying so', async () => {
      const { last, edits } = await onStats({ ...GROUPS, creation: { ways: { stats: { way: 'array', numbers: [9] } } } } as unknown as Definition);
      expect(box().value).toBe('9');
      await userEvent.type(box(), 'x');
      expect(edits).toEqual([]);
      void last;
      expect(box().getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('Whole numbers, with commas between them.')).toBeTruthy();
      await userEvent.type(box(), '{Backspace}');
      expect(box().getAttribute('aria-invalid')).toBeNull();
    });

    it('says when a number doesn\'t fit a stat', async () => {
      const ranged = { ...GROUPS, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', max: 10 }] }] } as unknown as Definition;
      await onStats({ ...ranged, creation: { ways: { stats: { way: 'array', numbers: [15] } } } } as unknown as Definition);
      expect(screen.getByText('15 is above Grit\'s highest, 10')).toBeTruthy();
    });

    it('ROLL starts as 4d6 drop lowest, arranged; it says what it does, and takes another way of placing', async () => {
      const { last } = await onStats();
      await userEvent.click(screen.getByRole('button', { name: 'ROLL' }));
      expect(last().creation).toEqual({ ways: { stats: { way: 'roll', each: '4d6 drop lowest', placed: 'arrange' } } });
      expect((screen.getByRole('textbox', { name: 'Each is' }) as HTMLInputElement).value).toBe('4d6 drop lowest');
      expect(panel().textContent).toContain('Every stat, rolled with 4d6 drop lowest, then placed as they like.');
      expect([pressed('IN ORDER'), pressed('ARRANGE')]).toEqual(['false', 'true']);
      await userEvent.click(screen.getByRole('button', { name: 'IN ORDER' }));
      expect(last().creation).toEqual({ ways: { stats: { way: 'roll', each: '4d6 drop lowest', placed: 'order' } } });
      expect(panel().textContent).toContain('Every stat, rolled with 4d6 drop lowest, in order.');
      expect([pressed('IN ORDER'), pressed('ARRANGE')]).toEqual(['true', 'false']);
      await userEvent.click(screen.getByRole('button', { name: 'ARRANGE' }));
      expect((last().creation as { ways: { stats: { placed: string } } }).ways.stats.placed).toBe('arrange');
    });

    it('takes what the GM writes, saying when it doesn\'t read or could come to what a stat can\'t hold', async () => {
      const { last } = await onStats();
      await userEvent.click(screen.getByRole('button', { name: 'ROLL' }));
      const each = screen.getByRole('textbox', { name: 'Each is' }) as HTMLInputElement;
      await userEvent.clear(each);
      expect(each.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText(/^Reads like 3d6, 4d6 drop lowest or 2d6 \+ 6/)).toBeTruthy();
      await userEvent.type(each, '3d6');
      expect((last().creation as { ways: { stats: { each: string; placed: string } } }).ways.stats).toEqual({ way: 'roll', each: '3d6', placed: 'arrange' });
      expect(each.getAttribute('aria-invalid')).toBeNull();
      expect(screen.queryByText(/^Reads like/)).toBeNull();
      cleanup();
      const ranged = { ...GROUPS, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', max: 10 }] }] } as unknown as Definition;
      await onStats({ ...ranged, creation: { ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } } } } as unknown as Definition);
      expect(screen.getByText('3d6 can roll 18, above Grit\'s highest, 10')).toBeTruthy();
    });

    it('pressing the way it already has keeps what it has', async () => {
      const { edits, last } = await onStats({ ...GROUPS, creation: { ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } } } } as unknown as Definition);
      await userEvent.click(screen.getByRole('button', { name: 'ROLL' }));
      expect(edits).toHaveLength(1);
      expect((last().creation as { ways: { stats: { each: string } } }).ways.stats.each).toBe('3d6');
      await userEvent.click(screen.getByRole('button', { name: 'A FIXED ARRAY' }));
      expect((last().creation as { ways: { stats: unknown } }).ways.stats).toEqual({ way: 'array', numbers: [] });
    });

    describe('a point buy (7c3d)', () => {
      const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
      const wayNow = (last: () => Definition) => (last().creation as { ways: { stats: Record<string, unknown> } }).ways.stats;
      const CLIMB = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
      const onBuy = async () => {
        const opened = await onStats();
        await userEvent.click(screen.getByRole('button', { name: 'POINT BUY' }));
        return opened;
      };

      it('starts as 20 points, 8 to 15, the climbing cost, each number\'s cost in its box', async () => {
        const { last } = await onBuy();
        expect(wayNow(last)).toEqual({ way: 'buy', points: 20, lowest: 8, highest: 15, costs: CLIMB });
        expect([box('Points').value, box('Lowest').value, box('Highest').value]).toEqual(['20', '8', '15']);
        expect([box('Cost of 8').value, box('Cost of 13').value, box('Cost of 15').value]).toEqual(['0', '5', '9']);
        expect(pressed('CLIMBING')).toBe('true');
        expect(panel().textContent).toContain('Every stat, bought with 20 points, from 8 to 15.');
      });

      it('the points and the range, written as they read', async () => {
        const { last } = await onBuy();
        await userEvent.clear(box('Points'));
        expect(box('Points').getAttribute('aria-invalid')).toBe('true');
        await userEvent.type(box('Points'), '27');
        expect(wayNow(last).points).toBe(27);
        expect(box('Points').getAttribute('aria-invalid')).toBeNull();
        await userEvent.clear(box('Highest'));
        await userEvent.type(box('Highest'), '9');
        expect(wayNow(last).highest).toBe(9);
        expect(wayNow(last).costs).toEqual({ 8: 0, 9: 1 });
        expect(screen.queryByRole('textbox', { name: 'Cost of 10' })).toBeNull();
      });

      it('1 FOR 1 drops the table, the boxes showing what each costs; CLIMBING brings it back', async () => {
        const { last } = await onBuy();
        await userEvent.click(screen.getByRole('button', { name: '1 FOR 1' }));
        expect('costs' in wayNow(last)).toBe(false);
        expect(pressed('1 FOR 1')).toBe('true');
        expect(box('Cost of 15').value).toBe('7');
        await userEvent.click(screen.getByRole('button', { name: 'CLIMBING' }));
        expect(wayNow(last).costs).toEqual(CLIMB);
        expect(box('Cost of 15').value).toBe('9');
      });

      it('a cost changed is the GM\'s own: neither preset pressed', async () => {
        const { last } = await onBuy();
        await userEvent.clear(box('Cost of 15'));
        await userEvent.type(box('Cost of 15'), '12');
        expect(wayNow(last).costs).toEqual({ ...CLIMB, 15: 12 });
        expect([pressed('1 FOR 1'), pressed('CLIMBING')]).toEqual(['false', 'false']);
        expect(box('Cost of 15').value).toBe('12');
      });

      it('says what would leave a player stuck', async () => {
        await onBuy();
        await userEvent.clear(box('Lowest'));
        await userEvent.type(box('Lowest'), '16');
        expect(screen.getByText('The lowest is above the highest')).toBeTruthy();
      });

      it('has a "?" on each', async () => {
        await onBuy();
        for (const k of ['creation.points', 'creation.buyRange', 'creation.costs'] as const) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
      });
    });

    it('back to typed in, the numbers go; each group keeps its own, its box showing its own', async () => {
      const { last } = open({ ...GROUPS, creation: { statsBy: 'group', ways: { 'stats:abilities': { way: 'array', numbers: [15, 14] }, 'stats:stress': { way: 'array', numbers: [3] } } } } as unknown as Definition);
      await userEvent.click(step('ABILITIES').getByRole('button', { name: 'ABILITIES' }));
      expect(box().value).toBe('15, 14');
      expect(panel().textContent).toContain('2 stats, placed from a fixed array.');
      await userEvent.click(step('STRESS').getByRole('button', { name: 'STRESS' }));
      expect(box().value).toBe('3');
      await userEvent.click(screen.getByRole('button', { name: 'TYPED IN' }));
      expect(last().creation).toEqual({ statsBy: 'group', ways: { 'stats:abilities': { way: 'array', numbers: [15, 14] } } });
      expect(screen.queryByRole('textbox', { name: 'The numbers' })).toBeNull();
    });
  });
});
