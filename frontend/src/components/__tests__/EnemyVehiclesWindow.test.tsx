import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnemyVehiclesWindow } from '../EnemyVehiclesWindow';
import { archetypeLook } from '../../sheets/vehicleArchetypes';

/**
 * The GM's enemy vehicles.
 *
 * Keyed by NPC sheet id rather than username, which is the whole reason this is a sibling of
 * the player window rather than a mode of it. What is checked here is that the window sends
 * that key, and that it says something useful when there is nothing to show — the empty case
 * is the one a GM meets first, and it has to explain where enemy vehicles come from.
 */

type Handler = (payload: any) => void;

const makeSocket = () => {
  const handlers: Record<string, Handler[]> = {};
  const emitted: { event: string; payload: any }[] = [];
  return {
    emitted,
    on: (event: string, fn: Handler) => { (handlers[event] ||= []).push(fn); },
    off: (event: string, fn: Handler) => { handlers[event] = (handlers[event] || []).filter(h => h !== fn); },
    emit: (event: string, payload?: any) => { emitted.push({ event, payload }); },
    deliver: (event: string, payload: any) => act(() => { (handlers[event] || []).forEach(h => h(payload)); }),
  };
};

const VAN = {
  sheetId: 12, owner: 'ROAD GANG', folder: 'Session 4', index: 1,
  name: 'Gang Van', type: 'van', ac: 11, armorRating: 6,
  hp: 35, hpMax: 35, moving: false, destroyed: false, crew: 3,
  seats: ['driver', 'seat2', 'seat3'],
};
const CAR = {
  ...VAN, sheetId: 19, owner: 'FIXER', folder: null, index: 1,
  name: 'Quiet Sedan', type: 'sedan', hp: 20, hpMax: 55,
};
const CREW = [{ sheetId: 12, label: 'ROAD GANG', folder: 'Session 4' }];

const open = (opts: { vehicles?: typeof VAN[]; crew?: typeof CREW } = {}) => {
  const socket = makeSocket();
  const refresh = vi.fn();
  render(
    <EnemyVehiclesWindow
      pos={{ x: 0, y: 0 }}
      setPos={vi.fn()}
      onClose={vi.fn()}
      socket={socket}
      vehicles={opts.vehicles ?? [VAN]}
      crew={opts.crew ?? CREW}
      look={archetypeLook}
      refresh={refresh}
    />
  );
  return { socket, refresh };
};

const last = (socket: ReturnType<typeof makeSocket>, event: string) =>
  [...socket.emitted].reverse().find(e => e.event === event)?.payload;

describe('the enemy vehicles window', () => {
  it('asks for the roster on open, since a sheet may have changed while it was shut', () => {
    const { refresh } = open();
    expect(refresh).toHaveBeenCalled();
  });

  it('says where enemy vehicles come from when there are none', () => {
    // The first thing a GM sees, so it has to explain the NPC sheet rather than just
    // being empty — and that they persist, which is the whole point.
    open({ vehicles: [] });
    expect(screen.getByText(/NPC sheet/)).toBeInTheDocument();
    expect(screen.getByText(/between sessions/)).toBeInTheDocument();
  });

  it('names each vehicle by its NPC, grouped by folder', () => {
    open({ vehicles: [VAN, CAR] });
    expect(screen.getByRole('option', { name: /GANG VAN · ROAD GANG/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /QUIET SEDAN · FIXER/ })).toBeInTheDocument();
    // A campaign of antagonists is not one flat list.
    expect(screen.getByRole('group', { name: 'Session 4' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'UNFILED' })).toBeInTheDocument();
  });

  it('draws the hull against its maximum', () => {
    open({ vehicles: [CAR] });
    const bar = screen.getByRole('progressbar', { name: 'Hull' });
    expect(bar).toHaveAttribute('aria-valuenow', '20');
    expect(bar).toHaveAttribute('aria-valuemax', '55');
    expect(screen.getByText('20 / 55')).toBeInTheDocument();
  });

  it('sends damage and repair keyed by sheet id, not by a name', () => {
    // The key is the point: an NPC sheet has no username to send.
    const { socket } = open();
    return (async () => {
      await userEvent.type(screen.getByLabelText('Hull amount'), '9');
      await userEvent.click(screen.getByText('DAMAGE'));
      expect(last(socket, 'setEnemyVehicleHp')).toEqual({ sheetId: 12, vehicleIndex: 1, delta: -9 });

      await userEvent.type(screen.getByLabelText('Hull amount'), '4');
      await userEvent.click(screen.getByText('REPAIR'));
      expect(last(socket, 'setEnemyVehicleHp')).toEqual({ sheetId: 12, vehicleIndex: 1, delta: 4 });
    })();
  });

  it('toggles MOVING on the car', async () => {
    const { socket } = open();
    await userEvent.click(screen.getByLabelText(/MOVING/i, { selector: 'input' }).closest('input')!);
    expect(last(socket, 'setEnemyVehicleMoving')).toEqual({ sheetId: 12, vehicleIndex: 1, moving: true });
  });

  it('reads WRECKED at zero', () => {
    open({ vehicles: [{ ...VAN, hp: 0, destroyed: true }] });
    expect(screen.getByText('WRECKED')).toBeInTheDocument();
    expect(screen.queryByText('HULL')).not.toBeInTheDocument();
  });

  it('surfaces a refusal from the server', () => {
    const { socket } = open();
    socket.deliver('vehicleSeatingError', { message: 'NO_SUCH_SHEET' });
    expect(screen.getByText(/NO SUCH SHEET/)).toBeInTheDocument();
  });

  it('draws a marker per seat', () => {
    // Read-only for now: seating an NPC needs an occupancy field keyed by sheet id.
    const { container } = render(
      <EnemyVehiclesWindow
        pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
        socket={makeSocket()} vehicles={[VAN]} crew={CREW}
        look={archetypeLook} refresh={vi.fn()}
      />
    );
    // Three seats on the van, drawn as circles over the wireframe.
    expect(container.querySelectorAll('svg circle').length).toBeGreaterThanOrEqual(3);
  });
});
