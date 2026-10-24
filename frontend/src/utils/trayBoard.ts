// What DICE_TRAY.EXE's board shows (6c4e; approved mockup docs/mockups/tray-scoreboard.html v3,
// 2026-10-23): a 16 by 2 character display, each character 5 by 7 dots, as 80s character modules
// drew them. A lone plain total fills both lines in big digits, as the old board did; anything
// else is lines of words, centered: what each roll was for and came to, the server's words for it
// (6c4d1-3), the symbols left or the faces rolled, and its outcome on a line of its own. A group's
// rolls (an attack's to-hit and damage) each take a line, their outcomes beside them where they
// fit. More than two lines turn pages. Pure: the board (components/DiceTray.tsx) paints what this
// works out.

export const COLS = 16;
export const ROWS = 2;
/** The dots across and down: 16 cells of 5, 2 cells of 7. */
export const WIDTH = COLS * 5;
export const HEIGHT = ROWS * 7;

/** How long each page of a result stays up, and how long a result stays before the board waits. */
export const PAGE_MS = 2100;
export const HOLD_MS = 10_000;
/** How long the letters take to decode into a result once the dice are down. */
export const SETTLE_MS = 450;

/** 5 by 7 letters, row by row. */
const G5: Record<string, string> = {
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111', '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
  A: '01110100011000110001111111000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11100100101000110001100011001011100',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100011000101010001000010000100', Z: '11111000010001000100010001000011111',
  '+': '00000001000010011111001000010000000', '-': '00000000000000011111000000000000000',
  '·': '00000000000000000100000000000000000', ':': '00000011000110000000011000110000000',
  ',': '00000000000000000000011000010001000', '.': '00000000000000000000000000110001100',
  _: '00000000000000000000000000000011111', '/': '00000000010001000100010001000000000',
  '!': '00100001000010000100001000000000100', '?': '01110100010000100010001000000000100',
  '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000',
  "'": '00100001000100000000000000000000000', '=': '00000000001111100000111110000000000',
  '%': '11000110010001000100010001001100011', '#': '01010010101111101010111110101001010',
  '&': '01100100101010001000101011001001101', '<': '00010001000100010000010000010000010',
  '>': '01000001000001000001000100010001000', ' ': '00000000000000000000000000000000000',
};

/** 3 by 5 digits, for a plain total drawn big across both lines. */
const G3: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  '-': '000000111000000',
};

/** What the noise of rolling and decoding is made of. */
export const NOISE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-:';

/** A roll as the board reads it: the server's total, whether dice were thrown, and its board words. */
export interface BoardRoll {
  total: number;
  results?: Record<string, unknown>;
  board?: { label?: string; words?: string; outcome?: string };
}

/** What a result shows: a lone plain total in big digits, or lines of up to 16. */
export type BoardShow = { big: string } | { lines: string[] };

