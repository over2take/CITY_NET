import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HelpPage } from '../HelpPage';
import { TOPICS, FORMULA_FUNCTIONS, EXAMPLES } from '../../sheets/builderHelp';

/**
 * The builder's HELP page (4i; approved mockup docs/mockups/builder-help.html, 2026-10-13): topics
 * down the left in their groups, the open one on the right, GO TO for a page's topic, the formula
 * functions, the examples to look at, and START THE TOUR once there is a tour to start.
 */

afterEach(() => cleanup());

const open = (over: Partial<React.ComponentProps<typeof HelpPage>> = {}) => {
  const onGoTo = vi.fn();
  const Harness = () => {
    const [topic, setTopic] = useState<string | null>(null);
    return <HelpPage topic={topic} onTopic={setTopic} canGoTo onGoTo={onGoTo} {...over} />;
  };
  render(<Harness />);
  return { onGoTo };
};
const topics = () => within(screen.getByRole('navigation', { name: 'Help topics' }));
const topic = () => within(screen.getByRole('article'));
const pick = (title: string) => userEvent.click(topics().getByRole('button', { name: title }));

describe('the topics', () => {
  it('lists every topic under its group, and opens on GETTING STARTED', () => {
    open();
    expect(topics().getAllByRole('button').map((b) => b.textContent)).toEqual(TOPICS.map((t) => t.title));
    for (const g of ['START', 'PAGES', 'REFERENCE']) expect(topics().getByText(g)).toBeTruthy();
    expect(topics().getByRole('button', { name: 'GETTING STARTED' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('article', { name: 'GETTING STARTED' })).toBeTruthy();
    expect(topic().getByText(TOPICS[0].body[0])).toBeTruthy();
  });

  it('opens the one picked, with all its words', async () => {
    open();
    await pick('DICE');
    const dice = TOPICS.find((t) => t.id === 'dice')!;
    expect(screen.getByRole('article', { name: 'DICE' })).toBeTruthy();
    for (const p of dice.body) expect(topic().getByText(p)).toBeTruthy();
    expect(topics().getByRole('button', { name: 'DICE' }).getAttribute('aria-current')).toBe('true');
    expect(topics().getByRole('button', { name: 'GETTING STARTED' }).getAttribute('aria-current')).toBeNull();
  });

  it('falls back to the first for a topic it doesn\'t know', () => {
    render(<HelpPage topic="nope" onTopic={() => {}} canGoTo onGoTo={() => {}} />);
    expect(screen.getByRole('article', { name: 'GETTING STARTED' })).toBeTruthy();
  });
});

describe('a page\'s topic', () => {
  it('goes to its page', async () => {
    const { onGoTo } = open();
    await pick('STATS & RULES');
    await userEvent.click(topic().getByRole('button', { name: 'GO TO STATS & RULES' }));
    expect(onGoTo).toHaveBeenCalledWith('rules');
  });

  it('can\'t go anywhere with no system open, and says why', async () => {
    const { onGoTo } = open({ canGoTo: false });
    await pick('SETUP');
    const go = topic().getByRole('button', { name: 'GO TO SETUP' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(go.title).toBe('Open a system first, in MY SYSTEMS.');
    expect(onGoTo).not.toHaveBeenCalled();
  });

  it('is the only kind with GO TO', async () => {
    open();
    for (const t of TOPICS.filter((x) => !x.page)) {
      await pick(t.title);
      expect(topic().queryByRole('button', { name: /^GO TO/ }), t.id).toBeNull();
    }
  });
});

describe('the references', () => {
  it('FORMULAS lists every function the engine knows, with its arguments and an example', async () => {
    open();
    await pick('FORMULAS');
    const rows = within(screen.getByRole('table', { name: 'Formula functions' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent)))
      .toEqual(FORMULA_FUNCTIONS.map((f) => [`${f.name}(${f.args})`, f.gives, f.example]));
  });

  it('only FORMULAS has the table', async () => {
    open();
    await pick('DICE');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('EXAMPLES opens each built-in game to look at', async () => {
    const onLook = vi.fn();
    open({ onLook });
    await pick('EXAMPLES');
    for (const e of EXAMPLES) await userEvent.click(topic().getByRole('button', { name: `LOOK AT ${e.name}` }));
    expect(onLook.mock.calls.map((c) => c[0])).toEqual(EXAMPLES.map((e) => e.id));
  });

  it('WHO SEES THE TARGET shows one roll as a player\'s tray and the GM\'s, at the setting picked (6c4h)', async () => {
    open();
    await pick('WHO SEES THE TARGET');
    const example = within(screen.getByTestId('target-seen-example'));
    const line = (tray: string) => within(example.getByRole('region', { name: tray })).getByTestId('tray-line').textContent;
    const board = (tray: string) => within(example.getByRole('region', { name: tray })).getByRole('img').getAttribute('aria-label');
    const setting = (name: string) => userEvent.click(within(example.getByRole('group', { name: 'Players see' })).getByRole('button', { name }));
    // Opens on GM ONLY, as a new system starts: the player sees their total alone; the GM all, marked.
    expect(within(example.getByRole('group', { name: 'Players see' })).getByRole('button', { name: 'GM ONLY' }).getAttribute('aria-pressed')).toBe('true');
    expect(line('A PLAYER')).toBe('KES rolled STEALTH [d20 (11) + 3 = 14]');
    expect(board('A PLAYER')).toBe('STEALTH       14');
    expect(line('YOU, THE GM')).toBe('KES rolled STEALTH [d20 (11) + 3 = 14] — vs 12: SUCCESS · SILENT · HIDDEN FROM PLAYERS');
    expect(board('YOU, THE GM')).toBe('STEALTH       14 / VS 12 SUCCESS');
    await setting('VERDICT ONLY');
    expect(line('A PLAYER')).toBe('KES rolled STEALTH [d20 (11) + 3 = 14] — SUCCESS · SILENT');
    expect(board('A PLAYER')).toBe('STEALTH       14 / SUCCESS');
    await setting('SHOWN');
    expect(line('A PLAYER')).toBe('KES rolled STEALTH [d20 (11) + 3 = 14] — vs 12: SUCCESS · SILENT');
    expect(line('YOU, THE GM')).toBe(line('A PLAYER'));
    // ROLL AGAIN: another face, never the same one.
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.06);
    await userEvent.click(example.getByRole('button', { name: 'ROLL AGAIN' }));
    random.mockRestore();
    expect(line('A PLAYER')).toBe('KES rolled STEALTH [d20 (2) + 3 = 5] — vs 12: FAILURE');
    // And the table of what each setting keeps, a row each.
    const rows = within(example.getByRole('table', { name: 'What each setting keeps from players' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))[1]).toEqual(['The target ("vs 12")', 'yes', '— hidden', '— hidden']);
  });

  it('EXAMPLES only describes them where they can\'t be opened', async () => {
    open();
    await pick('EXAMPLES');
    expect(topic().queryAllByRole('button')).toEqual([]);
  });
});

describe('the tour', () => {
  it('START THE TOUR on GETTING STARTED, once there is a tour to start', async () => {
    const onStartTour = vi.fn();
    open({ onStartTour });
    await userEvent.click(topic().getByRole('button', { name: 'START THE TOUR' }));
    expect(onStartTour).toHaveBeenCalledTimes(1);
    await pick('SETUP');
    expect(topic().queryByRole('button', { name: 'START THE TOUR' })).toBeNull();
  });

  it('no START THE TOUR without one', () => {
    open();
    expect(topic().queryByRole('button', { name: 'START THE TOUR' })).toBeNull();
  });
});
