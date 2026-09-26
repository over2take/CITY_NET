/**
 * The boot screen before the login screen: it starts by itself, types its lines out and
 * fades. Only its SKIP button skips it; a click anywhere else is the moment sound becomes
 * possible, and is passed on for that.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { BootScreen, bootLines } from '../BootScreen';

afterEach(() => vi.useRealTimers());

describe('the boot screen', () => {
  it('names the version, runs a dozen lines, and ends ready for an operator', () => {
    const lines = bootLines('1.14.2');
    expect(lines[0]).toContain('v1.14.2');
    expect(lines.length).toBeGreaterThanOrEqual(12);
    expect(lines.at(-1)).toMatch(/NAV_OS READY/);
  });

  it('starts without waiting for anything, and finishes by itself', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<BootScreen onDone={onDone} />);
    // Each line's timer starts once the line before it is drawn, so time moves a step at a time.
    const step = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    step(260);
    expect(screen.getByText(/CITY_NET BIOS/)).toBeInTheDocument();
    expect(screen.queryByText(/NAV_OS READY/)).toBeNull();
    for (let i = 0; i < 20; i += 1) step(300);
    expect(screen.getByText(/NAV_OS READY/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it('is skipped by its SKIP button and nothing else', () => {
    const onDone = vi.fn();
    render(<BootScreen onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.pointerDown(screen.getByTestId('boot-screen'));
    fireEvent.mouseDown(screen.getByTestId('boot-screen'));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'SKIP' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('passes a click on the screen on, so the drive can be heard from then', () => {
    const onTouch = vi.fn();
    render(<BootScreen onDone={vi.fn()} onTouch={onTouch} />);
    fireEvent.pointerDown(screen.getByTestId('boot-screen'));
    expect(onTouch).toHaveBeenCalledTimes(1);
  });
});
