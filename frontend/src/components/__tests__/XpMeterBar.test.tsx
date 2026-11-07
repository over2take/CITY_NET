// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { XpMeterBar } from '../XpMeterBar';
import { clearCustomTemplates, registerCustomTemplate, type CustomRender } from '../../sheets/customTemplates';
import { getTemplate } from '../../sheets';
import { WORKED_KEY } from '../../sheets/choicesShown';
import { XP_KEY } from '../../sheets/xpMeter';

/** The meter on a sheet (7d2a): as the HP bar, in cells, cyan once there's enough for the next level. */

const ID = 'sys_00000000000000bb';
const open = (data: Record<string, unknown>, render_: Partial<CustomRender> = {}) => {
  registerCustomTemplate({ id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, levels: { table: { 2: 300, 3: 900 } }, ...render_ } as unknown as CustomRender);
  render(<XpMeterBar template={getTemplate(ID)} data={data} />);
};
const lit = () => document.querySelectorAll('[data-lit]').length;

afterEach(() => { cleanup(); clearCustomTemplates(); });

describe('the meter', () => {
  it('draws nothing where characters don\'t earn XP', () => {
    open({}, { levels: null } as never);
    expect(screen.queryByTestId('xp-meter')).toBeNull();
  });

  it('says how far, in cells, and the level', () => {
    open({ [XP_KEY]: 600, [WORKED_KEY]: { levels: { level: 2 } } });
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('XP: 600 / 900 · 300 TO LEVEL 3');
    expect(screen.getByText('600 / 900 · 300 TO LEVEL 3')).toBeTruthy();
    expect(screen.getByText('LV 2')).toBeTruthy();
    expect(screen.getByRole('img').children).toHaveLength(20);
    expect(lit()).toBe(10);
    expect((screen.getByRole('img').lastElementChild as HTMLElement).style.background).toBe('transparent');
    expect(screen.getByRole('img').style.border).toContain('var(--green)');
  });

  it('turns cyan once there\'s enough, saying what carries over', () => {
    open({ [XP_KEY]: 1000, [WORKED_KEY]: { levels: { level: 2 } } });
    expect(screen.getByText('1000 / 900 · ENOUGH FOR LEVEL 3 · 100 CARRIES OVER')).toBeTruthy();
    expect(screen.getByRole('img').style.border).toContain('var(--cyan)');
    expect((document.querySelector('[data-lit]') as HTMLElement).style.background).toBe('var(--cyan)');
  });

  it('uses the game\'s word', () => {
    open({ [XP_KEY]: 5 }, { words: { xp: { short: 'Karma' } } } as never);
    expect(screen.getByText('KARMA')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^KARMA: /);
  });
});
