import { describe, it, expect } from 'vitest';
import {
  makeWaiting, makeSnake, makePong, makeBreakout, makeBlocks, pictureFor, diceAt, ORDER, SHAPES,
  PIPES_STEP_MS, SNAKE_STEP_MS, SNAKE_MOST, PONG_TO, MOST_BEHIND_MS, DICE_CYCLE_MS, DICE_ROLL_MS,
} from '../trayWaiting';
import { emptyField, putReady, WIDTH, HEIGHT } from '../trayBoard';

/** A repeatable random source. */
const seeded = (seed = 7) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
const frame = (draw: ReturnType<typeof makeWaiting>, t: number, nth: number) => { const f = emptyField(); const kind = draw(f, t, nth); return { f, kind, lit: f.flat().filter(Boolean).length }; };
const same = (a: number[][], b: number[][]) => a.every((row, y) => row.every((v, x) => v === b[y][x]));

describe('the board waiting (6c4f)', () => {
  it('one picture a wait, the next the next time, READY_ first, round again', () => {
    // The games and the calmer pictures by turns (6c4f2).
    expect(ORDER).toEqual(['ready', 'pong', 'snake', 'breakout', 'rain', 'blocks', 'pipes', 'stars', 'scan', 'dice']);
    expect([0, 1, 3, 9, 10, 11].map(pictureFor)).toEqual(['ready', 'pong', 'breakout', 'dice', 'ready', 'pong']);
    // Never another picture partway through a wait, however long it lasts.
    const draw = makeWaiting(seeded());
    expect(new Set([0, 7000, 30_000, 120_000].map((t) => frame(draw, t, 4).kind))).toEqual(new Set(['rain']));
  });

  it('READY_ as the board has always said it', () => {
    const ready = emptyField(); putReady(ready, 600);
    expect(same(frame(makeWaiting(seeded()), 600, 0).f, ready)).toBe(true);
  });

  // Minutes of play simulated: seconds here, three times that on CI, past the usual five.
  it('every picture stays in the field and draws something, every frame, for minutes', { timeout: 60_000 }, () => {
    const draw = makeWaiting(seeded());
    ORDER.forEach((kind, nth) => {
      for (let t = 0; t < 180_000; t += 997) {
        const { f, lit } = frame(draw, t, nth);
        expect(f.length, kind).toBe(HEIGHT);
        expect(f.every((row) => row.length === WIDTH), kind).toBe(true);
        expect(lit, `${kind} at ${t}`).toBeGreaterThan(0);
      }
    });
  });

  it('SNAKE steers itself: it grows as it eats and never crosses itself', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const snake = makeSnake(seeded(seed));
      let most = 0;
      // Even 200 ms beats: the food is hidden, so every lit dot is the snake.
      for (let t = 0; t < 60_000; t += 400) {
        const f = emptyField();
        snake.draw(f, t);
        expect(f.flat().filter(Boolean).length, `seed ${seed} at ${t}`).toBe(snake.length);
        most = Math.max(most, snake.length);
      }
      expect(most, `seed ${seed}`).toBeGreaterThan(5);
      expect(most, `seed ${seed}`).toBeLessThanOrEqual(SNAKE_MOST + 1);
    }
  });

  it('runs as long as a table is quiet: half an hour of SNAKE and PIPES, drawn promptly', () => {
    // Starting over once used to set the clock back too, so a picture filling up within a wait sent
    // the drawing round catching up for ever and froze the board.
    const draw = makeWaiting(seeded(11));
    for (const nth of [2, 6]) {
      const began = Date.now();
      for (let t = 0; t <= 30 * 60_000; t += 60_000) frame(draw, t, nth);
      expect(Date.now() - began, ORDER[nth]).toBeLessThan(3000);
    }
  });

  it('never takes long over a frame, however long since the last: it skips ahead past MOST_BEHIND_MS', () => {
    // A tab left in the background for hours draws again: no replaying of it all.
    for (const nth of [1, 2, 3, 5, 6]) {
      const draw = makeWaiting(seeded(13));
      frame(draw, 1000, nth);
      const began = Date.now();
      const { lit } = frame(draw, 10 * 3_600_000, nth);
      expect(Date.now() - began, ORDER[nth]).toBeLessThan(250);
      expect(lit, ORDER[nth]).toBeGreaterThan(0);
    }
    expect(MOST_BEHIND_MS).toBeLessThanOrEqual(5000);
  });

  it('SNAKE and PIPES start afresh when waiting starts again', () => {
    const draw = makeWaiting(seeded(5));
    const first = frame(draw, SNAKE_STEP_MS * 8, 2).lit;
    frame(draw, 40_000, 2);
    expect(Math.abs(frame(draw, SNAKE_STEP_MS * 8, 2).lit - first)).toBeLessThanOrEqual(1);
    const p0 = frame(draw, PIPES_STEP_MS * 10, 6).lit;
    frame(draw, 6500, 6);
    expect(frame(draw, PIPES_STEP_MS * 10, 6).lit).toBe(p0);
  });

  it('PIPES lay dot by dot', () => {
    const draw = makeWaiting(seeded(9));
    expect(frame(draw, PIPES_STEP_MS * 200, 6).lit).toBeGreaterThan(frame(makeWaiting(seeded(9)), PIPES_STEP_MS * 20, 6).lit);
  });
});

