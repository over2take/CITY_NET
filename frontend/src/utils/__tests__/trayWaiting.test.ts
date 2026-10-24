import { describe, it, expect } from 'vitest';
import { makeWaiting, makeSnake, turnAt, ORDER, TURN_MS, SNAKE_STEP_MS, PIPES_STEP_MS, SNAKE_MOST } from '../trayWaiting';
import { emptyField, putReady, WIDTH, HEIGHT } from '../trayBoard';

/** A repeatable random source. */
const seeded = (seed = 7) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
const frame = (draw: ReturnType<typeof makeWaiting>, t: number) => { const f = emptyField(); const kind = draw(f, t); return { f, kind, lit: f.flat().filter(Boolean).length }; };
const at = (n: number, dt = 0) => n * TURN_MS + dt;
const same = (a: number[][], b: number[][]) => a.every((row, y) => row.every((v, x) => v === b[y][x]));

describe('the board waiting (6c4f)', () => {
  it('takes turns, READY_ first, round and round', () => {
    expect(ORDER).toEqual(['ready', 'pong', 'snake', 'rain', 'pipes', 'scan']);
    expect([0, at(1), at(2) - 1, at(6), at(7) + 5].map((t) => turnAt(t))).toEqual([
      { kind: 'ready', from: 0 }, { kind: 'pong', from: TURN_MS }, { kind: 'pong', from: TURN_MS },
      { kind: 'ready', from: at(6) }, { kind: 'pong', from: at(7) },
    ]);
    const draw = makeWaiting(seeded());
    expect(ORDER.map((_, n) => frame(draw, at(n, 1000)).kind)).toEqual([...ORDER]);
  });

  it('READY_ as the board has always said it', () => {
    const draw = makeWaiting(seeded());
    const ready = emptyField(); putReady(ready, 600);
    expect(same(frame(draw, 600).f, ready)).toBe(true);
  });

  it('every picture stays in the field and draws something, every frame', () => {
    const draw = makeWaiting(seeded());
    for (let n = 0; n < ORDER.length; n += 1) {
      for (let dt = 0; dt < TURN_MS; dt += 97) {
        const { f, lit, kind } = frame(draw, at(n, dt));
        expect(f.length, kind).toBe(HEIGHT);
        expect(f.every((row) => row.length === WIDTH), kind).toBe(true);
        expect(lit, `${kind} at ${dt}`).toBeGreaterThan(0);
      }
    }
  });

  it('PONG: the ball moves, a paddle on each side', () => {
    const draw = makeWaiting(seeded());
    const a = frame(draw, at(1, 0)).f;
    const b = frame(draw, at(1, 300)).f;
    expect(same(a, b)).toBe(false);
    for (const f of [a, b]) {
      expect(f.filter((row) => row[0]).length).toBe(4);
      expect(f.filter((row) => row[WIDTH - 1]).length).toBe(4);
    }
  });

  it('SNAKE steers itself: it grows as it eats and never crosses itself', () => {
    const draw = makeWaiting(seeded(3));
    let most = 0;
    for (let dt = 0; dt < TURN_MS; dt += SNAKE_STEP_MS) {
      // Its body: every lit dot but a blinking food (drawn on odd 200 ms beats).
      const { lit } = frame(draw, at(2, Math.floor(dt / 400) * 400));
      most = Math.max(most, lit);
    }
    // Four long to start; it eats in a turn's time.
    expect(most).toBeGreaterThan(5);
    expect(most).toBeLessThanOrEqual(SNAKE_MOST + 2);
  });

  it('SNAKE never crosses itself: every part of it a dot of its own, over many turns', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const snake = makeSnake(seeded(seed));
      // Even 200 ms beats: the food is hidden, so every lit dot is the snake.
      for (let t = 0; t < TURN_MS * 3; t += 400) {
        const f = emptyField();
        snake.draw(f, t);
        expect(f.flat().filter(Boolean).length, `seed ${seed} at ${t}`).toBe(snake.length);
      }
    }
  });

  it('SNAKE and PIPES start afresh each time their turn comes round', () => {
    const draw = makeWaiting(seeded(5));
    const first = frame(draw, at(2, 400)).lit;
    frame(draw, at(2, 6000));
    // The next time round, the same moment into its turn starts from four again.
    const again = frame(draw, at(8, 400)).lit;
    expect(Math.abs(again - first)).toBeLessThanOrEqual(1);
    const p0 = frame(draw, at(4, PIPES_STEP_MS * 10)).lit;
    frame(draw, at(4, 6500));
    expect(frame(draw, at(10, PIPES_STEP_MS * 10)).lit).toBe(p0);
  });

  it('PIPES lay dot by dot', () => {
    const draw = makeWaiting(seeded(9));
    const early = frame(draw, at(4, PIPES_STEP_MS * 20)).lit;
    const later = frame(draw, at(4, PIPES_STEP_MS * 200)).lit;
    expect(later).toBeGreaterThan(early);
  });

  it('starts again with READY_ when waiting starts again', () => {
    const draw = makeWaiting(seeded());
    frame(draw, at(3, 500));
    expect(frame(draw, 100).kind).toBe('ready');
  });
});
