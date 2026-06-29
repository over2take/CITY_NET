import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DraggableWindow } from './DraggableWindow';
import paperFillIcon from '../assets/lets-icons--paper-fill.svg';
import paperLightIcon from '../assets/lets-icons--paper-light.svg';
import type { DiceRoll } from '../types';

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
    if (val === 1) return { bg: 'var(--green)', shadow: '0 0 5px var(--green), 0 0 10px var(--green)' };
    if (val === 2) return { bg: 'rgba(0,255,0,0.5)', shadow: '0 0 2px var(--green)' };
    if (val === 3) return { bg: 'rgba(0,255,0,0.2)', shadow: 'none' };
    return { bg: 'rgba(0,255,0,0.05)', shadow: 'none' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
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

interface DiceSceneProps {
  latestRoll: { total: number; results: any; color: string; timestamp: number } | null;
}

export function DiceScene({ latestRoll }: DiceSceneProps) {
  const { scene, camera } = useThree();

  useEffect(() => {
    camera.lookAt(0, 0, 0);
    const diceObjects: THREE.Mesh[] = [];
    if (latestRoll && latestRoll.results) {
      const material = new THREE.MeshBasicMaterial({ color: latestRoll.color, wireframe: true });
      let xOffset = -2.5;
      for (const [sides, rolls] of Object.entries(latestRoll.results)) {
        const s = parseInt(sides);
        let geometry: THREE.BufferGeometry;
        switch (s) {
          case 4: geometry = new THREE.TetrahedronGeometry(1); break;
          case 6: geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2); break;
          case 8: geometry = new THREE.OctahedronGeometry(1); break;
          case 12: geometry = new THREE.DodecahedronGeometry(1); break;
          case 20: geometry = new THREE.IcosahedronGeometry(1); break;
          default: geometry = new THREE.SphereGeometry(1, Math.max(3, s / 2), Math.max(3, s / 2)); break;
        }
        (rolls as number[]).forEach(val => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(xOffset + (Math.random() - 0.5), (Math.random() - 0.5), 2 + Math.random() * 2);
          mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
          let typeFriction = 0.88;
          let rotMult = 1.5;
          if (s === 2) { typeFriction = 0.60; rotMult = 0.2; }
          else if (s === 4) { typeFriction = 0.70; rotMult = 0.5; }
          else if (s === 6) { typeFriction = 0.80; rotMult = 0.8; }
          else if (s === 8) { typeFriction = 0.84; rotMult = 1.0; }
          else if (s === 10 || s === 100) { typeFriction = 0.86; rotMult = 1.2; }
          else if (s === 12) { typeFriction = 0.88; rotMult = 1.3; }
          else if (s === 20) { typeFriction = 0.90; rotMult = 1.5; }
          const speed = 15 + Math.random() * 10;
          const angle = Math.random() * Math.PI * 2;
          mesh.userData = {
            velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 10 + Math.random() * 10),
            stopped: false, typeFriction, rotMult,
          };
          scene.add(mesh);
          diceObjects.push(mesh);
          xOffset += 1.5;
          if (xOffset > 2.5) xOffset = -2.5;
        });
      }
    }
    return () => {
      diceObjects.forEach(d => { scene.remove(d); d.geometry.dispose(); });
      if (diceObjects.length > 0 && diceObjects[0].material) (diceObjects[0].material as THREE.Material).dispose();
    };
  }, [latestRoll, scene]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const bounds = { minX: -5.4, maxX: 5.4, minY: -3.2, maxY: 3.2 };
    const restitution = 0.8;
    const gravity = 60;
    const diceList: THREE.Mesh[] = [];

    scene.children.forEach(c => {
      if (c.userData.velocity !== undefined) diceList.push(c as THREE.Mesh);
    });

    diceList.forEach(c => {
      if (c.userData.stopped) return;
      c.userData.velocity.z -= gravity * dt;
      if (c.position.z <= 0) {
        const drag = c.userData.typeFriction || 0.88;
        c.userData.velocity.x *= drag;
        c.userData.velocity.y *= drag;
      }
      c.position.addScaledVector(c.userData.velocity, dt);
      if (c.position.z <= 0) {
        c.position.z = 0;
        if (c.userData.velocity.z < -2.0) {
          c.userData.velocity.z *= -restitution;
          const veer = Math.abs(c.userData.velocity.z) * 0.2;
          c.userData.velocity.x += (Math.random() - 0.5) * veer;
          c.userData.velocity.y += (Math.random() - 0.5) * veer;
        } else {
          c.userData.velocity.z = 0;
        }
      }
      if (c.position.x < bounds.minX) { c.position.x = bounds.minX; c.userData.velocity.x *= -restitution; }
      if (c.position.x > bounds.maxX) { c.position.x = bounds.maxX; c.userData.velocity.x *= -restitution; }
      if (c.position.y < bounds.minY) { c.position.y = bounds.minY; c.userData.velocity.y *= -restitution; }
      if (c.position.y > bounds.maxY) { c.position.y = bounds.maxY; c.userData.velocity.y *= -restitution; }
      const speedSq = c.userData.velocity.lengthSq();
      if (speedSq < 0.2 && c.position.z === 0) { c.userData.stopped = true; return; }
      const speed = Math.sqrt(speedSq);
      const rotAxis = new THREE.Vector3(-c.userData.velocity.y, c.userData.velocity.x, c.userData.velocity.z).normalize();
      if (rotAxis.lengthSq() > 0.1) c.rotateOnWorldAxis(rotAxis, speed * dt * (c.userData.rotMult || 1.5));
    });

    for (let i = 0; i < diceList.length; i++) {
      for (let j = i + 1; j < diceList.length; j++) {
        const c1 = diceList[i];
        const c2 = diceList[j];
        const dx = c2.position.x - c1.position.x;
        const dy = c2.position.y - c1.position.y;
        const dz = c2.position.z - c1.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = 2.0;
        if (distSq < minDist * minDist && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist, ny = dy / dist, nz = dz / dist;
          c1.position.x -= nx * overlap * 0.5; c1.position.y -= ny * overlap * 0.5; c1.position.z -= nz * overlap * 0.5;
          c2.position.x += nx * overlap * 0.5; c2.position.y += ny * overlap * 0.5; c2.position.z += nz * overlap * 0.5;
          const v1 = c1.userData.velocity, v2 = c2.userData.velocity;
          const velAlongNormal = (v2.x - v1.x) * nx + (v2.y - v1.y) * ny + (v2.z - v1.z) * nz;
          if (velAlongNormal < 0) {
            const jImpulse = -(1 + 0.7) * velAlongNormal / 2;
            const ix = nx * jImpulse, iy = ny * jImpulse, iz = nz * jImpulse;
            v1.x -= ix; v1.y -= iy; v1.z -= iz;
            v2.x += ix; v2.y += iy; v2.z += iz;
            if (c1.userData.stopped && v1.lengthSq() > 0.5) c1.userData.stopped = false;
            if (c2.userData.stopped && v2.lengthSq() > 0.5) c2.userData.stopped = false;
          }
        }
      }
    }
  });

  return null;
}

