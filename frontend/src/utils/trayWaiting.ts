// What DICE_TRAY.EXE's board shows while it waits for a roll (6c4f; approved mockup
// docs/mockups/tray-scoreboard.html v3, 2026-10-23): a picture drawn in its dots, one for the whole
// wait, the next one the next time it waits (the user, 2026-10-24: it stays on one till a roll
// happens, then changes), READY_ first. The games play themselves (the user: "Snake
// plays it's self"). Each draws into the board's field (utils/trayBoard.ts) for a time `t` into
// the wait. The games, and PIPES, keep their own state from frame to frame, start afresh when `t`
// goes back (a new wait), and go on by themselves when full or done (a new wall, an emptied well),
// so one can run for as long as a table is quiet; STARFIELD and TUMBLING DICE work out each frame
// from `t` alone.

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

/**
 * BREAKOUT, played: three rows of bricks along the top, a paddle on the bottom row that chases the
 * ball with an aim a little off each time, so now and then it misses and a new ball comes; a wall
 * broken through is built again.
 */
export const BREAKOUT_STEP_MS = 20;
const BRICK_ROWS = [1, 3, 5];
const BRICK_W = 4;
const BRICKS_PER_ROW = 16;
const BAT = 8;
const brickX = (k: number) => k * 5 + 1;
export const makeBreakout = (random: Random): Waiter & { readonly bricks: number; readonly balls: number } => {
  let bricks: boolean[][] = [];
  let ball = { x: 0, y: 0, vx: 0, vy: 0 };
  let bat = 0;
  let aim = 0;
  let waitUntil = 0;
  let clock = 0;
  let last = 0;
  let balls = 0;
  const wall = () => { bricks = BRICK_ROWS.map(() => Array(BRICKS_PER_ROW).fill(true)); };
  const serve = () => {
    ball = { x: bat + BAT / 2, y: HEIGHT - 3, vx: (random() < 0.5 ? -1 : 1) * (16 + random() * 10), vy: -(11 + random() * 4) };
    aim = (random() * 2 - 1) * 4;
    balls += 1;
  };
  const reset = () => { wall(); bat = WIDTH / 2 - BAT / 2; clock = 0; last = 0; balls = 0; waitUntil = 300; serve(); };
  const brickAt = (x: number, y: number) => {
    const row = BRICK_ROWS.indexOf(y);
    if (row < 0) return null;
    const k = Math.floor((x - 1) / 5);
    if (k < 0 || k >= BRICKS_PER_ROW || x - 1 - k * 5 >= BRICK_W || !bricks[row][k]) return null;
    return [row, k] as const;
  };
  const step = (dt: number) => {
    clock += dt * 1000;
    // The bat chases where the ball is, with its aim, when the ball comes down.
    const want = ball.vy > 0 ? ball.x - BAT / 2 + aim : WIDTH / 2 - BAT / 2;
    bat = Math.max(0, Math.min(WIDTH - BAT, bat + Math.max(-28 * dt, Math.min(28 * dt, want - bat))));
    if (clock < waitUntil) { ball.x = bat + BAT / 2; return; }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.x < 0) { ball.x = -ball.x; ball.vx = Math.abs(ball.vx); }
    if (ball.x > WIDTH - 1) { ball.x = 2 * (WIDTH - 1) - ball.x; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < 0) { ball.y = -ball.y; ball.vy = Math.abs(ball.vy); }
    const hit = brickAt(Math.round(ball.x), Math.round(ball.y));
    if (hit) {
      bricks[hit[0]][hit[1]] = false;
      ball.vy = -ball.vy;
      if (bricks.every((row) => row.every((b) => !b))) { wall(); waitUntil = clock + 800; }
    }
    if (ball.vy > 0 && ball.y >= HEIGHT - 2) {
      const offset = ball.x - (bat + BAT / 2);
      if (Math.abs(offset) <= BAT / 2 + 0.5) {
        ball.y = HEIGHT - 2;
        ball.vy = -Math.abs(ball.vy);
        ball.vx = Math.max(-30, Math.min(30, ball.vx * 0.6 + offset * 5));
        if (Math.abs(ball.vx) < 6) ball.vx = Math.sign(ball.vx || 1) * 6;
        aim = (random() * 2 - 1) * 4;
      } else if (ball.y > HEIGHT) {
        waitUntil = clock + 600;
        serve();
      }
    }
  };
  reset();
  return {
    get bricks() { return bricks.flat().filter(Boolean).length; },
    get balls() { return balls; },
    draw: (f, t) => {
      if (t < last) reset();
      last = caughtUp(last, t);
      while (last + BREAKOUT_STEP_MS <= t) { step(BREAKOUT_STEP_MS / 1000); last += BREAKOUT_STEP_MS; }
      BRICK_ROWS.forEach((y, row) => bricks[row].forEach((on, k) => { if (on) for (let x = 0; x < BRICK_W; x += 1) f[y][brickX(k) + x] = 1; }));
      for (let x = Math.round(bat); x < Math.round(bat) + BAT; x += 1) if (inField(x, HEIGHT - 1)) f[HEIGHT - 1][x] = 1;
      const bx = Math.round(ball.x);
      const by = Math.round(ball.y);
      if (inField(bx, by)) f[by][bx] = 1;
    },
  };
};

