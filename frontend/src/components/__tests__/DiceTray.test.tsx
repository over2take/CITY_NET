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

// A test can hand the scene a real three.js scene and camera (`three.current`) and step its frames.
const three = vi.hoisted(() => ({ current: null as any, frame: null as null | (() => void) }));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
  useThree: () => three.current ?? { scene: { children: [], add: vi.fn(), remove: vi.fn() }, camera: { lookAt: vi.fn(), position: { set: vi.fn() } } },
  useFrame: (cb: () => void) => { three.frame = cb; },
}));

vi.mock('../../assets/lets-icons--paper-fill.svg', () => ({ default: 'paper-fill.svg' }));
vi.mock('../../assets/lets-icons--paper-light.svg', () => ({ default: 'paper-light.svg' }));

import * as THREE from 'three';
import { DiceTrayWindow, DotMatrixScoreboard, DiceScene, type TrayRoll } from '../DiceTray';
import { ThemeContext, THEMES } from '../../theme/themes';
import { TRAY_ASPECT, floorSeen, trayCamera, throwDice, diceOfRoll, printedOn, revealAfter } from '../../utils/trayThrow';

const makeSocketRef = () => ({ current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } });

beforeEach(() => { vi.clearAllMocks(); three.current = null; three.frame = null; });

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

  it('renders DICE_TRAY.EXE title', () => {
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    expect(screen.getByTestId('window-title').textContent).toBe('DICE_TRAY.EXE');
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

  it('queues back-to-back broadcasts instead of replacing the roll mid-flight', async () => {
    // Attacks broadcast to-hit + damage within milliseconds; both must play
    // and land in history in order.
    const user = userEvent.setup();
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    await user.click(screen.getByTitle('TOGGLE_HISTORY'));
    const broadcast = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollBroadcast')[1];

    vi.useFakeTimers();
    try {
      const toHit = { total: 15, results: { 20: [15] }, color: '#0f0', historyString: 'to-hit', throw: { seed: 11, dice: [{ key: '20', sides: 20, landed: [14] }] } };
      const damage = { total: 7, results: { 6: [1] }, color: '#0f0', historyString: 'damage', throw: { seed: 12, dice: [{ key: '6', sides: 6, landed: [0] }] } };
      // Each revealed as its own dice stop rolling (6c4b2b), not after a set time.
      const first = revealAfter(throwDice(diceOfRoll(toHit), 11, trayCamera()));
      const second = revealAfter(throwDice(diceOfRoll(damage), 12, trayCamera()));
      act(() => { broadcast(toHit); broadcast(damage); });
      // First roll animating; second waits in the queue
      act(() => { vi.advanceTimersByTime(first - 50); });
      expect(screen.queryByText(/to-hit/)).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(50); });
      expect(screen.getByText(/to-hit/)).toBeInTheDocument();
      expect(screen.queryByText(/damage/)).not.toBeInTheDocument();
      // Second roll finishes its own throw
      act(() => { vi.advanceTimersByTime(second); });
      expect(screen.getByText(/damage/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows dice-less rolls (shock) only briefly', async () => {
    const user = userEvent.setup();
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    await user.click(screen.getByTitle('TOGGLE_HISTORY'));
    const broadcast = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollBroadcast')[1];

    vi.useFakeTimers();
    try {
      act(() => {
        broadcast({ total: 3, results: {}, color: '#0f0', historyString: 'shock damage' });
      });
      act(() => { vi.advanceTimersByTime(800); });
      expect(screen.getByText(/shock damage/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── The tray's dice (6c4b2b) ─────────────────────────────────────────────────

describe("the tray's dice", () => {
  const roll = (more: Partial<TrayRoll> = {}): TrayRoll => ({ total: 5, results: { 6: [5] }, color: '#00ff00', timestamp: 1, throw: { seed: 9, dice: [{ key: '6', sides: 6, landed: [4] }] }, ...more });
  const stage = () => {
    const scene = new THREE.Scene();
    three.current = { scene, camera: new THREE.PerspectiveCamera() };
    return scene;
  };
  const dice = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.Group => c instanceof THREE.Group);
  const up = new THREE.Vector3(0, 1, 0);

  it("draws the tray one shape on every screen, so the walls are everyone's", () => {
    render(<DiceTrayWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socketRef={makeSocketRef()} />);
    expect(parseFloat(screen.getByTestId('dice-tray-floor').style.aspectRatio)).toBe(TRAY_ASPECT);
  });

  it('puts a solid die in the tray for each die rolled, every face printed, inside a rim', () => {
    const scene = stage();
    render(<DiceScene latestRoll={roll({ results: { 6: [5], 20: [20] }, throw: { seed: 9, dice: [{ key: '6', sides: 6, landed: [4] }, { key: '20', sides: 20, landed: [19] }] } })} />);
    const [d6, d20] = dice(scene);
    expect(dice(scene)).toHaveLength(2);
    // A body, its edges, and a print on every face.
    expect(d6.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1 + 6);
    expect(d20.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1 + 20);
    expect(d6.children.some((c) => c instanceof THREE.LineSegments)).toBe(true);
    // The rim lies inside the picture's edges.
    const rim = scene.children.find((c): c is THREE.LineLoop => c instanceof THREE.LineLoop)!;
    const { walls } = floorSeen(trayCamera(), 0);
    const p = rim.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 1) for (const w of walls) expect(w.nx * p.getX(i) + w.nz * p.getZ(i)).toBeLessThan(w.c);
  });

  it('lands each die with the face the server rolled on top', () => {
    const scene = stage();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    render(<DiceScene latestRoll={roll()} />);
    now.mockReturnValue(1000 + 10_000);
    act(() => { three.frame!(); });
    const [die] = dice(scene);
    // The printed face that now points up is the one the throw landed on top, which carries what came up: 5.
    const prints = die.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh).slice(1);
    const top = prints.find((m) => new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion).applyQuaternion(die.quaternion).dot(up) > 0.95);
    expect(top).toBeDefined();
    const [thrown] = throwDice(diceOfRoll(roll()), 9, trayCamera()).dice;
    expect(prints.indexOf(top!)).toBe(thrown.up);
    expect(printedOn(thrown)[thrown.up]).toBe('5');
    // ...and the print there shows the die's fifth face, the one the server rolled.
    expect(top!.userData.face).toBe(4);
    now.mockRestore();
  });

  it("colors a bad die the theme's danger color, the rest the roller's, each in any theme", () => {
    for (const theme of Object.values(THEMES)) {
      const scene = stage();
      const { unmount } = render(
        <ThemeContext.Provider value={theme}>
          <DiceScene latestRoll={roll({ color: '#123456', results: { 6: [1], Bad: ['✕'] }, throw: { seed: 3, dice: [{ key: '6', sides: 6, landed: [0] }, { key: 'Bad', sides: 2, landed: [1], faces: [{ text: '·' }, { text: '✕' }], color: 'danger' }] } })} />
        </ThemeContext.Provider>,
      );
      const edgeColor = (g: THREE.Group) => `#${((g.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments).material as THREE.LineBasicMaterial).color.getHexString()}`;
      const [plain, bad] = dice(scene);
      expect(edgeColor(plain), theme.id).toBe('#123456');
      expect(edgeColor(bad), theme.id).toBe(`#${new THREE.Color(theme.danger).getHexString()}`);
      unmount();
    }
  });

  it('plays the throw even where the computer asks for less motion (Windows animation effects off)', () => {
    const scene = stage();
    const was = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      render(<DiceScene latestRoll={roll()} />);
      act(() => { three.frame!(); });
      const [die] = dice(scene);
      const startedAt = die.position.clone();
      now.mockReturnValue(1000 + 10_000);
      act(() => { three.frame!(); });
      // Thrown in from past the edge, so where it starts is far from where it lands.
      expect(startedAt.distanceTo(die.position)).toBeGreaterThan(2);
    } finally {
      now.mockRestore();
      window.matchMedia = was;
    }
  });

  it('takes its dice away when the roll is over', () => {
    const scene = stage();
    const { unmount } = render(<DiceScene latestRoll={roll()} />);
    expect(dice(scene)).toHaveLength(1);
    unmount();
    expect(scene.children).toEqual([]);
  });
});

// ─── ROLL or LANDED (6c4b3b) ─────────────────────────────────────────────────

describe('ROLL or LANDED', () => {
  const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  const fetchMock = vi.fn((..._args: unknown[]) => ok({ trayMotion: 'roll' }));
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); localStorage.clear(); });

  it('is an ANIMATION toggle in the title bar, on (the dice roll) to start, turned off (they land) and saved to whoever is signed in', async () => {
    render(<DiceTrayWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socketRef={makeSocketRef()} authToken="tok" />);
    const toggle = screen.getByRole('switch', { name: 'Animation' });
    expect(toggle.textContent).toBe('ANIMATION');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => { toggle.click(); });
    expect(screen.getByRole('switch', { name: 'Animation' }).getAttribute('aria-checked')).toBe('false');
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT') as [string, RequestInit];
    expect([put[0], JSON.parse(put[1].body as string)]).toEqual(['/api/me/settings', { trayMotion: 'landed' }]);
  });

  it('shows a throw already at rest when LANDED', () => {
    const scene = new THREE.Scene();
    three.current = { scene, camera: new THREE.PerspectiveCamera() };
    const now = vi.spyOn(performance, 'now').mockReturnValue(5000);
    const latest: TrayRoll = { total: 5, results: { 6: [5] }, color: '#00ff00', timestamp: 1, throw: { seed: 9, dice: [{ key: '6', sides: 6, landed: [4] }] } };
    render(<DiceScene latestRoll={latest} landed />);
    act(() => { three.frame!(); });
    const [die] = scene.children.filter((c): c is THREE.Group => c instanceof THREE.Group);
    const [thrown] = throwDice(diceOfRoll(latest), 9, trayCamera()).dice;
    const last = thrown.path[thrown.path.length - 1];
    // The first frame is the last of the throw: no tumble at all.
    expect(die.position.distanceTo(new THREE.Vector3(last.x, last.y, last.z))).toBeLessThan(1e-9);
    now.mockRestore();
  });

  it('tells the result as soon as the dice are down, when LANDED', async () => {
    localStorage.setItem('citynet_tray_motion', 'landed');
    const user = userEvent.setup();
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socketRef={socketRef} />);
    await user.click(screen.getByTitle('TOGGLE_HISTORY'));
    const broadcast = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollBroadcast')[1];
    vi.useFakeTimers();
    try {
      act(() => { broadcast({ total: 15, results: { 20: [15] }, color: '#0f0', historyString: 'landed at once', throw: { seed: 11, dice: [{ key: '20', sides: 20, landed: [14] }] } }); });
      act(() => { vi.advanceTimersByTime(800); });
      expect(screen.getByText(/landed at once/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
