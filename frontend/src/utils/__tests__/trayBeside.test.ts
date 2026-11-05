import { describe, it, expect } from 'vitest';
import { TRAY_WIDTH, trayBeside } from '../trayBeside';

/** Where the dice tray opens over NEW_CHARACTER.EXE (7c3c): beside it, as far as the screen allows. */

const FLOW = { x: 445, y: 80, width: 660 };

describe('the tray over the new character window', () => {
  it('goes beside the window, keeping its height, on a screen with room', () => {
    expect(trayBeside({ x: 720, y: 160 }, FLOW, 1920)).toEqual({ x: 1113, y: 160 });
  });

  it('goes as far as the screen allows on one without', () => {
    expect(trayBeside({ x: 443, y: 160 }, FLOW, 1366)).toEqual({ x: 1366 - TRAY_WIDTH - 8, y: 160 });
  });

  it('never off the left of a very small screen', () => {
    expect(trayBeside({ x: 100, y: 10 }, { x: 0, y: 0, width: 400 }, 400).x).toBe(0);
  });

  it('stays where it is when it isn\'t over the window, either side', () => {
    const left = { x: FLOW.x - TRAY_WIDTH, y: 5 };
    const right = { x: FLOW.x + FLOW.width, y: 5 };
    expect(trayBeside(left, FLOW, 1920)).toBe(left);
    expect(trayBeside(right, FLOW, 1920)).toBe(right);
  });

  it('moves when it only just covers it', () => {
    expect(trayBeside({ x: FLOW.x - TRAY_WIDTH + 1, y: 5 }, FLOW, 1920).x).toBe(1113);
    expect(trayBeside({ x: FLOW.x + FLOW.width - 1, y: 5 }, FLOW, 1920).x).toBe(1113);
  });
});
