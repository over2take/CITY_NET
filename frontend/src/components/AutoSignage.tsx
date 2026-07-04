import React, { useMemo, useRef, useContext } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ThemeContext } from '../theme/themes';

// ─── Types ───────────────────────────────────────────────────────────────────

type SignType = 'color_wash' | 'glitch_word' | 'scroll_text' | 'strobe';

interface SignDef {
  x: number; y: number; z: number;
  rotY: number;         // face yaw
  w: number; h: number; // sign dimensions
  type: SignType;
  seed: number;
}

interface SignageLocation {
  id: number;
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  rotation?: number;
  shape?: string;
  parent_id?: number | null;
  has_signage?: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NO_SIGNAGE_SHAPES = new Set(['rhombus', 'enemy_rhombus', 'friendly_rhombus', 'none']);
const SIGN_TYPES: SignType[] = ['color_wash', 'glitch_word', 'scroll_text', 'strobe'];
const GLITCH_WORDS = [
  'SYS_ERR', 'NETRUNNER', 'GHOST', 'FLATLINE', 'UPLOAD',
  'BREACH', 'NEURAL', 'CHROME', 'NEON', 'DECODE',
  'OFFLINE', 'PROXY', 'SIGNAL', 'STATIC', 'CORRUPT',
];

const SIGN_CANVAS_W = 256;
const SIGN_CANVAS_H = 128;
const MIN_BUILDING_H = 3; // don't sign tiny structures

// ─── Seeded RNG ──────────────────────────────────────────────────────────────

const seededRand = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
};

// ─── Compound bounds ─────────────────────────────────────────────────────────

interface CompoundBounds {
  cx: number; cz: number;
  w: number; d: number;
  maxH: number;
  baseY: number;
}

const getCompoundBounds = (root: SignageLocation, children: SignageLocation[]): CompoundBounds => {
  const parts = [root, ...children];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let maxH = 0, baseY = root.y;
  for (const p of parts) {
    minX = Math.min(minX, p.x - p.width / 2);
    maxX = Math.max(maxX, p.x + p.width / 2);
    minZ = Math.min(minZ, p.z - p.depth / 2);
    maxZ = Math.max(maxZ, p.z + p.depth / 2);
    maxH = Math.max(maxH, p.y + p.height);
    baseY = Math.min(baseY, p.y);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, maxH: maxH - baseY, baseY };
};

// ─── Sign placement ──────────────────────────────────────────────────────────

const placeSigns = (loc: SignageLocation, children: SignageLocation[], rand: () => number, density: number): SignDef[] => {
  const signs: SignDef[] = [];
  const bounds = getCompoundBounds(loc, children);
  const { cx, cz, w, d, maxH, baseY } = bounds;
  const hw = w / 2, hd = d / 2;
  const faces = [
    { rotY: 0,            ox: 0,   oz: hd,  faceW: w, faceH: maxH },
    { rotY: Math.PI,      ox: 0,   oz: -hd, faceW: w, faceH: maxH },
    { rotY: Math.PI / 2,  ox: -hw, oz: 0,   faceW: d, faceH: maxH },
    { rotY: -Math.PI / 2, ox: hw,  oz: 0,   faceW: d, faceH: maxH },
  ];
  const count = Math.max(1, Math.round(density * (1 + rand() * 3)));
  for (let i = 0; i < count; i++) {
    const face = faces[Math.floor(rand() * faces.length)];
    const signW = Math.min(face.faceW * (0.3 + rand() * 0.4), 4);
    const signH = signW * (0.3 + rand() * 0.4);
    const yOffset = rand() * (maxH * 0.5); // upper half of wall
    const yaw = loc.rotation ?? 0;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const ox = face.ox, oz = face.oz;
    signs.push({
      x: cx + cos * ox - sin * oz,
      y: baseY + maxH / 2 + yOffset,
      z: cz + sin * ox + cos * oz,
      rotY: face.rotY + yaw,
      w: signW, h: signH,
      type: SIGN_TYPES[Math.floor(rand() * SIGN_TYPES.length)],
      seed: Math.floor(rand() * 0xffff),
    });
  }
  return signs;
};

