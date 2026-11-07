import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import { useLevelReady } from '../useLevelReady';
import { XP_KEY } from '../../sheets/xpMeter';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

/**
 * Whether this user can go up a level, with no sheet window open (7d2b), for what blinks on the rail. It asks for
 * the sheet only where levels go up, as asking makes a blank sheet for anyone with none.
 */

const ID = 'sys_fedcba9876543210';
const system = (levels: object | null = { top: 5, table: { 2: 100 } }) => registerCustomTemplate({
  id: ID, name: 'H', words: {}, parts: {}, derived: [], sheet: { sections: [] }, levels,
} as unknown as CustomRender);

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

describe('useLevelReady', () => {
  it('peeks at the sheet, never making one, and is ready once the XP is there', () => {
    system();
    const socket = makeSocket();
    const { result } = renderHook(() => useLevelReady({ current: socket } as never, 'WREN', ID));
    expect(socket.emit).toHaveBeenCalledWith('requestMySheet', { peek: true });
    expect(result.current).toBe(false);
    socket.fire('sheetData', sheet({ [XP_KEY]: 99 }));
    expect(result.current).toBe(false);
    socket.fire('sheetData', sheet({ [XP_KEY]: 100 }));
    expect(result.current).toBe(true);
  });

  it("doesn't ask where levels don't go up", () => {
    system(null);
    const socket = makeSocket();
    const { result } = renderHook(() => useLevelReady({ current: socket } as never, 'WREN', ID));
    expect(socket.emit).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it("doesn't ask in a built-in game", () => {
    const socket = makeSocket();
    renderHook(() => useLevelReady({ current: socket } as never, 'WREN', 'cities_without_number'));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("doesn't ask with nobody signed in", () => {
    system();
    const socket = makeSocket();
    renderHook(() => useLevelReady({ current: socket } as never, null, ID));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("takes no one else's sheet, nor another game's", () => {
    system();
    const socket = makeSocket();
    const { result } = renderHook(() => useLevelReady({ current: socket } as never, 'WREN', ID));
    socket.fire('sheetData', sheet({ [XP_KEY]: 100 }, { username: 'ROOK' }));
    expect(result.current).toBe(false);
    socket.fire('sheetData', sheet({ [XP_KEY]: 100 }, { system: 'cities_without_number' }));
    expect(result.current).toBe(false);
  });

  it('asks again when their sheet moves, or on signing in, and not for anyone else', () => {
    system();
    const socket = makeSocket();
    renderHook(() => useLevelReady({ current: socket } as never, 'WREN', ID));
    socket.emit.mockClear();
    socket.fire('sheetUpdated', { username: 'ROOK' });
    expect(socket.emit).not.toHaveBeenCalled();
    socket.fire('sheetUpdated', { username: 'WREN' });
    expect(socket.emit).toHaveBeenCalledTimes(1);
    socket.fire('identified', undefined);
    expect(socket.emit).toHaveBeenCalledTimes(2);
  });

  it('stops listening when gone', () => {
    system();
    const socket = makeSocket();
    const { unmount } = renderHook(() => useLevelReady({ current: socket } as never, 'WREN', ID));
    unmount();
    expect(socket.off.mock.calls.map((c) => c[0]).sort()).toEqual(['identified', 'sheetData', 'sheetUpdated']);
  });
});