/** Text in what the board can draw: capitals, a few look-alikes, and a space for anything else. */
export const boardText = (text: string): string => [...String(text).toUpperCase()
  .replace(/×/g, 'X').replace(/[—–]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()]
  .map((ch) => (G5[ch] ? ch : ' ')).join('');

/** Words into lines of 16: a long one broken at its spaces, or cut where it has none. */
const fill = (parts: string[], gaps: string[]): string[] => {
  const lines: string[] = [];
  let line = '';
  parts.forEach((part, i) => {
    const pieces = part.length > COLS ? part.split(' ').filter(Boolean) : [part];
    pieces.forEach((piece, k) => {
      const gap = k > 0 ? ' ' : gaps[i] ?? '  ';
      const next = line ? `${line}${gap}${piece}` : piece;
      if (next.length <= COLS) { line = next; return; }
      if (line) lines.push(line);
      line = piece.slice(0, COLS);
    });
  });
  if (line) lines.push(line);
  return lines;
};

/** One roll's lines: its name and what it came to, the outcome after, beside it when `inline` and it fits. */
const linesOfRoll = (r: BoardRoll, inline: boolean): string[] => {
  const label = r.board?.label ? boardText(r.board.label) : '';
  const outcome = r.board?.outcome ? boardText(r.board.outcome) : '';
  const thrown = !!r.results && Object.keys(r.results).length > 0;
  // A roll of no dice and nothing to count (a spell with no damage) says only what it was.
  const value = r.board?.words != null ? boardText(r.board.words) : thrown || r.total !== 0 ? String(r.total) : '';
  const items = value ? value.split(' · ').filter(Boolean) : [];
  const parts = [...(label ? [label] : []), ...items];
  const lines = fill(parts, parts.map((_, i) => (i === 1 && label ? ' ' : '  ')));
  if (!outcome) return lines;
  const lastAt = lines.length - 1;
  if (inline && lastAt >= 0 && `${lines[lastAt]} ${outcome}`.length <= COLS) return [...lines.slice(0, lastAt), `${lines[lastAt]} ${outcome}`];
  return [...lines, ...fill([outcome], [''])];
};

/**
 * What a group's rolls show once landed. One roll with nothing but a plain total of up to four
 * figures: big digits. Otherwise lines: a single roll's outcome on a line of its own (decided
 * 2026-10-23), a group's beside each roll where it fits.
 */
export const showOf = (rolls: BoardRoll[]): BoardShow => {
  if (!rolls.length) return { lines: [] };
  const [only] = rolls;
  if (rolls.length === 1 && !only.board?.label && only.board?.words == null && !only.board?.outcome && /^-?\d{1,4}$/.test(String(only.total))) {
    return { big: String(only.total) };
  }
  return { lines: rolls.flatMap((r) => linesOfRoll(r, rolls.length > 1)) };
};

/** A line of up to 16, centered: what is left over goes half to each side, the odd one to the right. */
export const centerLine = (s: string): string => {
  const t = s.slice(0, COLS);
  return (' '.repeat(Math.floor((COLS - t.length) / 2)) + t).padEnd(COLS);
};

/** The two lines on show `since` ms after the result landed, turning pages when there are more. */
export const pageOf = (lines: string[], since: number): [string, string] => {
  const shown = lines.length === 1 ? ['', lines[0]] : lines;
  const pages = Math.max(1, Math.ceil(shown.length / 2));
  const page = pages > 1 ? Math.floor(Math.max(0, since) / PAGE_MS) % pages : 0;
  return [centerLine(shown[page * 2] ?? ''), centerLine(shown[page * 2 + 1] ?? '')];
};

/** How many pages a result turns through. */
export const pagesOf = (show: BoardShow): number => ('big' in show ? 1 : Math.max(1, Math.ceil((show.lines.length === 1 ? 2 : show.lines.length) / 2)));

/** What a result says, for a screen reader and for the eye in one line. */
export const sayOf = (show: BoardShow): string => ('big' in show ? show.big : show.lines.join(' / '));

export type Field = number[][];
export const emptyField = (): Field => Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));

/** A character into its cell. */
export const putChar = (f: Field, row: number, col: number, ch: string) => {
  const bits = G5[ch] ?? G5[' '];
  for (let k = 0; k < 35; k += 1) f[row * 7 + Math.floor(k / 5)][col * 5 + (k % 5)] = bits[k] === '1' ? 1 : 0;
};

/** Two lines of 16 into the field. */
export const putLines = (f: Field, lines: [string, string]) => lines.forEach((line, row) => [...line].forEach((ch, col) => putChar(f, row, col, ch)));

/** A plain total in big digits across both lines: each 3 by 5 digit drawn 12 dots wide and 14 tall. */
export const putBig = (f: Field, digits: string) => {
  const width = digits.length * 12 + (digits.length - 1) * 4;
  let x0 = Math.floor((WIDTH - width) / 2);
  for (const d of digits) {
    const g = G3[d];
    if (g) {
      for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < 12; x += 1) {
        if (g[Math.min(4, Math.floor((y * 5) / HEIGHT)) * 3 + Math.floor(x / 4)] === '1') f[y][x0 + x] = 1;
      }
    }
    x0 += 16;
  }
};

/** The result into the field, `since` ms after it landed. */
export const putShow = (f: Field, show: BoardShow, since: number) => {
  if ('big' in show) putBig(f, show.big);
  else putLines(f, pageOf(show.lines, since));
};

/** Cells from `from` on, every row, as noise: the dice still rolling, or the letters not yet decoded. */
export const putNoise = (f: Field, from = 0, random: () => number = Math.random) => {
  for (let r = 0; r < ROWS; r += 1) for (let c = from; c < COLS; c += 1) putChar(f, r, c, NOISE[Math.floor(random() * NOISE.length)]);
};

/** How many cells have decoded `since` ms after the dice came down. */
export const decodedAt = (since: number): number => Math.max(0, Math.min(COLS, Math.floor((since / SETTLE_MS) * COLS)));

/** Waiting: DICE_TRAY.EXE above a blinking READY_, the first of the pictures taking turns (utils/trayWaiting.ts). */
export const putReady = (f: Field, t: number) => putLines(f, [centerLine('DICE_TRAY.EXE'), centerLine(`READY${Math.floor(t / 530) % 2 ? '_' : ' '}`)]);
