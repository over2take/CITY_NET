import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VehiclesWindow, seatAnchor, seatRows, hullColor } from '../VehiclesWindow';

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

const PLAYERS = [
  { username: 'cody', name: 'Sam' },
  { username: 'mouse', name: 'Vega' },
];

const CAR = {
  owner: 'cody', ownerName: 'Sam', index: 1, name: 'Kestrel', type: 'car',
  ac: 8, armorRating: 6, hp: 30, hpMax: 30, moving: false, destroyed: false,
  crew: 5, seats: ['driver', 'seat2', 'seat3', 'seat4', 'seat5'],
  occupants: {} as Record<string, string>,
};

const open = (
  opts: {
    userName?: string;
    isAdmin?: boolean;
    vehicles?: typeof CAR[];
    players?: typeof PLAYERS;
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
      players={opts.players ?? PLAYERS}
    />
  );
  return socket;
};

/** Same as `open`, but hands back the render result for the tests that measure. */
const renderWindow = (opts: { vehicles?: typeof CAR[]; players?: typeof PLAYERS } = {}) =>
  render(
    <VehiclesWindow
      pos={{ x: 0, y: 0 }}
      setPos={vi.fn()}
      onClose={vi.fn()}
      socket={makeSocket()}
      userName="cody"
      vehicles={opts.vehicles ?? [CAR]}
      players={opts.players ?? PLAYERS}
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
    open({ vehicles: [{ ...CAR, type: 'apc', crew: 3, seats: ['driver', 'seat2', 'seat3'] }], players: [PLAYERS[0]] });
    expect(screen.getByLabelText('DRIVER')).toBeInTheDocument();
    expect(screen.getByLabelText('GUNNER')).toBeInTheDocument();
    expect(screen.getByLabelText('CREW 3')).toBeInTheDocument();
  });

  it('shows the numbers the table needs without opening a sheet', () => {
    open({ vehicles: [{ ...CAR, occupants: { driver: 'cody' } }], players: [PLAYERS[0]] });
    expect(screen.getByText('AC 8')).toBeInTheDocument();
    expect(screen.getByText('AR 6')).toBeInTheDocument();
    expect(screen.getByText('30 / 30')).toBeInTheDocument();
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
    open({ vehicles: [{ ...CAR, destroyed: true }], players: [PLAYERS[0]] });
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

  it('names characters in the dropdowns, not accounts', async () => {
    // Nobody at the table thinks of each other by login name.
    const socket = open();
    const seat = screen.getByLabelText('SHOTGUN') as HTMLSelectElement;
    expect([...seat.options].map(o => o.textContent)).toEqual(['— EMPTY —', 'SAM', 'VEGA']);
    // The username is still what gets written, since it is the key everything else uses.
    await userEvent.selectOptions(seat, 'mouse');
    expect(lastEmit(socket, 'seatIn')).toMatchObject({ occupant: 'mouse' });
  });

  it('names the owner by character in the picker', () => {
    open();
    expect(screen.getByRole('option', { name: /KESTREL · SAM/ })).toBeInTheDocument();
  });

  it('seats the front pair side by side', () => {
    // A car is DRIVER, SHOTGUN, B.LEFT, B.RIGHT, REAR. Shotgun is the front passenger
    // seat, not the one behind the driver — the driver used to sit alone at the nose with
    // shotgun tucked in behind them.
    const [driver, shotgun, backLeft, backRight, rear] = [0, 1, 2, 3, 4].map(i => seatAnchor(i, 5));
    expect(driver.y).toBe(shotgun.y);
    expect(driver.side).toBe('left');
    expect(shotgun.side).toBe('right');
    // The back bench is a row further down, and matches sides with the front.
    expect(backLeft.y).toBeGreaterThan(driver.y);
    expect(backLeft.side).toBe('left');
    expect(backRight.side).toBe('right');
    expect(backRight.y).toBe(backLeft.y);
    // The odd seat out goes down the centre line at the back.
    expect(rear.x).toBe(50);
    expect(rear.y).toBeGreaterThan(backLeft.y);
  });

  it('puts a lone rider on the centre line', () => {
    // A motorcycle is crew 1; it should not be pushed to one side of the frame.
    expect(seatAnchor(0, 1).x).toBe(50);
    expect(seatRows(1)).toBe(1);
  });

  it('pairs an even crew off with no centre seat', () => {
    // A truck is DRIVER and SHOTGUN, both on the front bench.
    expect(seatAnchor(0, 2).side).toBe('left');
    expect(seatAnchor(1, 2).side).toBe('right');
    expect(seatAnchor(0, 2).y).toBe(seatAnchor(1, 2).y);
    expect(seatRows(2)).toBe(1);
  });

  it('counts rows for the big hulls', () => {
    expect(seatRows(16)).toBe(8);
    expect(seatRows(13)).toBe(7);
  });

  it('surfaces a refusal from the server', () => {
    const socket = open();
    socket.deliver('vehicleSeatingError', { message: 'NO_SUCH_SEAT' });
    expect(screen.getByText(/NO SUCH SEAT/)).toBeInTheDocument();
  });
});

