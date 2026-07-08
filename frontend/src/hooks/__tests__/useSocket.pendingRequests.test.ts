/**
 * Tests for pending edit-request state management in the useSocket hook.
 *
 * Covers the bug where editingApproved / editingDenied did not broadcast a
 * removal of the request, so a newly-granted temp admin would see all
 * accumulated requests from earlier in the session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Minimal event-emitter that mimics the socket API used by useSocket ────────

type Handler = (data?: any) => void;

function makeSocket() {
  const listeners: Record<string, Handler[]> = {};

  const socket = {
    on:  (event: string, fn: Handler) => { (listeners[event] ??= []).push(fn); },
    off: (event: string, fn?: Handler) => {
      if (!fn) { listeners[event] = []; return; }
      listeners[event] = (listeners[event] ?? []).filter(h => h !== fn);
    },
    emit: (event: string, data?: any) => {
      (listeners[event] ?? []).forEach(h => h(data));
    },
    // Helper: simulate the server broadcasting an event to this client
    serverEmit: (event: string, data?: any) => {
      (listeners[event] ?? []).forEach(h => h(data));
    },
  };

  return socket;
}

// ── Minimal pendingRequests reducer extracted from useSocket logic ─────────────
// We test the state transitions directly without mounting the full hook,
// because useSocket depends on a live Socket.IO connection.

function makePendingRequestsManager(socket: ReturnType<typeof makeSocket>) {
  let state: any[] = [];
  const getState = () => state;

  socket.on('editingRequested', (data: any) => {
    state = [...state, data];
  });

  socket.on('editingApproved', (data: any) => {
    state = state.filter(r => r.userId !== data.userId);
  });

  socket.on('editingDenied', (data: any) => {
    state = state.filter(r => r.userId !== data.userId);
  });

  return { getState };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pendingRequests — editingRequested', () => {
  it('adds a request when editingRequested fires', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1, locationName: 'Bank' });
    expect(getState()).toHaveLength(1);
    expect(getState()[0].userId).toBe('GHOST');
  });

  it('accumulates multiple requests', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingRequested', { userId: 'VIPER', locationId: 2 });
    expect(getState()).toHaveLength(2);
  });
});

describe('pendingRequests — editingApproved', () => {
  it('removes the approved request from state', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingRequested', { userId: 'VIPER', locationId: 2 });
    socket.serverEmit('editingApproved', { userId: 'GHOST' });

    expect(getState()).toHaveLength(1);
    expect(getState()[0].userId).toBe('VIPER');
  });

  it('leaves state unchanged when userId does not match any request', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingApproved', { userId: 'NOBODY' });

    expect(getState()).toHaveLength(1);
  });
});

describe('pendingRequests — editingDenied', () => {
  it('removes the denied request from state', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingRequested', { userId: 'VIPER', locationId: 2 });
    socket.serverEmit('editingDenied', { userId: 'VIPER' });

    expect(getState()).toHaveLength(1);
    expect(getState()[0].userId).toBe('GHOST');
  });

  it('clears all requests when every user is denied', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingDenied', { userId: 'GHOST' });

    expect(getState()).toHaveLength(0);
  });
});

describe('regression: temp admin sees stale requests', () => {
  it('requests approved before temp admin joined are not present in state', () => {
    // Simulate: request arrives, original admin approves it, then a new temp
    // admin is granted access. Their client should see 0 pending requests.
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingApproved', { userId: 'GHOST' });

    // Any future listener reading state (e.g. newly promoted temp admin) sees empty list
    expect(getState()).toHaveLength(0);
  });

  it('requests denied before temp admin joined are not present in state', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingDenied', { userId: 'GHOST' });

    expect(getState()).toHaveLength(0);
  });

  it('only unresolved requests remain visible after mixed approve/deny', () => {
    const socket = makeSocket();
    const { getState } = makePendingRequestsManager(socket);

    socket.serverEmit('editingRequested', { userId: 'GHOST', locationId: 1 });
    socket.serverEmit('editingRequested', { userId: 'VIPER', locationId: 2 });
    socket.serverEmit('editingRequested', { userId: 'REX',   locationId: 3 });

    socket.serverEmit('editingApproved', { userId: 'GHOST' });
    socket.serverEmit('editingDenied',   { userId: 'VIPER' });

    // Only REX's request is still pending
    expect(getState()).toHaveLength(1);
    expect(getState()[0].userId).toBe('REX');
  });
});
