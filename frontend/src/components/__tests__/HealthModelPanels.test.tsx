import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { HitPointsPanel, HealthReviewPanel } from '../HitPoints';
import type { HealthView } from '../../hooks/useHealthView';

/**
 * The HEALTH folder under a custom system's health model, as in the approved mockup
 * (docs/mockups/health-windows.html): each model's editor sends what the server expects and
 * says what happened; other players get a description with no numbers or notes; the built-in
 * systems keep the folder exactly as it was.
 */

const SYSTEM = 'sys_0123456789abcdef';

/** A socket that answers requestHealthView with the view given for that token. */
const fakeSocket = (views: Record<number, Partial<HealthView>>) => {
  const handlers: Record<string, ((d: any) => void)[]> = {};
  const emitted: { e: string; d: any }[] = [];
  return {
    emitted,
    on: (e: string, fn: (d: any) => void) => { (handlers[e] ||= []).push(fn); },
    off: (e: string, fn: (d: any) => void) => { handlers[e] = (handlers[e] || []).filter((f) => f !== fn); },
    emit: (e: string, d: any) => {
      emitted.push({ e, d });
      if (e === 'requestHealthView') {
        const v = views[d.location_id] ?? { model: null };
        queueMicrotask(() => (handlers.healthView || []).forEach((fn) => fn({ location_id: d.location_id, ...v })));
      }
    },
    fire: (e: string, d?: any) => act(() => { (handlers[e] || []).forEach((fn) => fn(d)); }),
    listening: (e: string) => (handlers[e] || []).length,
  };
};

/** fetch that answers the health route with `reply`, and remembers what it was sent. */
const stubFetch = (reply: { ok?: boolean; body?: any } = {}) => {
  const sent: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body) sent.push(JSON.parse(String(init.body)));
    return { ok: reply.ok ?? true, status: reply.ok === false ? 400 : 200, json: async () => reply.body ?? {} } as Response;
  }));
  return sent;
};

const token = (hp: number, max: number, extra = {}) => ({ id: 7, name: 'Razor', x: 0, y: 0, z: 0, shape: 'rhombus', owner: 'RAZOR', hp_current: hp, hp_max: max, hp_temp: 0, ...extra }) as never;

const editor = (view: Partial<HealthView>, t = token(8, 10), gm = false) => {
  const socket = fakeSocket({ 7: view });
  render(<HitPointsPanel target={t} token={gm ? 'gm-token' : ''} refreshLocations={() => {}} gameSystem={SYSTEM} socket={socket} />);
  return socket;
};
const review = (view: Partial<HealthView>, t = token(8, 10)) => {
  const socket = fakeSocket({ 7: view });
  const utils = render(<HealthReviewPanel location={t} socket={socket} gameSystem={SYSTEM} />);
  return { socket, ...utils };
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TRACKS_FULL: Partial<HealthView> = {
  model: 'tracks', full: true, overflow: true,
  tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }],
  second: { id: 'stun', label: 'STUN', current: 6, max: 9 },
};

describe('asking the server', () => {
  it('asks about this token, and again whenever a sheet or the map changes', async () => {
    const socket = editor(TRACKS_FULL);
    await screen.findByText('6 / 9 · OVERFLOW → PHYSICAL');
    expect(socket.emitted.filter((x) => x.e === 'requestHealthView')).toEqual([{ e: 'requestHealthView', d: { location_id: 7 } }]);
    await socket.fire('sheetUpdated', { username: 'RAZOR' });
    await socket.fire('dataUpdated', {});
    expect(socket.emitted.filter((x) => x.e === 'requestHealthView')).toHaveLength(3);
  });

  it('ignores a view of another token, and stops listening when closed', async () => {
    const socket = fakeSocket({ 7: TRACKS_FULL });
    const { unmount } = render(<HitPointsPanel target={token(8, 10)} token="" refreshLocations={() => {}} gameSystem={SYSTEM} socket={socket} />);
    await screen.findByRole('button', { name: 'PHYSICAL' });
    await socket.fire('healthView', { location_id: 99, model: 'none' });
    expect(screen.queryByText(/TRACKS HARM AS CONDITIONS/)).toBeNull();
    unmount();
    expect(socket.listening('healthView') + socket.listening('sheetUpdated') + socket.listening('dataUpdated')).toBe(0);
  });

  it('leaves a built-in system\'s folder exactly as it was, without asking', async () => {
    const socket = fakeSocket({});
    render(<HitPointsPanel target={token(8, 10)} token="" refreshLocations={() => {}} gameSystem="cities_without_number" socket={socket} />);
    expect(screen.getByText('8 / 10')).toBeTruthy();
    expect(screen.getByText('STIM_HEAL (+1 STRAIN)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DAMAGE' })).toBeTruthy();
    expect(socket.emitted).toEqual([]);
  });
});

