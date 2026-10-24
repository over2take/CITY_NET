// What DICE_TRAY.EXE's board shows while it waits for a roll (6c4f; approved mockup
// docs/mockups/tray-scoreboard.html v3, 2026-10-23): a picture drawn in its dots, one for the whole
// wait, the next one the next time it waits (the user, 2026-10-24: it stays on one till a roll
// happens, then changes), READY_ first. PONG plays itself and SNAKE steers itself (the user: "Snake
// plays it's self"). Each draws into the board's field (utils/trayBoard.ts) for a time `t` into
// the wait; SNAKE and PIPES keep their own state from frame to frame, start afresh when `t` goes
// back (a new wait), and start again by themselves when full, so one can run for as long as a
// table is quiet.

import { WIDTH, HEIGHT, putReady, putSmall, type Field } from './trayBoard';

type Random = () => number;
export interface Waiter {
  /** Into `f`, `t` ms into its turn. */
  draw: (f: Field, t: number) => void;
}

const inField = (x: number, y: number) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/**
 * The most a picture that steps through time catches up in one frame. Further behind (a tab left in
 * the background, a slow machine), it skips ahead rather than replaying it all, so a frame can never
 * take long, whatever happens in a picture.
 */
export const MOST_BEHIND_MS = 5000;
const caughtUp = (last: number, t: number) => Math.max(last, t - MOST_BEHIND_MS);

/** Back and forth along 0..span. */
const bounce = (p: number, span: number) => { const m = p % (2 * span); return m < span ? m : 2 * span - m; };

/** DICE_TRAY.EXE above a blinking READY_. */
const ready = (): Waiter => ({ draw: (f, t) => putReady(f, t) });

/**
 * PONG, played (the user, 2026-10-24: "let them score or move more like they are actually
 * playing"): two paddles that chase the ball only when it comes their way, at a paddle's speed,
 * aiming a little off each rally, so a steep shot can beat them. Where the ball meets a paddle sets
 * its angle, and each return is a little faster. A miss is a point: the scores at the top either
 * side of a dashed net, as the arcade drew them, a pause and a serve from the middle, and back to
 * 0-0 after a 9.
 */
