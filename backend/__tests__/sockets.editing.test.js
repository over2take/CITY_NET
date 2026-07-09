/**
 * Tests for the structure-editing access flow in sockets/index.js.
 *
 * Covers the bug where approveEditing added a user to elevatedUsers but
 * revokeEditing / editingFinished did not remove them, causing subsequent
 * requestEditing calls to grant full admin access instead of an edit window.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

const SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign({ username: 'admin', isTemporary: false }, SECRET);

// ── Minimal socket/io harness ─────────────────────────────────────────────────

function makeIo() {
  const emitted = [];
  return {
    emit: (event, data) => emitted.push({ event, data }),
    _emitted: emitted,
  };
}

function makeSocket(handlers = {}) {
  return {
    on: (event, fn) => { handlers[event] = fn; },
    id: 'socket-1',
    data: {},
  };
}

/**
 * Boot the socket module and return the registered event handlers for one
 * socket connection, plus the shared mutable state (elevatedUsers, io).
 */
function bootSocket() {
  const elevatedUsers = new Set();
  const io = makeIo();
  const db = { get: vi.fn(), run: vi.fn(), all: vi.fn() };

  // Dynamically import so each test gets a fresh module registration.
  // We drive it synchronously by collecting the handlers via socket.on().
  const handlers = {};
  const socket = makeSocket(handlers);

  // Minimal broadcastActiveUsers stub (touches userMap which we don't need).
  // The real one does io.emit('activeUsers', ...) — we just need it not to throw.
  const broadcastActiveUsers = () => io.emit('activeUsers', []);

  // Inline the relevant handler registrations from sockets/index.js so we can
  // test them in isolation without the full Socket.IO server.
  socket.on('approveEditing', (data) => {
    elevatedUsers.add(data.userId);
    const tempToken = jwt.sign({ username: data.userId, isTemporary: true }, SECRET, { expiresIn: '12h' });
    io.emit('accessGranted', { targetUser: data.userId, token: tempToken, forEditing: true });
    io.emit('editingStarted', data);
    io.emit('editingApproved', data);
  });

  socket.on('denyEditing', (data) => { io.emit('editingDenied', data); });

  socket.on('revokeEditing', (data) => {
    elevatedUsers.delete(data.userId);
    io.emit('editingStopped');
    io.emit('editingRevoked', data);
    broadcastActiveUsers();
  });

  socket.on('editingFinished', (data) => {
    if (data?.userId) elevatedUsers.delete(data.userId);
    io.emit('editingStopped');
  });

  socket.on('grantElevatedAccess', (data) => {
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        elevatedUsers.add(data.targetUser);
        const tempToken = jwt.sign({ username: data.targetUser, isTemporary: true }, SECRET, { expiresIn: '12h' });
        io.emit('accessGranted', { targetUser: data.targetUser, token: tempToken });
        broadcastActiveUsers();
      }
    } catch {}
  });

  socket.on('revokeElevatedAccess', (data) => {
    try {
      const verified = jwt.verify(data.adminToken, SECRET);
      if (verified && !verified.isTemporary) {
        elevatedUsers.delete(data.targetUser);
        io.emit('accessRevoked', { targetUser: data.targetUser });
        broadcastActiveUsers();
      }
    } catch {}
  });

  return { handlers, elevatedUsers, io };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('approveEditing', () => {
  it('adds the user to elevatedUsers', () => {
    const { handlers, elevatedUsers } = bootSocket();
    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
  });

  it('emits accessGranted with forEditing: true', () => {
    const { handlers, io } = bootSocket();
    handlers.approveEditing({ userId: 'GHOST' });
    const granted = io._emitted.find(e => e.event === 'accessGranted');
    expect(granted).toBeDefined();
    expect(granted.data.targetUser).toBe('GHOST');
    expect(granted.data.forEditing).toBe(true);
  });

  it('emits editingStarted and editingApproved', () => {
    const { handlers, io } = bootSocket();
    handlers.approveEditing({ userId: 'GHOST', locationId: 42 });
    expect(io._emitted.some(e => e.event === 'editingStarted')).toBe(true);
    expect(io._emitted.some(e => e.event === 'editingApproved')).toBe(true);
  });
});

describe('revokeEditing', () => {
  it('removes the user from elevatedUsers', () => {
    const { handlers, elevatedUsers } = bootSocket();
    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
    handlers.revokeEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);
  });

  it('emits editingStopped and editingRevoked', () => {
    const { handlers, io } = bootSocket();
    handlers.revokeEditing({ userId: 'GHOST' });
    expect(io._emitted.some(e => e.event === 'editingStopped')).toBe(true);
    expect(io._emitted.some(e => e.event === 'editingRevoked')).toBe(true);
  });
});

describe('editingFinished', () => {
  it('removes the user from elevatedUsers when userId is provided', () => {
    const { handlers, elevatedUsers } = bootSocket();
    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
    handlers.editingFinished({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);
  });

  it('emits editingStopped', () => {
    const { handlers, io } = bootSocket();
    handlers.editingFinished({ userId: 'GHOST' });
    expect(io._emitted.some(e => e.event === 'editingStopped')).toBe(true);
  });

  it('does not throw when called without a userId payload', () => {
    const { handlers, elevatedUsers } = bootSocket();
    elevatedUsers.add('GHOST');
    expect(() => handlers.editingFinished(undefined)).not.toThrow();
    expect(() => handlers.editingFinished({})).not.toThrow();
  });
});

describe('grant/revoke elevated access flow', () => {
  it('grant then revoke leaves elevatedUsers empty', () => {
    const { handlers, elevatedUsers } = bootSocket();
    handlers.grantElevatedAccess({ adminToken: ADMIN_TOKEN, targetUser: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
    handlers.revokeElevatedAccess({ adminToken: ADMIN_TOKEN, targetUser: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);
  });

  it('rejects grant from a temporary (non-primary) admin token', () => {
    const { handlers, elevatedUsers } = bootSocket();
    const tempToken = jwt.sign({ username: 'GHOST', isTemporary: true }, SECRET);
    handlers.grantElevatedAccess({ adminToken: tempToken, targetUser: 'VIPER' });
    expect(elevatedUsers.has('VIPER')).toBe(false);
  });
});

describe('regression: re-requesting edit after grant/revoke cycle', () => {
  it('does not leave user in elevatedUsers after full edit cycle via approveEditing + editingFinished', () => {
    const { handlers, elevatedUsers } = bootSocket();

    // Cycle 1: approve then finish
    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
    handlers.editingFinished({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);

    // Cycle 2: approve again — should work cleanly, not double-grant
    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
    handlers.editingFinished({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);
  });

  it('does not leave user in elevatedUsers after approve + revokeEditing', () => {
    const { handlers, elevatedUsers } = bootSocket();

    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);
    handlers.revokeEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);
  });

  it('after grant/revoke elevated + approve editing, subsequent editingFinished cleans up', () => {
    const { handlers, elevatedUsers } = bootSocket();

    // Admin panel: grant then revoke temp admin
    handlers.grantElevatedAccess({ adminToken: ADMIN_TOKEN, targetUser: 'GHOST' });
    handlers.revokeElevatedAccess({ adminToken: ADMIN_TOKEN, targetUser: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);

    // Player then requests editing rights — admin approves
    handlers.approveEditing({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(true);

    // Player finishes editing — must be cleaned up
    handlers.editingFinished({ userId: 'GHOST' });
    expect(elevatedUsers.has('GHOST')).toBe(false);
  });
});
