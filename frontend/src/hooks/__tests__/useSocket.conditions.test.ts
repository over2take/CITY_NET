import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

/**
 * The server saying a game's conditions changed reaches every window that shows them (4e2b1, 4e2c2):
 * a published system changing (customSystemChanged) and a built-in game's own changing in the GAME
 * tab (conditionsChanged) both become CONDITIONS_CHANGED_EVENT, which the condition lists ask again on.
 */

const listeners: Record<string, ((data?: unknown) => void)[]> = {};
const fakeSocket = {
  on: (event: string, fn: (data?: unknown) => void) => { (listeners[event] ??= []).push(fn); return fakeSocket; },
  off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: true, id: 'fake',
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../../sheets/customTemplates', async (original) => ({
  ...(await original<typeof import('../../sheets/customTemplates')>()),
  refreshCustomTemplate: vi.fn(async () => null),
}));

const { useSocket } = await import('../useSocket');
const { CONDITIONS_CHANGED_EVENT } = await import('../useConditionList');

afterEach(() => { cleanup(); for (const k of Object.keys(listeners)) delete listeners[k]; });

const mount = () => renderHook(() => useSocket({
  userName: 'gm', token: 'admintoken', isLoggedIn: true, notificationsEnabled: false, isChatOpen: false,
  onFetchAll: vi.fn(), onFetchLocations: vi.fn(), onFetchRoads: vi.fn(), onFetchDistricts: vi.fn(), onFetchWaterBodies: vi.fn(),
  onBankUpdate: vi.fn(), onNotification: vi.fn(), onHasUnreadChat: vi.fn(), onTokenUpdate: vi.fn(), onIsAdminUpdate: vi.fn(),
}));

/** How many times the windows were told, when the server sends `event`. */
const toldOn = (event: string, data: unknown) => {
  let told = 0;
  const count = () => { told += 1; };
  window.addEventListener(CONDITIONS_CHANGED_EVENT, count);
  for (const fn of listeners[event] ?? []) fn(data);
  window.removeEventListener(CONDITIONS_CHANGED_EVENT, count);
  return told;
};

describe('the server saying conditions changed', () => {
  it('tells the windows when a built-in game\'s own change', () => {
    mount();
    expect(toldOn('conditionsChanged', { system: 'cities_without_number' })).toBe(1);
  });

  it('tells them when a published system changes', () => {
    mount();
    expect(toldOn('customSystemChanged', { id: 'sys_aaaaaaaaaaaaaaaa' })).toBe(1);
  });
});
