import { CONDITION_ICONS, isDrawnIcon, isUploadedIcon } from '../sheets/conditionIcons';
import type { ThrowFace, ThrowSymbol } from './trayThrow';

// What is printed on a die's face in the tray (6c4b2b; mockup builder-dice, decision 10): its words,
// or on a system's own die its number and each symbol's look, a drawing as its squares and an icon
// as itself. The log always writes the marks; the tray shows the looks.

/** One thing printed on a face, side by side with the rest. */
export type LabelPart = { text: string } | { drawn: string[] } | { icon: string };

/**
 * A face as parts. A face of a system's own die is its number (as its words begin with it) and a
 * part for each symbol, drawn or iconed where it has a look; anything else is its words, whole.
 */
export const labelParts = (face: ThrowFace, symbols: Map<string, ThrowSymbol>): LabelPart[] => {
  if (!face.s?.length) return face.text ? [{ text: face.text }] : [];
  const looks = face.s.map((id) => symbols.get(id) ?? { id, mark: '?' });
  const marks = looks.map((l) => l.mark).join('');
  const number = face.text.endsWith(marks) ? face.text.slice(0, face.text.length - marks.length) : '';
  return [
    ...(number ? [{ text: number }] : []),
    ...looks.map((l): LabelPart => (l.drawn ? { drawn: l.drawn } : l.icon ? { icon: l.icon } : { text: l.mark })),
  ];
};

/** One key per distinct face as printed, so dice showing the same face share one picture. */
export const labelKey = (parts: LabelPart[], color: string) => `${color}|${JSON.stringify(parts)}`;

const SIZE = 128;
const OUTLINE = 'rgba(0,0,0,0.85)';

/** The 16 by 16 squares of a drawing (each row 4 hex digits, as the DICE tab's pad keeps them). */
const squares = (rows: string[]) => rows.flatMap((row, y) => {
  const bits = parseInt(row, 16) || 0;
  return Array.from({ length: 16 }, (_, x) => x).filter((x) => bits & (0x8000 >> x)).map((x) => [x, y] as const);
});

/**
 * Paint `parts` onto a square canvas in `color`, outlined so they read on any die. An uploaded
 * icon is drawn once its picture has loaded, and `loaded` is called so the texture can be redrawn.
 */
export const paintLabel = (canvas: HTMLCanvasElement, parts: LabelPart[], color: string, loaded?: () => void) => {
  canvas.width = SIZE; canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g || !parts.length) return;
  const w = Math.min(SIZE * 0.66, (SIZE * 0.88) / parts.length);
  parts.forEach((part, i) => {
    const x0 = SIZE / 2 - (parts.length * w) / 2 + i * w;
    if ('text' in part) {
      const size = parts.length > 1 ? Math.min(w * 0.95, 70) : part.text.length > 4 ? 34 : part.text.length > 2 ? 46 : 78;
      g.font = `bold ${size}px "Courier New", monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.lineJoin = 'round'; g.strokeStyle = OUTLINE; g.fillStyle = color;
      g.strokeText(part.text, x0 + w / 2, SIZE / 2 + 4); g.fillText(part.text, x0 + w / 2, SIZE / 2 + 4);
    } else if ('drawn' in part) {
      const px = w / 16; const top = SIZE / 2 - w / 2;
      g.fillStyle = OUTLINE;
      for (const [x, y] of squares(part.drawn)) g.fillRect(x0 + x * px - 2, top + y * px - 2, px + 4, px + 4);
      g.fillStyle = color;
      for (const [x, y] of squares(part.drawn)) g.fillRect(x0 + x * px, top + y * px, px + 0.5, px + 0.5);
    } else if (isUploadedIcon(part.icon)) {
      const img = new Image();
      img.onload = () => { g.drawImage(img, x0 + w * 0.08, SIZE / 2 - w * 0.42, w * 0.84, w * 0.84); loaded?.(); };
      img.src = part.icon;
    } else if (typeof Path2D !== 'undefined') {
      const paths = CONDITION_ICONS[isDrawnIcon(part.icon) ? part.icon : 'target'];
      g.save();
      g.translate(x0 + w * 0.08, SIZE / 2 - w * 0.42);
      g.scale((w * 0.84) / 24, (w * 0.84) / 24);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [stroke, width] of [[OUTLINE, 5], [color, 2.2]] as const) {
        g.strokeStyle = stroke; g.lineWidth = width;
        for (const d of paths) g.stroke(new Path2D(d));
      }
      g.restore();
    }
  });
};
