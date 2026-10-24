import { describe, it, expect } from 'vitest';
import { makeWaiting, makeSnake, makePong, pictureFor, ORDER, PIPES_STEP_MS, SNAKE_STEP_MS, SNAKE_MOST, PONG_TO, MOST_BEHIND_MS } from '../trayWaiting';
import { emptyField, putReady, WIDTH, HEIGHT } from '../trayBoard';

/** A repeatable random source. */
const seeded = (seed = 7) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
const frame = (draw: ReturnType<typeof makeWaiting>, t: number, nth: number) => { const f = emptyField(); const kind = draw(f, t, nth); return { f, kind, lit: f.flat().filter(Boolean).length }; };
const same = (a: number[][], b: number[][]) => a.every((row, y) => row.every((v, x) => v === b[y][x]));

describe('the board waiting (6c4f)', () => {
  it('one picture a wait, the next the next time, READY_ first, round again', () => {
    expect(ORDER).toEqual(['ready', 'pong', 'snake', 'rain', 'pipes', 'scan']);
    expect([0, 1, 2, 5, 6, 7].map(pictureFor)).toEqual(['ready', 'pong', 'snake', 'scan', 'ready', 'pong']);
    // Never another picture partway through a wait, however long it lasts.
    const draw = makeWaiting(seeded());
    expect(new Set([0, 7000, 30_000, 120_000].map((t) => frame(draw, t, 3).kind))).toEqual(new Set(['rain']));
  });

  it('READY_ as the board has always said it', () => {
    const ready = emptyField(); putReady(ready, 600);
    expect(same(frame(makeWaiting(seeded()), 600, 0).f, ready)).toBe(true);
  });

  it('every picture stays in the field and draws something, every frame, for minutes', () => {
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
    for (const nth of [2, 4]) {
      const began = Date.now();
      for (let t = 0; t <= 30 * 60_000; t += 60_000) frame(draw, t, nth);
      expect(Date.now() - began, ORDER[nth]).toBeLessThan(3000);
    }
  });

  it('never takes long over a frame, however long since the last: it skips ahead past MOST_BEHIND_MS', () => {
    // A tab left in the background for hours draws again: no replaying of it all.
    for (const nth of [1, 2, 4]) {
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
    const p0 = frame(draw, PIPES_STEP_MS * 10, 4).lit;
    frame(draw, 6500, 4);
    expect(frame(draw, PIPES_STEP_MS * 10, 4).lit).toBe(p0);
  });

  it('PIPES lay dot by dot', () => {
    const draw = makeWaiting(seeded(9));
    expect(frame(draw, PIPES_STEP_MS * 200, 4).lit).toBeGreaterThan(frame(makeWaiting(seeded(9)), PIPES_STEP_MS * 20, 4).lit);
  });
});

describe('PONG, played (2026-10-24)', () => {
  /** The paddles' tops, read off the field's outer columns. */
  const paddles = (f: number[][]) => [0, WIDTH - 1].map((x) => f.findIndex((row) => row[x] === 1));

  it('they score: points come every few seconds to a minute, and it starts again after a 9', () => {
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
