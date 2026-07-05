import React, { useMemo, useContext, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ThemeContext } from '../theme/themes';
import { loadFont, type RemoteFont } from '../utils/fontLoader';

export interface SignLine {
  text: string;
  font_size: number;
}

export interface SignData {
  id: number;
  text: string;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  font_size: number;
  font_family?: string | null;
  lines?: string | null; // JSON-encoded SignLine[]
  image_url?: string | null;
  use_tv_filter?: number;
  filter_intensity?: number | null;
}

// ─── Canvas rendering ────────────────────────────────────────────────────────

const PIXELS_PER_UNIT = 48;
const BORDER_PX = 3;
const H_PAD_RATIO = 0.4;
const V_PAD_RATIO = 0.35;
const LINE_GAP_RATIO = 0.3;
const MAX_IMAGE_PX = 512;

const makeSignTexture = (
  lines: SignLine[],
  fontFamily: string,
  primaryColor: string
): { tex: THREE.CanvasTexture; w: number; h: number } => {
  // Measure each line in a temporary canvas
  const tmp = document.createElement('canvas').getContext('2d')!;
  const measured = lines.map(l => {
    const px = Math.round(l.font_size * PIXELS_PER_UNIT);
    tmp.font = `bold ${px}px ${fontFamily}`;
    return { px, textW: tmp.measureText(l.text).width };
  });

  const maxPx = Math.max(...measured.map(m => m.px));
  const hPad = maxPx * H_PAD_RATIO;
  const vPad = maxPx * V_PAD_RATIO;
  const lineGap = (i: number) => measured[i].px * LINE_GAP_RATIO;
  const totalTextH = measured.reduce((s, m) => s + m.px, 0)
    + measured.slice(0, -1).reduce((s, _, i) => s + lineGap(i), 0);
  const maxTextW = Math.max(...measured.map(m => m.textW));

  const canvas = document.createElement('canvas');
  canvas.width  = Math.ceil(maxTextW + hPad * 2);
  canvas.height = Math.ceil(totalTextH + vPad * 2);

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#030a03';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = BORDER_PX;
  ctx.strokeRect(BORDER_PX / 2, BORDER_PX / 2, canvas.width - BORDER_PX, canvas.height - BORDER_PX);

  let y = vPad;
  lines.forEach((line, i) => {
    const { px } = measured[i];
    ctx.font = `bold ${px}px ${fontFamily}`;
    ctx.fillStyle = primaryColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(line.text, canvas.width / 2, y);
    y += px + (i < lines.length - 1 ? lineGap(i) : 0);
  });

  return {
    tex: new THREE.CanvasTexture(canvas),
    w: canvas.width  / PIXELS_PER_UNIT,
    h: canvas.height / PIXELS_PER_UNIT,
  };
};