describe('PONG, played (2026-10-24)', () => {
  /** The paddles' tops, read off the field's outer columns. */
  const paddles = (f: number[][]) => [0, WIDTH - 1].map((x) => f.findIndex((row) => row[x] === 1));

  // Minutes of play simulated: seconds here, three times that on CI, past the usual five.
  it('they score: points come every few seconds to a minute, and it starts again after a 9', { timeout: 60_000 }, () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const pong = makePong(seeded(seed));
      let points = 0;
      let before = 0;
      let restarted = false;
      for (let t = 0; t <= 600_000; t += 50) {
        pong.draw(emptyField(), t);
        const total = pong.score[0] + pong.score[1];
        if (total < before) restarted = true;
        else if (total > before) points += 1;
        before = total;
        expect(Math.max(...pong.score), `seed ${seed}`).toBeLessThanOrEqual(PONG_TO);
      }
      // Ten minutes: a point every minute at least, and never one every couple of seconds.
      expect(points, `seed ${seed}`).toBeGreaterThan(10);
      expect(points, `seed ${seed}`).toBeLessThan(300);
      if (points > 2 * PONG_TO) expect(restarted, `seed ${seed}`).toBe(true);
    }
  });

  it('they play: each paddle moves on its own, never leaving the field, the ball inside it', () => {
    const pong = makePong(seeded(4));
    const seen = new Set<string>();
    let apart = 0;
    for (let t = 0; t < 30_000; t += 50) {
      const f = emptyField();
      pong.draw(f, t);
      const [left, right] = paddles(f);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeGreaterThanOrEqual(0);
      // A paddle is four dots; a ball slipping past it shares its column for a moment.
      for (const x of [0, WIDTH - 1]) {
        expect(f.filter((row) => row[x]).length).toBeGreaterThanOrEqual(4);
        expect(f.filter((row) => row[x]).length).toBeLessThanOrEqual(6);
      }
      seen.add(`${left},${right}`);
      if (left !== right) apart += 1;
    }
    // Not one copying the other: they are often at different heights, and go all over.
    expect(apart).toBeGreaterThan(100);
    expect(seen.size).toBeGreaterThan(20);
  });

  it('shows the score either side of a dashed net', () => {
    const f = emptyField();
    makePong(seeded(2)).draw(f, 0);
    // The net: every other dot down the middle.
    expect(f.map((row) => row[WIDTH / 2])).toEqual(Array.from({ length: HEIGHT }, (_, y) => (y % 2 === 0 ? 1 : 0)));
    // 0 and 0, three dots wide, either side of it.
    expect(f[1].slice(WIDTH / 2 - 5, WIDTH / 2 - 2)).toEqual([1, 1, 1]);
    expect(f[1].slice(WIDTH / 2 + 3, WIDTH / 2 + 6)).toEqual([1, 1, 1]);
  });

  it('plays the same however often it is drawn', () => {
    const a = makePong(seeded(3));
    const b = makePong(seeded(3));
    for (let t = 0; t <= 20_000; t += 17) a.draw(emptyField(), t);
    for (let t = 0; t <= 20_000; t += 250) b.draw(emptyField(), t);
    const fa = emptyField(); a.draw(fa, 20_000);
    const fb = emptyField(); b.draw(fb, 20_000);
    expect(same(fa, fb)).toBe(true);
  });
});

