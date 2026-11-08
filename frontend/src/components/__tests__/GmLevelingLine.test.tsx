import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GmLevelingLine } from '../GmLevelingLine';
import type { SheetTemplate } from '../../sheets/types';

/** The GM's line on a player's sheet while they level up (7d5b): where they are, and CLEAR THE ROLL for a kept health roll. */

afterEach(() => cleanup());

const template = { levels: { top: 5, health: { gain: 'roll', dieOn: 'class', dice: { soldier: 10 } } },
  choices: [{ id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }] }] } as unknown as SheetTemplate;
const data = (health?: object) => ({ _worked: { picks: [{ list: 'classes', option: 'soldier', level: 2 }], levels: { level: 2 } },
  _leveling: { list: 'classes', option: 'soldier', ...(health ? { health } : {}) } });

describe('GmLevelingLine', () => {
  it('says where they are, the roll kept, and clears it', async () => {
    const onClear = vi.fn();
    render(<GmLevelingLine template={template} data={data({ roll: 3, die: 10 })} onClear={onClear} />);
    expect(screen.getByRole('group', { name: 'Leveling up' }).textContent).toContain('LEVELING UP · SOLDIER 2 → 3 · HEALTH ROLLED 3 ON A D10');
    await userEvent.click(screen.getByRole('button', { name: 'CLEAR THE ROLL' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('nothing to clear before a roll, and nothing at all while they aren\'t leveling up', () => {
    const { unmount } = render(<GmLevelingLine template={template} data={data()} onClear={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'CLEAR THE ROLL' })).toBeNull();
    unmount();
    const { container } = render(<GmLevelingLine template={template} data={{}} onClear={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