const makeImageTexture = (
  img: HTMLImageElement,
  captionLines: SignLine[],
  fontFamily: string,
  primaryColor: string,
): { tex: THREE.CanvasTexture; w: number; h: number } => {
  const scale = Math.min(1, MAX_IMAGE_PX / img.naturalWidth);
  const imgW = Math.max(1, Math.round(img.naturalWidth * scale));
  const imgH = Math.max(1, Math.round(img.naturalHeight * scale));

  const hasCaption = captionLines.some(l => l.text.trim());
  const vPad = 8;
  let capH = 0;
  let capMeasured: Array<{ px: number }> = [];

  if (hasCaption) {
    const tmp = document.createElement('canvas').getContext('2d')!;
    capMeasured = captionLines.map(l => {
      const px = Math.round(l.font_size * PIXELS_PER_UNIT);
      tmp.font = `bold ${px}px ${fontFamily}`;
      return { px };
    });
    const totalTextH = capMeasured.reduce((s, m, i) =>
      s + m.px + (i < captionLines.length - 1 ? m.px * LINE_GAP_RATIO : 0), 0);
    capH = Math.ceil(totalTextH + vPad * 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width  = imgW;
  canvas.height = imgH + capH;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#030a03';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, imgW, imgH);

  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = BORDER_PX;
  ctx.strokeRect(BORDER_PX / 2, BORDER_PX / 2, canvas.width - BORDER_PX, canvas.height - BORDER_PX);

  if (hasCaption) {
    ctx.fillStyle = 'rgba(3, 10, 3, 0.82)';
    ctx.fillRect(0, imgH, imgW, capH);
    let y = imgH + vPad;
    captionLines.forEach((l, i) => {
      const { px } = capMeasured[i];
      ctx.font = `bold ${px}px ${fontFamily}`;
      ctx.fillStyle = primaryColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(l.text, imgW / 2, y);
      y += px + (i < captionLines.length - 1 ? px * LINE_GAP_RATIO : 0);
    });
  }

  return {
    tex: new THREE.CanvasTexture(canvas),
    w: canvas.width  / PIXELS_PER_UNIT,
    h: canvas.height / PIXELS_PER_UNIT,
  };
};

/** Normalise a SignData into a lines array for rendering */
const resolveLines = (sign: SignData): SignLine[] => {
  if (sign.lines) {
    try {
      const parsed = JSON.parse(sign.lines) as SignLine[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* fall through */ }
  }
  return [{ text: sign.text, font_size: sign.font_size }];
};

// ─── TV filter shader ────────────────────────────────────────────────────────

const TV_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TV_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacity;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime;
    float k = uIntensity;

    // Occasional glitch: a few frames every couple of seconds, rows shear sideways
    float slice = floor(t * 8.0);
    float glitchGate = step(0.96, hash(vec2(slice, 3.7)));
    float rowJitter = (hash(vec2(floor(uv.y * 36.0), slice)) - 0.5) * 0.08 * glitchGate * k;
    uv.x += rowJitter;

    // Chromatic fringe: split R/B horizontally
    float fr = 0.003 * k;
    vec4 c;
    c.r = texture2D(uMap, uv + vec2(fr, 0.0)).r;
    c.g = texture2D(uMap, uv).g;
    c.b = texture2D(uMap, uv - vec2(fr, 0.0)).b;
    c.a = texture2D(uMap, uv).a;

    // Scanlines
    float scan = 0.5 + 0.5 * sin(uv.y * 420.0);
    c.rgb *= mix(1.0, 0.72 + 0.28 * scan, k);

    // Rolling refresh band sweeping downward
    float roll = fract(uv.y - t * 0.07);
    float band = smoothstep(0.0, 0.18, roll) * smoothstep(0.38, 0.2, roll);
    c.rgb *= 1.0 + band * 0.25 * k;

    // Per-pixel static
    float n = hash(uv * vec2(521.0, 383.0) + fract(t) * 61.7);
    c.rgb += (n - 0.5) * 0.12 * k;

    // Vignette (curved-screen corner falloff)
    vec2 d = uv - 0.5;
    c.rgb *= 1.0 - dot(d, d) * 0.8 * k;

    gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  }
`;

const TVSignMaterial = ({ tex, intensity }: { tex: THREE.CanvasTexture; intensity: number }) => {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: TV_VERT,
    fragmentShader: TV_FRAG,
    uniforms: {
      uMap: { value: tex as THREE.Texture },
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uOpacity: { value: 0.95 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => { material.uniforms.uMap.value = tex; }, [tex, material]);
  useEffect(() => { material.uniforms.uIntensity.value = intensity; }, [intensity, material]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => { material.uniforms.uTime.value = state.clock.getElapsedTime(); });

  return <primitive object={material} attach="material" />;
};

// ─── Sign mesh ───────────────────────────────────────────────────────────────

const SignMesh = React.memo(({
  sign, primaryColor, fontReady, isSelected, onSelect, onMeshRef,
}: {
  sign: SignData;
  primaryColor: string;
  fontReady: boolean;
  isSelected: boolean;
  onSelect?: (id: number) => void;
  onMeshRef?: (mesh: THREE.Mesh | null) => void;
}) => {
  const family  = sign.font_family || 'monospace';
  const lines   = useMemo(() => resolveLines(sign), [sign]);
  const meshRef = React.useRef<THREE.Mesh>(null);

  // Async image loading — switches canvas renderer to image mode when ready
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!sign.image_url) { setLoadedImage(null); return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { if (!cancelled) setLoadedImage(img); };
    img.onerror = () => { if (!cancelled) setLoadedImage(null); };
    img.src = sign.image_url;
    return () => { cancelled = true; };
  }, [sign.image_url]);

  const { tex, w, h } = useMemo(() => {
    if (loadedImage) return makeImageTexture(loadedImage, lines, family, primaryColor);
    return makeSignTexture(lines, family, primaryColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedImage, lines, family, primaryColor, fontReady]);

  // Notify parent when this sign becomes selected/deselected
  useEffect(() => {
    onMeshRef?.(isSelected ? meshRef.current : null);
  }, [isSelected, onMeshRef]);

  return (
    <mesh
      ref={meshRef}
      position={[sign.x, sign.y + h / 2, sign.z]}
      rotation={[0, sign.rotation_y, 0]}
      renderOrder={10}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(sign.id); } : undefined}
    >
      <planeGeometry args={[w, h]} />
      {sign.use_tv_filter
        ? <TVSignMaterial tex={tex} intensity={sign.filter_intensity ?? 1.0} />
        : <meshBasicMaterial map={tex} transparent opacity={0.95} depthWrite={false} side={THREE.DoubleSide} />}
    </mesh>
  );
});

// ─── Font preloader ───────────────────────────────────────────────────────────

const useFontReady = (signs: SignData[], remoteFonts: RemoteFont[]) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const needed = new Set(signs.map(s => s.font_family).filter(Boolean) as string[]);
    const toLoad = remoteFonts.filter(rf => needed.has(rf.name));
    if (!toLoad.length) { setReady(true); return; }
    Promise.all(toLoad.map(rf => loadFont(rf.name, rf.url)))
      .finally(() => setReady(true));
  }, [signs, remoteFonts]);
  return ready;
};

// ─── Main export ─────────────────────────────────────────────────────────────

export const Signs = React.memo(({
  signs, remoteFonts = [], selectedId, onSelect, onMeshRef,
}: {
  signs: SignData[];
  remoteFonts?: RemoteFont[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  onMeshRef?: (mesh: THREE.Mesh | null) => void;
}) => {
  const theme = useContext(ThemeContext);
  const fontReady = useFontReady(signs, remoteFonts);
  if (!signs.length) return null;
  return (
    <group>
      {signs.map(s => (
        <SignMesh
          key={s.id}
          sign={s}
          primaryColor={theme.primary}
          fontReady={fontReady}
          isSelected={s.id === selectedId}
          onSelect={onSelect}
          onMeshRef={onMeshRef}
        />
      ))}
    </group>
  );
});
