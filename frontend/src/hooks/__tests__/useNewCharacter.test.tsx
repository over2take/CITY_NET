import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import { useNewCharacter } from '../useNewCharacter';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * Where a user stands with the guided new character, with no sheet window open (7c2): what blinks and
 * what CHARACTER_SHEET opens. It asks for the sheet only in a game with the flow on, as asking makes a
 * blank sheet for anyone with none.
 */

const ID = 'sys_fedcba9876543210';
const FLOW: Partial<CustomRender> = { creation: { steps: ['who'], stats: [] } };
const system = (over: Partial<CustomRender> = FLOW) => registerCustomTemplate({
  id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, ...over,
} as CustomRender);

const makeSocket = () => {
  const handlers: Record<string, ((p: unknown) => void) | undefined> = {};
  return {
    on: vi.fn((e: string, fn: (p: unknown) => void) => { handlers[e] = fn; }),
    off: vi.fn((e: string) => { handlers[e] = undefined; }),
    emit: vi.fn(),
    fire: (e: string, p: unknown) => act(() => handlers[e]?.(p)),
    handlers,
  };
};
const sheet = (data: object, over: object = {}) => ({ username: 'WREN', system: ID, data, ...over });

afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

describe('useNewCharacter', () => {
  it('asks for the sheet, and is new on a blank one', () => {
    system();
    const socket = makeSocket();
    const { result } = renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
    expect(result.current).toBe('none');
    socket.fire('sheetData', sheet({}));
    expect(result.current).toBe('new');
  });

  it('follows the sheet: opened, then done, only on word of their own', () => {
    system();
    const socket = makeSocket();
    const { result } = renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    socket.fire('sheetData', sheet({}));
    socket.emit.mockClear();
    socket.fire('sheetUpdated', { username: 'ROOK' });
    expect(socket.emit).not.toHaveBeenCalled();
    socket.fire('sheetUpdated', { username: 'WREN' });
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
    socket.fire('sheetData', sheet({ _creating: {} }));
    expect(result.current).toBe('going');
    socket.fire('sheetData', sheet({ name: 'W', _creating: { done: true } }));
    expect(result.current).toBe('none');
  });

  it('takes no notice of someone else\'s sheet, nor one from another game', () => {
    system();
    const socket = makeSocket();
    const { result } = renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    socket.fire('sheetData', sheet({}, { username: 'ROOK' }));
    expect(result.current).toBe('none');
    socket.fire('sheetData', sheet({}, { system: 'generic' }));
    expect(result.current).toBe('none');
  });

  it('never asks where the flow is off, a built-in game, no one signed in or no socket: asking makes a sheet', () => {
    const fetcher = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', fetcher);
    system({});
    const socket = makeSocket();
    renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', 'generic'));
    cleanup();
    system();
    renderHook(() => useNewCharacter({ current: socket } as never, null, ID));
    renderHook(() => useNewCharacter({ current: null }, 'WREN', ID));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('asks as soon as the GM turns it on', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })));
    system({});
    const socket = makeSocket();
    renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    expect(socket.emit).not.toHaveBeenCalled();
    act(() => { system(); });
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
  });

  it('asks again once the server knows who they are: the first question may have come too soon', () => {
    system();
    const socket = makeSocket();
    renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    socket.emit.mockClear();
    socket.fire('identified', undefined);
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
  });

  it('reads the socket when it runs, as useSocket makes it in an effect just before', () => {
    system();
    const socket = makeSocket();
    const ref = { current: null as unknown };
    const { rerender } = renderHook(({ name }) => useNewCharacter(ref as never, name, ID), { initialProps: { name: null as string | null } });
    expect(socket.emit).not.toHaveBeenCalled();
    ref.current = socket;
    rerender({ name: 'WREN' });
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet');
  });

  it('stops listening when it goes', () => {
    system();
    const socket = makeSocket();
    const { unmount } = renderHook(() => useNewCharacter({ current: socket } as never, 'WREN', ID));
    unmount();
    expect(socket.off.mock.calls.map((c) => c[0]).sort()).toEqual(['identified', 'sheetData', 'sheetUpdated']);
  });
});
