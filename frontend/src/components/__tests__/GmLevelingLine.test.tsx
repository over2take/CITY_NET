import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GmLevelingLine } from '../GmLevelingLine';
import type { SheetTemplate } from '../../sheets/types';

/**
 * The GM's line on a player's sheet (7d5b): where they are, and CLEAR THE ROLL for a kept health roll; from 7d7a their
 * level whatever they're doing, and FILL IT IN FOR THEM.
 */

afterEach(() => cleanup());

const template = { levels: { top: 5, health: { gain: 'roll', dieOn: 'class', dice: { soldier: 10 } } },
  choices: [{ id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }] }] } as unknown as SheetTemplate;
const data = (health?: object) => ({ _worked: { picks: [{ list: 'classes', option: 'soldier', level: 2 }], levels: { level: 2 } },
  _leveling: { list: 'classes', option: 'soldier', ...(health ? { health } : {}) } });

describe('GmLevelingLine', () => {
  it('says where they are, the roll kept, and clears it', async () => {
    const onClear = vi.fn();
    render(<GmLevelingLine template={template} data={data({ roll: 3, die: 10 })} onClear={onClear} />);
    expect(screen.getByRole('group', { name: 'Their level' }).textContent).toContain('LEVELING UP · SOLDIER 2 → 3 · HEALTH ROLLED 3 ON A D10');
    await userEvent.click(screen.getByRole('button', { name: 'CLEAR THE ROLL' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('nothing to clear before a roll, and nothing at all before a class is picked', () => {
    const { unmount } = render(<GmLevelingLine template={template} data={data()} onClear={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'CLEAR THE ROLL' })).toBeNull();
    unmount();
    const { container } = render(<GmLevelingLine template={template} data={{}} onClear={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('their level while they aren\'t leveling up, and FILL IT IN FOR THEM (7d7a)', async () => {
    const onFillIn = vi.fn();
    const { unmount } = render(<GmLevelingLine template={template} data={{ _worked: data()._worked }} onClear={vi.fn()} onFillIn={onFillIn} />);
    expect(screen.getByRole('group', { name: 'Their level' }).textContent).toContain('LEVEL 2');
    await userEvent.click(screen.getByRole('button', { name: 'FILL IT IN FOR THEM' }));
    expect(onFillIn).toHaveBeenCalledTimes(1);
    unmount();
    // Without a way to open it, no button.
    const { unmount: gone } = render(<GmLevelingLine template={template} data={{ _worked: data()._worked }} onClear={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'FILL IT IN FOR THEM' })).toBeNull();
    gone();
    // At the highest level, nothing to fill in.
    const top = { ...template, levels: { ...template.levels, top: 2 } } as SheetTemplate;
    render(<GmLevelingLine template={top} data={{ _worked: data()._worked }} onClear={vi.fn()} onFillIn={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'FILL IT IN FOR THEM' })).toBeNull();
  });
});
