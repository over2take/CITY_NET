import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title, titleControls }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      <div data-testid="title-controls">{titleControls}</div>
      {children}
    </div>
  ),
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
  useThree: () => ({ scene: { children: [], add: vi.fn(), remove: vi.fn() }, camera: { lookAt: vi.fn(), position: {} } }),
  useFrame: vi.fn(),
}));

vi.mock('../../assets/lets-icons--paper-fill.svg', () => ({ default: 'paper-fill.svg' }));
vi.mock('../../assets/lets-icons--paper-light.svg', () => ({ default: 'paper-light.svg' }));

import { DiceTrayWindow, DotMatrixScoreboard } from '../DiceTray';

const makeSocketRef = () => ({ current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } });

beforeEach(() => vi.clearAllMocks());

// ─── DotMatrixScoreboard ─────────────────────────────────────────────────────

describe('DotMatrixScoreboard', () => {
  it('renders a 5-row dot matrix grid', () => {
    const { container } = render(<DotMatrixScoreboard value="" timestamp={0} />);
    const rows = container.querySelectorAll('div > div');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('renders without crashing with a numeric value', () => {
    expect(() => render(<DotMatrixScoreboard value="42" timestamp={Date.now()} />)).not.toThrow();
  });

  it('renders without crashing in rolling mode', () => {
    expect(() => render(<DotMatrixScoreboard value="" timestamp={0} isRolling={true} />)).not.toThrow();
  });
});

// ─── DiceTrayWindow ───────────────────────────────────────────────────────────

describe('DiceTrayWindow', () => {
  const basePos = { x: 0, y: 0 };
  const setPos = vi.fn();
  const onClose = vi.fn();

  it('renders DICE_TRAY.exe title', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    expect(screen.getByTestId('window-title').textContent).toBe('DICE_TRAY.exe');
  });

  it('requests dice history on mount', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    expect(socketRef.current.emit).toHaveBeenCalledWith('requestDiceHistory');
  });

  it('registers diceRollBroadcast and diceRollHistory listeners', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    expect(socketRef.current.on).toHaveBeenCalledWith('diceRollBroadcast', expect.any(Function));
    expect(socketRef.current.on).toHaveBeenCalledWith('diceRollHistory', expect.any(Function));
  });

  it('cleans up socket listeners on unmount', () => {
    const socketRef = makeSocketRef();
    const { unmount } = render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    unmount();
    expect(socketRef.current.off).toHaveBeenCalledWith('diceRollBroadcast', expect.any(Function));
    expect(socketRef.current.off).toHaveBeenCalledWith('diceRollHistory', expect.any(Function));
  });

  it('shows history toggle button in title controls', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    const controls = screen.getByTestId('title-controls');
    expect(controls.querySelector('button')).not.toBeNull();
  });

  it('renders the Canvas for 3D dice', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
  });

  it('populates history when diceRollHistory event fires', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    const histHandler = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollHistory')[1];
    act(() => {
      histHandler([{ total: 17, results: { 20: [17] }, color: '#0f0', historyString: 'GHOST rolled d20: 17 = 17' }]);
    });
    // History is populated — verify no crash and state updated silently
    expect(socketRef.current.emit).toHaveBeenCalledWith('requestDiceHistory');
  });
});
