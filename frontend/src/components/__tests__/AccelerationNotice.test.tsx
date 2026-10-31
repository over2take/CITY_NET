import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccelerationNotice } from '../AccelerationNotice';
import { setBuilderOpen } from '../windowFocus';
import { DISMISSED_KEY, CHECK_ANYWAY_KEY } from '../../utils/hardwareAccel';

/**
 * HARDWARE ACCELERATION IS OFF (2026-10-31), for the GM and players: shown when the check says off,
 * with the steps for their browser; DISMISS hides it for good in this browser; not over the system
 * builder; never in an automated browser unless asked.
 */

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const off = () => ({ state: 'off' as const });
const webdriver = (on: boolean) => Object.defineProperty(navigator, 'webdriver', { value: on, configurable: true });

afterEach(() => { cleanup(); window.localStorage.clear(); webdriver(false); act(() => setBuilderOpen(false)); });

describe('the notice', () => {
  it('says so, with the steps for their browser, when acceleration is off', () => {
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    const notice = screen.getByRole('status', { name: 'Hardware acceleration is off' });
    expect(notice.textContent).toContain('HARDWARE ACCELERATION IS OFF: THE 3D MAP WILL BE SLOW');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Open Settings, then General, and scroll to Performance.', 'Untick "Use recommended performance settings".',
      'Tick "Use hardware acceleration when available".', 'Restart Firefox.',
    ]);
  });

  it('nothing when it is on, or unknown; checked once', () => {
    const check = vi.fn(() => ({ state: 'on' as const }));
    const { rerender } = render(<AccelerationNotice check={check} agent={FIREFOX} />);
    rerender(<AccelerationNotice check={check} agent={FIREFOX} />);
    expect(check).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    render(<AccelerationNotice check={() => ({ state: 'unknown' })} agent={FIREFOX} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('DISMISS hides it for good in this browser, and nothing is checked again', async () => {
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    await userEvent.click(screen.getByRole('button', { name: 'DISMISS' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1');
    cleanup();
    const check = vi.fn(off);
    render(<AccelerationNotice check={check} agent={FIREFOX} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('not over the system builder, and back once it shuts', () => {
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    act(() => setBuilderOpen(true));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => setBuilderOpen(false));
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('never in an automated browser, unless asked for the one test proving it', () => {
    webdriver(true);
    const check = vi.fn(off);
    render(<AccelerationNotice check={check} agent={FIREFOX} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(check).not.toHaveBeenCalled();
    cleanup();
    window.localStorage.setItem(CHECK_ANYWAY_KEY, '1');
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
