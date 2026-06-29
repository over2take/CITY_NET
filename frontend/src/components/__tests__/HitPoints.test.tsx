import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HitPointsMenu } from '../HitPoints';
import type { Location } from '../../types';

const basePos = { x: 0, y: 0 };
const setPos = vi.fn();
const onClose = vi.fn();

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

describe('HitPointsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('shows NO_TARGET_ACQUIRED when targetRhombus is null', () => {
    render(<HitPointsMenu targetRhombus={null} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText('NO_TARGET_ACQUIRED')).toBeInTheDocument();
  });

  it('renders HP values from targetRhombus', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText('80 / 100')).toBeInTheDocument();
  });

  it('shows target name in title', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText('HP: GHOST')).toBeInTheDocument();
  });

  it('shows UNKNOWN in title when name is missing', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus({ name: '' })} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText('HP: UNKNOWN')).toBeInTheDocument();
  });

  it('shows temp HP when hp_temp > 0', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus({ hp_temp: 15 })} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText(/\+ 15 TEMP/)).toBeInTheDocument();
  });

  it('does not show temp HP badge when hp_temp is 0', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus({ hp_temp: 0 })} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.queryByText(/\+ \d+ TEMP/)).not.toBeInTheDocument();
  });

  it('calls PUT /health with heal action on HEAL click', async () => {
    const refreshLocations = vi.fn();
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="tok" refreshLocations={refreshLocations} pos={basePos} setPos={setPos} onClose={onClose} />);
    await userEvent.type(screen.getAllByPlaceholderText('0')[0], '10');
    await userEvent.click(screen.getByText('HEAL'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/locations/1/health',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ action: 'heal', amount: 10 }) })
    ));
    expect(refreshLocations).toHaveBeenCalled();
  });

  it('calls PUT /health with damage action on DAMAGE click', async () => {
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="tok" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    await userEvent.type(screen.getAllByPlaceholderText('0')[0], '25');
    await userEvent.click(screen.getByText('DAMAGE'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/locations/1/health',
      expect.objectContaining({ body: JSON.stringify({ action: 'damage', amount: 25 }) })
    ));
  });

  it('hides MAX_HP controls when no token', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.queryByText('MAX_HP')).not.toBeInTheDocument();
  });

  it('shows MAX_HP controls when token is present', () => {
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="tok" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    expect(screen.getByText('MAX_HP')).toBeInTheDocument();
  });

  it('caps TEMP_HP input at 100', async () => {
    render(<HitPointsMenu targetRhombus={makeRhombus()} token="tok" refreshLocations={vi.fn()} pos={basePos} setPos={setPos} onClose={onClose} />);
    const tempInputEl = document.querySelector('input[max="100"]') as HTMLInputElement;
    await userEvent.clear(tempInputEl);
    await userEvent.type(tempInputEl, '150');
    expect(parseInt(tempInputEl.value)).toBeLessThanOrEqual(100);
  });
});