describe('BREAKOUT, played (6c4f2)', () => {
  // Minutes of play simulated: seconds here, three times that on CI, past the usual five.
  it('breaks bricks, serves again after a miss, and builds a broken-through wall again', { timeout: 60_000 }, () => {
    for (const seed of [1, 2, 3, 4]) {
      const game = makeBreakout(seeded(seed));
      expect(game.bricks).toBe(48);
      let walls = 0; let before = game.bricks; let fewest = 48;
      for (let t = 0; t <= 600_000; t += 100) {
        const f = emptyField();
        game.draw(f, t);
        // The bat: eight dots on the bottom row, and nothing of it anywhere else.
        expect(f[HEIGHT - 1].filter(Boolean).length, `seed ${seed} at ${t}`).toBeGreaterThanOrEqual(8);
        if (game.bricks > before) walls += 1;
        fewest = Math.min(fewest, game.bricks);
        before = game.bricks;
      }
      expect(fewest, `seed ${seed}`).toBeLessThan(10);
      expect(walls, `seed ${seed}`).toBeGreaterThan(0);
      // It misses now and then: more than one ball in ten minutes, but not one every second.
      expect(game.balls, `seed ${seed}`).toBeGreaterThan(5);
      expect(game.balls, `seed ${seed}`).toBeLessThan(300);
    }
  });

  it('draws three rows of bricks at the top', () => {
    const f = emptyField();
    makeBreakout(seeded(1)).draw(f, 0);
    for (const y of [1, 3, 5]) expect(f[y].filter(Boolean).length).toBe(16 * 4);
    expect([0, 2, 4].map((y) => f[y].filter(Boolean).length)).toEqual([0, 0, 0]);
  });
});

describe('BLOCKS, played (6c4f2)', () => {
  const connected = (cells: [number, number][]) => {
    const seen = new Set([cells[0].join()]);
    const todo = [cells[0]];
    while (todo.length) {
      const [x, y] = todo.pop()!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = `${nx},${ny}`;
        if (!seen.has(k) && cells.some((c) => c.join() === k)) { seen.add(k); todo.push([nx, ny]); }
      }
    }
    return seen.size === cells.length;
  };

  it('our own shapes, not Tetris\'s: three or five dots each, every one in one piece', () => {
    expect(SHAPES.map((s) => s.name)).toEqual(['TOKEN', 'CUP', 'BOLT', 'TOWER', 'CORNER', 'BAR']);
    for (const s of SHAPES) {
      // Tetris's pieces are all four dots; none of ours is.
      expect([3, 5], s.name).toContain(s.cells.length);
      expect(new Set(s.cells.map((c) => c.join())).size, s.name).toBe(s.cells.length);
      expect(connected(s.cells), s.name).toBe(true);
    }
  });

  // Minutes of play simulated: seconds here, three times that on CI, past the usual five.
  it('plays itself across the whole board: pieces everywhere, rows clear, and a full board is emptied', { timeout: 60_000 }, () => {
    let emptied = 0;
    for (const seed of [1, 2, 3, 4]) {
      const game = makeBlocks(seeded(seed));
      const columns = new Set<number>();
      for (let t = 0; t <= 600_000; t += 100) {
        const f = emptyField();
        game.draw(f, t);
        // Below the score's rows, where a piece has landed anywhere along the bottom.
        f[HEIGHT - 1].forEach((v, x) => { if (v) columns.add(x); });
        // The cascade: never a gap under a dot, so a row of 80 can fill.
        expect(game.gaps, `seed ${seed} at ${t}`).toBe(0);
      }
      // Across the whole width (2026-10-24), not a well in the middle.
      expect(columns.size, `seed ${seed}`).toBe(WIDTH);
      // A row about every quarter minute once under way: thirty in ten minutes at the least.
      expect(game.cleared, `seed ${seed}`).toBeGreaterThan(25);
      expect(game.restarts, `seed ${seed}`).toBeLessThan(6);
      emptied += game.restarts;
    }
    // Chance fills a board to the top now and then: emptied, and play went on.
    expect(emptied).toBeGreaterThan(0);
  });

  it('shows the rows cleared at the top right', () => {
    const f = emptyField();
    makeBlocks(seeded(2)).draw(f, 0);
    // A 0: three dots wide at the board's right edge, five tall.
    expect(f.slice(0, 5).map((row) => row.slice(WIDTH - 5, WIDTH - 2))).toEqual([[1, 1, 1], [1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 1]]);
  });
});

