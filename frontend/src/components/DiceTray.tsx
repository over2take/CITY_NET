import React, { useState, useEffect, useRef, useContext } from 'react';
import { Canvas } from '@react-three/fiber';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DraggableWindow } from './DraggableWindow';
import { ThemeContext } from '../theme/themes';
import { themedRollColor } from '../theme/rollColor';
import paperFillIcon from '../assets/lets-icons--paper-fill.svg';
import paperLightIcon from '../assets/lets-icons--paper-light.svg';
import type { DiceRoll } from '../types';
import { diceOfRoll, throwDice, revealAfter, MOST_DICE, poseAt, printOrder, floorSeen, trayCamera, TRAY_VIEW, TRAY_ASPECT, type Throw, type RollThrow } from '../utils/trayThrow';
import { labelTurn } from '../utils/diceShapes';
import { labelParts, labelKey, paintLabel } from '../utils/dieLabels';
import { useTrayMotion } from '../hooks/useTrayMotion';

// ─── DOT_MATRIX_3x5 ──────────────────────────────────────────────────────────

const DOT_MATRIX_3x5: Record<string, number[][]> = {
  '0': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
  '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
  '2': [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
  '3': [[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]],
  '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
  '5': [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
  '6': [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
  '7': [[1,1,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1]],
  '8': [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
  '9': [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
  '-': [[0,0,0],[0,0,0],[1,1,1],[0,0,0],[0,0,0]],
  ' ': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
};

// ─── DotMatrixScoreboard ─────────────────────────────────────────────────────

interface DotMatrixScoreboardProps {
  value: string;
  timestamp: number;
  isRolling?: boolean;
}

export function DotMatrixScoreboard({ value, timestamp, isRolling }: DotMatrixScoreboardProps) {
  const theme = useContext(ThemeContext);
  const cols = 25;
  const rows = 5;
  const [idleMode, setIdleMode] = useState(!value && !isRolling);
  const [animFrame, setAnimFrame] = useState(0);
  const [animType, setAnimType] = useState('matrix');

  useEffect(() => {
    const pickRandomAnim = (current: string) => {
      const types = ['matrix', 'pingpong', 'sinewave', 'scanner'];
      const others = types.filter(t => t !== current);
      return others[Math.floor(Math.random() * others.length)];
    };

    if (!value && !isRolling) {
      setIdleMode(true);
      setAnimType(t => pickRandomAnim(''));
      return;
    }

    setIdleMode(false);
    if (isRolling) return;

    const timer = setTimeout(() => {
      setAnimType(t => pickRandomAnim(t));
      setIdleMode(true);
    }, 10000);

    return () => clearTimeout(timer);
  }, [value, timestamp, isRolling]);

  useEffect(() => {
    if (!idleMode && !isRolling) return;
    const interval = setInterval(() => setAnimFrame(f => f + 1), 100);
    return () => clearInterval(interval);
  }, [idleMode, isRolling]);

  let grid = Array.from({ length: rows }, () => Array(cols).fill(0));

  if (isRolling) {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        grid[r][c] = Math.random() > 0.8 ? 1 : Math.random() > 0.8 ? 2 : 0;
  } else if (idleMode || !value) {
    if (animType === 'matrix') {
      for (let c = 0; c < cols; c++) {
        const dropSpeed = (c % 3) + 1;
        const y = (Math.floor(animFrame / dropSpeed) + (c * 7)) % (rows + 4) - 2;
        for (let r = 0; r < rows; r++) {
          if (r === y) grid[r][c] = 1;
          else if (r === y - 1) grid[r][c] = 2;
          else if (r === y - 2) grid[r][c] = 3;
        }
      }
    } else if (animType === 'pingpong') {
      const cycleX = (cols - 1) * 2;
      const cycleY = (rows - 1) * 2;
      let bx = animFrame % cycleX; if (bx >= cols) bx = cycleX - bx;
      let by = Math.floor(animFrame * 0.7) % cycleY; if (by >= rows) by = cycleY - by;
      grid[by][bx] = 1;
      const p1y = Math.min(Math.max(by, 1), rows - 2);
      grid[p1y - 1][0] = 2; grid[p1y][0] = 1; grid[p1y + 1][0] = 2;
      const p2y = Math.min(Math.max(by, 1), rows - 2);
      grid[p2y - 1][cols - 1] = 2; grid[p2y][cols - 1] = 1; grid[p2y + 1][cols - 1] = 2;
    } else if (animType === 'sinewave') {
      for (let c = 0; c < cols; c++) {
        const y = Math.floor((Math.sin((c + animFrame) * 0.5) + 1) * (rows - 1) / 2);
        grid[y][c] = 1;
        if (y + 1 < rows) grid[y + 1][c] = 2;
        if (y - 1 >= 0) grid[y - 1][c] = 2;
      }
    } else if (animType === 'scanner') {
      const cycle = (cols - 1) * 2;
      let pos = animFrame % cycle;
      if (pos >= cols) pos = cycle - pos;
      for (let r = 0; r < rows; r++) {
        grid[r][pos] = 1;
        if (pos - 1 >= 0) grid[r][pos - 1] = 2;
        if (pos - 2 >= 0) grid[r][pos - 2] = 3;
        if (pos + 1 < cols) grid[r][pos + 1] = 2;
        if (pos + 2 < cols) grid[r][pos + 2] = 3;
      }
    }
  } else {
    const valStr = value.toString();
    const totalWidth = valStr.length * 4 - 1;
    let currentCol = Math.floor((cols - totalWidth) / 2) + totalWidth - 1;
    for (let i = valStr.length - 1; i >= 0; i--) {
      const char = valStr[i];
      const charMatrix = DOT_MATRIX_3x5[char] || DOT_MATRIX_3x5[' '];
      for (let r = 0; r < rows; r++) {
        for (let c = 2; c >= 0; c--) {
          const targetCol = currentCol - (2 - c);
          if (targetCol >= 0 && targetCol < cols) grid[r][targetCol] = charMatrix[r][c];
        }
      }
      currentCol -= 4;
      if (currentCol < 0) break;
    }
  }

  const getColor = (val: number) => {
    const p = theme.primary;
    if (val === 1) return { bg: p, shadow: `0 0 5px ${p}, 0 0 10px ${p}` };
    if (val === 2) return { bg: `${p}80`, shadow: `0 0 2px ${p}` };
    if (val === 3) return { bg: `${p}33`, shadow: 'none' };
    return { bg: `${p}0d`, shadow: 'none' };
  };

  return (
    <div data-testid="dice-board" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
      {grid.map((row, rIdx) => (
        <div key={rIdx} style={{ display: 'flex', gap: '4px' }}>
          {row.map((val, cIdx) => {
            const style = getColor(val);
            return (
              <div key={cIdx} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: style.bg, boxShadow: style.shadow, transition: 'background-color 0.1s, box-shadow 0.1s' }} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── DiceScene ───────────────────────────────────────────────────────────────

/** A roll as the tray plays it: the server's dice and its throw (6c4b1), and who rolled's color. */
export interface TrayRoll {
  total: number;
  results: Record<string, unknown>;
  diceSides?: Record<string, number>;
  throw?: RollThrow;
  /** The throw worked out (utils/trayThrow), once, when the roll came: the window reveals as it ends. */
  thrown?: Throw;
  color: string;
  timestamp: number;
}

interface DiceSceneProps {
  latestRoll: TrayRoll | null;
  /** LANDED (6c4b3b): each throw shown already at rest. Read as a throw starts, so flipping it never replays one. */
  landed?: boolean;
}

/**
 * The tray's dice (6c4b2b; approved mockup docs/mockups/builder-dice.html): solid, every face
 * printed, thrown by physics from the server's seed with the faces it rolled on top (utils/trayThrow),
 * inside a rim drawn where the walls are. A die takes the roller's color, or the theme's danger
 * color for a bad die; its body is that color sunk toward the theme's background.
 */
export function DiceScene({ latestRoll, landed = false }: DiceSceneProps) {
  const { scene, camera } = useThree();
  const landedNow = useRef(landed);
  useEffect(() => { landedNow.current = landed; }, [landed]);
  const theme = useContext(ThemeContext);
  const playing = useRef<{ thrown: Throw; groups: THREE.Group[]; start: number } | null>(null);

  useEffect(() => {
    camera.position.set(...TRAY_VIEW.position);
    camera.lookAt(...TRAY_VIEW.target);
  }, [camera]);

  // The rim of the tray, just inside the edges of the picture, where the walls keep the dice.
  useEffect(() => {
    const { corners, mid } = floorSeen(trayCamera(), 0);
    const points = corners.map((p) => {
      const toMid = new THREE.Vector2(mid.x - p.x, mid.z - p.z).normalize().multiplyScalar(0.25);
      return new THREE.Vector3(p.x + toMid.x, 0, p.z + toMid.y);
    });
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: theme.primary, transparent: true, opacity: 0.45 }));
    scene.add(rim);
    return () => { scene.remove(rim); rim.geometry.dispose(); (rim.material as THREE.Material).dispose(); };
  }, [scene, theme.primary]);

  useEffect(() => {
    if (!latestRoll) return undefined;
    const thrown = latestRoll.thrown ?? throwDice(diceOfRoll(latestRoll), latestRoll.throw?.seed ?? 1, trayCamera());
    const symbols = new Map((latestRoll.throw?.symbols ?? []).map((s) => [s.id, s]));
    const textures = new Map<string, THREE.CanvasTexture>();
    const owned: { dispose: () => void }[] = [];
    const ground = new THREE.Color(theme.background);
    const groups = thrown.dice.map((die) => {
      const tone = new THREE.Color(die.spec.danger ? theme.danger : themedRollColor(die.spec.color ?? latestRoll.color, theme));
      const group = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({ color: tone.clone().lerp(ground, 0.82), emissive: tone.clone().multiplyScalar(0.05), roughness: 0.55, metalness: 0.15, flatShading: true });
      const edges = new THREE.EdgesGeometry(die.shape.geometry, 12);
      const edgeLine = new THREE.LineBasicMaterial({ color: tone });
      owned.push(die.shape.geometry, body, edges, edgeLine);
      group.add(new THREE.Mesh(die.shape.geometry, body), new THREE.LineSegments(edges, edgeLine));
      // Every face printed: what came up on the face that lands on top, the die's others round it.
      const order = printOrder(die);
      const plane = new THREE.PlaneGeometry(die.shape.label, die.shape.label);
      owned.push(plane);
      die.shape.faces.forEach((spot, k) => {
        const i = order[k];
        if (i < 0) return;
        const parts = labelParts(die.spec.faces?.[i] ?? { text: die.spec.texts[i] ?? '' }, symbols);
        if (!parts.length) return;
        const color = `#${tone.getHexString()}`;
        const key = labelKey(parts, color);
        let texture = textures.get(key);
        if (!texture) {
          const canvas = document.createElement('canvas');
          texture = new THREE.CanvasTexture(canvas);
          const made = texture;
          paintLabel(canvas, parts, color, () => { made.needsUpdate = true; });
          texture.anisotropy = 4;
          textures.set(key, texture);
        }
        const label = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
        owned.push(label);
        const print = new THREE.Mesh(plane, label);
        print.userData.face = i; // which of the die's own faces it shows
        // The top face's words turned on it to read from the camera.
        print.quaternion.copy(labelTurn(spot.normal));
        if (k === die.up && die.twist) print.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), die.twist));
        print.position.copy(spot.center).addScaledVector(spot.normal, 0.012);
        group.add(print);
      });
      group.scale.setScalar(die.scale);
      const pose = poseAt(die, 0);
      group.position.copy(pose.position);
      group.quaternion.copy(pose.quaternion);
      scene.add(group);
      return group;
    });
    // Every throw is played, whatever the computer's own motion setting: the throw is the tray.
    playing.current = { thrown, groups, start: performance.now() - (landedNow.current ? 1e7 : 0) };
    return () => {
      playing.current = null;
      for (const g of groups) scene.remove(g);
      for (const o of owned) o.dispose();
      for (const t of textures.values()) t.dispose();
    };
  }, [latestRoll, scene, theme.background, theme.danger]);

  useFrame(() => {
    const p = playing.current;
    if (!p) return;
    const seconds = (performance.now() - p.start) / 1000;
    p.thrown.dice.forEach((die, i) => {
      const pose = poseAt(die, seconds);
      p.groups[i].position.copy(pose.position);
      p.groups[i].quaternion.copy(pose.quaternion);
    });
  });

  return null;
}

// ─── DiceTrayWindow ───────────────────────────────────────────────────────────

/** A roll as the server sends it to the tray (diceRollBroadcast). */
interface RollBroadcast {
  total: number;
  results: Record<string, unknown>;
  diceSides?: Record<string, number>;
  throw?: RollThrow;
  /** Rolls of one group land in one throw (6c4c, utils/diceThrow.js on the server). */
  group?: string;
  color: string;
  historyString: string;
  glitch?: boolean;
  criticalGlitch?: boolean;
}

interface DiceTrayWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socketRef: React.MutableRefObject<any>;
  /** Whoever is signed in, GM or player: their ROLL or LANDED is kept on their account (6c4b3b). */
  authToken?: string | null;
}

export function DiceTrayWindow({ pos, setPos, onClose, socketRef, authToken }: DiceTrayWindowProps) {
  const theme = useContext(ThemeContext);
  const [motion, setMotion] = useTrayMotion(authToken);
  // Read when a roll arrives, inside the socket handlers set up once.
  const motionNow = useRef(motion);
  useEffect(() => { motionNow.current = motion; }, [motion]);
  const [history, setHistory] = useState<DiceRoll[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [latestRoll, setLatestRoll] = useState<TrayRoll | null>(null);
  const [displayRoll, setDisplayRoll] = useState<TrayRoll | null>(null);
  const [glitchState, setGlitchState] = useState<'none' | 'glitch' | 'critical'> ('none');
  const [isRolling, setIsRolling] = useState(false);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  // No queue (6c4c): a new roll cuts straight in, and the one it cut short goes into the record at
  // once. Rolls the server puts in one group (one person's within a moment, as an attack's to-hit
  // and damage) land in one throw together. Dice-less rolls (shock damage) show briefly.
  const playing = useRef<{ group?: string; rolls: RollBroadcast[]; told: boolean } | null>(null);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('requestDiceHistory');

    /** Rolls into the record, in the order they came. */
    const record = (rolls: RollBroadcast[]) => setHistory(prev => {
      setTimeout(() => { if (historyContainerRef.current) historyContainerRef.current.scrollTop = historyContainerRef.current.scrollHeight; }, 50);
      return [...prev, ...(rolls as unknown as DiceRoll[])];
    });

    /** Throw a group's dice, all its rolls' together, from its first roll's seed; tell its result as they stop. */
    const play = (group: { rolls: RollBroadcast[]; told: boolean }) => {
      if (rollTimer.current) clearTimeout(rollTimer.current);
      const first = group.rolls[0];
      const last = group.rolls[group.rolls.length - 1];
      // Worked out now, so the total is revealed as the last die stops, not after a set time.
      const specs = group.rolls.flatMap((r) => (r.results && Object.keys(r.results).length ? diceOfRoll(r).map((s) => ({ ...s, color: r.color })) : [])).slice(0, MOST_DICE);
      const thrown = specs.length ? throwDice(specs, first.throw?.seed ?? 1, trayCamera()) : undefined;
      setLatestRoll({ total: last.total, results: last.results, diceSides: last.diceSides, throw: first.throw, thrown, color: first.color, timestamp: Date.now() });
      setIsRolling(true);
      setDisplayRoll(null);
      setGlitchState('none');
      rollTimer.current = setTimeout(() => {
        rollTimer.current = null;
        setIsRolling(false);
        setDisplayRoll({ total: last.total, results: last.results, diceSides: last.diceSides, color: last.color, timestamp: Date.now() });
        if (group.rolls.some((r) => r.criticalGlitch)) setGlitchState('critical');
        else if (group.rolls.some((r) => r.glitch)) setGlitchState('glitch');
        group.told = true;
        record(group.rolls);
      }, thrown && motionNow.current === 'roll' ? revealAfter(thrown) : 800);
    };

    const handleBroadcast = (data: RollBroadcast) => {
      const now = playing.current;
      // The same group as the throw under way: thrown with it.
      if (now && !now.told && data.group && now.group === data.group) {
        now.rolls.push(data);
        play(now);
        return;
      }
      // Another: it cuts in, and what it cut short is told in the record at once.
      if (now && !now.told) { now.told = true; record(now.rolls); }
      playing.current = { group: data.group, rolls: [data], told: false };
      play(playing.current);
    };

    const handleHistory = (data: any[]) => {
      setHistory(data);
      setTimeout(() => { if (historyContainerRef.current) historyContainerRef.current.scrollTop = historyContainerRef.current.scrollHeight; }, 50);
    };

    const socket = socketRef.current;
    if (!socket) return;
    socket.on('diceRollBroadcast', handleBroadcast);
    socket.on('diceRollHistory', handleHistory);
    return () => {
      socket.off('diceRollBroadcast', handleBroadcast);
      socket.off('diceRollHistory', handleHistory);
      if (rollTimer.current) clearTimeout(rollTimer.current);
      rollTimer.current = null;
      playing.current = null;
    };
  }, [socketRef.current]);

  const titleControls = (
    <>
    <button
      type="button"
      role="switch"
      onClick={() => setMotion(motion === 'roll' ? 'landed' : 'roll')}
      className="win95-title-toggle"
      aria-checked={motion === 'roll'}
      aria-label="Animation"
      title={motion === 'roll' ? 'ANIMATION ON: THE DICE ROLL' : 'ANIMATION OFF: THE DICE LAND AT ONCE'}
      style={{ background: 'var(--black)', color: 'var(--green)', padding: '0 6px', height: '22px', width: 'auto', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '1px', marginRight: '4px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
    >
      {/* A toggle: the knob to the right and the track lit when on. */}
      <span aria-hidden style={{ position: 'relative', width: '20px', height: '10px', borderRadius: '5px', border: '1px solid var(--green)', boxSizing: 'border-box', background: motion === 'roll' ? 'var(--green)' : 'transparent', transition: 'background 0.15s' }}>
        <span style={{ position: 'absolute', top: '1px', left: motion === 'roll' ? '11px' : '1px', width: '6px', height: '6px', borderRadius: '50%', background: motion === 'roll' ? 'var(--black)' : 'var(--green)', transition: 'left 0.15s' }} />
      </span>
      ANIMATION
    </button>
    <button
      onClick={() => setIsHistoryOpen(!isHistoryOpen)}
      className="win95-close-btn"
      style={{ background: 'var(--black)', padding: '2px', width: '22px', height: '22px' }}
      title="TOGGLE_HISTORY"
    >
      <img src={isHistoryOpen ? paperFillIcon : paperLightIcon} width="14" height="14" alt="Paper" style={{ filter: 'brightness(0) invert(1)' }} />
    </button>
    </>
  );

  return (
    <DraggableWindow
      title="DICE_TRAY.EXE"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '480px', display: 'flex', flexDirection: 'column' }}
      contentStyle={{ maxHeight: 'none', padding: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'visible' }}
      titleControls={titleControls}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: 'var(--black)' }}>
        <div style={{ padding: '20px', background: 'var(--black)', borderBottom: '2px solid var(--dark-green)', textAlign: 'center', overflow: 'hidden' }}>
          <DotMatrixScoreboard
            value={displayRoll !== null ? displayRoll.total.toString() : ''}
            timestamp={displayRoll?.timestamp || 0}
            isRolling={isRolling}
          />
          {glitchState !== 'none' && (
            <div style={{
              marginTop: '10px',
              padding: '6px 12px',
              border: `2px solid ${glitchState === 'critical' ? 'var(--danger)' : 'var(--warning)'}`,
              background: glitchState === 'critical' ? 'rgba(60,0,0,0.5)' : 'rgba(60,45,0,0.5)',
              color: glitchState === 'critical' ? 'var(--danger)' : 'var(--warning)',
              fontSize: '0.75rem',
              letterSpacing: '2px',
              fontWeight: 700,
              animation: 'death-pulse 1.2s ease-in-out infinite',
            }}>
              {glitchState === 'critical' ? '⚠ CRITICAL GLITCH' : '⚠ GLITCH'}
            </div>
          )}
        </div>

        {/* One shape on every screen (TRAY_ASPECT), so the walls, and the throw, are everyone's. */}
        <div data-testid="dice-tray-floor" style={{ width: '100%', aspectRatio: String(TRAY_ASPECT), position: 'relative' }}>
          <Canvas camera={{ position: [...TRAY_VIEW.position], fov: TRAY_VIEW.fov, near: 0.1, far: 100 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[-3, 8, 5]} intensity={0.9} />
            <DiceScene latestRoll={latestRoll} landed={motion === 'landed'} />
          </Canvas>
        </div>

        {isHistoryOpen && (
          <div
            ref={historyContainerRef}
            data-testid="dice-history"
            style={{
              position: 'absolute', left: '-252px', top: 0, bottom: 0, width: '250px',
              boxSizing: 'border-box', border: '2px solid var(--green)',
              background: 'var(--panel-bg)', overflowY: 'auto',
              padding: '10px', fontSize: '0.75rem', textAlign: 'left',
            }}
          >
            {history.map((h, i) => {
              const match = h.historyString.match(/^(.*?) rolled (.*)$/);
              return (
                <React.Fragment key={i}>
                  <div style={{ marginBottom: '8px', color: themedRollColor(h.color, theme), textShadow: '1px 1px 2px #000, 0 0 8px #000, 0 0 4px #000', wordBreak: 'break-word' }}>
                    {match ? <><strong style={{ fontWeight: 800 }}>{match[1]}:</strong> rolled {match[2]}</> : h.historyString}
                  </div>
                  {i < history.length - 1 && <div style={{ borderBottom: '1px solid var(--green)', opacity: 0.4, margin: '12px 0' }} />}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