// ─── DiceTrayWindow ───────────────────────────────────────────────────────────

interface DiceTrayWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socketRef: React.MutableRefObject<any>;
}

export function DiceTrayWindow({ pos, setPos, onClose, socketRef }: DiceTrayWindowProps) {
  const [history, setHistory] = useState<DiceRoll[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [latestRoll, setLatestRoll] = useState<{ total: number; results: any; color: string; timestamp: number } | null>(null);
  const [displayRoll, setDisplayRoll] = useState<{ total: number; results: any; color: string; timestamp: number } | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const historyContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('requestDiceHistory');

    const handleBroadcast = (data: any) => {
      setLatestRoll({ total: data.total, results: data.results, color: data.color, timestamp: Date.now() });
      setIsRolling(true);
      setDisplayRoll(null);
      setTimeout(() => {
        setIsRolling(false);
        setDisplayRoll({ total: data.total, results: data.results, color: data.color, timestamp: Date.now() });
        setHistory(prev => {
          const newHistory = [...prev, data];
          setTimeout(() => { if (historyContainerRef.current) historyContainerRef.current.scrollTop = historyContainerRef.current.scrollHeight; }, 50);
          return newHistory;
        });
      }, 5000);
    };

    const handleHistory = (data: any[]) => {
      setHistory(data);
      if (data.length > 0) {
        const last = data[data.length - 1];
        setLatestRoll({ total: last.total, results: last.results, color: last.color, timestamp: Date.now() });
        setDisplayRoll({ total: last.total, results: last.results, color: last.color, timestamp: Date.now() });
        setTimeout(() => { if (historyContainerRef.current) historyContainerRef.current.scrollTop = historyContainerRef.current.scrollHeight; }, 50);
      }
    };

    socketRef.current.on('diceRollBroadcast', handleBroadcast);
    socketRef.current.on('diceRollHistory', handleHistory);
    return () => {
      socketRef.current.off('diceRollBroadcast', handleBroadcast);
      socketRef.current.off('diceRollHistory', handleHistory);
    };
  }, [socketRef]);

  const titleControls = (
    <button
      onClick={() => setIsHistoryOpen(!isHistoryOpen)}
      className="win95-close-btn"
      style={{ background: 'var(--black)', padding: '2px', width: '22px', height: '22px' }}
      title="TOGGLE_HISTORY"
    >
      <img src={isHistoryOpen ? paperFillIcon : paperLightIcon} width="14" height="14" alt="Paper" style={{ filter: 'brightness(0) invert(1)' }} />
    </button>
  );

  return (
    <DraggableWindow
      title="DICE_TRAY.exe"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '480px', display: 'flex', flexDirection: 'column' }}
      contentStyle={{ maxHeight: 'none', padding: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'visible' }}
      titleControls={titleControls}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: 'var(--black)' }}>
        <div style={{ padding: '20px', background: '#0a0a0a', borderBottom: '2px solid var(--dark-green)', textAlign: 'center', overflow: 'hidden' }}>
          <DotMatrixScoreboard
            value={displayRoll !== null ? displayRoll.total.toString() : ''}
            timestamp={displayRoll?.timestamp || 0}
            isRolling={isRolling}
          />
        </div>

        <div style={{ height: '320px', width: '100%', position: 'relative' }}>
          <Canvas camera={{ position: [0, 0, 13], fov: 35, near: 0.1, far: 100 }}>
            <ambientLight intensity={1} />
            <DiceScene latestRoll={latestRoll} />
          </Canvas>
        </div>

        {isHistoryOpen && (
          <div
            ref={historyContainerRef}
            style={{
              position: 'absolute', left: '-252px', top: 0, bottom: 0, width: '250px',
              boxSizing: 'border-box', border: '2px solid var(--green)',
              background: 'rgba(0,15,0,0.95)', overflowY: 'auto',
              padding: '10px', fontSize: '0.75rem', textAlign: 'left',
            }}
          >
            {history.map((h, i) => {
              const match = h.historyString.match(/^(.*?) rolled (.*)$/);
              return (
                <React.Fragment key={i}>
                  <div style={{ marginBottom: '8px', color: h.color, textShadow: '1px 1px 2px #000, 0 0 8px #000, 0 0 4px #000', wordBreak: 'break-word' }}>
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
