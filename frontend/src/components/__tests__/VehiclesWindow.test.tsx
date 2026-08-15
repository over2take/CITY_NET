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

const open = (
  opts: {
    userName?: string;
    isAdmin?: boolean;
    vehicles?: typeof CAR[];
    players?: string[];
  } = {},
) => {
  const socket = makeSocket();
  render(
    <VehiclesWindow
      pos={{ x: 0, y: 0 }}
      setPos={vi.fn()}
      onClose={vi.fn()}
      socket={socket}
      userName={opts.userName ?? 'cody'}
      isAdmin={opts.isAdmin}
      vehicles={opts.vehicles ?? [CAR]}
      players={opts.players ?? ['cody', 'mouse']}
    />
  );
  return socket;
};

/** Same as `open`, but hands back the render result for the tests that measure. */
const renderWindow = (opts: { vehicles?: typeof CAR[]; players?: string[] } = {}) =>
  render(
    <VehiclesWindow
      pos={{ x: 0, y: 0 }}
      setPos={vi.fn()}
      onClose={vi.fn()}
      socket={makeSocket()}
      userName="cody"
      vehicles={opts.vehicles ?? [CAR]}
      players={opts.players ?? ['cody', 'mouse']}
    />
  );

const lastEmit = (socket: ReturnType<typeof makeSocket>, event: string) =>
  [...socket.emitted].reverse().find(e => e.event === event)?.payload as never;

beforeEach(() => vi.clearAllMocks());

describe('the vehicles window', () => {
  it('says what to do when there are no vehicles', () => {
    open({ vehicles: [], players: [] });
    expect(screen.getByText(/NO VEHICLES/)).toBeInTheDocument();
  });

  it('draws one seat per crew, named from the book', () => {
    open();
    // A Car is crew 5 and the book names all five.
    expect(screen.getByLabelText('DRIVER')).toBeInTheDocument();
    expect(screen.getByLabelText('SHOTGUN')).toBeInTheDocument();
    expect(screen.getByLabelText('REAR')).toBeInTheDocument();
  });

  it('numbers seats the book does not name', () => {
    // An APC seats sixteen and the book names two of them.
    open({ vehicles: [{ ...CAR, type: 'apc', crew: 3, seats: ['driver', 'seat2', 'seat3'] }], players: ['cody'] });
    expect(screen.getByLabelText('DRIVER')).toBeInTheDocument();
    expect(screen.getByLabelText('GUNNER')).toBeInTheDocument();
    expect(screen.getByLabelText('CREW 3')).toBeInTheDocument();
  });

  it('shows the numbers the table needs without opening a sheet', () => {
    open({ vehicles: [{ ...CAR, occupants: { driver: 'cody' } }], players: ['cody'] });
    expect(screen.getByText('AC 8')).toBeInTheDocument();
    expect(screen.getByText('AR 6')).toBeInTheDocument();
    expect(screen.getByText('30/30 HP')).toBeInTheDocument();
    expect(screen.getByText('1/5 ABOARD')).toBeInTheDocument();
  });

  it('seats someone by picking them', async () => {
    const socket = open();
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), 'mouse');
    expect(lastEmit(socket, 'seatIn')).toMatchObject({
      occupant: 'mouse', owner: 'cody', vehicleIndex: 1, seat: 'seat2',
    });
  });

  it('lets you out of your own seat', async () => {
    const socket = open({ userName: 'mouse', vehicles: [{ ...CAR, occupants: { seat2: 'mouse' } }] });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), '');
    expect(lastEmit(socket, 'seatOut')).toMatchObject({ occupant: 'mouse' });
  });

  it('refuses to turn someone else out, and says why', async () => {
    const socket = open({ userName: 'cody', vehicles: [{ ...CAR, occupants: { seat2: 'mouse' } }] });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), '');
    // Caught here to save a round trip; the server refuses it as well.
    expect(socket.emitted.some(e => e.event === 'seatOut')).toBe(false);
    expect(screen.getByText(/ONLY THAT PLAYER/)).toBeInTheDocument();
  });

  it('lets the GM turn anyone out', async () => {
    const socket = open({ userName: 'gm', isAdmin: true, vehicles: [{ ...CAR, occupants: { seat2: 'mouse' } }] });
    await userEvent.selectOptions(screen.getByLabelText('SHOTGUN'), '');
    expect(lastEmit(socket, 'seatOut')).toMatchObject({ occupant: 'mouse' });
  });

  it('sets movement on the vehicle, not on a person', async () => {
    const socket = open();
    await userEvent.click(screen.getByLabelText('MOVING'));
    expect(lastEmit(socket, 'setVehicleMoving')).toMatchObject({
      owner: 'cody', vehicleIndex: 1, moving: true,
    });
  });

  it('marks a wreck as no longer cover', () => {
    open({ vehicles: [{ ...CAR, destroyed: true }], players: ['cody'] });
    // Flagged in the picker and spelled out under the diagram.
    expect(screen.getByRole('option', { name: /WRECKED/ })).toBeInTheDocument();
    expect(screen.getByText(/no longer cover/)).toBeInTheDocument();
  });

  it('lists every car in play, not just yours', () => {
    open({ vehicles: [CAR, { ...CAR, owner: 'mouse', name: 'Mule' }] });
    expect((screen.getByLabelText('Vehicle') as HTMLSelectElement).options).toHaveLength(2);
  });

  it('sizes itself to the vehicle rather than scrolling', () => {
    // The window's content pane caps at 300px and scrolls, so a diagram the width of the
    // window overran it every time and put half the car below the fold.
    const { container } = renderWindow({ vehicles: [CAR] });
    const diagram = container.querySelector('svg')!.parentElement as HTMLElement;
    const car = parseInt(diagram.style.height, 10);
    expect(car).toBeGreaterThan(0);
    expect(car).toBeLessThanOrEqual(540);
    expect(diagram.style.margin).toContain('auto');
  });

  it('gives a sixteen-seat hull more room than a five-seat one', () => {
    // Seats stack in two columns, so what sets the height is rows a side — and sixteen
    // controls crammed into a car-sized box would overlap each other.
    const seats = Array.from({ length: 16 }, (_, i) => (i === 0 ? 'driver' : `seat${i + 1}`));
    const small = renderWindow({ vehicles: [CAR] });
    const smallH = parseInt((small.container.querySelector('svg')!.parentElement as HTMLElement).style.height, 10);
    small.unmount();

    const big = renderWindow({ vehicles: [{ ...CAR, type: 'apc', crew: 16, seats }] });
    const bigH = parseInt((big.container.querySelector('svg')!.parentElement as HTMLElement).style.height, 10);
    expect(bigH).toBeGreaterThan(smallH);
  });

  it('surfaces a refusal from the server', () => {
    const socket = open();
    socket.deliver('vehicleSeatingError', { message: 'NO_SUCH_SEAT' });
    expect(screen.getByText(/NO SUCH SEAT/)).toBeInTheDocument();
  });
});
