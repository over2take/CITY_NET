import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LevelUpReady } from '../LevelUpReady';
import { XP_KEY } from '../../sheets/xpMeter';
import { WORKED_KEY } from '../../sheets/choicesShown';
import type { SheetTemplate } from '../../sheets/types';

/** LEVEL UP READY on a sheet (7d2b): the player's button, one per class, or only words for whoever can't press it. */

afterEach(() => cleanup());

const CLASSES = { id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage' }] };
const template = (choices: object[] = []) => ({ levels: { top: 5, table: { 2: 100, 3: 300 } }, choices }) as unknown as SheetTemplate;
const holding = (...picks: [string, number][]) => ({ [XP_KEY]: 9000, [WORKED_KEY]: { picks: picks.map(([option, level]) => ({ list: 'classes', option, level })), levels: { level: 1 } } });

describe('LevelUpReady', () => {
  it('nothing until it is available', () => {
    const { container } = render(<LevelUpReady template={template()} data={{ [XP_KEY]: 5 }} onLevelUp={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('one button, blinking, that goes up', async () => {
    const onLevelUp = vi.fn();
    render(<LevelUpReady template={template([CLASSES])} data={holding(['soldier', 1])} onLevelUp={onLevelUp} />);
    const ready = screen.getByRole('button', { name: 'LEVEL UP READY' });
    expect(ready.className).toContain('unread-flash');
    await userEvent.click(ready);
    expect(onLevelUp).toHaveBeenCalledWith({ list: 'classes', option: 'soldier', name: 'Soldier', level: 1 });
  });

  it('with no class list, the level itself', async () => {
    const onLevelUp = vi.fn();
    render(<LevelUpReady template={template()} data={{ [XP_KEY]: 100, level: 1 }} onLevelUp={onLevelUp} />);
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL UP READY' }));
    expect(onLevelUp).toHaveBeenCalledWith({ name: 'LEVEL', level: 1 });
  });

  it('several classes, one button each, saying where it goes', async () => {
    const onLevelUp = vi.fn();
    render(<LevelUpReady template={template([CLASSES])} data={holding(['soldier', 3], ['mage', 1])} onLevelUp={onLevelUp} />);
    expect(screen.queryByRole('button', { name: 'LEVEL UP READY' })).toBeNull();
    screen.getByRole('button', { name: 'LEVEL UP: SOLDIER 3 → 4' });
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL UP: MAGE 1 → 2' }));
    expect(onLevelUp).toHaveBeenCalledWith({ list: 'classes', option: 'mage', name: 'Mage', level: 1 });
  });

  it('with a class list and none picked, says to pick one', () => {
    render(<LevelUpReady template={template([CLASSES])} data={holding()} onLevelUp={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('LEVEL UP READY: PICK A CLASS FIRST');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('only words where nobody here can press it', () => {
    render(<LevelUpReady template={template([CLASSES])} data={holding(['soldier', 1])} />);
    expect(screen.getByRole('status').textContent).toBe('LEVEL UP READY');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
