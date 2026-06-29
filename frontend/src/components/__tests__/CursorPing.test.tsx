import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CursorPingListener } from '../CursorPing';
import * as THREE from 'three';

// useThree requires a Canvas context — mock it
vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    raycaster: {
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn(() => [{ point: new THREE.Vector3(1, 2, 3), object: { visible: true } }]),
      ray: { intersectPlane: vi.fn(() => false) },
    },
    camera: {},
    scene: { children: [] },
    pointer: {},
  }),
}));

const makeSocket = () => ({ emit: vi.fn() });

describe('CursorPingListener', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing (returns null)', () => {
    const { container } = render(
      <CursorPingListener socket={makeSocket()} view="list" activeBattleMapData={null} pingColor="#00ff00" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('emits ping_location on Q keydown when socket is present', () => {
    const socket = makeSocket();
    render(<CursorPingListener socket={socket} view="list" activeBattleMapData={null} pingColor="#ff0000" />);
    fireEvent.keyDown(window, { key: 'q' });
    expect(socket.emit).toHaveBeenCalledWith('ping_location', expect.objectContaining({
      color: '#ff0000',
      size: 2,
      battle_map_id: null,
      floor_index: null,
    }));
  });

  it('does not emit when socket is null', () => {
    const socket = makeSocket();
    render(<CursorPingListener socket={null} view="list" activeBattleMapData={null} pingColor="#00ff00" />);
    fireEvent.keyDown(window, { key: 'q' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does not emit when active element is an INPUT', () => {
    const socket = makeSocket();
    render(<CursorPingListener socket={socket} view="list" activeBattleMapData={null} pingColor="#00ff00" />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { key: 'q' });
    expect(socket.emit).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does not emit when active element is a TEXTAREA', () => {
    const socket = makeSocket();
    render(<CursorPingListener socket={socket} view="list" activeBattleMapData={null} pingColor="#00ff00" />);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(window, { key: 'q' });
    expect(socket.emit).not.toHaveBeenCalled();
    document.body.removeChild(ta);
  });

  it('includes battle_map_id and floor_index when in battle_map view', () => {
    const socket = makeSocket();
    render(
      <CursorPingListener
        socket={socket}
        view="battle_map"
        activeBattleMapData={{ locationId: 42, maps: [], currentFloorIndex: 2 }}
        pingColor="#00ff00"
      />
    );
    fireEvent.keyDown(window, { key: 'q' });
    expect(socket.emit).toHaveBeenCalledWith('ping_location', expect.objectContaining({
      battle_map_id: 42,
      floor_index: 2,
    }));
  });

  it('ignores non-Q keys', () => {
    const socket = makeSocket();
    render(<CursorPingListener socket={socket} view="list" activeBattleMapData={null} pingColor="#00ff00" />);
    fireEvent.keyDown(window, { key: 'e' });
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