/**
 * BLOCKS: a falling game across the whole board (the user, 2026-10-24), with shapes of our own
 * rather than Tetris's (2026-10-23): the token's diamond, a cup, a bolt, a tower, a corner and a
 * bar, three and five dots, none of them a Tetris piece. Each piece comes in somewhere along the top
 * at random (the user, 2026-10-24), and the game plays itself, steering it to the best place within
 * REACH columns by how flat and gapless that leaves the board; full rows clear; filled to the top,
 * the board is emptied and play goes on. The rows cleared show at the top right.
 */
export const BLOCKS_STEP_MS = 60;
export const WELL_W = WIDTH;
const WELL_X = 0;
const MOVE_COLS = 3;
/** How far either side of where it comes in a piece is steered. */
export const REACH = 6;
/** How many random spots a piece weighs before coming in at the lowest. */
export const SPAWN_TRIES = 3;
type Cells = [number, number][];
export const SHAPES: { name: string; cells: Cells }[] = [
  { name: 'TOKEN', cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { name: 'CUP', cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { name: 'BOLT', cells: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]] },
  { name: 'TOWER', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { name: 'CORNER', cells: [[0, 0], [0, 1], [1, 1]] },
  { name: 'BAR', cells: [[0, 0], [1, 0], [2, 0]] },
];
/** A shape turned a quarter clockwise, kept against the top left. */
const turn = (cells: Cells): Cells => {
  const turned = cells.map(([x, y]) => [-y, x] as [number, number]);
  const mx = Math.min(...turned.map(([x]) => x));
  const my = Math.min(...turned.map(([, y]) => y));
  return turned.map(([x, y]) => [x - mx, y - my] as [number, number]);
};
const turnsOf = (cells: Cells): Cells[] => [cells, turn(cells), turn(turn(cells)), turn(turn(turn(cells)))];
export const makeBlocks = (random: Random): Waiter & { readonly cleared: number; readonly filled: number; readonly restarts: number; readonly gaps: number } => {
  let well: number[][] = [];
  let piece = { shape: 0, rot: 0, x: 0, y: 0 };
  let next = 0;
  let target = { rot: 0, x: 0 };
  let cleared = 0;
  let restarts = 0;
  let last = 0;
  const cellsOf = (p: { shape: number; rot: number }) => turnsOf(SHAPES[p.shape].cells)[p.rot];
  const fits = (cells: Cells, px: number, py: number, w = well) => cells.every(([x, y]) => px + x >= 0 && px + x < WELL_W && py + y < HEIGHT && (py + y < 0 || !w[py + y][px + x]));
  /** Where a piece would rest dropped from the top at `px`, turned `rot`. */
  const restAt = (shape: number, rot: number, px: number) => {
    const cells = turnsOf(SHAPES[shape].cells)[rot];
    if (!fits(cells, px, 0)) return null;
    let py = 0;
    while (fits(cells, px, py + 1)) py += 1;
    return py;
  };
  /** How good a well is to be left with: low, flat, without gaps under anything, rows cleared. */
  const worth = (w: number[][], lines: number) => {
    let holes = 0; let total = 0; let bumps = 0; let before = -1;
    for (let x = 0; x < WELL_W; x += 1) {
      let top = HEIGHT;
      for (let y = 0; y < HEIGHT; y += 1) if (w[y][x]) { top = y; break; }
      for (let y = top + 1; y < HEIGHT; y += 1) if (!w[y][x]) holes += 1;
      const h = HEIGHT - top;
      total += h;
      if (before >= 0) bumps += Math.abs(h - before);
      before = h;
    }
    return lines * 8 - holes * 4 - total * 0.5 - bumps * 0.4;
  };
  /** Each column's dots fallen to the bottom. */
  const settled = (w: number[][]) => {
    const out = Array.from({ length: HEIGHT }, () => Array(WELL_W).fill(0));
    for (let x = 0; x < WELL_W; x += 1) {
      let n = 0;
      for (let y = 0; y < HEIGHT; y += 1) n += w[y][x] ? 1 : 0;
      for (let k = 0; k < n; k += 1) out[HEIGHT - 1 - k][x] = 1;
    }
    return out;
  };
  const clearRows = (w: number[][]) => {
    const kept = w.filter((row) => row.some((v) => !v));
    const lines = HEIGHT - kept.length;
    return { w: [...Array.from({ length: lines }, () => Array(WELL_W).fill(0)), ...kept], lines };
  };
  /**
   * The best place for a piece of `shape` come in at `from`: every turn and column within REACH
   * tried, a little chance in a tie. Each is placed, weighed and lifted out again, so choosing copies
   * nothing.
   */
  const choose = (shape: number, from: number) => {
    let best = { rot: 0, x: from, score: -Infinity };
    for (let rot = 0; rot < 4; rot += 1) {
      const cells = turnsOf(SHAPES[shape].cells)[rot];
      for (let x = from - REACH; x <= from + REACH; x += 1) {
        const py = restAt(shape, rot, x);
        if (py === null) continue;
        for (const [cx, cy] of cells) well[py + cy][x + cx] = 1;
        const lines = well.filter((row) => row.every(Boolean)).length;
        const score = worth(well, lines) + random() * 0.3;
        for (const [cx, cy] of cells) well[py + cy][x + cx] = 0;
        if (score > best.score) best = { rot, x, score };
      }
    }
    return best;
  };
  /** How deep the board is at column `x`: the rows free above whatever is there. */
  const depth = (x: number) => { let y = 0; while (y < HEIGHT && !well[y][Math.max(0, Math.min(WELL_W - 1, x))]) y += 1; return y; };
  /**
   * A new piece, somewhere along the top at random: the lowest of SPAWN_TRIES spots picked at
   * random, so low gaps fill first, as a player aims for them, and rows can come to be cleared.
   * Where it can't come in, the board is full: emptied, and play goes on.
   */
  const spawn = () => {
    const shape = next;
    next = Math.floor(random() * SHAPES.length);
    const spots = Array.from({ length: SPAWN_TRIES }, () => Math.floor(random() * (WELL_W - 2)));
    const from = spots.reduce((a, b) => (depth(b + 1) > depth(a + 1) ? b : a));
    if (!fits(turnsOf(SHAPES[shape].cells)[0], from, 0)) {
      well = Array.from({ length: HEIGHT }, () => Array(WELL_W).fill(0));
      restarts += 1;
    }
    const best = choose(shape, from);
    piece = { shape, rot: 0, x: from, y: 0 };
    target = best.score === -Infinity ? { rot: 0, x: from } : { rot: best.rot, x: best.x };
  };
  const reset = () => {
    well = Array.from({ length: HEIGHT }, () => Array(WELL_W).fill(0));
    cleared = 0; restarts = 0; last = 0;
    next = Math.floor(random() * SHAPES.length);
    spawn();
  };
  const step = () => {
    // Turned and moved toward where it is going, falling a row a step.
    if (piece.rot !== target.rot) {
      const rot = (piece.rot + 1) % 4;
      if (fits(cellsOf({ ...piece, rot }), piece.x, piece.y)) piece.rot = rot; else target.rot = piece.rot;
    }
    for (let k = 0; k < MOVE_COLS && piece.x !== target.x; k += 1) {
      const x = piece.x + Math.sign(target.x - piece.x);
      if (fits(cellsOf(piece), x, piece.y)) piece.x = x; else target.x = piece.x;
    }
    if (fits(cellsOf(piece), piece.x, piece.y + 1)) { piece.y += 1; return; }
    for (const [cx, cy] of cellsOf(piece)) if (piece.y + cy >= 0) well[piece.y + cy][piece.x + cx] = 1;
    // The cascade: every dot with room under it falls, so no gap is ever left under anything and a
    // row across the whole board can fill. Our shapes on flat ground always leave gaps (the token's
    // arms), and without it a row of 80 almost never cleared.
    well = settled(well);
    const { w, lines } = clearRows(well);
    well = w;
    cleared += lines;
    spawn();
  };
  reset();
  return {
    get cleared() { return cleared; },
    get filled() { return well.flat().filter(Boolean).length; },
    get restarts() { return restarts; },
    /** Empty places with a dot somewhere above them: never any, with the cascade. */
    get gaps() { let n = 0; for (let x = 0; x < WELL_W; x += 1) { let seen = false; for (let y = 0; y < HEIGHT; y += 1) { if (well[y][x]) seen = true; else if (seen) n += 1; } } return n; },
    draw: (f, t) => {
      if (t < last) reset();
      last = caughtUp(last, t);
      while (last + BLOCKS_STEP_MS <= t) { step(); last += BLOCKS_STEP_MS; }
      for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WELL_W; x += 1) if (well[y][x]) f[y][WELL_X + x] = 1;
      for (const [cx, cy] of cellsOf(piece)) if (inField(WELL_X + piece.x + cx, piece.y + cy)) f[piece.y + cy][WELL_X + piece.x + cx] = 1;
      const said = String(cleared % 100);
      putSmall(f, WIDTH - 1 - said.length * 4, 0, said);
    },
  };
};

