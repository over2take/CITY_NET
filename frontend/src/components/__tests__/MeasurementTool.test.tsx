import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import * as THREE from 'three';

// --- Shared mock for @react-three/fiber ---
const mockRaycaster = {
  setFromCamera: vi.fn(),
  intersectObjects: vi.fn(() => [{ point: new THREE.Vector3(10, 0, 20), object: { visible: true } }]),
  ray: { intersectPlane: vi.fn(() => false) },
};
const mockDomElement = document.createElement('canvas');

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    raycaster: mockRaycaster,
    camera: {},
    scene: { children: [] },
    pointer: {},
    gl: { domElement: mockDomElement },
  }),
}));

// drei Line and Html are Three.js canvas components — stub them out for DOM tests
vi.mock('@react-three/drei', () => ({
  Line: () => null,
  Html: ({ children }: any) => <div data-testid="html-label">{children}</div>,
}));

import { MeasurementTool, MeasurementVisualizer } from '../MeasurementTool';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

const makeSocket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });

beforeEach(() => vi.clearAllMocks());

// ─── MeasurementTool ────────────────────────────────────────────────────────

describe('MeasurementTool', () => {
  it('renders nothing when measureMode is false', () => {
    const { container } = render(
      <MeasurementTool measureMode={false} socket={makeSocket()} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#00ff00" userName="GHOST" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing before a start point is set', () => {
    const { container } = render(
      <MeasurementTool measureMode={true} socket={makeSocket()} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#00ff00" userName="GHOST" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows distance label after pointerdown then pointermove', () => {
    const { getByTestId } = render(
      <MeasurementTool measureMode={true} socket={makeSocket()} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#00ff00" userName="GHOST" />
    );
    // Set raycaster to return two distinct points
    mockRaycaster.intersectObjects
      .mockReturnValueOnce([{ point: new THREE.Vector3(0, 0, 0), object: { visible: true } }])
      .mockReturnValueOnce([{ point: new THREE.Vector3(2, 0, 0), object: { visible: true } }]);

    fireEvent.pointerDown(mockDomElement, { button: 0 });
    fireEvent.pointerMove(mockDomElement);

    // distance = sqrt((2-0)²+(0-0)²) * 5 = 10.0 ft
    expect(getByTestId('html-label').textContent).toBe('10.0 ft');
  });

  it('emits drawMeasurement on pointermove when socket present', () => {
    const socket = makeSocket();
    mockRaycaster.intersectObjects
      .mockReturnValueOnce([{ point: new THREE.Vector3(0, 0, 0), object: { visible: true } }])
      .mockReturnValueOnce([{ point: new THREE.Vector3(3, 0, 0), object: { visible: true } }]);

    render(<MeasurementTool measureMode={true} socket={socket} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#00ff00" userName="GHOST" />);
    fireEvent.pointerDown(mockDomElement, { button: 0 });
    fireEvent.pointerMove(mockDomElement);

    expect(socket.emit).toHaveBeenCalledWith('drawMeasurement', expect.not.objectContaining({ isFinal: true }));
  });

  it('emits final drawMeasurement on pointerup', () => {
    const socket = makeSocket();
    mockRaycaster.intersectObjects
      .mockReturnValueOnce([{ point: new THREE.Vector3(0, 0, 0), object: { visible: true } }])
      .mockReturnValueOnce([{ point: new THREE.Vector3(3, 0, 0), object: { visible: true } }]);

    render(<MeasurementTool measureMode={true} socket={socket} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#00ff00" userName="GHOST" />);
    fireEvent.pointerDown(mockDomElement, { button: 0 });
    fireEvent.pointerMove(mockDomElement);
    fireEvent.pointerUp(window);

    expect(socket.emit).toHaveBeenLastCalledWith('drawMeasurement', expect.objectContaining({ isFinal: true }));
  });

  it('ignores non-left-button pointerdown', () => {
    const { container } = render(
      <MeasurementTool measureMode={true} socket={makeSocket()} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#00ff00" userName="GHOST" />
    );
    mockRaycaster.intersectObjects.mockReturnValue([{ point: new THREE.Vector3(1, 0, 1), object: { visible: true } }]);
    fireEvent.pointerDown(mockDomElement, { button: 2 });
    fireEvent.pointerMove(mockDomElement);
    expect(container.firstChild).toBeNull();
  });

  it('resolves JSON array scale multiplier correctly', () => {
    mockRaycaster.intersectObjects
      .mockReturnValueOnce([{ point: new THREE.Vector3(0, 0, 0), object: { visible: true } }])
      .mockReturnValueOnce([{ point: new THREE.Vector3(1, 0, 0), object: { visible: true } }]);

    const { getByTestId } = render(
      <MeasurementTool
        measureMode={true} socket={makeSocket()} view="battle_map"
        activeBattleMapData={{ locationId: 1, maps: [], currentFloorIndex: 1 }}
        mapScaleMultiplier="[2,10]" color="#fff" userName="GHOST"
      />
    );
    fireEvent.pointerDown(mockDomElement, { button: 0 });
    fireEvent.pointerMove(mockDomElement);
    // floor 1 → scale 10; distance = 1 * 10 = 10.0 ft
    expect(getByTestId('html-label').textContent).toBe('10.0 ft');
  });
});

// ─── MeasurementVisualizer ──────────────────────────────────────────────────

describe('MeasurementVisualizer', () => {
  it('renders nothing with no measurements', () => {
    const socket = makeSocket();
    const { container } = render(
      <MeasurementVisualizer socket={socket} view="list" activeBattleMapData={null} userName="GHOST" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('registers and cleans up measurementUpdated listener', () => {
    const socket = makeSocket();
    const { unmount } = render(
      <MeasurementVisualizer socket={socket} view="list" activeBattleMapData={null} userName="GHOST" />
    );
    expect(socket.on).toHaveBeenCalledWith('measurementUpdated', expect.any(Function));
    unmount();
    expect(socket.off).toHaveBeenCalledWith('measurementUpdated', expect.any(Function));
  });

  it('does not render if socket is null', () => {
    const { container } = render(
      <MeasurementVisualizer socket={null} view="list" activeBattleMapData={null} userName="GHOST" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a measurement label when socket emits measurementUpdated', () => {
    const socket = makeSocket();
    render(<MeasurementVisualizer socket={socket} view="list" activeBattleMapData={null} userName="OTHER" />);

    // Grab the registered handler and call it directly
    const handler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'measurementUpdated')[1];
    act(() => {
      handler({ owner: 'OTHER', view: 'list', start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, color: '#0f0', map_scale_multiplier: '5', isFinal: true });
    });

    // distance = 4 * 5 = 20.0 ft
    expect(document.body.textContent).toContain('20.0 ft');
  });

  it('ignores events from own user that are not final', () => {
    const socket = makeSocket();
    render(<MeasurementVisualizer socket={socket} view="list" activeBattleMapData={null} userName="GHOST" />);
    const handler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'measurementUpdated')[1];
    act(() => {
      handler({ owner: 'GHOST', view: 'list', start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, color: '#0f0', map_scale_multiplier: '5', isFinal: false });
    });
    expect(document.body.textContent).not.toContain('ft');
  });

  it('ignores events from a different view', () => {
    const socket = makeSocket();
    render(<MeasurementVisualizer socket={socket} view="list" activeBattleMapData={null} userName="OTHER" />);
    const handler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'measurementUpdated')[1];
    act(() => {
      handler({ owner: 'OTHER', view: 'battle_map', start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, color: '#0f0', map_scale_multiplier: '5' });
    });
    expect(document.body.textContent).not.toContain('ft');
  });
});

// ─── The running system's unit (3d3) ─────────────────────────────────────────

describe('the ruler in the running system\'s unit', () => {
  const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
  const use = (distance: string) => registerCustomTemplate({
    id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] }, distance,
  });
  beforeEach(() => clearCustomTemplates());
  afterEach(() => clearCustomTemplates());

  /** Your own ruler, 6 squares long on a map at 5 ft a square: its label, or null for none. */
  const measure = (system?: string) => {
    mockRaycaster.intersectObjects
      .mockReturnValueOnce([{ point: new THREE.Vector3(0, 0, 0), object: { visible: true } }])
      .mockReturnValueOnce([{ point: new THREE.Vector3(6, 0, 0), object: { visible: true } }]);
    const { queryByTestId, unmount } = render(
      <MeasurementTool measureMode={true} socket={makeSocket()} view="list" activeBattleMapData={null} mapScaleMultiplier={5} color="#0f0" userName="GHOST" system={system} />,
    );
    fireEvent.pointerDown(mockDomElement, { button: 0 });
    fireEvent.pointerMove(mockDomElement);
    const label = queryByTestId('html-label')?.textContent ?? null;
    unmount();
    return label;
  };

  /** Somebody else's line, 6 squares long on a map at `scale` ft a square, as this browser shows it. */
  const theirs = (system?: string, scale = '5') => {
    const socket = makeSocket();
    const { container, unmount } = render(<MeasurementVisualizer socket={socket} view="list" activeBattleMapData={null} userName="GHOST" system={system} />);
    const handler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'measurementUpdated')[1];
    act(() => handler({ owner: 'OTHER', view: 'list', start: { x: 0, z: 0 }, end: { x: 6, z: 0 }, color: '#0f0', map_scale_multiplier: scale, isFinal: true }));
    const label = container.querySelector('[data-testid="html-label"]')?.textContent ?? null;
    unmount();
    return label;
  };

  it('reads feet, as always, in every built-in system', () => {
    for (const system of [undefined, 'cities_without_number', 'generic']) {
      expect(measure(system), String(system)).toBe('30.0 ft');
      expect(theirs(system), String(system)).toBe('30.0 ft');
    }
  });

  it('reads a custom system\'s own unit, the same for your line and everyone else\'s', () => {
    for (const [unit, reads] of [['meters', '9.1 m'], ['yards', '10.0 yd'], ['squares', '6.0 sq'], ['hexes', '6.0 hex'], ['feet', '30.0 ft']]) {
      use(unit);
      expect(measure(HEARTH), unit).toBe(reads);
      expect(theirs(HEARTH), unit).toBe(reads);
    }
  });

  it('still follows each map\'s own scale, floor by floor, converting feet but counting squares', () => {
    const onFloor = (system: string, distance: string) => {
      use(distance);
      mockRaycaster.intersectObjects
        .mockReturnValueOnce([{ point: new THREE.Vector3(0, 0, 0), object: { visible: true } }])
        .mockReturnValueOnce([{ point: new THREE.Vector3(6, 0, 0), object: { visible: true } }]);
      const { getByTestId, unmount } = render(
        <MeasurementTool measureMode={true} socket={makeSocket()} view="battle_map"
          activeBattleMapData={{ locationId: 1, maps: [], currentFloorIndex: 1 }}
          mapScaleMultiplier="[2,10]" color="#0f0" userName="GHOST" system={system} />,
      );
      fireEvent.pointerDown(mockDomElement, { button: 0 });
      fireEvent.pointerMove(mockDomElement);
      const label = getByTestId('html-label').textContent;
      unmount();
      return label;
    };
    // Floor 1 of this map is 10 ft a square: 6 squares is 60 ft.
    expect(onFloor(HEARTH, 'feet')).toBe('60.0 ft');
    expect(onFloor(HEARTH, 'meters')).toBe('18.3 m');
    expect(onFloor(HEARTH, 'squares')).toBe('6.0 sq');
    // And somebody else's line on that map, at the scale it was drawn with.
    use('meters');
    expect(theirs(HEARTH, '10')).toBe('18.3 m');
    expect(theirs('cities_without_number', '10')).toBe('60.0 ft');
  });

  it('draws the line with no number in zones', () => {
    use('zones');
    expect(measure(HEARTH)).toBeNull();
    expect(theirs(HEARTH)).toBeNull();
  });
});
