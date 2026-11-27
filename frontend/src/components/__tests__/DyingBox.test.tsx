import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';
import { DyingBox, DownWord } from '../DyingBox';
import type { DyingShown } from '../../sheets/dyingBox';

/**
 * The DYING box (8c3; approved mockup docs/mockups/rule-library.html, section 2): the word, the count as boxes and words,
 * DEATH SAVE (lit on their turn) and the GM's A TURN GOES BY, each sent to the server, its refusal said. Anyone sent only the
 * word sees the word.
 */

const { dyingShown } = createRequire(import.meta.url)('../../../../backend/systemBuilder/dying.js');
const OWN = { format: 1, name: 'Ashfall' };
const rule = (dying: Record<string, unknown>): DyingShown => dyingShown({ ...OWN, dying });
const DND = rule({ word: 'Dying', way: 'count' });
const CWN = rule({ word: 'Mortally Wounded', way: 'turns', turns: 3 });
const FULL = (more: Record<string, unknown> = {}) => JSON.stringify({ state: 'dying', saves: 0, fails: 0, made: 0, turns: 0, due: false, ...more });
afterEach(cleanup);

/** A socket that answers each ask as told. */
const socketAnswering = (answer: { ok: boolean; error?: string }) => ({ emit: vi.fn((_e: string, _p: unknown, ack: (a: unknown) => void) => ack(answer)) });

describe('the box', () => {
  it('the word, the count as boxes said in words, the save; DEATH SAVE sent for this token', async () => {
    const socket = socketAnswering({ ok: true });
    render(<DyingBox rule={DND} dying={FULL({ saves: 1, fails: 2 })} locationId={7} gm={false} socket={socket} />);
    const box = within(screen.getByRole('region', { name: 'DYING' }));
    expect(box.getByRole('status').textContent).toBe('⚠ DYING');
    expect(box.getByRole('img', { name: 'SAVES 1 of 3' })).toBeTruthy();
    expect(box.getByRole('img', { name: 'FAILS 2 of 3' })).toBeTruthy();
    expect(box.getByText('1d20 · 10 OR MORE')).toBeTruthy();
    expect(box.queryByText('THEIR TURN')).toBeNull();
    expect(box.queryByRole('button', { name: 'A TURN GOES BY' })).toBeNull();
    await userEvent.click(box.getByRole('button', { name: 'DEATH SAVE' }));
    expect(socket.emit).toHaveBeenCalledWith('deathSave', { locationId: 7 }, expect.any(Function));
    expect(box.queryByRole('alert')).toBeNull();
  });

  it('lit on their turn; what the server refuses, said', async () => {
    render(<DyingBox rule={DND} dying={FULL({ due: true })} locationId={7} gm={false} socket={socketAnswering({ ok: false, error: 'A death save waits for their turn' })} />);
    const save = screen.getByRole('button', { name: 'DEATH SAVE' });
    expect(save.getAttribute('aria-describedby')).toBe('dying-due-7');
    expect(screen.getByText('THEIR TURN')).toBeTruthy();
    await userEvent.click(save);
    expect(screen.getByRole('alert').textContent).toBe('A DEATH SAVE WAITS FOR THEIR TURN');
  });

  it('TURNS LEFT: the turns left; the GM\'s A TURN GOES BY sent, a player has none', async () => {
    const socket = socketAnswering({ ok: true });
    const { unmount } = render(<DyingBox rule={CWN} dying={FULL({ turns: 1 })} locationId={9} gm socket={socket} />);
    expect(screen.getByRole('img', { name: 'TURNS LEFT 2 of 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'DEATH SAVE' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'A TURN GOES BY' }));
    expect(socket.emit).toHaveBeenCalledWith('dyingTurn', { locationId: 9 }, expect.any(Function));
    unmount();
    render(<DyingBox rule={CWN} dying={FULL({ turns: 1 })} locationId={9} gm={false} socket={socket} />);
    expect(screen.queryByRole('button', { name: 'A TURN GOES BY' })).toBeNull();
  });

  it('STABLE and DEAD: the word and what it means; not down: nothing', () => {
    const { unmount } = render(<DyingBox rule={DND} dying={FULL({ state: 'stable' })} locationId={7} gm socket={null} />);
    expect(screen.getByRole('region', { name: 'STABLE' }).textContent).toContain('No more saves.');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    const { container } = render(<DyingBox rule={DND} dying={null} locationId={7} gm socket={null} />);
    expect(container.textContent).toBe('');
  });

  it('sent only the word (not theirs, not the GM): the word alone, nothing to press', () => {
    render(<DyingBox rule={DND} dying={'{"state":"dying"}'} locationId={7} gm={false} socket={socketAnswering({ ok: true })} />);
    expect(screen.getByRole('status', { name: 'Down: DYING' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a socket not there yet: DEATH SAVE waits', () => {
    render(<DyingBox rule={DND} dying={FULL()} locationId={7} gm={false} socket={null} />);
    expect((screen.getByRole('button', { name: 'DEATH SAVE' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the word on the token', () => {
  it('the game\'s word, STABLE or DEAD; nothing when not down', () => {
    const { unmount } = render(<DownWord rule={CWN} dying={'{"state":"dying"}'} />);
    expect(screen.getByRole('status', { name: 'Down: MORTALLY WOUNDED' }).textContent).toBe('⚠ MORTALLY WOUNDED');
    unmount();
    const { container, rerender } = render(<DownWord rule={CWN} dying={'{"state":"dead"}'} />);
    expect(screen.getByRole('status', { name: 'Down: DEAD' })).toBeTruthy();
    rerender(<DownWord rule={CWN} dying={null} />);
    expect(container.textContent).toBe('');
  });
});
