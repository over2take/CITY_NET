import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: new THREE.Vector3(0, 100, 0), lookAt: vi.fn(), fov: 60 },
    controls: {
      enabled: true,
      setOrbitPoint: vi.fn(),
      getTarget: vi.fn((v: THREE.Vector3) => v),
      target: new THREE.Vector3(),
      update: vi.fn(),
    },
    raycaster: { setFromCamera: vi.fn(), intersectObjects: vi.fn(() => []) },
    pointer: new THREE.Vector2(),
    scene: { children: [] },
    size: { width: 800, height: 600 },
  }),
}));

vi.mock('three', async () => {
  const actual = await vi.importActual('three') as any;
  return { ...actual };
});

import { GlobalCameraCapture, CursorPivotControls, CameraController } from '../Camera';

beforeEach(() => vi.clearAllMocks());

// ─── GlobalCameraCapture ──────────────────────────────────────────────────────

describe('GlobalCameraCapture', () => {
  it('renders null (no DOM output)', () => {
    const { container } = render(<GlobalCameraCapture />);
    expect(container.firstChild).toBeNull();
  });

  it('assigns globalCamera on mount', () => {
    delete (window as any).globalCamera;
    render(<GlobalCameraCapture />);
    expect((window as any).globalCamera).toBeDefined();
  });
});

// ─── CursorPivotControls ─────────────────────────────────────────────────────

describe('CursorPivotControls', () => {
  it('renders null (no DOM output)', () => {
    const { container } = render(<CursorPivotControls />);
    expect(container.firstChild).toBeNull();
  });

  it('registers and cleans up pointerdown listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<CursorPivotControls />);
    expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

// ─── CameraController ────────────────────────────────────────────────────────

describe('CameraController', () => {
  it('renders null when target is null', () => {
    const { container } = render(<CameraController target={null} onComplete={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when target is provided', () => {
    const { container } = render(
      <CameraController target={{ pos: [10, 0, 20], size: 5 }} onComplete={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not call onComplete on initial mount without frame tick', () => {
    const onComplete = vi.fn();
    render(<CameraController target={{ pos: [0, 0, 0], size: 10 }} onComplete={onComplete} />);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
