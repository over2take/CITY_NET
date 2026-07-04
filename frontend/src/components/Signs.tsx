import React, { useMemo, useContext, useEffect, useState } from 'react';
import * as THREE from 'three';
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
}

// ─── Canvas rendering ────────────────────────────────────────────────────────

const PIXELS_PER_UNIT = 48;
const BORDER_PX = 3;
const H_PAD_RATIO = 0.4;
const V_PAD_RATIO = 0.35;
const LINE_GAP_RATIO = 0.3; // gap between lines as fraction of that line's px height

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

// ─── Sign mesh ───────────────────────────────────────────────────────────────

const SignMesh = React.memo(({
  sign, primaryColor, fontReady, onSelect,
}: {
  sign: SignData;
  primaryColor: string;
  fontReady: boolean;
  onSelect?: (id: number) => void;
}) => {
  const family = sign.font_family || 'monospace';
  const lines  = useMemo(() => resolveLines(sign), [sign]);

  const { tex, w, h } = useMemo(
    () => makeSignTexture(lines, family, primaryColor),
    // fontReady triggers re-render once remote font is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, family, primaryColor, fontReady]
  );

  return (
    <mesh
      position={[sign.x, sign.y + h / 2, sign.z]}
      rotation={[0, sign.rotation_y, 0]}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(sign.id); } : undefined}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.95} depthWrite={false} side={THREE.DoubleSide} />
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
  signs, remoteFonts = [], onSelect,
}: {
  signs: SignData[];
  remoteFonts?: RemoteFont[];
  onSelect?: (id: number) => void;
}) => {
  const theme = useContext(ThemeContext);
  const fontReady = useFontReady(signs, remoteFonts);
  if (!signs.length) return null;
  return (
    <group>
      {signs.map(s => (
        <SignMesh key={s.id} sign={s} primaryColor={theme.primary} fontReady={fontReady} onSelect={onSelect} />
      ))}
    </group>
  );
});
