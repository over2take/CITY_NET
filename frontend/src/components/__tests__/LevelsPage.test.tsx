// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LevelsPage } from '../LevelsPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';

/**
 * The builder's LEVELS page (7d1). What it works out is tested in sheets/__tests__/levels.test.ts: here, that
 * it draws that and every control writes.
 */

const held: { current: Definition } = { current: { format: 1, name: 'L' } };
function Harness({ start, onGoTo }: { start: Definition; onGoTo?: (p: string) => void }) {
  const [definition, setDefinition] = useState(start);
  return <LevelsPage definition={definition} edit={(next) => { held.current = next; setDefinition(next); }} onGoTo={onGoTo as never} />;
}
const open = (over: Record<string, unknown> = {}, onGoTo?: (p: string) => void) =>
  render(<Harness start={{ format: 1, name: 'L', core: { advancement: ['levels'] }, ...over }} onGoTo={onGoTo} />);
const press = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const total = (level: number) => screen.getByRole('textbox', { name: `Level ${level} total` }) as HTMLInputElement;

afterEach(cleanup);

describe('the "?" beside each setting', () => {
  it('has its words, each of them shown', () => {
    open({ levels: { health: { how: 'formula', formula: '10' } } });
    const perLevel = ['levels.healthDie', 'levels.healthGain', 'levels.healthAdds'];
    for (const [key, text] of Object.entries(HINTS).filter(([k]) => k.startsWith('levels.') && !perLevel.includes(k))) {
      expect(screen.getByRole('note', { name: text }), key).toBeTruthy();
    }
    cleanup();
    open({ levels: { health: { how: 'level' } } });
    for (const [key, text] of Object.entries(HINTS).filter(([k]) => perLevel.includes(k))) {
      expect(screen.getByRole('note', { name: text }), key).toBeTruthy();
    }
  });
});

describe('how they advance', () => {
  it('says so for each answer, the table only with XP', async () => {
    open({ core: { advancement: [] } });
    expect(screen.getByText(/^Off: characters don't go up here/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'The XP table' })).toBeNull();
    await press('MILESTONE');
    expect(screen.getByText(/^No XP is kept/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'The XP table' })).toBeNull();
    await press('XP LEVELS');
    expect(screen.getByText(/^Both: the GM awards XP/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'The XP table' })).toBeTruthy();
    await press('MILESTONE');
    expect(screen.getByText(/^The GM awards XP, and the sheet counts/)).toBeTruthy();
    expect(held.current.core).toEqual({ advancement: ['levels'] });
  });

  it('says what SETUP picked that comes later', () => {
    open({ core: { advancement: ['levels', 'spend', 'use'] } });
    expect(screen.getByText('SETUP also picks SPEND XP and IMPROVE BY USE. Those come later, as their own pieces.')).toBeTruthy();
    cleanup();
    open({ core: { advancement: ['use'] } });
    expect(screen.getByText('SETUP also picks IMPROVE BY USE. That comes later, as their own pieces.')).toBeTruthy();
  });
});

describe('the word', () => {
  it('shows it, and goes to WORDS to rename it', async () => {
    const onGoTo = vi.fn();
    open({ words: { xp: { short: 'KARMA' } } }, onGoTo);
    expect(screen.getByText('TOTAL KARMA TO REACH EACH LEVEL. TYPE OVER ANY OF THEM.')).toBeTruthy();
    await press('RENAME ON WORDS');
    expect(onGoTo).toHaveBeenCalledWith('words');
  });
});