// ─── Canvas texture helpers ───────────────────────────────────────────────────

const makeCanvas = () => {
  const c = document.createElement('canvas');
  c.width = SIGN_CANVAS_W; c.height = SIGN_CANVAS_H;
  return c;
};

// ─── Individual sign components ───────────────────────────────────────────────

const ColorWashSign = ({ def }: { def: SignDef }) => {
  const tex = useMemo(() => {
    const c = makeCanvas(); const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#001100'; ctx.fillRect(0, 0, c.width, c.height);
    return new THREE.CanvasTexture(c);
  }, []);
  const meshRef = useRef<THREE.Mesh>(null);
  const rand = useMemo(() => seededRand(def.seed), [def.seed]);
  const hue = useRef(rand() * 360);

  useFrame((_, delta) => {
    hue.current = (hue.current + delta * 40) % 360;
    const c = tex.image as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = `hsl(${hue.current},100%,35%)`;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = `hsla(${(hue.current + 120) % 360},100%,70%,0.3)`;
    ctx.fillRect(0, c.height * 0.6, c.width, c.height * 0.4);
    tex.needsUpdate = true;
  });

  return (
    <mesh ref={meshRef} position={[def.x, def.y, def.z]} rotation={[0, def.rotY, 0]} raycast={() => null}>
      <planeGeometry args={[def.w, def.h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.85} depthWrite={false} side={THREE.FrontSide} />
    </mesh>
  );
};

const GLITCH_INTERVAL = 0.12;

const GlitchWordSign = ({ def }: { def: SignDef }) => {
  const rand = useMemo(() => seededRand(def.seed), [def.seed]);
  const word = useMemo(() => GLITCH_WORDS[Math.floor(rand() * GLITCH_WORDS.length)], [rand]);
  const tex = useMemo(() => {
    const c = makeCanvas(); const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000811'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = 'bold 40px monospace'; ctx.fillStyle = '#00ffcc';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(word, c.width / 2, c.height / 2);
    return new THREE.CanvasTexture(c);
  }, [word]);

  const timer = useRef(0);
  useFrame((_, delta) => {
    timer.current += delta;
    if (timer.current < GLITCH_INTERVAL) return;
    timer.current = 0;
    if (Math.random() > 0.15) return; // mostly static
    const c = tex.image as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000811'; ctx.fillRect(0, 0, c.width, c.height);
    // glitch bar
    const gy = Math.random() * c.height;
    ctx.fillStyle = `rgba(0,255,180,0.15)`;
    ctx.fillRect(0, gy, c.width, 8 + Math.random() * 16);
    const r = Math.random();
    ctx.font = 'bold 40px monospace';
    ctx.fillStyle = r > 0.5 ? '#ff0044' : '#00ffcc';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const dx = (Math.random() - 0.5) * 12;
    ctx.fillText(word, c.width / 2 + dx, c.height / 2);
    tex.needsUpdate = true;
  });

  return (
    <mesh position={[def.x, def.y, def.z]} rotation={[0, def.rotY, 0]} raycast={() => null}>
      <planeGeometry args={[def.w, def.h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.9} depthWrite={false} side={THREE.FrontSide} blending={THREE.AdditiveBlending} />
    </mesh>
  );
};

const ScrollTextSign = ({ def }: { def: SignDef }) => {
  const rand = useMemo(() => seededRand(def.seed), [def.seed]);
  const phrases = ['NEURAL LINK', 'GHOST SIGNAL', 'CHROME DREAMS', 'NET RUNNER', 'DEEP SPACE', 'ZERO DAY', 'CYBER NOIR'];
  const phrase = useMemo(() => phrases[Math.floor(rand() * phrases.length)], [rand]);
  const tex = useMemo(() => { const c = makeCanvas(); return new THREE.CanvasTexture(c); }, []);
  const offset = useRef(SIGN_CANVAS_W);

  useFrame((_, delta) => {
    offset.current -= delta * 60;
    if (offset.current < -SIGN_CANVAS_W * 1.5) offset.current = SIGN_CANVAS_W;
    const c = tex.image as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#030a03'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = 'bold 32px monospace'; ctx.fillStyle = '#00ff88';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(phrase, offset.current, c.height / 2);
    // wrap
    ctx.fillText(phrase, offset.current + SIGN_CANVAS_W * 1.5, c.height / 2);
    tex.needsUpdate = true;
  });

  return (
    <mesh position={[def.x, def.y, def.z]} rotation={[0, def.rotY, 0]} raycast={() => null}>
      <planeGeometry args={[def.w, def.h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.88} depthWrite={false} side={THREE.FrontSide} />
    </mesh>
  );
};

const StrobeSign = ({ def }: { def: SignDef }) => {
  const theme = useContext(ThemeContext);
  const rand = useMemo(() => seededRand(def.seed), [def.seed]);
  const color = useMemo(() => {
    const colors = [theme.primary, theme.highlight, theme.danger, theme.friendly];
    return colors[Math.floor(rand() * colors.length)];
  }, [theme, rand]);
  const tex = useMemo(() => {
    const c = makeCanvas(); const ctx = c.getContext('2d')!;
    ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
    return new THREE.CanvasTexture(c);
  }, [color]);
  const interval = useMemo(() => 0.08 + rand() * 0.3, [rand]);
  const timer = useRef(0); const on = useRef(true);

  useFrame((_, delta) => {
    timer.current += delta;
    if (timer.current < interval) return;
    timer.current = 0; on.current = !on.current;
    const c = tex.image as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = on.current ? color : '#000000';
    ctx.fillRect(0, 0, c.width, c.height);
    tex.needsUpdate = true;
  });

  return (
    <mesh position={[def.x, def.y, def.z]} rotation={[0, def.rotY, 0]} raycast={() => null}>
      <planeGeometry args={[def.w, def.h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.8} depthWrite={false} side={THREE.FrontSide} blending={THREE.AdditiveBlending} />
    </mesh>
  );
};

// ─── Main export ──────────────────────────────────────────────────────────────

export const AutoSignage = React.memo(({ locations, density = 1 }: { locations: SignageLocation[]; density?: number }) => {
  const signs = useMemo(() => {
    const all = locations || [];
    const childrenByParent = new Map<number, SignageLocation[]>();
    for (const loc of all) {
      if (loc.parent_id) {
        const arr = childrenByParent.get(loc.parent_id) ?? [];
        arr.push(loc);
        childrenByParent.set(loc.parent_id, arr);
      }
    }
    return all
      .filter(loc => {
        if (loc.parent_id) return false;
        if (NO_SIGNAGE_SHAPES.has(loc.shape ?? '')) return false;
        if ((loc.has_signage ?? 1) !== 1) return false;
        const children = childrenByParent.get(loc.id) ?? [];
        const { maxH } = getCompoundBounds(loc, children);
        return maxH >= MIN_BUILDING_H;
      })
      .flatMap(loc => {
        const rand = seededRand(loc.id * 2654435761);
        return placeSigns(loc, childrenByParent.get(loc.id) ?? [], rand, density);
      });
  }, [locations, density]);

  if (signs.length === 0) return null;

  return (
    <group>
      {signs.map((def, i) => {
        switch (def.type) {
          case 'color_wash':  return <ColorWashSign  key={i} def={def} />;
          case 'glitch_word': return <GlitchWordSign key={i} def={def} />;
          case 'scroll_text': return <ScrollTextSign key={i} def={def} />;
          case 'strobe':      return <StrobeSign     key={i} def={def} />;
        }
      })}
    </group>
  );
});
