import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';
import { DyingBox, DownWord, StabilizeOffer } from '../DyingBox';
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

describe("STABILIZE in the token's HEALTH window (8c4b2)", () => {
  const HEALING = { ...DND, stabilize: { field: 'heal', label: 'Heal', roll: null, vs: '10', then: 'stable' as const, gets: null } };
  const HELPERS = [{ id: 4, name: 'Ash' }, { id: 3, name: 'Ogre (NPC)' }];

  it('the GM: HELPED BY (the first to start), STABILIZE as them; BY HAND STABLE and DEAD; the answer said', async () => {
    const socket = { emit: vi.fn((e: string, _p: unknown, ack: (a: unknown) => void) => ack(e === 'stabilize' ? { ok: true, made: true } : { ok: true })) };
    render(<DyingBox rule={HEALING} dying={FULL()} locationId={7} gm socket={socket} helpers={HELPERS} />);
    const help = within(screen.getByRole('group', { name: 'Stabilize them' }));
    expect((help.getByLabelText('HELPED BY') as HTMLSelectElement).value).toBe('4');
    expect(help.getByText('HEAL VS 10')).toBeTruthy();
    await userEvent.selectOptions(help.getByLabelText('HELPED BY'), '3');
    await userEvent.click(help.getByRole('button', { name: 'STABILIZE' }));
    expect(socket.emit).toHaveBeenCalledWith('stabilize', { locationId: 7, as: 3 }, expect.any(Function));
    expect(screen.getByRole('status', { name: 'Stabilize' }).textContent).toBe('STABILIZED');
    const hand = within(screen.getByRole('group', { name: 'By hand' }));
    await userEvent.click(hand.getByRole('button', { name: 'DEAD' }));
    expect(socket.emit).toHaveBeenCalledWith('dyingByHand', { locationId: 7, to: 'dead' }, expect.any(Function));
    await userEvent.click(hand.getByRole('button', { name: 'STABLE' }));
    expect(socket.emit).toHaveBeenCalledWith('dyingByHand', { locationId: 7, to: 'stable' }, expect.any(Function));
  });

  it('nobody there: STABILIZE waits; a miss said; a game with no STABILIZE: BY HAND alone', async () => {
    const socket = socketAnswering({ ok: true, made: false } as never);
    const { unmount } = render(<DyingBox rule={HEALING} dying={FULL()} locationId={7} gm socket={socket} helpers={[]} />);
    expect((screen.getByRole('button', { name: 'STABILIZE' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('NOBODY HERE')).toBeTruthy();
    unmount();
    const again = render(<DyingBox rule={HEALING} dying={FULL()} locationId={7} gm socket={socket} helpers={HELPERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'STABILIZE' }));
    expect(screen.getByRole('status', { name: 'Stabilize' }).textContent).toBe('NOT THIS TIME: SEE THE TRAY');
    again.unmount();
    render(<DyingBox rule={DND} dying={FULL()} locationId={7} gm socket={socket} helpers={HELPERS} />);
    expect(screen.queryByRole('group', { name: 'Stabilize them' })).toBeNull();
    expect(screen.getByRole('group', { name: 'By hand' })).toBeTruthy();
  });

  it('STABLE: DEAD alone by hand, nothing to stabilize; the sheet\'s strip (no helpers) and a player: none of it', () => {
    const socket = socketAnswering({ ok: true });
    const { unmount } = render(<DyingBox rule={HEALING} dying={FULL({ state: 'stable' })} locationId={7} gm socket={socket} helpers={HELPERS} />);
    expect(within(screen.getByRole('group', { name: 'By hand' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['DEAD']);
    expect(screen.queryByRole('group', { name: 'Stabilize them' })).toBeNull();
    unmount();
    const strip = render(<DyingBox rule={HEALING} dying={FULL()} locationId={7} gm socket={socket} />);
    expect(screen.queryByRole('group', { name: 'By hand' })).toBeNull();
    strip.unmount();
    render(<DyingBox rule={HEALING} dying={FULL()} locationId={7} gm={false} socket={socket} helpers={HELPERS} />);
    expect(screen.queryByRole('group', { name: 'By hand' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Stabilize them' })).toBeNull();
  });

  it("a player looking at someone down: YOUR HEAL VS 10 and STABILIZE as themselves; the answer or the refusal said", async () => {
    const socket = { emit: vi.fn((_e: string, _p: unknown, ack: (a: unknown) => void) => ack({ ok: true, made: true })) };
    const { unmount } = render(<StabilizeOffer rule={HEALING} dying={'{"state":"dying"}'} locationId={9} socket={socket} />);
    const offer = within(screen.getByRole('group', { name: 'Stabilize them' }));
    expect(offer.getByText('YOUR HEAL VS 10')).toBeTruthy();
    await userEvent.click(offer.getByRole('button', { name: 'STABILIZE' }));
    expect(socket.emit).toHaveBeenCalledWith('stabilize', { locationId: 9 }, expect.any(Function));
    expect(offer.getByRole('status').textContent).toBe('STABILIZED');
    unmount();
    render(<StabilizeOffer rule={HEALING} dying={'{"state":"dying"}'} locationId={9} socket={socketAnswering({ ok: false, error: 'Your character has no token on the map' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'STABILIZE' }));
    expect(screen.getByRole('alert').textContent).toBe('YOUR CHARACTER HAS NO TOKEN ON THE MAP');
  });

  it('nothing to offer: not dying, no STABILIZE, or no connection yet', () => {
    const { container, rerender } = render(<StabilizeOffer rule={HEALING} dying={'{"state":"stable"}'} locationId={9} socket={null} />);
    expect(container.textContent).toBe('');
    rerender(<StabilizeOffer rule={DND} dying={'{"state":"dying"}'} locationId={9} socket={null} />);
    expect(container.textContent).toBe('');
    rerender(<StabilizeOffer rule={HEALING} dying={'{"state":"dying"}'} locationId={9} socket={null} />);
    expect((screen.getByRole('button', { name: 'STABILIZE' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
