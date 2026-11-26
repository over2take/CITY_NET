import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaitingHits } from '../WaitingHits';
import { useWaitingHits } from '../../hooks/useWaitingHits';
import { HitPointsPanel, HealthReviewPanel } from '../HitPoints';
import { TokenWindow } from '../TokenWindow';
import type { WaitingHit, WaitingView } from '../../sheets/waitingHits';

/**
 * Hits waiting under APPLY DAMAGE CONFIRM on a token (8b6b2; approved mockup docs/mockups/waiting-hits.html, sections 3 and 4,
 * answered 2026-11-25): under its HP on HEALTH, above CONDITIONS (answer 3 A), newest first, APPLY and DISMISS each, APPLY
 * ALL where two or more; the one who made them told how many and who applies them; HEALTH's tab saying how many; read
 * again when the server says they changed.
 */

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const hit = (id: number, over: Partial<WaitingHit> = {}): WaitingHit => ({ id, from: 'KES', what: `Hit ${id}`, words: 'RESISTS FIRE: 6 → 3 · WOULD TAKE 7 OF 10', taken: 7, ...over });
const may = (...hits: WaitingHit[]): WaitingView => ({ ok: true, may: true, hits });

describe('the box', () => {
  const draw = (view: WaitingView | null, more: { fold?: boolean; answer?: unknown } = {}) => {
    const act = vi.fn(async () => (more.answer ?? { ok: true, done: 1 }) as never);
    render(<WaitingHits view={view} act={act} gm="GM" fold={more.fold} />);
    return act;
  };

  it('each, newest first: who made it with what, its notes, what it would take larger; APPLY with its number and DISMISS', async () => {
    const act = draw(may(hit(1), hit(2, { from: 'MIRA', what: 'Shortbow', words: 'WOULD TAKE 5', taken: 5 })));
    const box = screen.getByRole('group', { name: 'Hits waiting' });
    expect(within(box).getByText('2 HITS WAITING · NEWEST FIRST')).toBeTruthy();
    const rows = within(box).getAllByRole('group').map((r) => r.getAttribute('aria-label'));
    expect(rows).toEqual(['Shortbow from MIRA', 'Hit 1 from KES']);
    const first = within(box).getByRole('group', { name: 'Hit 1 from KES' });
    expect(first.textContent).toContain('from KES · Hit 1 · RESISTS FIRE: 6 → 3');
    expect(within(first).getByTestId('would-take').textContent).toBe('WOULD TAKE 7 OF 10');
    expect(within(first).getByTestId('would-take').style.fontWeight).toBe('800');
    await userEvent.click(within(first).getByRole('button', { name: 'APPLY 7: Hit 1 from KES' }));
    expect(act).toHaveBeenLastCalledWith({ act: 'apply', hitId: 1 });
    await userEvent.click(within(box).getByRole('button', { name: 'Dismiss Shortbow from MIRA' }));
    expect(act).toHaveBeenLastCalledWith({ act: 'dismiss', hitId: 2 });
    await userEvent.click(within(box).getByRole('button', { name: 'APPLY ALL' }));
    expect(act).toHaveBeenLastCalledWith({ act: 'apply_all' });
  });

  it('one waiting: no APPLY ALL; its numbers kept from them: APPLY alone, no WOULD TAKE', () => {
    draw(may(hit(1, { taken: null, words: '' })));
    expect(screen.queryByRole('button', { name: 'APPLY ALL' })).toBeNull();
    expect(screen.getByRole('button', { name: 'APPLY: Hit 1 from KES' }).textContent).toBe('APPLY');
    expect(screen.queryByTestId('would-take')).toBeNull();
    expect(screen.getByRole('group', { name: 'Hit 1 from KES' }).textContent).toContain('from KES · Hit 1');
  });

  it('why the server said no, said under it; held while asking', async () => {
    let answer!: (a: unknown) => void;
    const send = vi.fn(() => new Promise((r) => { answer = r; }));
    render(<WaitingHits view={may(hit(1))} act={send as never} gm="GM" />);
    fireEvent.click(screen.getByRole('button', { name: 'APPLY 7: Hit 1 from KES' }));
    expect((screen.getByRole('button', { name: 'APPLY 7: Hit 1 from KES' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { answer({ ok: false, error: 'This token has no sheet to keep that on' }); });
    expect(screen.getByRole('alert').textContent).toBe('This token has no sheet to keep that on');
    expect((screen.getByRole('button', { name: 'APPLY 7: Hit 1 from KES' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('the vitals box: more than two folded, opened in place; two or fewer as they are', async () => {
    draw(may(hit(1), hit(2), hit(3)), { fold: true });
    const fold = screen.getByRole('button', { name: '3 HITS WAITING ▸' });
    expect(screen.queryByRole('button', { name: 'APPLY ALL' })).toBeNull();
    await userEvent.click(fold);
    expect(screen.getByRole('button', { name: 'APPLY ALL' })).toBeTruthy();
    cleanup();
    draw(may(hit(1), hit(2)), { fold: true });
    expect(screen.queryByRole('button', { name: /HITS WAITING ▸/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'APPLY ALL' })).toBeTruthy();
  });

  it('the one who made them: how many, and who applies them, nothing to press; anyone else, or none, nothing', () => {
    draw({ ok: true, may: false, hits: [], mine: 2 });
    expect(screen.getByRole('status', { name: 'Hits waiting' }).textContent).toBe('2 HITS WAITING · THE GM APPLIES THEM');
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    draw({ ok: true, may: false, hits: [], mine: 0 });
    expect(screen.queryByLabelText('Hits waiting')).toBeNull();
    cleanup();
    draw(may());
    expect(screen.queryByLabelText('Hits waiting')).toBeNull();
    cleanup();
    draw(null);
    expect(screen.queryByLabelText('Hits waiting')).toBeNull();
  });
});

/** A socket answering waitingHits with `view` (as the server does), and waitingHitAct with `answer`; what was sent kept. */
const serving = (view: WaitingView, answer: unknown = { ok: true, done: 1 }) => {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const socket = {
    view,
    emit: vi.fn((e: string, _p: unknown, ack?: (a: unknown) => void) => {
      if (e === 'waitingHits' && ack) queueMicrotask(() => ack(socket.view));
      if (e === 'waitingHitAct' && ack) queueMicrotask(() => ack(answer));
    }),
    on: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, [...(handlers.get(e) ?? []), fn]); },
    off: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, (handlers.get(e) ?? []).filter((f) => f !== fn)); },
    say: (e: string, d: unknown) => act(() => { for (const fn of handlers.get(e) ?? []) fn(d); }),
  };
  return socket;
};

describe('read from the server (useWaitingHits)', () => {
  const Harness = ({ socket, id, on = true }: { socket: unknown; id: number | null; on?: boolean }) => {
    const { view, act: send } = useWaitingHits(socket, id, on);
    return (
      <>
        <span data-testid="view">{view ? JSON.stringify(view) : 'none'}</span>
        <button type="button" onClick={() => { void send({ act: 'apply_all' }); }}>ALL</button>
      </>
    );
  };

  it('asked for its token, read again whenever the server says any changed; APPLY sent for its token', async () => {
    const socket = serving(may(hit(1)));
    render(<Harness socket={socket} id={5} />);
    await act(async () => {});
    expect(socket.emit).toHaveBeenCalledWith('waitingHits', { locationId: 5 }, expect.any(Function));
    expect(JSON.parse(screen.getByTestId('view').textContent!).hits).toHaveLength(1);
    socket.view = may(hit(1), hit(2));
    await socket.say('waitingHitsChanged', { locationId: 99 });
    await act(async () => {});
    expect(JSON.parse(screen.getByTestId('view').textContent!).hits).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    expect(socket.emit).toHaveBeenLastCalledWith('waitingHitAct', { locationId: 5, act: 'apply_all' }, expect.any(Function));
  });

  it('off (a built-in game), or no token: never asked; another token\'s answer never shown for this one', async () => {
    const socket = serving(may(hit(1)));
    render(<Harness socket={socket} id={5} on={false} />);
    await act(async () => {});
    expect(socket.emit).not.toHaveBeenCalled();
    expect(screen.getByTestId('view').textContent).toBe('none');
    cleanup();
    const other = serving(may(hit(1)));
    const { rerender } = render(<Harness socket={other} id={5} />);
    await act(async () => {});
    other.emit.mockImplementation(() => {});
    rerender(<Harness socket={other} id={6} />);
    expect(screen.getByTestId('view').textContent).toBe('none');
  });
});

describe('where it shows', () => {
  const CUSTOM = 'sys_0123456789abcdef';
  const rhombus = { id: 7, name: 'GHOUL', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 20, hp_max: 20, hp_temp: 0, conditions: '[]' } as never;
  const quiet = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

  it('HEALTH: under the HP, above CONDITIONS; a built-in game: none asked', async () => {
    quiet();
    const socket = serving(may(hit(1)));
    render(<HitPointsPanel target={rhombus} token="gm" refreshLocations={vi.fn()} gameSystem={CUSTOM} socket={socket} />);
    const box = await screen.findByRole('group', { name: 'Hits waiting' });
    const hp = screen.getByText('20 / 20');
    expect(hp.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const conditions = screen.getByRole('region', { name: 'Conditions' });
    expect(box.compareDocumentPosition(conditions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    const builtIn = serving(may(hit(1)));
    render(<HitPointsPanel target={rhombus} token="gm" refreshLocations={vi.fn()} gameSystem="cyberpunk_red" socket={builtIn} />);
    await act(async () => {});
    expect(builtIn.emit.mock.calls.some((c) => c[0] === 'waitingHits')).toBe(false);
  });

  it('HEALTH\'s tab: how many wait, beside its name; none, its name alone', async () => {
    const socket = serving(may(hit(1), hit(2), hit(3)));
    const props = { location: { id: 7, name: 'GHOUL', shape: 'friendly_rhombus', owner: null, description: '' }, title: 'ID: GHOUL', pos: { x: 0, y: 0 }, setPos: vi.fn(), onClose: vi.fn(),
      portrait: null, description: '', actions: [], operator: null, socket, health: <div>HEALTH PANEL</div>, gameSystem: CUSTOM };
    const { rerender } = render(<TokenWindow {...props} />);
    await act(async () => {});
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toContain('HEALTH3 WAITING');
    socket.view = may();
    await socket.say('waitingHitsChanged', { locationId: 7 });
    await act(async () => {});
    rerender(<TokenWindow {...props} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toContain('HEALTH');
  });
});

describe('the one who made them, watching HEALTH', () => {
  it('the read-only panel: how many of theirs wait and who applies them, nothing to press', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const socket = serving({ ok: true, may: false, hits: [], mine: 1 });
    const ghoul = { id: 7, name: 'GHOUL', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 20, hp_max: 20, hp_temp: 0, conditions: '[]' } as never;
    render(<HealthReviewPanel location={ghoul} socket={socket} gameSystem="sys_0123456789abcdef" />);
    expect((await screen.findByRole('status', { name: 'Hits waiting' })).textContent).toBe('1 HIT WAITING · THE GM APPLIES IT');
    expect(screen.queryByRole('button', { name: /APPLY/ })).toBeNull();
  });
});
