import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HitPointsPanel, HealthReviewPanel } from '../HitPoints';
import type { Location } from '../../types';


const makeRhombus = (overrides = {}): Location => ({
  id: 1,
  name: 'GHOST',
  shape: 'rhombus',
  x: 0, y: 0, z: 0,
  width: 1, height: 1, depth: 1,
  color: '#00ff00',
  hp_current: 80,
  hp_max: 100,
  hp_temp: 0,
  ...overrides,
} as unknown as Location);

describe('HitPointsPanel: changing health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('shows NO_TARGET_ACQUIRED when targetRhombus is null', () => {
    render(<HitPointsPanel target={null} token="" refreshLocations={vi.fn()} />);
    expect(screen.getByText('NO_TARGET_ACQUIRED')).toBeInTheDocument();
  });

  it('renders HP values from targetRhombus', () => {
    render(<HitPointsPanel target={makeRhombus()} token="" refreshLocations={vi.fn()} />);
    expect(screen.getByText('80 / 100')).toBeInTheDocument();
  });

  it('shows temp HP when hp_temp > 0', () => {
    render(<HitPointsPanel target={makeRhombus({ hp_temp: 15 })} token="" refreshLocations={vi.fn()} />);
    expect(screen.getByText(/\+ 15 TEMP/)).toBeInTheDocument();
  });

  it('does not show temp HP badge when hp_temp is 0', () => {
    render(<HitPointsPanel target={makeRhombus({ hp_temp: 0 })} token="" refreshLocations={vi.fn()} />);
    expect(screen.queryByText(/\+ \d+ TEMP/)).not.toBeInTheDocument();
  });

  it('calls PUT /health with heal action on HEAL click', async () => {
    const refreshLocations = vi.fn();
    render(<HitPointsPanel target={makeRhombus()} token="tok" refreshLocations={refreshLocations} />);
    await userEvent.type(screen.getAllByPlaceholderText('0')[0], '10');
    await userEvent.click(screen.getByText('HEAL'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/locations/1/health',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ action: 'heal', amount: 10 }) })
    ));
    expect(refreshLocations).toHaveBeenCalled();
  });

  it('calls PUT /health with damage action on DAMAGE click', async () => {
    render(<HitPointsPanel target={makeRhombus()} token="tok" refreshLocations={vi.fn()} />);
    await userEvent.type(screen.getAllByPlaceholderText('0')[0], '25');
    await userEvent.click(screen.getByText('DAMAGE'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/locations/1/health',
      expect.objectContaining({ body: JSON.stringify({ action: 'damage', amount: 25 }) })
    ));
  });

  it('hides MAX_HP controls when no token', () => {
    render(<HitPointsPanel target={makeRhombus()} token="" refreshLocations={vi.fn()} />);
    expect(screen.queryByText('MAX_HP')).not.toBeInTheDocument();
  });

  it('shows MAX_HP controls when token is present', () => {
    render(<HitPointsPanel target={makeRhombus()} token="tok" refreshLocations={vi.fn()} />);
    expect(screen.getByText('MAX_HP')).toBeInTheDocument();
  });

  it('caps TEMP_HP input at 100', async () => {
    render(<HitPointsPanel target={makeRhombus()} token="tok" refreshLocations={vi.fn()} />);
    const tempInputEl = document.querySelector('input[max="100"]') as HTMLInputElement;
    await userEvent.clear(tempInputEl);
    await userEvent.type(tempInputEl, '150');
    expect(parseInt(tempInputEl.value)).toBeLessThanOrEqual(100);
  });
});

describe('HitPointsPanel (HEALTH on your own token, or any for the GM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('shows the numbers and the live monitor together', () => {
    const { container } = render(<HitPointsPanel target={makeRhombus()} token="tok" refreshLocations={vi.fn()} />);
    expect(screen.getByText('80 / 100')).toBeInTheDocument();
    expect(container.querySelector('.ekg-live')).not.toBeNull();
  });

  it('offers to make a health record for a player with no token yet', async () => {
    const onCreate = vi.fn();
    render(<HitPointsPanel target={null} token="" refreshLocations={vi.fn()} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: 'CREATE HEALTH RECORD' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('offers nothing to make when there is no way to make it', () => {
    render(<HitPointsPanel target={null} token="" refreshLocations={vi.fn()} />);
    expect(screen.getByText('NO_TARGET_ACQUIRED')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks an injury and saves it for the token', async () => {
    render(<HitPointsPanel target={makeRhombus()} token="tok" refreshLocations={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Injuries' }));
    await userEvent.click(screen.getByRole('button', { name: 'HEAD' }));
    expect(global.fetch).toHaveBeenCalledWith('/api/locations/1/injuries', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ injuries: { head: true } }),
    }));
    expect(screen.getByRole('button', { name: 'HEAD' })).toHaveAttribute('aria-pressed', 'true');
  });
});

/** What a person reads: the text on screen, not the monitor's stylesheet. */
const shownText = (el: HTMLElement) => {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('style').forEach((n) => n.remove());
  return copy.textContent ?? '';
};

describe('HealthReviewPanel (HEALTH on somebody else\'s token)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null });
  });

  it('beats while they stand, and flatlines when they are down', () => {
    const { container, rerender } = render(<HealthReviewPanel location={makeRhombus()} />);
    expect(container.querySelector('.ekg-live')).not.toBeNull();
    rerender(<HealthReviewPanel location={makeRhombus({ hp_current: 0 })} />);
    expect(container.querySelector('.ekg-dead')).not.toBeNull();
  });

  it('never gives a number: not their HP, not their temp HP', () => {
    const { container } = render(<HealthReviewPanel location={makeRhombus({ hp_current: 37, hp_max: 90, hp_temp: 12 })} />);
    expect(shownText(container)).not.toMatch(/\d/);
    expect(screen.getByText('+ TEMP SHIELDING')).toBeInTheDocument();
  });

  it('SR6 stun is a bar with no figures', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stun_current: 3, stun_monitor: 10 }) });
    const { container } = render(<HealthReviewPanel location={makeRhombus()} gameSystem="shadowrun_6e" />);
    expect(await screen.findByTestId('stun-track')).toBeInTheDocument();
    expect(shownText(container)).not.toMatch(/\d/);
  });

  it('shows the injury map, and it cannot be changed from here', async () => {
    render(<HealthReviewPanel location={makeRhombus({ injuries: JSON.stringify({ head: true }) } as any)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Injuries' }));
    expect(screen.getByTitle('HEAD')).toHaveAttribute('data-injured', 'yes');
    expect(screen.queryByRole('button', { name: 'HEAD' })).toBeNull();
  });
});
