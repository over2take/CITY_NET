import React, { useState, useEffect, useRef, useContext, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DraggableWindow, NotifyBell } from './DraggableWindow';
import { ToggleSwitch } from './ToggleSwitch';
import { ThemeContext } from '../theme/themes';
import { themedRollColor } from '../theme/rollColor';
import paperFillIcon from '../assets/lets-icons--paper-fill.svg';
import paperLightIcon from '../assets/lets-icons--paper-light.svg';
import type { DiceRoll } from '../types';
import { diceOfRoll, throwDice, revealAfter, MOST_DICE, poseAt, printOrder, floorSeen, trayCamera, TRAY_VIEW, TRAY_ASPECT, type Throw, type RollThrow } from '../utils/trayThrow';
import { labelTurn } from '../utils/diceShapes';
import { labelParts, labelKey, paintLabel } from '../utils/dieLabels';
import { useTrayMotion } from '../hooks/useTrayMotion';
import { showOf, sayOf, emptyField, putShow, putNoise, decodedAt, COLS, WIDTH, HEIGHT, SETTLE_MS, HOLD_MS, type BoardRoll } from '../utils/trayBoard';
import { makeWaiting } from '../utils/trayWaiting';

// ─── CharacterBoard ──────────────────────────────────────────────────────────

interface CharacterBoardProps {
  /** The rolls landed and on show (a group's together), or null while there is nothing to tell. */
  rolls: BoardRoll[] | null;
  /** The dice still in the air: every cell flickers. */
  rolling: boolean;
  /** When the rolls came down, on performance.now()'s clock: they decode from then. */
  landedAt: number;
}

/**
 * DICE_TRAY.EXE's board (6c4e; approved mockup docs/mockups/tray-scoreboard.html v3): a 16 by 2
 * character display in the theme's primary. While the dice roll every cell flickers; as they land
 * the result decodes into place left to right; it stays HOLD_MS, turning pages if it has more than
 * two lines, then the board waits with a picture, the next one each wait (utils/trayWaiting.ts;
 * utils/trayBoard.ts works out what each dot of a result shows).
 * Its 1,120 dots are made once and painted directly, so a frame repaints only what changed.
 */
export function CharacterBoard({ rolls, rolling, landedAt }: CharacterBoardProps) {
  const theme = useContext(ThemeContext);
  const dots = useRef<HTMLSpanElement[]>([]);
  const painted = useRef<number[]>([]);
  const show = useMemo(() => (rolls && rolls.length ? showOf(rolls) : null), [rolls]);
  // Back to waiting once a result has been up long enough: the timer marks which landing is over.
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    if (rolling || !show) return;
    const left = landedAt + SETTLE_MS + HOLD_MS - performance.now();
    const timer = setTimeout(() => setOver(landedAt), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [rolling, show, landedAt]);
  const waiting = !rolling && (!show || over === landedAt);

  // While waiting, a picture (6c4f, utils/trayWaiting.ts): one for the whole wait, the next one the
  // next time, READY_ when the tray opens.
  const waitingDraw = useRef(makeWaiting());
  const waitingSince = useRef(0);
  useEffect(() => { if (waiting) waitingSince.current = performance.now(); }, [waiting]);
  // Which wait this is: one more for each result told, known by when it landed, so running an effect
  // twice (React does in development) never counts one twice and skips a picture.
  const told = useRef({ count: 0, last: Number.NaN });
  useEffect(() => {
    if (show && landedAt !== told.current.last) told.current = { count: told.current.count + 1, last: landedAt };
  }, [show, landedAt]);

  useEffect(() => {
    const paint = () => {
      const now = performance.now();
      const f = emptyField();
      if (rolling) putNoise(f);
      else if (show && !waiting) {
        const since = now - landedAt;
        putShow(f, show, Math.max(0, since - SETTLE_MS));
        if (since < SETTLE_MS) putNoise(f, decodedAt(since));
      } else waitingDraw.current(f, now - waitingSince.current, told.current.count);
      for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
        const k = (Math.floor(y / 7) * COLS + Math.floor(x / 5)) * 35 + (y % 7) * 5 + (x % 5);
        if (painted.current[k] === f[y][x]) continue;
        painted.current[k] = f[y][x];
        dots.current[k]?.classList.toggle('on', f[y][x] === 1);
      }
    };
    paint();
    const timer = setInterval(paint, 50);
    return () => clearInterval(timer);
  }, [rolling, show, landedAt, waiting]);

  const said = rolling ? 'Rolling' : show && !waiting ? sayOf(show) : 'Ready';
  return (
    <div data-testid="dice-board" role="img" aria-label={said} className="tray-board" style={{ '--board-on': theme.primary } as React.CSSProperties}>
      {Array.from({ length: COLS * 2 }, (_, cell) => (
        <span key={cell} className="tray-board-cell">
          {Array.from({ length: 35 }, (__, dot) => (
            <span key={dot} className="tray-board-px" ref={(el) => { if (el) dots.current[cell * 35 + dot] = el; }} />
          ))}
        </span>
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
  /** What the board says of it: what it was for, its words, what it came to (6c4d1-3 on the server). */
  board?: BoardRoll['board'];
}

interface DiceTrayWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socketRef: React.MutableRefObject<any>;
  /** Whoever is signed in, GM or player: their ROLL or LANDED is kept on their account (6c4b3b). */
  authToken?: string | null;
  /** The tray's bell (6c4g), between ANIMATION and the history button: whether others' rolls flash it while shut. */
  bell?: boolean;
  onToggleBell?: () => void;
  /** Open with the roll history showing: the tray was opened on a flash, so there are rolls to catch up on. */
  openHistory?: boolean;
}

export function DiceTrayWindow({ pos, setPos, onClose, socketRef, authToken, bell, onToggleBell, openHistory = false }: DiceTrayWindowProps) {
  const theme = useContext(ThemeContext);
  const [motion, setMotion] = useTrayMotion(authToken);
  // Read when a roll arrives, inside the socket handlers set up once.
  const motionNow = useRef(motion);
  useEffect(() => { motionNow.current = motion; }, [motion]);
  const [history, setHistory] = useState<DiceRoll[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(openHistory);
  const [latestRoll, setLatestRoll] = useState<TrayRoll | null>(null);
  /** The rolls on the board once landed, a group's together, and when they came down. */
  const [shown, setShown] = useState<{ rolls: RollBroadcast[]; at: number } | null>(null);
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
      setShown(null);
      setGlitchState('none');
      rollTimer.current = setTimeout(() => {
        rollTimer.current = null;
        setIsRolling(false);
        setShown({ rolls: [...group.rolls], at: performance.now() });
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
    <ToggleSwitch on={motion === 'roll'} onChange={(on) => setMotion(on ? 'roll' : 'landed')} label="ANIMATION" name="Animation"
      color="var(--green)" className="win95-title-toggle"
      title={motion === 'roll' ? 'ANIMATION ON: THE DICE ROLL' : 'ANIMATION OFF: THE DICE LAND AT ONCE'}
      style={{ background: 'var(--black)', padding: '0 6px', height: '22px', fontSize: '10px', marginRight: '4px', gap: '6px' }} />
    {onToggleBell && <NotifyBell enabled={!!bell} onToggle={onToggleBell} />}
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
          <CharacterBoard rolls={shown?.rolls ?? null} rolling={isRolling} landedAt={shown?.at ?? 0} />
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
