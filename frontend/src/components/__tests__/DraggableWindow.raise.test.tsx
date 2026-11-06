import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

import { DraggableWindow } from '../DraggableWindow';

/**
 * A window asked to come to the front (7c4d): the new character window, as a roll made in it opens the
 * dice tray, whose window has only just taken its place in front. Nothing changes without being asked.
 */

afterEach(() => cleanup());

const windowOf = (name: string) => screen.getByText(name).closest('.win95-window') as HTMLElement;
const z = (name: string) => Number(windowOf(name).style.zIndex);
const two = (raiseOn?: number) => (
  <>
    <DraggableWindow title="LOW.EXE" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} raiseOn={raiseOn}>low</DraggableWindow>
    <DraggableWindow title="HIGH.EXE" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}>high</DraggableWindow>
  </>
);

describe('raiseOn', () => {
  it('without it, the later window is in front, and stays there', async () => {
    const { rerender } = render(two());
    expect(z('HIGH.EXE')).toBeGreaterThan(z('LOW.EXE'));
    rerender(two());
    await Promise.resolve();
    expect(z('HIGH.EXE')).toBeGreaterThan(z('LOW.EXE'));
  });

  it('at 0 it asks for nothing', async () => {
    render(two(0));
    await Promise.resolve();
    expect(z('HIGH.EXE')).toBeGreaterThan(z('LOW.EXE'));
  });

  it('changing, the window comes in front', async () => {
    const { rerender } = render(two(0));
    rerender(two(1));
    await waitFor(() => expect(z('LOW.EXE')).toBeGreaterThan(z('HIGH.EXE')));
  });

  it('over a window opening in the same moment', async () => {
    const { rerender } = render(<DraggableWindow title="LOW.EXE" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} raiseOn={0}>low</DraggableWindow>);
    rerender(two(1));
    await waitFor(() => expect(z('LOW.EXE')).toBeGreaterThan(z('HIGH.EXE')));
  });
});
