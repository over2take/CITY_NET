import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccelerationNotice } from '../AccelerationNotice';
import { MapSlowHelp } from '../MapSlowHelp';
import { setBuilderOpen } from '../windowFocus';
import { DISMISSED_KEY, CHECK_ANYWAY_KEY, forgetAcceleration, setWarn } from '../../utils/hardwareAccel';

/**
 * HARDWARE ACCELERATION IS OFF (2026-10-31), for the GM and players: shown only when the browser says
 * so, with the steps for their browser; DISMISS turns SYSTEM_INFO's WARN ME switch off for good in
 * this browser, and only the switch brings it back; not over the system builder; never in an
 * automated browser unless asked. MAP SLOW? holds the steps whenever wanted.
 */

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const off = () => ({ state: 'off' as const });
const webdriver = (on: boolean) => Object.defineProperty(navigator, 'webdriver', { value: on, configurable: true });
const notice = () => screen.queryByRole('status', { name: 'Hardware acceleration is off' });
const warnSwitch = () => screen.getByRole('switch', { name: /WARN ME IF HARDWARE ACCELERATION IS OFF/ });

afterEach(() => { cleanup(); window.localStorage.clear(); webdriver(false); forgetAcceleration(); act(() => setBuilderOpen(false)); });

describe('the notice', () => {
  it('says so, with the steps for their browser, when the browser says acceleration is off', () => {
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    expect(notice()!.textContent).toContain('HARDWARE ACCELERATION IS OFF: THE 3D MAP WILL BE SLOW');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Open Settings, then General, and scroll to Performance.', 'Untick "Use recommended performance settings".',
      'Tick "Use hardware acceleration when available".', 'Restart Firefox.',
    ]);
    expect(notice()!.textContent).toContain('SYSTEM_INFO turns it back on');
  });

  it('nothing when it is on, or unknown; asked once per page', () => {
    const check = vi.fn(() => ({ state: 'on' as const }));
    const { rerender } = render(<AccelerationNotice check={check} agent={FIREFOX} />);
    rerender(<AccelerationNotice check={check} agent={FIREFOX} />);
    cleanup();
    render(<AccelerationNotice check={check} agent={FIREFOX} />);
    expect(check).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
    forgetAcceleration();
    cleanup();
    render(<AccelerationNotice check={() => ({ state: 'unknown' })} agent={FIREFOX} />);
    expect(notice()).toBeNull();
  });

  it('DISMISS stops it for good in this browser, nothing asked again, and SYSTEM_INFO\'s switch with it', async () => {
    render(<><AccelerationNotice check={off} agent={FIREFOX} /><MapSlowHelp agent={FIREFOX} /></>);
    expect(warnSwitch().getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'DISMISS' }));
    expect(notice()).toBeNull();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1');
    expect(warnSwitch().getAttribute('aria-checked')).toBe('false');
    cleanup();
    forgetAcceleration();
    const check = vi.fn(off);
    render(<AccelerationNotice check={check} agent={FIREFOX} />);
    expect(notice()).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('comes back at once when the switch is turned on again, and goes when it is turned off', async () => {
    setWarn(false);
    render(<><AccelerationNotice check={off} agent={FIREFOX} /><MapSlowHelp agent={FIREFOX} /></>);
    expect(notice()).toBeNull();
    await userEvent.click(warnSwitch());
    expect(notice()).toBeTruthy();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
    await userEvent.click(warnSwitch());
    expect(notice()).toBeNull();
  });

  it('not over the system builder, and back once it shuts', () => {
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    act(() => setBuilderOpen(true));
    expect(notice()).toBeNull();
    act(() => setBuilderOpen(false));
    expect(notice()).toBeTruthy();
  });

  it('never in an automated browser, unless asked for the one test proving it', () => {
    webdriver(true);
    const check = vi.fn(off);
    render(<AccelerationNotice check={check} agent={FIREFOX} />);
    expect(notice()).toBeNull();
    expect(check).not.toHaveBeenCalled();
    cleanup();
    window.localStorage.setItem(CHECK_ANYWAY_KEY, '1');
    render(<AccelerationNotice check={off} agent={FIREFOX} />);
    expect(notice()).toBeTruthy();
  });
});

describe('MAP SLOW? in SYSTEM_INFO', () => {
  it('shut at first, opening on the steps for their browser', async () => {
    render(<MapSlowHelp agent={CHROME} />);
    expect(screen.queryByRole('region', { name: 'Map slow?' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '▸ MAP SLOW?' }));
    const help = screen.getByRole('region', { name: 'Map slow?' });
    expect(help.textContent).toContain('A slow 3D map usually means hardware acceleration is off in your browser.');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Open Settings, then System.', 'Turn on "Use graphics acceleration when available".', 'Press Relaunch.',
    ]);
    await userEvent.click(screen.getByRole('button', { name: '▾ MAP SLOW?' }));
    expect(screen.queryByRole('region', { name: 'Map slow?' })).toBeNull();
  });

  it('the warning on until switched off, kept in this browser', async () => {
    render(<MapSlowHelp agent={CHROME} />);
    expect(warnSwitch().getAttribute('aria-checked')).toBe('true');
    await userEvent.click(warnSwitch());
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('1');
    cleanup();
    render(<MapSlowHelp agent={CHROME} />);
    expect(warnSwitch().getAttribute('aria-checked')).toBe('false');
  });
});
