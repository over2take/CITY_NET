import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetAttackPanel } from '../Sidebar';

/**
 * Firing a vehicle mount.
 *
 * The server has always been able to resolve a mount — it takes a vehicleIndex
 * beside the weaponIndex and reads the mount through the same path as a carried
 * weapon. The panel never sent one, so a mount on the sheet was unreachable.
 */

type Handler = (payload: any) => void;

const makeSocket = () => {
  const handlers: Record<string, Handler[]> = {};
  const emitted: { event: string; payload: any }[] = [];
  return {
    emitted,
    on: (event: string, fn: Handler) => { (handlers[event] ||= []).push(fn); },
    off: (event: string, fn: Handler) => { handlers[event] = (handlers[event] || []).filter(h => h !== fn); },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    deliver: (event: string, payload: any) => act(() => { (handlers[event] || []).forEach(h => h(payload)); }),
  };
};

const renderPanel = (system: 'cities_without_number' | 'cyberpunk_red' = 'cities_without_number') => {
  const socket = makeSocket();
  const socketRef = { current: socket } as any;
  render(
    <SheetAttackPanel
      system={system}
      userName="cody"
      socketRef={socketRef}
      targetId={7}
      rhombusState={{ color: '#00ff00' }}
      setIsDiceTrayOpen={vi.fn()}
    />
  );
  return socket;
};

const sheet = (data: Record<string, string>) => ({ username: 'cody', data });

const CARBINE = { weapon1_name: 'Carbine', weapon1_dmg: '1d10', weapon1_skill: 'shoot' };
const CANNON = {
  vehicle1_name: 'Car',
  vehicle1_weapon1_name: 'Cannon',
  vehicle1_weapon1_dmg: '6d4',
  vehicle1_weapon1_skill: 'shoot',
};

const select = () => screen.getByLabelText('Weapon') as HTMLSelectElement;
const lastAttack = (socket: ReturnType<typeof makeSocket>) =>
  [...socket.emitted].reverse().find(e => e.event === 'sheetAttack')?.payload;

beforeEach(() => {
  vi.spyOn(global, 'fetch' as never).mockResolvedValue({ json: async () => [] } as never);
});

describe('vehicle mounts in the attack panel', () => {
  it('offers a mount alongside the carried weapons', async () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ ...CARBINE, ...CANNON }));
    expect(select().options).toHaveLength(2);
    // Labelled with its vehicle: firing a turret is a different act from
    // drawing a gun, and two mounts named MOUNT 1 would otherwise be identical.
    expect(screen.getByRole('option', { name: /CAR · CANNON · 6d4/ })).toBeInTheDocument();
  });

  it('sends the vehicle index when a mount is fired', async () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ ...CARBINE, ...CANNON }));
    await userEvent.selectOptions(select(), 'v1:1');
    await userEvent.click(screen.getByRole('button', { name: /FIRE|STRIKE|SWING/ }));
    expect(lastAttack(socket)).toMatchObject({ targetId: 7, vehicleIndex: 1, weaponIndex: 1 });
  });

  it('sends no vehicle index for a carried weapon', async () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ ...CARBINE, ...CANNON }));
    await userEvent.selectOptions(select(), '1');
    await userEvent.click(screen.getByRole('button', { name: /FIRE|STRIKE|SWING/ }));
    const payload = lastAttack(socket);
    expect(payload).toMatchObject({ weaponIndex: 1 });
    // Not merely falsy: the server branches on the key being present at all.
    expect('vehicleIndex' in payload).toBe(false);
  });

  it('distinguishes the same mount number on different vehicles', () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({
      ...CANNON,
      vehicle3_name: 'Truck',
      vehicle3_weapon1_name: 'Cannon',
      vehicle3_weapon1_dmg: '6d4',
      vehicle3_weapon1_skill: 'shoot',
    }));
    // Both are weaponIndex 1. Keyed by the pair, they are two entries rather
    // than one shadowing the other.
    expect(select().options).toHaveLength(2);
    expect(screen.getByRole('option', { name: /TRUCK · CANNON/ })).toBeInTheDocument();
  });

  it('skips a mount missing DMG or SKILL', () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({
      ...CARBINE,
      vehicle1_name: 'Car',
      vehicle1_weapon2_name: 'Autocannon', // named only — the placeholder row
    }));
    // The server would refuse it, so offering it would only produce an error.
    expect(select().options).toHaveLength(1);
  });

  it('names an unnamed vehicle so its mount is still identifiable', () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({
      vehicle2_weapon1_dmg: '2d8',
      vehicle2_weapon1_skill: 'shoot',
    }));
    expect(screen.getByRole('option', { name: /VEHICLE 2 · MOUNT 1/ })).toBeInTheDocument();
  });

  it('leaves other systems without mounts', () => {
    const socket = renderPanel('cyberpunk_red');
    // Same field names, a system that has no vehicles: the mount must not leak
    // across systems just because the data happens to be there.
    socket.deliver('sheetData', sheet({
      weapon1_name: 'Heavy Pistol', weapon1_dmg: '3d6', weapon1_skill: 'handgun',
      ...CANNON,
    }));
    expect(select().options).toHaveLength(1);
  });
});
