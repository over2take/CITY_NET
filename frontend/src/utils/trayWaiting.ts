// What DICE_TRAY.EXE's board shows while it waits for a roll (6c4f; approved mockup
// docs/mockups/tray-scoreboard.html v3, 2026-10-23): pictures drawn in its dots, taking turns,
// READY_ first. PONG plays itself and SNAKE steers itself (the user: "Snake plays it's self"). Each
// draws into the board's field (utils/trayBoard.ts) for a time `t` into its turn; SNAKE and PIPES
// keep their own state from frame to frame, and start afresh when `t` goes back: their turn come
// round again, or waiting begun again.

import { WIDTH, HEIGHT, putReady, type Field } from './trayBoard';

/** How long each picture has before the next takes over. */
export const TURN_MS = 7000;

type Random = () => number;
export interface Waiter {
  /** Into `f`, `t` ms into its turn. */
  draw: (f: Field, t: number) => void;
}

const inField = (x: number, y: number) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** Back and forth along 0..span. */
const bounce = (p: number, span: number) => { const m = p % (2 * span); return m < span ? m : 2 * span - m; };

/** DICE_TRAY.EXE above a blinking READY_. */
const ready = (): Waiter => ({ draw: (f, t) => putReady(f, t) });

/** A ball bouncing round the field, a paddle at each side following it. */
const pong = (): Waiter => ({
  draw: (f, t) => {
    const s = t / 1000;
    const bx = 2 + Math.floor(bounce(s * 34, WIDTH - 6));
    const by = Math.floor(bounce(s * 13, HEIGHT - 2));
    f[by][bx] = 1; f[by][bx + 1] = 1; f[by + 1][bx] = 1; f[by + 1][bx + 1] = 1;
    const top = Math.max(0, Math.min(HEIGHT - 4, by - 1));
    for (const x of [0, WIDTH - 1]) for (let y = top; y < top + 4; y += 1) f[y][x] = 1;
  },
});

/** Drops of three falling down every column, each at its own pace. */
const rain = (): Waiter => ({
  draw: (f, t) => {
    for (let x = 0; x < WIDTH; x += 1) {
      const rate = 6 + ((x * 7) % 5) * 2;
      const offset = (x * 37) % 23;
      const head = (Math.floor((t / 1000) * rate + offset) % (HEIGHT + 8)) - 4;
      for (let k = 0; k < 3; k += 1) {
        const y = head - k * 2;
        if (y >= 0 && y < HEIGHT && (k === 0 || (x + k) % 2 === 0)) f[y][x] = 1;
      }
    }
  },
});

/** A bar sweeping side to side, a flicker trailing it. */
const scan = (): Waiter => ({
  draw: (f, t) => {
    const x = bounce(Math.floor((t / 1000) * 45), WIDTH - 3);
    for (let y = 0; y < HEIGHT; y += 1) {
      f[y][x + 1] = 1; f[y][x + 2] = 1;
      if ((y + Math.floor(t / 120)) % 3 === 0) f[y][x] = 1;
    }
  },
});