/** A number from 0 to 1 that is always the same for `a` and `b`: the stars' and dice's own chance. */
const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** STARFIELD: stars streaming out from the middle as if flown through, the near ones trailing. */
export const STAR_COUNT = 48;
const stars = (random: Random): Waiter => {
  const field = Array.from({ length: STAR_COUNT }, () => ({ angle: random() * Math.PI * 2, speed: 0.25 + random() * 0.35, phase: random() }));
  return {
    draw: (f, t) => {
      for (const s of field) {
        const z = (s.phase + (t / 1000) * s.speed) % 1;
        const r = z * z;
        const x = WIDTH / 2 + Math.cos(s.angle) * r * (WIDTH / 2 + 4);
        const y = HEIGHT / 2 - 0.5 + Math.sin(s.angle) * r * (HEIGHT / 2 + 2);
        const [px, py] = [Math.round(x), Math.round(y)];
        if (inField(px, py)) f[py][px] = 1;
        // Near ones trail toward the middle.
        if (z > 0.6) {
          const [tx, ty] = [Math.round(x - Math.cos(s.angle) * 1.5), Math.round(y - Math.sin(s.angle) * 0.6)];
          if (inField(tx, ty)) f[ty][tx] = 1;
        }
      }
    },
  };
};

/**
 * TUMBLING DICE: two dice tumble in from the left, their faces flicking over as they roll and
 * slowing, and come to rest on a face each; then roll in again. Each roll comes out the same for
 * the same moment, so it needs no state.
 */