describe('the editor', () => {
  it('one pool: today\'s folder, with the system\'s own word for health', async () => {
    editor({ model: 'pool', full: true, label: 'VIGOR' });
    expect(await screen.findByText('VIGOR')).toBeTruthy();
    expect(screen.getByText('8 / 10')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DAMAGE' })).toBeTruthy();
  });

  it('two tracks: damage goes to the track picked, and a spill is reported', async () => {
    const sent = stubFetch({ body: { overflow: 3, out: false } });
    editor(TRACKS_FULL);
    await screen.findByText('6 / 9 · OVERFLOW → PHYSICAL');
    expect(screen.getByText('8 / 10')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'STUN' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    await waitFor(() => expect(sent).toEqual([{ action: 'damage', amount: 5, track: 'stun' }]));
    expect(await screen.findByText('STUN FULL · 3 SPILLED INTO PHYSICAL')).toBeTruthy();
    expect(screen.getByLabelText('Temp HP')).toBeTruthy();
  });

  it('two tracks: the GM sets the picked track\'s maximum, and a player gets no SET', async () => {
    const sent = stubFetch();
    editor(TRACKS_FULL, token(8, 10), true);
    await screen.findByLabelText('MAX PHYSICAL');
    fireEvent.change(screen.getByLabelText('MAX PHYSICAL'), { target: { value: '12' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'SET' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'STUN' }));
    fireEvent.change(screen.getByLabelText('MAX STUN'), { target: { value: '7' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'SET' })[0]);
    await waitFor(() => expect(sent).toEqual([{ action: 'set_max', hp_max: 12 }, { action: 'set_max', track: 'stun', amount: 7 }]));
    cleanup();
    editor(TRACKS_FULL);
    await screen.findByRole('button', { name: 'PHYSICAL' });
    expect(screen.queryByLabelText(/^MAX /)).toBeNull();
  });

  it('damage types: boxes heaviest first, the type picked, and boxes turning heavier reported', async () => {
    const sent = stubFetch({ body: { turned: 2, out: false } });
    editor({ model: 'typed', full: true, boxes: 5, types: [{ id: 'superficial', label: 'SUPERFICIAL', marks: 2 }, { id: 'aggravated', label: 'AGGRAVATED', marks: 1 }] }, token(2, 5));
    const boxes = await screen.findByRole('img', { name: 'Health boxes' });
    expect([...boxes.children].map((b) => b.textContent)).toEqual(['X', '/', '/', '', '']);
    expect(screen.getByText('2 OF 5 BOXES CLEAR')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'AGGRAVATED' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    await waitFor(() => expect(sent).toEqual([{ action: 'damage', amount: 3, type: 'aggravated' }]));
    expect(await screen.findByText('TRACK FULL · 2 BOXES TURNED HEAVIER')).toBeTruthy();
    expect(screen.queryByLabelText('Temp HP')).toBeNull();
  });

  const HARM_FULL: Partial<HealthView> = {
    model: 'harm', full: true, worst: 1, out: false,
    levels: [
      { id: 'lesser', label: 'LESSER', penalty: 'Reduced effect', slots: ['Bruised ribs', ''] },
      { id: 'moderate', label: 'MODERATE', penalty: '-1d', slots: ['Twisted knee', 'Cut'] },
      { id: 'severe', label: 'SEVERE', penalty: 'Need help', slots: [''] },
    ],
  };

  it('harm levels: the notes and penalties, harm written at the level picked, and a move up reported', async () => {
    const sent = stubFetch({ body: { placed: 'severe', out: false } });
    editor(HARM_FULL, token(2, 5));
    expect(await screen.findByText('Twisted knee')).toBeTruthy();
    expect(screen.getByText('-1d')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'MODERATE' }));
    fireEvent.change(screen.getByLabelText('Harm note'), { target: { value: 'Broken arm' } });
    fireEvent.click(screen.getByRole('button', { name: 'TAKE HARM' }));
    await waitFor(() => expect(sent).toEqual([{ action: 'damage', level: 'moderate', note: 'Broken arm' }]));
    expect(await screen.findByText('MODERATE FULL · MOVED UP TO SEVERE')).toBeTruthy();
    expect((screen.getByLabelText('Harm note') as HTMLInputElement).value).toBe('');
  });

  it('harm levels: × clears that slot, and out and refusals are said in red', async () => {
    const sent = stubFetch({ body: { out: true } });
    editor(HARM_FULL, token(2, 5));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Cut' }));
    await waitFor(() => expect(sent).toEqual([{ action: 'heal', level: 'moderate', slot: 2 }]));
    fireEvent.click(screen.getByRole('button', { name: 'TAKE HARM' }));
    const out = await screen.findByText('NO ROOM PAST SEVERE · OUT OF ACTION');
    expect(out.style.color).toBe('var(--danger)');
    cleanup();
    stubFetch({ ok: false, body: { error: 'Not one of this system\'s harm levels' } });
    editor(HARM_FULL, token(2, 5));
    fireEvent.click(await screen.findByRole('button', { name: 'TAKE HARM' }));
    expect((await screen.findByText('Not one of this system\'s harm levels')).style.color).toBe('var(--danger)');
  });

  it('wound count: pips, the penalty, and TAKE WOUND', async () => {
    const sent = stubFetch({ body: { out: true } });
    editor({ model: 'wounds', full: true, penalty: -2 }, token(1, 3), true);
    const pips = await screen.findByRole('img', { name: 'Wounds left' });
    expect(pips.children).toHaveLength(3);
    expect(screen.getByText('1 OF 3 WOUNDS LEFT')).toBeTruthy();
    expect(screen.getByText('PENALTY -2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'TAKE WOUND' }));
    await waitFor(() => expect(sent).toEqual([{ action: 'damage', amount: 1 }]));
    expect(await screen.findByText('OUT OF WOUNDS · INCAPACITATED')).toBeTruthy();
    expect(screen.getByLabelText('WOUNDS')).toBeTruthy();
  });

  it('hit locations: where it hit and a note go with the damage, and × clears a location', async () => {
    const sent = stubFetch();
    editor({ model: 'locations', full: true, locations: [{ id: 'head', label: 'HEAD', note: '' }, { id: 'body', label: 'BODY', note: 'Graze' }] }, token(9, 15));
    expect(await screen.findByText('Graze')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Where it hit'), { target: { value: 'head' } });
    fireEvent.change(screen.getByLabelText('Location note'), { target: { value: 'Grazed' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear BODY' }));
    await waitFor(() => expect(sent).toEqual([
      { action: 'damage', amount: 2, location: 'head', note: 'Grazed' },
      { action: 'heal', location: 'body', amount: 0 },
    ]));
    expect(screen.getByLabelText('Temp HP')).toBeTruthy();
  });

  it('none: says so, with no monitor and nothing to press', async () => {
    editor({ model: 'none', full: true });
    expect(await screen.findByText('THIS SYSTEM TRACKS HARM AS CONDITIONS, NOT HEALTH.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'DAMAGE' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Heart monitor/ })).toBeNull();
    // The injury map is still there, as for every system.
    expect(screen.getByRole('button', { name: 'Injuries' })).toBeTruthy();
  });
});

describe('what other players see', () => {
  /** Nothing another player sees may carry a number. (The monitor's own CSS is not seen.) */
  const noNumbers = (container: HTMLElement) => {
    const seen = container.cloneNode(true) as HTMLElement;
    seen.querySelectorAll('style').forEach((s) => s.remove());
    expect(seen.textContent).not.toMatch(/\d/);
  };

  it('two tracks: the second as a fill, and FULL with where it spills', async () => {
    const { container } = review({ model: 'tracks', full: false, overflow: true, tracks: TRACKS_FULL.tracks, second: { label: 'STUN', fill: 1, full: true } });
    expect(await screen.findByText('STUN — FULL · OVERFLOW → PHYSICAL')).toBeTruthy();
    noNumbers(container);
  });

  it('damage types: light against heavy', async () => {
    const { container } = review({ model: 'typed', full: false, light: 0.4, heavy: 0.2 });
    expect((await screen.findByTestId('heavy-fill')).style.width).toBe('20%');
    noNumbers(container);
  });

  it('harm levels: the worst level\'s name, the beat it sets, and out as a flatline', async () => {
    // HP alone would read steady here: the beat is the worst harm's, not the HP's.
    const { container } = review({ model: 'harm', full: false, levelCount: 3, worst: 1, worstLabel: 'MODERATE', out: false }, token(4, 5));
    expect(await screen.findByText('MODERATE HARM')).toBeTruthy();
    expect(container.querySelector('[data-band]')!.getAttribute('data-band')).toBe('fast');
    noNumbers(container);
    cleanup();
    const down = review({ model: 'harm', full: false, levelCount: 3, worst: 2, worstLabel: 'SEVERE', out: true }, token(0, 5));
    expect(await screen.findByText('OUT OF ACTION')).toBeTruthy();
    expect(down.container.querySelector('[data-band]')!.getAttribute('data-band')).toBe('down');
  });

  it('wound count: a word, never the pips', async () => {
    const { container } = review({ model: 'wounds', full: false, state: 'wounded' }, token(1, 3));
    expect(await screen.findByText('WOUNDED')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Wounds left' })).toBeNull();
    noNumbers(container);
  });

  it('hit locations: which are hurt, never how', async () => {
    const { container } = review({ model: 'locations', full: false, locations: [{ id: 'head', label: 'HEAD', hit: false }, { id: 'body', label: 'BODY', hit: true }] });
    await screen.findByText('BODY');
    expect([...container.querySelectorAll('[data-hit]')].map((d) => d.getAttribute('data-hit'))).toEqual(['no', 'yes']);
    noNumbers(container);
  });

  it('none: no monitor at all', async () => {
    review({ model: 'none', full: false });
    expect(await screen.findByText('NO HEALTH TRACKED.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Heart monitor/ })).toBeNull();
  });

  it('a built-in system: the folder as it was, without asking', () => {
    const socket = fakeSocket({});
    render(<HealthReviewPanel location={token(8, 10)} socket={socket} gameSystem="cyberpunk_red" />);
    expect(screen.getByRole('img', { name: /Heart monitor/ })).toBeTruthy();
    expect(socket.emitted.some((x) => x.e === 'requestHealthView')).toBe(false);
  });
});