/** A snake that steers itself toward the food, never into itself or a wall; full grown, it starts again. */
export const SNAKE_STEP_MS = 55;
export const SNAKE_MOST = 60;
export const makeSnake = (random: Random): Waiter & { readonly length: number } => {
  let body: [number, number][] = [];
  let dir = 0;
  let food: [number, number] = [0, 0];
  let last = 0;
  const free = (): [number, number] => {
    for (let i = 0; i < 1000; i += 1) {
      const p: [number, number] = [Math.floor(random() * WIDTH), Math.floor(random() * HEIGHT)];
      if (!body.some(([x, y]) => x === p[0] && y === p[1])) return p;
    }
    return [0, 0];
  };
  const reset = () => { body = [[10, 7], [9, 7], [8, 7], [7, 7]]; dir = 0; food = free(); last = 0; };
  const step = () => {
    const [hx, hy] = body[0];
    const options = [dir, (dir + 1) % 4, (dir + 3) % 4].map((d) => ({ d, x: hx + DIRS[d][0], y: hy + DIRS[d][1] }))
      .filter((o) => inField(o.x, o.y) && !body.slice(0, -1).some(([x, y]) => x === o.x && y === o.y))
      .sort((a, b) => (Math.abs(a.x - food[0]) + Math.abs(a.y - food[1])) - (Math.abs(b.x - food[0]) + Math.abs(b.y - food[1])));
    if (!options.length) { reset(); return; }
    const next = options[0];
    dir = next.d;
    body.unshift([next.x, next.y]);
    if (next.x === food[0] && next.y === food[1]) { if (body.length > SNAKE_MOST) reset(); else food = free(); } else body.pop();
  };
  reset();
  return {
    get length() { return body.length; },
    draw: (f, t) => {
      if (t < last) reset();
      while (last + SNAKE_STEP_MS <= t) { step(); last += SNAKE_STEP_MS; }
      for (const [x, y] of body) f[y][x] = 1;
      if (Math.floor(t / 200) % 2) f[food[1]][food[0]] = 1;
    },
  };
};

/** Pipes laid a dot at a time, turning now and then; full enough, wiped and laid again. */
export const PIPES_STEP_MS = 28;
const pipes = (random: Random): Waiter => {
  let lit: number[][] = [];
  let head = { x: 0, y: 0, dir: 0 };
  let last = 0;
  let count = 0;
  // A pipe begins where it starts, lit at once rather than a blank board for a step.
  const start = () => {
    head = { x: Math.floor(random() * WIDTH), y: Math.floor(random() * HEIGHT), dir: Math.floor(random() * 4) };
    lit[head.y][head.x] = 1;
  };
  const reset = () => { lit = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0)); count = 0; last = 0; start(); };
  const step = () => {
    const turn = random() < 0.18;
    const tries = turn ? [(head.dir + (random() < 0.5 ? 1 : 3)) % 4, head.dir] : [head.dir, (head.dir + 1) % 4, (head.dir + 3) % 4];
    const go = tries.find((d) => inField(head.x + DIRS[d][0], head.y + DIRS[d][1]) && !lit[head.y + DIRS[d][1]][head.x + DIRS[d][0]]);
    if (go === undefined) { start(); return; }
    head = { x: head.x + DIRS[go][0], y: head.y + DIRS[go][1], dir: go };
    lit[head.y][head.x] = 1;
    count += 1;
    if (count > WIDTH * HEIGHT * 0.55) reset();
  };
  reset();
  return {
    draw: (f, t) => {
      if (t < last) reset();
      while (last + PIPES_STEP_MS <= t) { step(); last += PIPES_STEP_MS; }
      for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) if (lit[y][x]) f[y][x] = 1;
      if (Math.floor(t / 150) % 2) f[head.y][head.x] = 0;
    },
  };
};

/** The pictures, in the order they take turns: READY_ first, so a tray just opened says so. */
export const ORDER = ['ready', 'pong', 'snake', 'rain', 'pipes', 'scan'] as const;
export type WaiterKind = (typeof ORDER)[number];
const MAKE: Record<WaiterKind, (random: Random) => Waiter> = { ready, pong, snake: makeSnake, rain, pipes, scan };

/** Whose turn it is `t` ms into waiting, and when that turn began. */
export const turnAt = (t: number): { kind: WaiterKind; from: number } => {
  const n = Math.floor(Math.max(0, t) / TURN_MS);
  return { kind: ORDER[n % ORDER.length], from: n * TURN_MS };
};

/** The board waiting: `draw(f, t)` puts in the picture whose turn it is `t` ms into waiting. */
export const makeWaiting = (random: Random = Math.random) => {
  const waiters = Object.fromEntries(ORDER.map((k) => [k, MAKE[k](random)])) as Record<WaiterKind, Waiter>;
  return (f: Field, t: number): WaiterKind => {
    const turn = turnAt(t);
    waiters[turn.kind].draw(f, t - turn.from);
    return turn.kind;
  };
};
