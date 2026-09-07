import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminXpWindow } from '../XpWindow';

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
