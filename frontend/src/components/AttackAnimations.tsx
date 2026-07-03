import { useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

// ─── Attack animations ────────────────────────────────────────────────────────
// Rendered inside the Canvas. App.tsx pushes entries into the queue from
// attackResult socket events; each entry plays once and removes itself.
//
// Hit (melee):  red arc sweeps across the target, then the rhombus wiggles.
// Hit (ranged): amber projectile flies attacker → target, then wiggle.
// Miss:         taunt text floats up from the target and fades.

export interface AttackAnimationEntry {
  id: string;
  hit: boolean;
  attackType: 'melee' | 'ranged';
  attackerPos: { x: number; z: number } | null;
  targetPos: { x: number; z: number };
  targetId: number;
}

const MISS_STRINGS = [
  'MISS!', 'DODGED!', 'BLOCKED!', 'DEFLECTED!', 'PARRIED!', 'EVADED!',
  'RESISTED!', 'ABSORBED!', 'GLANCING BLOW!', 'TOO SLOW!', 'NOT A SCRATCH!', 'CLOSE ONE!',
];

// Prefer the live on-screen position (rhombuses lerp toward their server
// position, so the registry is where the mesh actually is right now).
const liveTargetPos = (targetId: number, fallback: { x: number; z: number }) => {
  const live = (window as any).activeRhombuses?.[targetId];
  return live ? { x: live.x, z: live.z } : fallback;
};

const triggerWiggle = (targetId: number) => {
  if (!(window as any).rhombusWiggles) (window as any).rhombusWiggles = {};
  (window as any).rhombusWiggles[targetId] = Date.now();
};

// ─── Melee swipe ──────────────────────────────────────────────────────────────
// A flat red arc that sweeps ~200° across the target over 350ms while fading.

function MeleeSwipe({ entry, onDone }: { entry: AttackAnimationEntry; onDone: () => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const start = useRef<number | null>(null);
  const done = useRef(false);

  useFrame(() => {
    if (done.current) return;
    if (start.current === null) start.current = performance.now();
    const t = (performance.now() - start.current) / 350;

    const pos = liveTargetPos(entry.targetId, entry.targetPos);
    if (groupRef.current) {
      groupRef.current.position.set(pos.x, 4, pos.z);
      // Sweep: fast-out easing across the target
      const ease = 1 - Math.pow(1 - Math.min(1, t), 3);
      groupRef.current.rotation.y = -1.2 + ease * 3.5;
    }
    if (matRef.current) {
      matRef.current.opacity = t < 0.6 ? 0.9 : 0.9 * Math.max(0, 1 - (t - 0.6) / 0.4);
    }
    if (t >= 1) {
      done.current = true;
      triggerWiggle(entry.targetId);
      onDone();
    }
  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.5, 5.5, 24, 1, 0, Math.PI * 0.65]} />
        <meshBasicMaterial ref={matRef} color="#ff4444" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ─── Ranged projectile ────────────────────────────────────────────────────────
// Amber sphere flies attacker → target over 500ms with a slight arc, then wiggle.

function RangedProjectile({ entry, onDone }: { entry: AttackAnimationEntry; onDone: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const start = useRef<number | null>(null);
  const done = useRef(false);
  // Missing attacker rhombus (no beacon placed): fall back to a short drop from above.
  const from = entry.attackerPos ?? { x: entry.targetPos.x, z: entry.targetPos.z - 30 };

  useFrame(() => {
    if (done.current) return;
    if (start.current === null) start.current = performance.now();
    const t = Math.min(1, (performance.now() - start.current) / 500);

    const to = liveTargetPos(entry.targetId, entry.targetPos);
    if (meshRef.current) {
      meshRef.current.position.x = THREE.MathUtils.lerp(from.x, to.x, t);
      meshRef.current.position.z = THREE.MathUtils.lerp(from.z, to.z, t);
      // Parabolic arc: up to ~8 units at midpoint, launch/land at rhombus height
      meshRef.current.position.y = 3 + Math.sin(t * Math.PI) * 8;
    }
    if (t >= 1) {
      done.current = true;
      triggerWiggle(entry.targetId);
      onDone();
    }
  });

  return (
    <mesh ref={meshRef} position={[from.x, 3, from.z]}>
      <sphereGeometry args={[0.6, 12, 12]} />
      <meshBasicMaterial color="#ffaa00" />
    </mesh>
  );
}

// ─── Miss text ────────────────────────────────────────────────────────────────
// A random taunt floats up from the target and fades over 1.2s.

function MissText({ entry, onDone }: { entry: AttackAnimationEntry; onDone: () => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const [opacity, setOpacity] = useState(1);
  const text = useMemo(() => MISS_STRINGS[Math.floor(Math.random() * MISS_STRINGS.length)], []);

  useFrame(() => {
    if (done.current) return;
    if (start.current === null) start.current = performance.now();
    const t = (performance.now() - start.current) / 1200;

    const pos = liveTargetPos(entry.targetId, entry.targetPos);
    if (groupRef.current) {
      groupRef.current.position.set(pos.x, 5 + t * 8, pos.z);
    }
    setOpacity(Math.max(0, 1 - t * t));
    if (t >= 1) {
      done.current = true;
      onDone();
    }
  });

  return (
    <group ref={groupRef} position={[entry.targetPos.x, 5, entry.targetPos.z]}>
      <Html center zIndexRange={[200, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{
          color: '#cccccc', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '16px',
          letterSpacing: '2px', whiteSpace: 'nowrap', opacity,
          textShadow: '0 0 6px rgba(0,0,0,0.9), 1px 1px 2px #000',
        }}>
          {text}
        </div>
      </Html>
    </group>
  );
}

// ─── Queue renderer ───────────────────────────────────────────────────────────

export function AttackAnimations({ animations, onComplete }: {
  animations: AttackAnimationEntry[];
  onComplete: (id: string) => void;
}) {
  return (
    <>
      {animations.map(entry => {
        if (!entry.hit) return <MissText key={entry.id} entry={entry} onDone={() => onComplete(entry.id)} />;
        if (entry.attackType === 'ranged') return <RangedProjectile key={entry.id} entry={entry} onDone={() => onComplete(entry.id)} />;
        return <MeleeSwipe key={entry.id} entry={entry} onDone={() => onComplete(entry.id)} />;
      })}
    </>
  );
}
