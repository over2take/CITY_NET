import React, { useMemo, useContext } from 'react';
import * as THREE from 'three';
import { ThemeContext } from '../theme/themes';

export interface SignData {
  id: number;
  text: string;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  font_size: number;
  image_url?: string | null;
  use_tv_filter?: number;
}

const PIXELS_PER_UNIT = 48;
const BORDER_PX = 3;
const H_PAD_RATIO = 0.35;
const V_PAD_RATIO = 0.4;

const makeTextTexture = (text: string, fontSizeUnits: number, primaryColor: string): { tex: THREE.CanvasTexture; w: number; h: number } => {
  const px = Math.round(fontSizeUnits * PIXELS_PER_UNIT);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${px}px monospace`;
  const measured = ctx.measureText(text).width;
  const hPad = px * H_PAD_RATIO;
  const vPad = px * V_PAD_RATIO;
  canvas.width = Math.ceil(measured + hPad * 2);
  canvas.height = Math.ceil(px + vPad * 2);
  // background
  ctx.fillStyle = '#030a03';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // border
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = BORDER_PX;
  ctx.strokeRect(BORDER_PX / 2, BORDER_PX / 2, canvas.width - BORDER_PX, canvas.height - BORDER_PX);
  // text
  ctx.font = `bold ${px}px monospace`;
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
  onSelect,
}: {
  sign: SignData;
  primaryColor: string;
  onSelect?: (id: number) => void;
}) => {
  const { tex, w, h } = useMemo(
    () => makeTextTexture(sign.text, sign.font_size, primaryColor),
    [sign.text, sign.font_size, primaryColor]
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

export const Signs = React.memo(({
  signs,
  onSelect,
}: {
  signs: SignData[];
  onSelect?: (id: number) => void;
}) => {
  const theme = useContext(ThemeContext);
  if (!signs.length) return null;
  return (
    <group>
      {signs.map(s => (
        <SignMesh key={s.id} sign={s} primaryColor={theme.primary} onSelect={onSelect} />
      ))}
    </group>
  );
});