describe('STARFIELD (6c4f2)', () => {
  it('streams stars out from the middle', () => {
    const draw = makeWaiting(seeded(4));
    const spread = (t: number) => {
      const f = frame(draw, t, 7).f;
      let far = 0;
      f.forEach((row, y) => row.forEach((v, x) => { if (v) far += Math.abs(x - WIDTH / 2) / (WIDTH / 2) + Math.abs(y - HEIGHT / 2) / (HEIGHT / 2); }));
      return far;
    };
    // Frame to frame the dots move; there are always stars to see.
    const a = frame(draw, 1000, 7);
    const b = frame(draw, 1100, 7);
    expect(same(a.f, b.f)).toBe(false);
    expect(a.lit).toBeGreaterThan(10);
    expect(spread(1000)).toBeGreaterThan(0);
  });
});

describe('TUMBLING DICE (6c4f2)', () => {
  it('two dice tumble in, faces flicking and on their edges, and come to rest on a face each', () => {
    const rolling = Array.from({ length: 30 }, (_, i) => diceAt(5, 0, (i * DICE_ROLL_MS) / 30));
    expect(rolling.some((d) => d[0].edge)).toBe(true);
    expect(new Set(rolling.filter((d) => !d[0].edge).map((d) => d[0].face)).size).toBeGreaterThan(1);
    // In from the left, to rest side by side.
    expect(rolling[0][0].x).toBeLessThan(0);
    const rest = diceAt(5, 0, DICE_ROLL_MS + 100);
    expect(rest.map((d) => d.x)).toEqual([22, 42]);
    expect(rest.every((d) => !d.edge && d.face >= 1 && d.face <= 6)).toBe(true);
    // Still for the rest of the roll.
    expect(diceAt(5, 0, DICE_CYCLE_MS - 1)).toEqual(rest);
  });

  it('a die shows its pips: the face it rests on, counted', () => {
    const draw = makeWaiting(seeded(6));
    const t = DICE_ROLL_MS + 500;
    const { f } = frame(draw, t, 9);
    // Each die is a 7 by 7 square with its pips inside: 24 dots of edge plus its face.
    const lit = (x0: number) => f.slice(4, 11).map((row) => row.slice(x0, x0 + 7).filter(Boolean).length).reduce((a, b) => a + b, 0);
    const faces = [lit(22) - 24, lit(42) - 24];
    expect(faces.every((n) => n >= 1 && n <= 6)).toBe(true);
  });

  it('rolls come out different from roll to roll', () => {
    const rests = Array.from({ length: 12 }, (_, c) => diceAt(5, c, DICE_ROLL_MS + 100).map((d) => d.face).join());
    expect(new Set(rests).size).toBeGreaterThan(3);
  });
});
