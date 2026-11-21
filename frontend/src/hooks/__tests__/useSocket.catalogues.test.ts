import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';

/**
 * The shops' uploaded catalogues, kept from the socket's first moment (8n1; found by the shop journey: kept by an effect in
 * App keyed on socketRef.current, they were missed, and a player found every custom system's shop empty). The server sends
 * them on identify; a GM's save or a new game has them asked for again.
 */

const listeners: Record<string, ((data?: unknown) => void)[]> = {};
const fakeSocket = {
  on: (event: string, fn: (data?: unknown) => void) => { (listeners[event] ??= []).push(fn); return fakeSocket; },
  off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: true, id: 'fake',
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

const { useSocket } = await import('../useSocket');
const { uploadedIn, uploadedRevision, clearUploaded, uploadedOf, buybackIn } = await import('../../sheets/uploadedCatalogues');

afterEach(() => { cleanup(); clearUploaded(); fakeSocket.emit.mockClear(); for (const k of Object.keys(listeners)) delete listeners[k]; });

const mount = () => renderHook(() => useSocket({
  userName: 'kes', token: '', isLoggedIn: true, notificationsEnabled: false, isChatOpen: false,
  onFetchAll: vi.fn(), onFetchLocations: vi.fn(), onFetchRoads: vi.fn(), onFetchDistricts: vi.fn(), onFetchWaterBodies: vi.fn(),
  onBankUpdate: vi.fn(), onNotification: vi.fn(), onHasUnreadChat: vi.fn(), onTokenUpdate: vi.fn(), onIsAdminUpdate: vi.fn(),
}));
const send = (event: string, data?: unknown) => act(() => { for (const fn of listeners[event] ?? []) fn(data); });
const asked = () => fakeSocket.emit.mock.calls.filter((c) => c[0] === 'requestCatalogues').length;

const ROPE = { id: 'rope', name: 'Rope', price: 5, fields: {}, source: 'uploaded' };
const BOOK = { id: 'light_pistol', name: 'Light Pistol', price: 200, fields: {}, source: 'book' };
// One of the game's own items on a type's shelf (8a7a3a).
const PISTOL = { id: 'item:pistol', name: 'Pistol', price: 200, fields: { damage: '2d6' }, source: 'items' };

describe('the shops\' catalogues', () => {
  it('kept as soon as the server sends them, the uploaded only; the shops redrawn', () => {
    mount();
    const before = uploadedRevision();
    send('catalogues', { entries: { gear: [ROPE], weapons: [BOOK] } });
    expect(uploadedIn('gear').map((e) => e.name)).toEqual(['Rope']);
    expect(uploadedIn('weapons')).toEqual([]);
    expect(uploadedRevision()).toBeGreaterThan(before);
  });

  it('with what a shop buys back of the game\'s items kept out of the shops (8a7a3c2)', () => {
    mount();
    send('catalogues', { entries: {}, buyback: { 'type:guns': [{ id: 'item:ring', name: 'Ring of Might', price: 5000 }] } });
    expect(buybackIn('type:guns')).toEqual([{ id: 'item:ring', name: 'Ring of Might', price: 5000, fields: {} }]);
    send('catalogues', { entries: {} });
    expect(buybackIn('type:guns')).toEqual([]);
  });

  it('what draws the shops draws again when they come', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useSocket({
        userName: 'kes', token: '', isLoggedIn: true, notificationsEnabled: false, isChatOpen: false,
        onFetchAll: vi.fn(), onFetchLocations: vi.fn(), onFetchRoads: vi.fn(), onFetchDistricts: vi.fn(), onFetchWaterBodies: vi.fn(),
        onBankUpdate: vi.fn(), onNotification: vi.fn(), onHasUnreadChat: vi.fn(), onTokenUpdate: vi.fn(), onIsAdminUpdate: vi.fn(),
      });
    });
    const before = renders;
    send('catalogues', { entries: { gear: [ROPE] } });
    expect(renders).toBeGreaterThan(before);
  });

  it('asked for again when a GM saves one, the game changes, or a system is published (its items sell themselves)', () => {
    mount();
    send('cataloguesChanged', { system: 'sys_aaaaaaaaaaaaaaaa' });
    send('gameSystemChanged', { system: 'generic' });
    send('customSystemChanged', { id: 'sys_aaaaaaaaaaaaaaaa' });
    expect(asked()).toBe(3);
  });
});

describe('uploadedOf', () => {
  it('the uploaded entries of each catalogue, the book\'s left out; nothing sent, nothing kept', () => {
    expect(uploadedOf({ entries: { gear: [ROPE, BOOK], weapons: null } })).toEqual({ gear: [ROPE], weapons: [] });
    // And the game's own items on a type's shelf, which the window has no copy of (8a7a3a).
    expect(uploadedOf({ entries: { 'type:guns': [PISTOL, ROPE] } })).toEqual({ 'type:guns': [PISTOL, ROPE] });
    expect(uploadedOf(null)).toEqual({});
    expect(uploadedOf({})).toEqual({});
  });
});
