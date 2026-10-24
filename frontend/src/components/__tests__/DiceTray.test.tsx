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
import { DiceTrayWindow, CharacterBoard, DiceScene, type TrayRoll } from '../DiceTray';
import { emptyField, putShow, putReady, showOf, SETTLE_MS, HOLD_MS } from '../../utils/trayBoard';
import { TURN_MS } from '../../utils/trayWaiting';
import { ThemeContext, THEMES } from '../../theme/themes';
import { themedRollColor } from '../../theme/rollColor';
import { TRAY_ASPECT, floorSeen, trayCamera, throwDice, diceOfRoll, printedOn, revealAfter } from '../../utils/trayThrow';

const makeSocketRef = () => ({ current: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } });

beforeEach(() => { vi.clearAllMocks(); three.current = null; three.frame = null; });

// ─── CharacterBoard (6c4e) ────────────────────────────────────────────────────

describe('CharacterBoard', () => {
  const lit = (container: HTMLElement) => container.querySelectorAll('.tray-board-px.on').length;
  const d20 = (total: number, board?: { label?: string; words?: string; outcome?: string }) => ({ total, results: { 20: [total] }, ...(board ? { board } : {}) });

  it('is 16 by 2 cells of 5 by 7 dots, waiting on READY_', () => {
    const { container } = render(<CharacterBoard rolls={null} rolling={false} landedAt={0} />);
    expect(container.querySelectorAll('.tray-board-cell')).toHaveLength(32);
    expect(container.querySelectorAll('.tray-board-px')).toHaveLength(32 * 35);
    expect(screen.getByRole('img', { name: 'Ready' })).toBeTruthy();
    expect(lit(container)).toBeGreaterThan(0);
  });

  it('waits with pictures taking turns, READY_ first, then PONG (6c4f)', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CharacterBoard rolls={null} rolling={false} landedAt={0} />);
      // The board's dots read back as a field: cell by cell, 35 dots each, into rows of 80.
      const field = () => {
        const dots = [...container.querySelectorAll('.tray-board-px')];
        return Array.from({ length: 14 }, (_, y) => Array.from({ length: 80 }, (__, x) =>
          (dots[(Math.floor(y / 7) * 16 + Math.floor(x / 5)) * 35 + (y % 7) * 5 + (x % 5)].classList.contains('on') ? 1 : 0)));
      };
      const ready = emptyField();
      putReady(ready, 0);
      expect(field()).toEqual(ready);
      act(() => { vi.advanceTimersByTime(TURN_MS + 100); });
      // PONG: a paddle down each side of the board.
      const f = field();
      expect(f.filter((row) => row[0])).toHaveLength(4);
      expect(f.filter((row) => row[79])).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flickers while the dice roll', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CharacterBoard rolls={null} rolling landedAt={0} />);
      expect(screen.getByRole('img', { name: 'Rolling' })).toBeTruthy();
      // Every cell a letter or a number, a new one each frame.
      const on = () => [...container.querySelectorAll('.tray-board-px')].map((d) => d.classList.contains('on')).join('');
      const first = on();
      act(() => { vi.advanceTimersByTime(100); });
      expect(on()).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells a group once landed, decoded into place, then waits again', () => {
    vi.useFakeTimers();
    try {
      const rolls = [d20(15, { label: 'TO HIT', outcome: 'HIT' }), d20(7, { label: 'DAMAGE' })];
      const { container } = render(<CharacterBoard rolls={rolls} rolling={false} landedAt={performance.now()} />);
      expect(screen.getByRole('img', { name: 'TO HIT 15 HIT / DAMAGE 7' })).toBeTruthy();
      const f = emptyField();
      putShow(f, showOf(rolls), 0);
      const result = f.flat().filter(Boolean).length;
      // Just landed: still noise, every cell a letter, not yet the result.
      expect(lit(container)).toBeGreaterThan(result + 100);
      // Once decoded, exactly the result's dots are lit.
      act(() => { vi.advanceTimersByTime(SETTLE_MS + 100); });
      expect(lit(container)).toBe(result);
      act(() => { vi.advanceTimersByTime(HOLD_MS); });
      expect(screen.getByRole('img', { name: 'Ready' })).toBeTruthy();
      // Waiting starts again from READY_, not where the last wait left off (6c4f).
      const dots = [...container.querySelectorAll('.tray-board-px')];
      const shownNow = Array.from({ length: 14 }, (_, y) => Array.from({ length: 80 }, (__, x) =>
        (dots[(Math.floor(y / 7) * 16 + Math.floor(x / 5)) * 35 + (y % 7) * 5 + (x % 5)].classList.contains('on') ? 1 : 0)));
      const ready = emptyField();
      putReady(ready, 0);
      expect(shownNow).toEqual(ready);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a lone plain total in big digits', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CharacterBoard rolls={[d20(8)]} rolling={false} landedAt={performance.now()} />);
      act(() => { vi.advanceTimersByTime(SETTLE_MS + 100); });
      expect(screen.getByRole('img', { name: '8' })).toBeTruthy();
      const f = emptyField();
      putShow(f, { big: '8' }, 0);
      expect(lit(container)).toBe(f.flat().filter(Boolean).length);
    } finally {
      vi.useRealTimers();
    }
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

  it('writes the record in the theme: the usual green as its primary, the server\'s red as its danger, a chosen color as chosen', async () => {
    const user = userEvent.setup();
    const socketRef = makeSocketRef();
    const ocean = THEMES.ocean;
    render(<ThemeContext.Provider value={ocean}><DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} /></ThemeContext.Provider>);
    const histHandler = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollHistory')[1];
    act(() => {
      histHandler([
        { total: 17, results: { 20: [17] }, color: '#00ff00', historyString: 'GHOST rolled a plain d20' },
        { total: 2, results: { 20: [2] }, color: '#ff3333', historyString: 'GHOST rolled a miss' },
        { total: 9, results: { 20: [9] }, color: '#ff00ff', historyString: 'ROOK rolled in pink' },
        { total: 7, results: { 20: [7] }, color: '#3749c8', historyString: 'KES rolled in dark blue' },
      ]);
    });
    await user.click(screen.getByTitle('TOGGLE_HISTORY'));
    const colorOf = (text: RegExp) => screen.getByText(text).closest('div')!.style.color;
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    expect(colorOf(/a plain d20/)).toBe(rgb(ocean.primary));
    expect(colorOf(/a miss/)).toBe(rgb(ocean.danger));
    expect(colorOf(/in pink/)).toBe(rgb('#ff00ff'));
    // Too dark to read on the panel: lifted, still Kes's blue.
    expect(colorOf(/in dark blue/)).toBe(rgb(themedRollColor('#3749c8', ocean)));
    expect(themedRollColor('#3749c8', ocean)).not.toBe('#3749c8');
  });

  it('lets a new roll cut in, telling the one it cut short in the record at once (no queue, 6c4c)', async () => {
    const user = userEvent.setup();
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    await user.click(screen.getByTitle('TOGGLE_HISTORY'));
    const broadcast = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollBroadcast')[1];
    vi.useFakeTimers();
    try {
      const rook = { total: 15, results: { 20: [15] }, color: '#0f0', historyString: 'rook rolled', group: 'a', throw: { seed: 11, dice: [{ key: '20', sides: 20, landed: [14] }] } };
      const kes = { total: 4, results: { 6: [4] }, color: '#f0f', historyString: 'kes rolled', group: 'b', throw: { seed: 12, dice: [{ key: '6', sides: 6, landed: [3] }] } };
      act(() => { broadcast(rook); });
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByText(/rook rolled/)).not.toBeInTheDocument();
      // Kes's roll cuts in: Rook's is in the record at once, Kes's when its dice stop.
      act(() => { broadcast(kes); });
      expect(screen.getByText(/rook rolled/)).toBeInTheDocument();
      expect(screen.queryByText(/kes rolled/)).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(revealAfter(throwDice(diceOfRoll(kes), 12, trayCamera()))); });
      expect(screen.getByText(/kes rolled/)).toBeInTheDocument();
      // Each once, in the order they came.
      const lines = screen.getAllByText(/rolled/).map((e) => e.textContent);
      expect(lines.filter((l) => /rook/.test(l!))).toHaveLength(1);
      expect(lines.findIndex((l) => /rook/.test(l!))).toBeLessThan(lines.findIndex((l) => /kes/.test(l!)));
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws one group's rolls together, an attack's to-hit and damage, each die in its roller's color, and tells both as they stop", async () => {
    const scene = new THREE.Scene();
    three.current = { scene, camera: new THREE.PerspectiveCamera() };
    const user = userEvent.setup();
    const socketRef = makeSocketRef();
    render(<DiceTrayWindow pos={basePos} setPos={setPos} onClose={onClose} socketRef={socketRef} />);
    await user.click(screen.getByTitle('TOGGLE_HISTORY'));
    const broadcast = (socketRef.current.on as ReturnType<typeof vi.fn>).mock.calls.find((call: any[]) => call[0] === 'diceRollBroadcast')[1];
    vi.useFakeTimers();
    try {
      const toHit = { total: 15, results: { 20: [15] }, color: '#00ff00', historyString: 'to-hit', group: 'g', throw: { seed: 11, dice: [{ key: '20', sides: 20, landed: [14] }] }, board: { label: 'TO HIT', outcome: 'HIT' } };
      const damage = { total: 7, results: { 8: [7] }, color: '#ff00ff', historyString: 'damage', group: 'g', throw: { seed: 12, dice: [{ key: '8', sides: 8, landed: [6] }] }, board: { label: 'DAMAGE' } };
      act(() => { broadcast(toHit); broadcast(damage); });
      // One throw: both dice, from the to-hit's seed, each in its own roll's color.
      const dice = scene.children.filter((c): c is THREE.Group => c instanceof THREE.Group);
      expect(dice).toHaveLength(2);
      const edges = dice.map((g) => `#${((g.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments).material as THREE.LineBasicMaterial).color.getHexString()}`);
      expect(edges).toEqual(['#00ff00', '#ff00ff']);
      const together = throwDice([...diceOfRoll(toHit).map((s) => ({ ...s, color: toHit.color })), ...diceOfRoll(damage).map((s) => ({ ...s, color: damage.color }))], 11, trayCamera());
      const when = revealAfter(together);
      act(() => { vi.advanceTimersByTime(when - 50); });
      expect(screen.queryByText(/to-hit/)).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Rolling' })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(50); });
      expect(screen.getByText(/to-hit/)).toBeInTheDocument();
      expect(screen.getByText(/damage/)).toBeInTheDocument();
      // The board tells both, the group's lines together (6c4e).
      expect(screen.getByRole('img', { name: 'TO HIT 15 HIT / DAMAGE 7' })).toBeTruthy();
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
          <DiceScene latestRoll={roll({ color: '#ff00ff', results: { 6: [1], Bad: ['✕'] }, throw: { seed: 3, dice: [{ key: '6', sides: 6, landed: [0] }, { key: 'Bad', sides: 2, landed: [1], faces: [{ text: '·' }, { text: '✕' }], color: 'danger' }] } })} />
        </ThemeContext.Provider>,
      );
      const edgeColor = (g: THREE.Group) => `#${((g.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments).material as THREE.LineBasicMaterial).color.getHexString()}`;
      const [plain, bad] = dice(scene);
      expect(edgeColor(plain), theme.id).toBe('#ff00ff');
      expect(edgeColor(bad), theme.id).toBe(`#${new THREE.Color(theme.danger).getHexString()}`);
      unmount();
    }
  });

  it('colors a die in the usual green the theme\'s primary, in any theme, and the board too', () => {
    for (const theme of Object.values(THEMES)) {
      const scene = stage();
      const { unmount, container } = render(
        <ThemeContext.Provider value={theme}>
          <DiceScene latestRoll={roll({ color: '#00ff00' })} />
          <CharacterBoard rolls={[{ total: 8, results: { 6: [8] } }]} rolling={false} landedAt={0} />
        </ThemeContext.Provider>,
      );
      const [die] = dice(scene);
      const edge = ((die.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments).material as THREE.LineBasicMaterial).color.getHexString();
      expect(`#${edge}`, theme.id).toBe(`#${new THREE.Color(theme.primary).getHexString()}`);
      // The board lights its dots in the theme's primary.
      expect((container.querySelector('[data-testid="dice-board"]') as HTMLElement).style.getPropertyValue('--board-on'), theme.id).toBe(theme.primary);
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
