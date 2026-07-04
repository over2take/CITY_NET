import React, { useMemo, useContext, useEffect, useState } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '../theme/themes';
import { loadFont, type RemoteFont } from '../utils/fontLoader';

export interface SignData {
  id: number;
  text: string;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  font_size: number;
  font_family?: string | null;
  image_url?: string | null;
  use_tv_filter?: number;
}

const PIXELS_PER_UNIT = 48;
const BORDER_PX = 3;
const H_PAD_RATIO = 0.35;
const V_PAD_RATIO = 0.4;

const makeTextTexture = (
  text: string,
  fontSizeUnits: number,
  fontFamily: string,
  primaryColor: string
): { tex: THREE.CanvasTexture; w: number; h: number } => {
  const px = Math.round(fontSizeUnits * PIXELS_PER_UNIT);
  const fontStr = `bold ${px}px ${fontFamily}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontStr;
  const measured = ctx.measureText(text).width;
  const hPad = px * H_PAD_RATIO;
  const vPad = px * V_PAD_RATIO;
  canvas.width = Math.ceil(measured + hPad * 2);
  canvas.height = Math.ceil(px + vPad * 2);
  ctx.fillStyle = '#030a03';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = BORDER_PX;
  ctx.strokeRect(BORDER_PX / 2, BORDER_PX / 2, canvas.width - BORDER_PX, canvas.height - BORDER_PX);
  ctx.font = fontStr;
  ctx.fillStyle = primaryColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const w = canvas.width / PIXELS_PER_UNIT;
  const h = canvas.height / PIXELS_PER_UNIT;
  return { tex: new THREE.CanvasTexture(canvas), w, h };
};

const SignMesh = React.memo(({
  sign,
  primaryColor,
  fontReady,
  onSelect,
}: {
  sign: SignData;
  primaryColor: string;
  fontReady: boolean;
  onSelect?: (id: number) => void;
}) => {
  const family = sign.font_family || 'monospace';
  const { tex, w, h } = useMemo(
    () => makeTextTexture(sign.text, sign.font_size, family, primaryColor),
    // fontReady in deps forces a re-render once the font loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sign.text, sign.font_size, family, primaryColor, fontReady]
  );

  return (
    <mesh
      position={[sign.x, sign.y + h / 2, sign.z]}
      rotation={[0, sign.rotation_y, 0]}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(sign.id); } : undefined}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={0.95}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
});

// Tracks which remote fonts are loaded so SignMesh can re-render
const useFontReady = (signs: SignData[], remoteFonts: RemoteFont[]) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const needed = new Set(
      signs.map(s => s.font_family).filter(Boolean) as string[]
    );
    const remoteNeeded = remoteFonts.filter(rf => needed.has(rf.name));
    if (remoteNeeded.length === 0) { setReady(true); return; }
    Promise.all(remoteNeeded.map(rf => loadFont(rf.name, rf.url)))
      .then(() => setReady(true))
      .catch(() => setReady(true)); // fall back to default font on error
  }, [signs, remoteFonts]);

  return ready;
};

export const Signs = React.memo(({
  signs,
  remoteFonts = [],
  onSelect,
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
        <SignMesh
          key={s.id}
          sign={s}
          primaryColor={theme.primary}
          fontReady={fontReady}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
});
