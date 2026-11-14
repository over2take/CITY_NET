import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminXpWindow, xpAvailable } from '../XpWindow';
import { clearCustomTemplates, registerCustomTemplate, type CustomRender } from '../../sheets/customTemplates';

/**
 * Awarding experience from the admin panel.
 *
 * It borrows PAY_PLAYERS' shape and differs in the one way that matters: money is a pot
 * the GM splits between whoever was on the job, experience is per character. CWN p44
 * awards points to a character for a session, not points shared between the party -
 * divided, a full party would earn less each than a pair, which is the opposite rule.
 */

const users = [
  { userName: 'ghost' },
  { userName: 'nyx' },
  { userName: 'rig', isNPC: true },
  { userName: 'cody', isAdmin: true },
];

const show = (over: Record<string, unknown> = {}) => {
  const emit = vi.fn();
  const handlers: Record<string, (d: unknown) => void> = {};
  const socket = {
    emit,
    on: (e: string, fn: (d: unknown) => void) => { handlers[e] = fn; },
    off: vi.fn(),
  };
  render(
    <AdminXpWindow
      pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
      socket={socket as never} token="t" activeUsers={users as never}
      system="cities_without_number"
      {...over}
    />,
  );
  return { emit, handlers };
};

const awards = (emit: ReturnType<typeof vi.fn>) =>
  emit.mock.calls.filter((c) => c[0] === 'adminAwardXp').map((c) => c[1]);

describe('who it offers', () => {
  it('lists the players and leaves out NPCs and admins', () => {
    show();
    expect(screen.getByLabelText('ghost')).toBeInTheDocument();
    expect(screen.getByLabelText('nyx')).toBeInTheDocument();
    expect(screen.queryByLabelText('rig')).toBeNull();
    expect(screen.queryByLabelText('cody')).toBeNull();
  });
});

describe('what it sends', () => {
  it('gives each selected character the full amount', async () => {
    // Not divided. This is the whole reason it is not PAY_PLAYERS.
    const { emit } = show();
    await userEvent.type(screen.getByLabelText('POINTS_EACH'), '3');
    await userEvent.click(screen.getByLabelText('ghost'));
    await userEvent.click(screen.getByLabelText('nyx'));
    await userEvent.click(screen.getByRole('button', { name: 'AWARD_SELECTED' }));

    expect(awards(emit)).toEqual([{ token: 't', usernames: ['ghost', 'nyx'], amount: 3 }]);
  });

  it('awards everyone without needing them ticked', async () => {
    const { emit } = show();
    await userEvent.type(screen.getByLabelText('POINTS_EACH'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'AWARD_ALL' }));
    expect(awards(emit)[0]).toMatchObject({ usernames: ['ghost', 'nyx'], amount: 2 });
  });

  it('takes experience back on a negative, and says so on the button', async () => {
    const { emit } = show();
    await userEvent.type(screen.getByLabelText('POINTS_EACH'), '-2');
    await userEvent.click(screen.getByLabelText('ghost'));
    expect(screen.getByRole('button', { name: 'TAKE_SELECTED' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'TAKE_SELECTED' }));
    expect(awards(emit)[0]).toMatchObject({ amount: -2 });
  });
});

describe('what it refuses to send', () => {
  it('will not send zero, which is always a mistake', async () => {
    const { emit } = show();
    await userEvent.type(screen.getByLabelText('POINTS_EACH'), '0');
    await userEvent.click(screen.getByLabelText('ghost'));
    expect(screen.getByRole('button', { name: 'AWARD_SELECTED' })).toBeDisabled();
    expect(awards(emit)).toEqual([]);
  });

  it('will not send a fraction, since experience is whole points', async () => {
    const { emit } = show();
    await userEvent.type(screen.getByLabelText('POINTS_EACH'), '1.5');
    await userEvent.click(screen.getByLabelText('ghost'));
    await userEvent.click(screen.getByRole('button', { name: 'AWARD_SELECTED' }));
    expect(awards(emit)).toEqual([]);
  });

  it('will not send with nobody selected', async () => {
    show();
    expect(screen.getByRole('button', { name: 'AWARD_SELECTED' })).toBeDisabled();
  });
});