describe('the table', () => {
  it('starts from the defaults, in one range', () => {
    open();
    expect(total(2).value).toBe('300');
    expect(total(3).value).toBe('900');
    expect(total(10).value).toBe(String(300 * (2 ** 9 - 1)));
    expect(screen.queryByRole('textbox', { name: 'Level 1 total' })).toBeNull();
    expect(within(screen.getByRole('listitem', { name: 'Levels 1 to 10' })).getByRole('button', { name: '× 2' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('what level 2 costs moves it', () => {
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Level 2 costs' }), { target: { value: '100' } });
    expect(total(3).value).toBe('300');
    expect(held.current.levels).toMatchObject({ first: 100 });
  });

  it('the highest level sets how many there are, the box keeping what is typed', () => {
    open();
    const top = screen.getByRole('textbox', { name: 'Highest level' }) as HTMLInputElement;
    fireEvent.change(top, { target: { value: '4' } });
    expect(screen.queryByRole('textbox', { name: 'Level 5 total' })).toBeNull();
    expect(total(4)).toBeTruthy();
    fireEvent.change(top, { target: { value: '1' } });
    expect(top.value).toBe('1');
  });

  it('+ ANOTHER RANGE splits the last, and each has its own multiplier', async () => {
    open();
    await press('+ ANOTHER RANGE');
    const high = within(screen.getByRole('listitem', { name: 'Levels 6 to 10' }));
    await userEvent.click(high.getByRole('button', { name: '× 3' }));
    expect(held.current.levels).toMatchObject({ ranges: [{ to: 5, x: 2 }, { to: 10, x: 3 }] });
    expect(total(6).value).toBe(String(300 + 600 + 1200 + 2400 + 7200));
  });

  it('a range ends where it is left, not on each key, and the next starts after it', async () => {
    open();
    await press('+ ANOTHER RANGE');
    const end = screen.getByRole('textbox', { name: 'Levels 1 to 5 ends at' }) as HTMLInputElement;
    fireEvent.change(end, { target: { value: '7' } });
    expect(screen.getByRole('listitem', { name: 'Levels 1 to 5' })).toBeTruthy();
    fireEvent.blur(end);
    expect(screen.getByRole('listitem', { name: 'Levels 1 to 7' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Levels 8 to 10' })).toBeTruthy();
  });

  it('Enter ends it too, and what doesn\'t read goes back', async () => {
    open();
    await press('+ ANOTHER RANGE');
    const end = screen.getByRole('textbox', { name: 'Levels 1 to 5 ends at' }) as HTMLInputElement;
    fireEvent.change(end, { target: { value: 'x' } });
    fireEvent.blur(end);
    expect(end.value).toBe('5');
    fireEvent.change(end, { target: { value: '3' } });
    fireEvent.keyDown(end, { key: 'Enter' });
    expect(screen.getByRole('listitem', { name: 'Levels 1 to 3' })).toBeTruthy();
  });

  it('the last range\'s end isn\'t a box, and one range has nothing to take off', async () => {
    open();
    expect(screen.queryByRole('textbox', { name: /ends at/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Take off/ })).toBeNull();
    await press('+ ANOTHER RANGE');
    await press('Take off Levels 1 to 5');
    expect(screen.getByRole('listitem', { name: 'Levels 1 to 10' })).toBeTruthy();
  });

  it('+ ANOTHER RANGE is off with no room', () => {
    open({ levels: { top: 2, ranges: [{ to: 2, x: 2 }] } });
    expect((screen.getByRole('button', { name: '+ ANOTHER RANGE' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('typing over a level marks it, keeps focus, and says one that doesn\'t climb', () => {
    open();
    const box = total(3);
    box.focus();
    fireEvent.change(box, { target: { value: '100' } });
    expect(total(3)).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box.style.color).toBe('var(--cyan)');
    expect(total(2).style.color).toBe('var(--green)');
    expect(screen.getByText('Level 3 needs more than level 2, 300')).toBeTruthy();
  });
});

describe('FILL IT AGAIN', () => {
  it('only once something is typed, asking first', async () => {
    open();
    expect(screen.queryByRole('button', { name: 'FILL IT AGAIN' })).toBeNull();
    fireEvent.change(total(3), { target: { value: '5000' } });
    await press('FILL IT AGAIN');
    const asking = within(screen.getByRole('alertdialog', { name: 'Fill it again' }));
    await userEvent.click(asking.getByRole('button', { name: 'CANCEL' }));
    expect(total(3).value).toBe('5000');
    await press('FILL IT AGAIN');
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'FILL IT AGAIN' }));
    expect(total(3).value).toBe('900');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'FILL IT AGAIN' })).toBeNull();
  });
});

describe('MAX HEALTH (7d4)', () => {
  it('AS IT IS to start, saying so; A FORMULA shows its box, its words and what it does', async () => {
    open();
    const group = screen.getByRole('group', { name: 'Max health' });
    expect(within(group).getByRole('button', { name: 'AS IT IS' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('The number on each token, as the GM or the player sets it.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Max health formula' })).toBeNull();
    await userEvent.click(within(group).getByRole('button', { name: 'A FORMULA' }));
    const box = screen.getByRole('textbox', { name: 'Max health formula' });
    await userEvent.type(box, '10 + 2');
    expect((box as HTMLInputElement).value).toBe('10 + 2');
    expect(screen.getByText(/^The token's max health is worked out from the sheet after every change/)).toBeTruthy();
    expect(screen.queryByText(/^TOKEN HEALTH is off/)).toBeNull();
    await userEvent.click(within(group).getByRole('button', { name: 'AS IT IS' }));
    expect(screen.queryByRole('textbox', { name: 'Max health formula' })).toBeNull();
    await userEvent.click(within(group).getByRole('button', { name: 'A FORMULA' }));
    expect((screen.getByRole('textbox', { name: 'Max health formula' }) as HTMLInputElement).value).toBe('10 + 2');
  });

  it('says the formula waits with TOKEN HEALTH off', () => {
    open({ parts: { token_health: { on: false } }, levels: { health: { how: 'formula', formula: '10' } } });
    expect(screen.getByText(/^TOKEN HEALTH is off on SETUP/)).toBeTruthy();
  });
});

describe('MAX HEALTH: PER LEVEL (7d5a)', () => {
  const CLASSES = [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }, { id: 'monk', label: 'Monk' }] }];
  it('its die on each class, each one named, one with none said; or one for all, picked', async () => {
    open({ choices: CLASSES });
    await userEvent.click(within(screen.getByRole('group', { name: 'Max health' })).getByRole('button', { name: 'PER LEVEL' }));
    expect(screen.getByLabelText("Each class's die").textContent).toBe('FIGHTER D10 · MONK NO HIT DIE');
    expect(screen.queryByRole('combobox', { name: 'The die for every level' })).toBeNull();
    expect(screen.getByText('A class with no HIT DIE gains only what each level adds. Set one on CHOICES.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'How health is gained' })).toHaveProperty('value', 'average');
    expect(screen.getByLabelText('How a level gains it').textContent).toBe('Half the die, rounded up, every time. Nothing to roll.');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'How health is gained' }), 'roll');
    expect(screen.getByRole('combobox', { name: 'How health is gained' })).toHaveProperty('value', 'roll');
    expect(screen.getByLabelText('How a level gains it').textContent).toMatch(/^Rolled each level in the tray/);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'How health is gained' }), 'choose');
    expect(screen.getByLabelText('How a level gains it').textContent).toMatch(/^Each level, the player takes the average or rolls/);
    expect(screen.getByRole('textbox', { name: 'Each level adds' })).toBeTruthy();
    expect(screen.getByText(/^Level 1 has the full die/)).toBeTruthy();
    await userEvent.click(within(screen.getByRole('group', { name: 'Where the die is set' })).getByRole('button', { name: 'ONE FOR ALL' }));
    const die = screen.getByRole('combobox', { name: 'The die for every level' }) as HTMLSelectElement;
    expect(die.value).toBe('8');
    await userEvent.selectOptions(die, '12');
    expect((screen.getByRole('combobox', { name: 'The die for every level' }) as HTMLSelectElement).value).toBe('12');
    expect(screen.queryByLabelText("Each class's die")).toBeNull();
  });

  it('with no class list, says to pick one for all', async () => {
    open({ levels: { health: { how: 'level' } } });
    expect(screen.getByLabelText("Each class's die").textContent).toBe('No list here has levels: pick ONE FOR ALL, or make a list levelled on CHOICES.');
    expect(screen.queryByText(/^A class with no HIT DIE/)).toBeNull();
  });

  it('TOKEN HEALTH off: it waits', () => {
    open({ parts: { token_health: { on: false } }, levels: { health: { how: 'level' } } });
    expect(screen.getByText(/^TOKEN HEALTH is off on SETUP/)).toBeTruthy();
  });
});