/**
 * The hull bar.
 *
 * The clamping is the server's test — what matters here is that the right sign goes out,
 * and that the buttons only appear for someone entitled to press them.
 */
describe('the hull', () => {
  const amountBox = () => screen.getByLabelText('Hull amount');

  it('draws the bar against the maximum', () => {
    open({ vehicles: [{ ...CAR, hp: 12 }] });
    const bar = screen.getByRole('progressbar', { name: 'Hull' });
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '30');
    expect(screen.getByText('12 / 30')).toBeInTheDocument();
  });

  it('says WRECKED rather than HULL at zero', () => {
    open({ vehicles: [{ ...CAR, hp: 0, destroyed: true }] });
    expect(screen.getByText('WRECKED')).toBeInTheDocument();
    expect(screen.queryByText('HULL')).not.toBeInTheDocument();
  });

  it('grades the colour by what is left', () => {
    // Same thresholds as the character health windows, so a car at a quarter reads as
    // urgently as a person at a quarter.
    expect(hullColor(30, 30)).toBe('var(--green)');
    expect(hullColor(10, 30)).toBe('#ffaa00');
    expect(hullColor(4, 30)).toBe('#ff3333');
    expect(hullColor(0, 30)).toBe('#ff3333');
    // A hull with no maximum is not a divide-by-zero.
    expect(hullColor(0, 0)).toBe('#ff3333');
  });

  it('sends damage negative and a repair positive', async () => {
    const socket = open();
    await userEvent.type(amountBox(), '7');
    await userEvent.click(screen.getByText('DAMAGE'));
    expect(lastEmit(socket, 'setVehicleHp')).toMatchObject({ owner: 'cody', vehicleIndex: 1, delta: -7 });

    await userEvent.type(amountBox(), '4');
    await userEvent.click(screen.getByText('REPAIR'));
    expect(lastEmit(socket, 'setVehicleHp')).toMatchObject({ owner: 'cody', vehicleIndex: 1, delta: 4 });
  });

  it('clears the amount after sending, so a click cannot repeat itself', async () => {
    const socket = open();
    await userEvent.type(amountBox(), '5');
    await userEvent.click(screen.getByText('DAMAGE'));
    expect(amountBox()).toHaveValue(null);

    // A second click with nothing typed sends nothing at all.
    const before = socket.emitted.length;
    await userEvent.click(screen.getByText('DAMAGE'));
    expect(socket.emitted.length).toBe(before);
  });

  it('reads a typed minus as an amount, not a direction', async () => {
    // REPAIR and DAMAGE carry the sign. A minus in the box would otherwise invert them.
    const socket = open();
    await userEvent.type(amountBox(), '-8');
    await userEvent.click(screen.getByText('DAMAGE'));
    expect(lastEmit(socket, 'setVehicleHp')).toMatchObject({ delta: -8 });
  });

  it('shows the bar to everyone but the buttons only to the owner', () => {
    open({ userName: 'mouse' });
    expect(screen.getByRole('progressbar', { name: 'Hull' })).toBeInTheDocument();
    expect(screen.queryByText('REPAIR')).not.toBeInTheDocument();
    expect(screen.queryByText('DAMAGE')).not.toBeInTheDocument();
  });

  it('gives the GM the buttons on a car that is not theirs', () => {
    open({ userName: 'mouse', isAdmin: true });
    expect(screen.getByText('REPAIR')).toBeInTheDocument();
  });
});