export const DICE_CYCLE_MS = 6000;
export const DICE_ROLL_MS = 3400;
const PIPS: Record<number, [number, number][]> = {
  1: [[3, 3]],
  2: [[2, 2], [4, 4]],
  3: [[2, 2], [3, 3], [4, 4]],
  4: [[2, 2], [4, 2], [2, 4], [4, 4]],
  5: [[2, 2], [4, 2], [3, 3], [2, 4], [4, 4]],
  6: [[2, 2], [4, 2], [2, 3], [4, 3], [2, 4], [4, 4]],
};
/** A die's face, 7 by 7 from `x0`, `y0`, its pips inside. */
const putDie = (f: Field, x0: number, y0: number, face: number) => {
  for (let k = 0; k < 7; k += 1) for (const [x, y] of [[x0 + k, y0], [x0 + k, y0 + 6], [x0, y0 + k], [x0 + 6, y0 + k]]) if (inField(x, y)) f[y][x] = 1;
  for (const [px, py] of PIPS[face]) if (inField(x0 + px, y0 + py)) f[y0 + py][x0 + px] = 1;
};
/** A die mid-tumble, on its edge: a diamond. */
const putEdge = (f: Field, cx: number, cy: number) => {
  for (let dy = -3; dy <= 3; dy += 1) {
    const dx = 3 - Math.abs(dy);
    for (const x of [cx - dx, cx + dx]) if (inField(x, cy + dy)) f[cy + dy][x] = 1;
  }
};
/** What the two dice of roll `cycle` show `t` ms into it: where each is, and a face or its edge. */
export const diceAt = (seed: number, cycle: number, t: number) => [0, 1].map((d) => {
  const rest = 22 + d * 20;
  // Already coming in, the first at the left edge and the second ahead of it, so the board is never blank.
  const from = d === 0 ? -3 : 6;
  const done = Math.min(1, t / DICE_ROLL_MS);
  const x = Math.round(from + (rest - from) * (1 - (1 - done) ** 3));
  if (t >= DICE_ROLL_MS) return { x, face: 1 + Math.floor(hash(seed + cycle, d * 977) * 6), edge: false };
  // Faces flick over quickly at first, slower as it comes to rest.
  const flick = Math.floor(Math.sqrt(t / DICE_ROLL_MS) * 14);
  return { x, face: 1 + Math.floor(hash(seed + cycle * 31 + flick, d * 131) * 6), edge: flick % 2 === 1 };
});
const tumblingDice = (random: Random): Waiter => {
  const seed = Math.floor(random() * 1e6);
  return {
    draw: (f, t) => {
      const cycle = Math.floor(t / DICE_CYCLE_MS);
      for (const die of diceAt(seed, cycle, t - cycle * DICE_CYCLE_MS)) {
        if (die.edge) putEdge(f, die.x + 3, 7); else putDie(f, die.x, 4, die.face);
      }
    },
  };
};

/**
 * The pictures, one wait each in this order: READY_ first, so a tray just opened says so, then the
 * games and the calmer pictures by turns.
 */
export const ORDER = ['ready', 'pong', 'snake', 'breakout', 'rain', 'blocks', 'pipes', 'stars', 'scan', 'dice'] as const;
export type WaiterKind = (typeof ORDER)[number];
const MAKE: Record<WaiterKind, (random: Random) => Waiter> = {
  ready, pong: makePong, snake: makeSnake, breakout: makeBreakout, rain, blocks: makeBlocks, pipes, stars, scan, dice: tumblingDice,
};

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