describe('correcting a level', () => {
  const levels = (emit: ReturnType<typeof vi.fn>) =>
    emit.mock.calls.filter((c) => c[0] === 'adminAdjustLevel').map((c) => c[1]);

  it('steps the selected characters down', async () => {
    const { emit } = show();
    await userEvent.click(screen.getByLabelText('ghost'));
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL_DOWN' }));
    expect(levels(emit)).toEqual([{ token: 't', usernames: ['ghost'], delta: -1 }]);
  });

  it('steps them up', async () => {
    const { emit } = show();
    await userEvent.click(screen.getByLabelText('ghost'));
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL_UP' }));
    expect(levels(emit)[0]).toMatchObject({ delta: 1 });
  });

  it('needs somebody selected', async () => {
    show();
    expect(screen.getByRole('button', { name: 'LEVEL_DOWN' })).toBeDisabled();
  });

  it('does not need an XP amount, since a level is not an award', async () => {
    // The two are separate: a GM fixing a level should not have to invent an XP figure.
    const { emit } = show();
    await userEvent.click(screen.getByLabelText('ghost'));
    expect(screen.getByRole('button', { name: 'LEVEL_DOWN' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL_DOWN' }));
    expect(levels(emit)).toHaveLength(1);
    expect(emit.mock.calls.filter((c) => c[0] === 'adminAwardXp')).toEqual([]);
  });

  it('reports the level that came back', async () => {
    const { handlers } = show();
    handlers.xpAwardResult({
      ok: true, levelChange: -1, results: [{ username: 'ghost', ok: true, level: 3 }],
    });
    expect(await screen.findByText('ghost: level 3')).toBeInTheDocument();
  });
});

describe('systems that do not have experience', () => {
  it('says so rather than offering a button that does nothing', () => {
    // Cyberpunk RED spends Improvement Points and Shadowrun spends Karma. Both real,
    // neither this.
    show({ system: 'cyberpunk_red' });
    expect(screen.getByText(/does not track experience/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('POINTS_EACH')).toBeNull();
  });
});

describe('what came back', () => {
  it('shows the level an award carried them to', async () => {
    // The award advances the level, so the result says where they landed rather than
    // leaving the GM to check four sheets.
    const { handlers } = show();
    handlers.xpAwardResult({
      ok: true, amount: 3, results: [{ username: 'ghost', ok: true, xp: 12, level: 4 }],
    });
    expect(await screen.findByText('ghost: 12 XP · level 4')).toBeInTheDocument();
  });

  it('reports each character, and names the ones that did nothing', async () => {
    // A name with no sheet is the case worth showing: without this it looks like the
    // button missed.
    const { handlers } = show();
    handlers.xpAwardResult({
      ok: true, amount: 3,
      results: [{ username: 'ghost', ok: true, xp: 9 }, { username: 'nyx', ok: false, reason: 'No sheet.' }],
    });
    expect(await screen.findByText('ghost: 9 XP')).toBeInTheDocument();
    expect(screen.getByText('nyx: No sheet.')).toBeInTheDocument();
  });

  it('shows the reason when the whole award was refused', async () => {
    const { handlers } = show();
    handlers.xpAwardResult({ ok: false, reason: 'Amount must not be zero.' });
    expect(await screen.findByText('Amount must not be zero.')).toBeInTheDocument();
  });
});

describe('a custom system (7d2a)', () => {
  const ID = 'sys_00000000000000cc';
  const custom = () => {
    registerCustomTemplate({ id: ID, name: 'H', words: { xp: { short: 'Karma' } }, parts: {}, derived: [], sheet: { sections: [] }, levels: { table: { 2: 300 } } } as unknown as CustomRender);
    return show({ system: ID });
  };
  const sets = (emit: ReturnType<typeof vi.fn>) => emit.mock.calls.filter((c) => c[0] === 'adminSetXp').map((c) => c[1]);
  afterEach(() => clearCustomTemplates());

  it('is offered while its characters earn XP, and not otherwise', () => {
    registerCustomTemplate({ id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, levels: null } as unknown as CustomRender);
    expect(xpAvailable(ID)).toBe(false);
    registerCustomTemplate({ id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, levels: { table: { 2: 300 } } } as unknown as CustomRender);
    expect(xpAvailable(ID)).toBe(true);
  });

  it('is named with the game\'s word', () => {
    custom();
    expect(screen.getByText('KARMA.EXE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SET_KARMA_TO' })).toBeInTheDocument();
  });

  it('gives each by default, and SPLIT says so and sends it', async () => {
    const { emit } = custom();
    expect(screen.getByRole('button', { name: 'EACH' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(screen.getByLabelText('POINTS_EACH'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'AWARD_ALL' }));
    expect(awards(emit)[0]).toEqual({ token: 't', usernames: ['ghost', 'nyx'], amount: 100 });
    await userEvent.click(screen.getByRole('button', { name: 'SPLIT' }));
    expect(screen.getByText(/^Shared between those selected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'AWARD_ALL' }));
    expect(awards(emit)[1]).toEqual({ token: 't', usernames: ['ghost', 'nyx'], amount: 100, split: true });
  });

  it('SET XP TO goes to those selected, once it reads and someone is', async () => {
    const { emit } = custom();
    const button = screen.getByRole('button', { name: 'SET_KARMA_TO' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Replace what the selected/), '500');
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByLabelText('ghost'));
    await userEvent.click(button);
    expect(sets(emit)).toEqual([{ token: 't', usernames: ['ghost'], value: 500 }]);
  });

  it('SET XP TO takes 0, and not a negative', async () => {
    custom();
    await userEvent.click(screen.getByLabelText('ghost'));
    const box = screen.getByLabelText(/^Replace what the selected/);
    fireEvent.change(box, { target: { value: '-5' } });
    expect(screen.getByRole('button', { name: 'SET_KARMA_TO' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'SET_KARMA_TO' })).not.toBeDisabled();
  });

  it('says what came of it in the game\'s word, and what wouldn\'t divide', () => {
    const { handlers } = custom();
    act(() => handlers.xpAwardResult({ ok: true, amount: 33, left: 1, results: [{ username: 'ghost', ok: true, xp: 33 }] }));
    expect(screen.getByText('ghost: 33 KARMA')).toBeInTheDocument();
    expect(screen.getByText("1 LEFT OVER: IT WOULDN'T DIVIDE")).toBeInTheDocument();
  });

  it('its level buttons give a level to take, or take one back, for those ticked (7d2b)', async () => {
    const { emit, handlers } = custom();
    await userEvent.click(screen.getByRole('checkbox', { name: 'ghost' }));
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL_UP' }));
    expect(emit).toHaveBeenCalledWith('adminAdjustLevel', { token: 't', usernames: ['ghost'], delta: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'LEVEL_DOWN' }));
    expect(emit).toHaveBeenCalledWith('adminAdjustLevel', { token: 't', usernames: ['ghost'], delta: -1 });
    expect(screen.getByText(/LEVEL UP READY shows on their sheet/)).toBeInTheDocument();
    act(() => handlers.xpAwardResult({ ok: true, levelChange: 1, results: [{ username: 'ghost', ok: true, level: 3, owed: 2 }] }));
    expect(screen.getByText(/level 3 · 2 to take/)).toBeInTheDocument();
    act(() => handlers.xpAwardResult({ ok: true, levelChange: -1, results: [{ username: 'ghost', ok: true, level: 3, owed: 0 }] }));
    expect(screen.getByText(/level 3/).textContent).not.toContain('to take');
  });

  it('with milestone only there is no XP to give: only the level buttons', () => {
    registerCustomTemplate({ id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, levels: { top: 5 } } as unknown as CustomRender);
    show({ system: ID });
    expect(screen.getByText('LEVELS.EXE')).toBeInTheDocument();
    expect(xpAvailable(ID)).toBe(true);
    expect(screen.getByRole('button', { name: 'LEVEL_UP' })).toBeInTheDocument();
    for (const gone of ['AWARD_SELECTED', 'SPLIT', 'EACH']) expect(screen.queryByRole('button', { name: new RegExp(gone) }), gone).toBeNull();
    expect(screen.queryByLabelText('POINTS_EACH')).toBeNull();
    expect(screen.queryByLabelText(/^Replace what the selected/)).toBeNull();
  });

  it('spending XP (7f2c2): offered with no levels at all, given to spend, with no level buttons', async () => {
    const spend = { buys: [], wait: false };
    registerCustomTemplate({ id: ID, name: 'H', words: { xp: { short: 'Karma' } }, parts: {}, derived: [], sheet: { sections: [] }, levels: null, spend } as unknown as CustomRender);
    expect(xpAvailable(ID)).toBe(true);
    const { emit } = show({ system: ID });
    expect(screen.getByText('KARMA.EXE')).toBeInTheDocument();
    expect(screen.getByText('Each selected character gets this many, to spend. Negative takes points back.')).toBeInTheDocument();
    expect(screen.getByLabelText('Replace what the selected characters have with another number. What they bought stays.')).toBeInTheDocument();
    for (const gone of ['LEVEL_UP', 'LEVEL_DOWN']) expect(screen.queryByRole('button', { name: gone }), gone).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'SPLIT' }));
    expect(screen.getByText('Shared between those selected, in whole points, to spend. Negative takes points back.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('POINTS_TO_SPLIT'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'AWARD_ALL' }));
    expect(awards(emit)[0]).toEqual({ token: 't', usernames: ['ghost', 'nyx'], amount: 20, split: true });
    cleanup();
    // With levels too: both said, and the level buttons there.
    registerCustomTemplate({ id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, levels: { table: { 2: 300 } }, spend } as unknown as CustomRender);
    show({ system: ID });
    expect(screen.getByText('Each selected character gets this many, to spend. Negative takes points back, but never a level.')).toBeInTheDocument();
    expect(screen.getByLabelText('Replace what the selected characters have with another number. Their level stays. What they bought stays.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LEVEL_UP' })).toBeInTheDocument();
  });

  it('Cities Without Number stays as it was: EACH only, no setting it', () => {
    show();
    expect(screen.getByText('XP.EXE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SPLIT' })).toBeNull();
    expect(screen.queryByLabelText(/^Replace what the selected/)).toBeNull();
    expect(screen.getByRole('button', { name: 'LEVEL_UP' })).toBeInTheDocument();
  });
});