export const PONG_STEP_MS = 20;
export const PONG_TO = 9;
const PADDLE = 4;
const PADDLE_SPEED = 13;
export const makePong = (random: Random): Waiter & { readonly score: [number, number] } => {
  let ball = { x: 0, y: 0, vx: 0, vy: 0 };
  let paddles = [0, 0];
  let aim = [0, 0];
  let score: [number, number] = [0, 0];
  let serveAt = 0;
  let clock = 0;
  let last = 0;
  /** From the middle, toward `side` (0 left, 1 right), at an angle of its own. */
  const serve = (side: number) => {
    ball = { x: WIDTH / 2 - 1, y: 2 + random() * (HEIGHT - 6), vx: (side ? 1 : -1) * 32, vy: (random() * 2 - 1) * 14 };
    aim = [(random() * 2 - 1) * 3, (random() * 2 - 1) * 3];
  };
  const reset = () => {
    paddles = [HEIGHT / 2 - PADDLE / 2, HEIGHT / 2 - PADDLE / 2];
    score = [0, 0];
    clock = 0; last = 0; serveAt = 400;
    serve(random() < 0.5 ? 0 : 1);
  };
  const step = (dt: number) => {
    clock += dt * 1000;
    // Each paddle chases the ball when it comes its way, else drifts back to the middle.
    for (const side of [0, 1]) {
      const coming = side === 0 ? ball.vx < 0 : ball.vx > 0;
      const want = coming && clock >= serveAt ? ball.y + 1 - PADDLE / 2 + aim[side] : HEIGHT / 2 - PADDLE / 2;
      const move = Math.max(-PADDLE_SPEED * dt, Math.min(PADDLE_SPEED * dt, want - paddles[side]));
      paddles[side] = Math.max(0, Math.min(HEIGHT - PADDLE, paddles[side] + move));
    }
    if (clock < serveAt) return;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.y < 0) { ball.y = -ball.y; ball.vy = Math.abs(ball.vy); }
    if (ball.y > HEIGHT - 2) { ball.y = 2 * (HEIGHT - 2) - ball.y; ball.vy = -Math.abs(ball.vy); }
    for (const side of [0, 1]) {
      const face = side === 0 ? 1 : WIDTH - 3;
      const reached = side === 0 ? ball.x <= face && ball.vx < 0 : ball.x >= face && ball.vx > 0;
      if (!reached) continue;
      const offset = (ball.y + 1) - (paddles[side] + PADDLE / 2);
      if (Math.abs(offset) <= PADDLE / 2 + 0.6) {
        // Returned: the angle from where it met the paddle, a little faster, a new aim for both.
        ball.x = face;
        ball.vx = -ball.vx * 1.06;
        ball.vx = Math.sign(ball.vx) * Math.min(70, Math.abs(ball.vx));
        ball.vy = Math.max(-26, Math.min(26, ball.vy * 0.4 + offset * 9 + (random() * 2 - 1) * 4));
        aim = [(random() * 2 - 1) * 3, (random() * 2 - 1) * 3];
      } else if (side === 0 ? ball.x < -2 : ball.x > WIDTH) {
        // Missed: a point to the other side, and a serve toward the one who missed.
        score[1 - side] += 1;
        if (score[1 - side] > PONG_TO) score = [0, 0];
        serveAt = clock + 700;
        serve(side);
      }
    }
  };
  reset();
  return {
    get score() { return score; },
    draw: (f, t) => {
      if (t < last) reset();
      last = caughtUp(last, t);
      while (last + PONG_STEP_MS <= t) { step(PONG_STEP_MS / 1000); last += PONG_STEP_MS; }
      // The net, dashed, and the scores either side of it.
      for (let y = 0; y < HEIGHT; y += 2) f[y][WIDTH / 2] = 1;
      putSmall(f, WIDTH / 2 - 5, 1, String(score[0]));
      putSmall(f, WIDTH / 2 + 3, 1, String(score[1]));
      for (const [side, x] of [[0, 0], [1, WIDTH - 1]]) {
        const top = Math.round(paddles[side]);
        for (let y = top; y < top + PADDLE; y += 1) f[y][x] = 1;
      }
      // The ball: two by two, hidden for a moment before each serve.
      if (clock >= serveAt || Math.floor(t / 150) % 2) {
        const bx = Math.round(ball.x);
        const by = Math.round(ball.y);
        for (const [x, y] of [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]]) if (inField(x, y)) f[y][x] = 1;
      }
    },
  };
};

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
  // Starting over (full grown, or boxed in) leaves the clock alone, so drawing catches up to now; only a
  // new wait, its time going back, sets the clock back too. Setting it back on every start over sent
  // the catching up round for ever once a snake could fill up within a wait.
  const restart = () => { body = [[10, 7], [9, 7], [8, 7], [7, 7]]; dir = 0; food = free(); };
  const reset = () => { restart(); last = 0; };
  const step = () => {
    const [hx, hy] = body[0];
    const options = [dir, (dir + 1) % 4, (dir + 3) % 4].map((d) => ({ d, x: hx + DIRS[d][0], y: hy + DIRS[d][1] }))
      .filter((o) => inField(o.x, o.y) && !body.slice(0, -1).some(([x, y]) => x === o.x && y === o.y))
      .sort((a, b) => (Math.abs(a.x - food[0]) + Math.abs(a.y - food[1])) - (Math.abs(b.x - food[0]) + Math.abs(b.y - food[1])));
    if (!options.length) { restart(); return; }
    const next = options[0];
    dir = next.d;
    body.unshift([next.x, next.y]);
    if (next.x === food[0] && next.y === food[1]) { if (body.length > SNAKE_MOST) restart(); else food = free(); } else body.pop();
  };
  reset();
  return {
    get length() { return body.length; },
    draw: (f, t) => {
      if (t < last) reset();
      last = caughtUp(last, t);
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
  // As the snake's: wiping a full board leaves the clock alone; only a new wait sets it back.
  const restart = () => { lit = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0)); count = 0; start(); };
  const reset = () => { restart(); last = 0; };
  const step = () => {
    const turn = random() < 0.18;
    const tries = turn ? [(head.dir + (random() < 0.5 ? 1 : 3)) % 4, head.dir] : [head.dir, (head.dir + 1) % 4, (head.dir + 3) % 4];
    const go = tries.find((d) => inField(head.x + DIRS[d][0], head.y + DIRS[d][1]) && !lit[head.y + DIRS[d][1]][head.x + DIRS[d][0]]);
    if (go === undefined) { start(); return; }
    head = { x: head.x + DIRS[go][0], y: head.y + DIRS[go][1], dir: go };
    lit[head.y][head.x] = 1;
    count += 1;
    if (count > WIDTH * HEIGHT * 0.55) restart();
  };
  reset();
  return {
    draw: (f, t) => {
      if (t < last) reset();
      last = caughtUp(last, t);
      while (last + PIPES_STEP_MS <= t) { step(); last += PIPES_STEP_MS; }
      for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) if (lit[y][x]) f[y][x] = 1;
      // The head blinks, but not while it is the only dot: a board just wiped never goes blank.
      if (count > 1 && Math.floor(t / 150) % 2) f[head.y][head.x] = 0;
    },
  };
};

/** The pictures, one wait each in this order: READY_ first, so a tray just opened says so. */
export const ORDER = ['ready', 'pong', 'snake', 'rain', 'pipes', 'scan'] as const;
export type WaiterKind = (typeof ORDER)[number];
const MAKE: Record<WaiterKind, (random: Random) => Waiter> = { ready, pong: makePong, snake: makeSnake, rain, pipes, scan };

/** The picture for the board's `nth` wait (from 0), round again after the last. */
export const pictureFor = (nth: number): WaiterKind => ORDER[((Math.floor(nth) % ORDER.length) + ORDER.length) % ORDER.length];

/** The board waiting: `draw(f, t, nth)` puts in its `nth` wait's picture, `t` ms into the wait. */
export const makeWaiting = (random: Random = Math.random) => {
  const waiters = Object.fromEntries(ORDER.map((k) => [k, MAKE[k](random)])) as Record<WaiterKind, Waiter>;
  return (f: Field, t: number, nth: number): WaiterKind => {
    const kind = pictureFor(nth);
    waiters[kind].draw(f, t);
    return kind;
  };
};
