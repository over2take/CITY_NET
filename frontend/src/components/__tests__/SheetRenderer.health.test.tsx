import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetRenderer } from '../SheetRenderer';
import { WORKED_KEY } from '../../sheets/choicesShown';
import { HP_TEMP_KEY, withTempHp } from '../../sheets/tempHp';
import type { SheetTemplate } from '../../sheets';

/**
 * A built system's HEALTH box and the tab its sheet opens on (the user, 2026-10-31): the name alone
 * over the box, CURRENT and MAX each under its number, the token's temporary HP added to the current
 * in the warning color, a feature's bonus on the maximum named on hover; and a sheet that lists
 * CHARACTER first opening on STATS.
 */

afterEach(() => cleanup());

const HEALTH = { id: 'health', label: 'HEALTH', layout: 'grid' as const, tab: 'STATS', columns: 2, fields: [
  { id: 'hp', label: 'HP', type: 'number' as const, source: 'token_hp' as const, maxField: 'hp_max' },
  { id: 'hp_max', label: 'HP MAX', type: 'number' as const, source: 'token_hp_max' as const },
] };
const template = {
  id: 'sys_healthhealthhealt', name: 'Health', tabs: ['CHARACTER', 'STATS'], opens: 'STATS',
  sections: [{ id: 'identity', label: 'IDENTITY', layout: 'list', tab: 'CHARACTER', fields: [{ id: 'name', label: 'Name', type: 'text' }] }, HEALTH],
} as SheetTemplate;
const draw = (data: Record<string, unknown>, more: Partial<SheetTemplate> = {}) =>
  render(<SheetRenderer template={{ ...template, ...more }} data={{ name: 'Rook', ...data } as never} onFieldChange={() => {}} />);
/** The title an element's box carries over the linked value's own. */
const hover = (el: HTMLElement) => el.parentElement!.parentElement!.getAttribute('title');

describe('the tab a sheet opens on', () => {
  it('is the one it names, though CHARACTER comes first in the row', async () => {
    draw({ hp: 30, hp_max: 45 });
    const row = screen.getAllByRole('button').map((b) => b.textContent).filter((t) => t === 'CHARACTER' || t === 'STATS');
    expect(row).toEqual(['CHARACTER', 'STATS']);
    expect(screen.getByText('─── HEALTH ───', { exact: false })).toBeTruthy();
    expect(screen.queryByText(/IDENTITY/)).toBeNull();
    await userEvent.click(screen.getByText('CHARACTER', { selector: 'button' }));
    expect(screen.getByText(/IDENTITY/)).toBeTruthy();
  });

  it('is the first without one, or with one the sheet no longer has', () => {
    draw({}, { opens: undefined });
    expect(screen.getByText(/IDENTITY/)).toBeTruthy();
    cleanup();
    draw({}, { opens: 'GONE' });
    expect(screen.getByText(/IDENTITY/)).toBeTruthy();
  });
});

describe('the HEALTH box', () => {
  it('has the name alone over CURRENT / MAX, each under its own number', () => {
    draw({ hp: 30, hp_max: 45 });
    expect(screen.getByText('HP', { exact: true }).textContent).toBe('HP');
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('45')).toBeTruthy();
    expect(screen.getByText('CURRENT')).toBeTruthy();
    expect(screen.getByText('MAX')).toBeTruthy();
    // The numbers and their names on one grid of three: current, the slash, max.
    const [numbers, names] = [screen.getByText('/').parentElement!, screen.getByText('MAX').parentElement!];
    expect(numbers.style.gridTemplateColumns).toBe('1fr 12px 1fr');
    expect(names.style.gridTemplateColumns).toBe('1fr 12px 1fr');
    expect(hover(screen.getByText('30'))).toBeNull();
  });

  it('adds the token\'s temporary HP to the current, in the warning color, and says so', () => {
    draw({ hp: 30, hp_max: 45, [HP_TEMP_KEY]: 5 });
    const current = screen.getByText('35');
    expect(current.parentElement!.style.color).toBe('var(--warning)');
    expect(hover(current)).toBe('30 + 5 temporary');
    const name = screen.getByText('CURRENT +5 TEMP');
    expect(name.style.color).toBe('var(--warning)');
    expect(screen.queryByText('30')).toBeNull();
  });

  it('names a feature\'s bonus on the maximum on hover, colored, not as a number by the name', () => {
    // Picks' bonuses are read where the system has lists to pick from.
    draw({ hp: 45, hp_max: 45, [WORKED_KEY]: { from: { hp_max: [{ feature: 'Tough', amount: 10 }] } } },
      { choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [] }] } as Partial<SheetTemplate>);
    const [current, max] = screen.getAllByText('45');
    expect(max.parentElement!.style.color).toBe('var(--cyan)');
    expect(hover(max)).toBe('35 → 45 (Tough +10)');
    expect(current.parentElement!.style.color).not.toBe('var(--cyan)');
    expect(hover(current)).toBeNull();
    expect(screen.getByText('HP', { exact: true }).textContent).toBe('HP');
    // Nor by the name when the current has a bonus of its own.
    cleanup();
    draw({ hp: 45, hp_max: 45, [WORKED_KEY]: { from: { hp: [{ feature: 'Odd', amount: 2 }] } } },
      { choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [] }] } as Partial<SheetTemplate>);
    expect(screen.getByText('HP', { exact: true }).textContent).toBe('HP');
  });
});

describe('withTempHp', () => {
  it('adds the temp HP to a field linked to the token\'s HP, and to nothing else', () => {
    expect(withTempHp({ id: 'hp', source: 'token_hp' }, { hp: 30, [HP_TEMP_KEY]: 5 })).toEqual({ data: { hp: 35, [HP_TEMP_KEY]: 5 }, temp: 5 });
    const data = { hp: 30, hp_max: 45, [HP_TEMP_KEY]: 5 };
    expect(withTempHp({ id: 'hp_max', source: 'token_hp_max' }, data)).toEqual({ data, temp: 0 });
    expect(withTempHp({ id: 'hp', source: 'token_hp' }, { hp: 30 })).toEqual({ data: { hp: 30 }, temp: 0 });
    expect(withTempHp({ id: 'hp', source: 'token_hp' }, { hp: null, [HP_TEMP_KEY]: 5 }).temp).toBe(0);
  });
});
