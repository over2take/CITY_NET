import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VehiclesWindow } from '../VehiclesWindow';

/**
 * The shared seating window.
 *
 * Every write goes to the server, which owns the rules. What is checked here is that the
 * window says the right thing and sends the right message — not that the rules hold,
 * which is the server's test.
 */

type Handler = (payload: unknown) => void;

const makeSocket = () => {
  const handlers: Record<string, Handler[]> = {};
  const emitted: { event: string; payload: unknown }[] = [];
  return {
    emitted,
    on: (event: string, fn: Handler) => { (handlers[event] ||= []).push(fn); },
    off: (event: string, fn: Handler) => { handlers[event] = (handlers[event] || []).filter(h => h !== fn); },
    emit: (event: string, payload?: unknown) => { emitted.push({ event, payload }); },
    deliver: (event: string, payload: unknown) => act(() => { (handlers[event] || []).forEach(h => h(payload)); }),
  };
};

const CAR = {
  owner: 'cody', index: 1, name: 'Kestrel', type: 'car',
  ac: 8, armorRating: 6, hp: 30, hpMax: 30, moving: false, destroyed: false,
  crew: 5, seats: ['driver', 'seat2', 'seat3', 'seat4', 'seat5'],
  occupants: {} as Record<string, string>,
};

const open = (opts: { userName?: string; isAdmin?: boolean } = {}) => {
  const socket = makeSocket();
  render(
    <VehiclesWindow
      pos={{ x: 0, y: 0 }}
      setPos={vi.fn()}
      onClose={vi.fn()}
      socket={socket}
      userName={opts.userName ?? 'cody'}
      isAdmin={opts.isAdmin}
    />
  );
  return socket;
};

const lastEmit = (socket: ReturnType<typeof makeSocket>, event: string) =>
  [...socket.emitted].reverse().find(e => e.event === event)?.payload as never;

beforeEach(() => vi.clearAllMocks());

describe('the vehicles window', () => {
  it('asks for the roster as soon as it opens', () => {
    const socket = open();
    expect(socket.emitted.some(e => e.event === 'requestVehicleRoster')).toBe(true);
  });

  it('says what to do when there are no vehicles', () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [], players: [] });
    expect(screen.getByText(/NO VEHICLES/)).toBeInTheDocument();
  });

  it('draws one seat per crew, named from the book', () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody', 'mouse'] });
    // A Car is crew 5 and the book names all five.
    expect(screen.getByLabelText('DRIVER')).toBeInTheDocument();
    expect(screen.getByLabelText('SHOTGUN')).toBeInTheDocument();
    expect(screen.getByLabelText('REAR')).toBeInTheDocument();
  });

  it('numbers seats the book does not name', () => {
    const socket = open();
    // An APC seats sixteen and the book names two of them.
    socket.deliver('vehicleRoster', {
      vehicles: [{ ...CAR, type: 'apc', crew: 3, seats: ['driver', 'seat2', 'seat3'] }],
      players: ['cody'],
    });
    expect(screen.getByLabelText('DRIVER')).toBeInTheDocument();
    expect(screen.getByLabelText('GUNNER')).toBeInTheDocument();
    expect(screen.getByLabelText('CREW 3')).toBeInTheDocument();
  });

  it('shows the numbers the table needs without opening a sheet', () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [{ ...CAR, occupants: { driver: 'cody' } }], players: ['cody'] });
    expect(screen.getByText('AC 8')).toBeInTheDocument();
    expect(screen.getByText('AR 6')).toBeInTheDocument();
    expect(screen.getByText('30/30 HP')).toBeInTheDocument();
    expect(screen.getByText('1/5 ABOARD')).toBeInTheDocument();
  });

  it('seats someone by picking them', async () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody', 'mouse'] });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), 'mouse');
    expect(lastEmit(socket, 'seatIn')).toMatchObject({
      occupant: 'mouse', owner: 'cody', vehicleIndex: 1, seat: 'seat2',
    });
  });

  it('lets you out of your own seat', async () => {
    const socket = open({ userName: 'mouse' });
    socket.deliver('vehicleRoster', {
      vehicles: [{ ...CAR, occupants: { seat2: 'mouse' } }], players: ['cody', 'mouse'],
    });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), '');
    expect(lastEmit(socket, 'seatOut')).toMatchObject({ occupant: 'mouse' });
  });

  it('refuses to turn someone else out, and says why', async () => {
    const socket = open({ userName: 'cody' });
    socket.deliver('vehicleRoster', {
      vehicles: [{ ...CAR, occupants: { seat2: 'mouse' } }], players: ['cody', 'mouse'],
    });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), '');
    // Caught here to save a round trip; the server refuses it as well.
    expect(socket.emitted.some(e => e.event === 'seatOut')).toBe(false);
    expect(screen.getByText(/ONLY THAT PLAYER/)).toBeInTheDocument();
  });

  it('lets the GM turn anyone out', async () => {
    const socket = open({ userName: 'gm', isAdmin: true });
    socket.deliver('vehicleRoster', {
      vehicles: [{ ...CAR, occupants: { seat2: 'mouse' } }], players: ['cody', 'mouse'],
    });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), '');
    expect(lastEmit(socket, 'seatOut')).toMatchObject({ occupant: 'mouse' });
  });

  it('sets movement on the vehicle, not on a person', async () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody'] });
    await userEvent.click(screen.getByLabelText('MOVING'));
    expect(lastEmit(socket, 'setVehicleMoving')).toMatchObject({
      owner: 'cody', vehicleIndex: 1, moving: true,
    });
  });

  it('marks a wreck as no longer cover', () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [{ ...CAR, destroyed: true }], players: ['cody'] });
    // Flagged in the picker and spelled out under the diagram.
    expect(screen.getByRole('option', { name: /WRECKED/ })).toBeInTheDocument();
    expect(screen.getByText(/no longer cover/)).toBeInTheDocument();
  });

  it('lists every car in play, not just yours', () => {
    const socket = open();
    socket.deliver('vehicleRoster', {
      vehicles: [CAR, { ...CAR, owner: 'mouse', name: 'Mule' }],
      players: ['cody', 'mouse'],
    });
    expect((screen.getByLabelText('Vehicle') as HTMLSelectElement).options).toHaveLength(2);
  });

  it('refreshes when someone else moves', () => {
    const socket = open();
    socket.deliver('vehicleRoster', { vehicles: [CAR], players: ['cody'] });
    const before = socket.emitted.filter(e => e.event === 'requestVehicleRoster').length;
    socket.deliver('vehicleSeatingChanged', {});
    expect(socket.emitted.filter(e => e.event === 'requestVehicleRoster').length).toBeGreaterThan(before);
  });
});
