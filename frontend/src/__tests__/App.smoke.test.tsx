/**
 * App smoke test — verifies the root component mounts without throwing.
 *
 * This catches initialization-order bugs (e.g. useEffect referencing a
 * const declared further down the same function), bad default state, and
 * missing required context providers.
 *
 * It is intentionally shallow: we mock the heavy runtime deps (Three.js,
 * R3F, Socket.IO, SVG assets) and only assert that React doesn't throw
 * during mount.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// ─── Three / R3F ─────────────────────────────────────────────────────────────

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
  useThree: () => ({
    camera: { position: { set: vi.fn() }, lookAt: vi.fn() },
    scene: { add: vi.fn(), remove: vi.fn(), children: [] },
    controls: { enabled: true },
    raycaster: { ray: { intersectPlane: vi.fn() } },
  }),
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  CameraControls: () => null,
  PerspectiveCamera: () => null,
  OrthographicCamera: () => null,
  Grid: () => null,
  TransformControls: () => null,
  Bvh: ({ children }: any) => <>{children}</>,
  Html: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('three', async () => {
  const actual = await vi.importActual('three') as any;
  return { ...actual };
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  }),
}));

// ─── SVG / image assets ───────────────────────────────────────────────────────

vi.mock('../assets/rhombus.svg', () => ({ default: 'rhombus.svg' }));
vi.mock('../assets/terminal-thin.svg', () => ({ default: 'terminal.svg' }));
vi.mock('../assets/oui--eye.svg', () => ({ default: 'eye.svg' }));
vi.mock('../assets/oui--eye-closed.svg', () => ({ default: 'eye-closed.svg' }));
vi.mock('../assets/Credits.svg', () => ({ default: 'credits.svg' }));
vi.mock('../assets/Credits.png', () => ({ default: 'credits.png' }));
vi.mock('../assets/Notification-on.svg', () => ({ default: 'notify-on.svg' }));
vi.mock('../assets/Notification-off.svg', () => ({ default: 'notify-off.svg' }));
vi.mock('../assets/lets-icons--paper-fill.svg', () => ({ default: 'paper-fill.svg' }));
vi.mock('../assets/lets-icons--paper-light.svg', () => ({ default: 'paper-light.svg' }));

// ─── Heavy child components that are render-safe to stub ─────────────────────

vi.mock('../components/Buildings', () => ({
  Building: () => null,
  InstancedBuildings: () => null,
  generateThemedBuildingsForPlot: () => [],
}));

vi.mock('../components/Streamer', () => ({
  SpectatorCameraRig: () => null,
  AdminCameraBroadcaster: () => null,
  SpectatorBattleMapRig: () => null,
  AdminBattleMapBroadcaster: () => null,
  computeBroadcastFraming: () => ({}),
}));

vi.mock('../components/StreamerOverlay', () => ({ StreamerOverlay: () => null }));
vi.mock('../components/StreamerDirectorPanel', () => ({ StreamerDirectorPanel: () => null }));
vi.mock('../components/AdminPanel', () => ({ AdminPanel: () => null }));
vi.mock('../BattleMapManager', () => ({ BattleMapManager: () => null }));
vi.mock('../BattleMapScene', () => ({ BattleMapScene: () => null }));
vi.mock('../PingEffect', () => ({ default: () => null }));

// ─── Global fetch (called in useEffect on mount) ──────────────────────────────

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

import App from '../App';

describe('App smoke test', () => {
  it('mounts without throwing', () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it('renders the sidebar canvas area', () => {
    const { container } = render(<App />);
    expect(container.firstChild).not.toBeNull();
  });
});
