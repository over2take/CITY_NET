/**
 * The boot screen before the login screen: it waits for a key (the moment a sound may
 * play), types its lines out, fades, and a further key or click skips it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { BootScreen, bootLines } from '../BootScreen';

afterEach(() => vi.useRealTimers());

describe('the boot screen', () => {
  it('names the version, and ends ready for an operator', () => {
    const lines = bootLines('1.14.2');
    expect(lines[0]).toContain('v1.14.2');
    expect(lines.at(-1)).toMatch(/NAV_OS READY/);
  });

  it('waits for a key, and plays the startup sound on it', () => {
    const onStart = vi.fn();
    render(<BootScreen onStart={onStart} onDone={vi.fn()} />);
    expect(screen.getByText(/PRESS ANY KEY TO BOOT/)).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/PRESS ANY KEY TO BOOT/)).toBeNull();
  });

  it('types its lines out one at a time, then finishes by itself', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<BootScreen onStart={vi.fn()} onDone={onDone} />);
    fireEvent.mouseDown(screen.getByTestId('boot-screen'));
    // Each line's timer starts once the line before it is drawn, so time moves a step at a time.
    const step = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    step(320);
    step(320);
    expect(screen.getByText(/MEMORY TEST/)).toBeInTheDocument();
    expect(screen.queryByText(/NAV_OS READY/)).toBeNull();
    for (let i = 0; i < 12; i += 1) step(400);
    expect(screen.getByText(/NAV_OS READY/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it('is skipped by a second key or click once it is booting', () => {
    const onDone = vi.fn();
    render(<BootScreen onStart={vi.fn()} onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('boot-screen'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
