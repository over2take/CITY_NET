import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LevelUpReady } from '../LevelUpReady';
import { LEVELING_KEY, XP_KEY } from '../../sheets/xpMeter';
import { WORKED_KEY } from '../../sheets/choicesShown';
import type { SheetTemplate } from '../../sheets/types';

/** LEVEL UP READY on a sheet (7d2b): the player's button opening LEVEL_UP.EXE (7d3a), or words for whoever can't press it. */

afterEach(() => cleanup());

const CLASSES = { id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage' }] };
const template = (choices: object[] = []) => ({ levels: { top: 5, table: { 2: 100, 3: 300 } }, choices }) as unknown as SheetTemplate;
const holding = (...picks: [string, number][]) => ({ [XP_KEY]: 9000, [WORKED_KEY]: { picks: picks.map(([option, level]) => ({ list: 'classes', option, level })), levels: { level: 1 } } });

describe('LevelUpReady', () => {
  it('nothing until it is available', () => {
    const { container } = render(<LevelUpReady template={template()} data={{ [XP_KEY]: 5 }} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('one button, blinking, opening the window, however many classes', async () => {
    const onOpen = vi.fn();
    render(<LevelUpReady template={template([CLASSES])} data={holding(['soldier', 3], ['mage', 1])} onOpen={onOpen} />);
    const ready = screen.getByRole('button');
    expect(ready.textContent).toBe('LEVEL UP READY');
    expect(ready.className).toContain('unread-flash');
    await userEvent.click(ready);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('CONTINUE once the window was left open', () => {
    render(<LevelUpReady template={template([CLASSES])} data={{ ...holding(['soldier', 1]), [LEVELING_KEY]: { list: 'classes', option: 'soldier' } }} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').textContent).toBe('LEVELING UP · CONTINUE');
  });

  it('with a class list and none picked, says to pick one', () => {
    render(<LevelUpReady template={template([CLASSES])} data={holding()} onOpen={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('LEVEL UP READY: PICK A CLASS FIRST');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('only words where nobody here can press it', () => {
    const { unmount } = render(<LevelUpReady template={template([CLASSES])} data={holding(['soldier', 1])} />);
    expect(screen.getByRole('status').textContent).toBe('LEVEL UP READY');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<LevelUpReady template={template([CLASSES])} data={{ ...holding(['soldier', 1]), [LEVELING_KEY]: {} }} />);
    expect(screen.getByRole('status').textContent).toBe('LEVELING UP');
  });
});
