/**
 * The boot screen shown as a login plays the startup sound: lines type out, it fades, and
 * any click or key skips it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { BootScreen, bootLines } from '../BootScreen';

afterEach(() => vi.useRealTimers());

describe('the boot screen', () => {
  it('names the version and the operator', () => {
    const lines = bootLines('1.14.2', 'ghost');
    expect(lines[0]).toContain('v1.14.2');
    expect(lines.some((l) => l.includes('SYNCING OPERATOR: GHOST'))).toBe(true);
    expect(lines.at(-1)).toBe('NAV_OS READY');
  });

  it('types its lines out one at a time, then finishes by itself', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<BootScreen operator="ghost" onDone={onDone} />);
    expect(screen.queryByText(/MEMORY TEST/)).toBeNull();
    // Each line's timer starts once the line before it is drawn, so time moves a step at a time.
    const step = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    step(320);
    step(320);
    expect(screen.getByText(/MEMORY TEST/)).toBeInTheDocument();
    expect(screen.queryByText('NAV_OS READY')).toBeNull();
    for (let i = 0; i < 12; i += 1) step(400);
    expect(screen.getByText('NAV_OS READY')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it('is skipped by a key or a click', () => {
    const onKey = vi.fn();
    const { unmount } = render(<BootScreen operator="ghost" onDone={onKey} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onKey).toHaveBeenCalled();
    unmount();
    const onClick = vi.fn();
    render(<BootScreen operator="ghost" onDone={onClick} />);
    fireEvent.mouseDown(screen.getByTestId('boot-screen'));
    expect(onClick).toHaveBeenCalled();
  });
});
