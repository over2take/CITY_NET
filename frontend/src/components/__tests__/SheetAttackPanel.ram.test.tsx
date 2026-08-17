import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetAttackPanel } from '../Sidebar';

/**
 * Ramming from the attack panel.
 *
 * The driver's weapon. It sits with the carried weapons because that is where a player
 * looks for "what can I do to that token" — but it is not an attack: no skill, no to-hit
 * roll, and it leaves by its own event rather than through the attack path.
 *
 * Who may ram is the server's decision, made from the seat. The panel only draws what the
 * server told it, which is why every case here starts from a `sheetData` payload.
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

const renderPanel = () => {
  const socket = makeSocket();
  render(
    <SheetAttackPanel
      system="cyberpunk_red"
      userName="cody"
      socketRef={{ current: socket } as any}
      targetId={7}
      rhombusState={{ color: '#00ff00' }}
      setIsDiceTrayOpen={vi.fn()}
    />
  );
  return socket;
};

const PISTOL = { weapon1_name: 'Militech', weapon1_dmg: '3d6', weapon1_skill: 'handgun' };
const sheet = (extra: Record<string, unknown>) =>
  ({ username: 'cody', data: PISTOL, ...extra });

const last = (socket: ReturnType<typeof makeSocket>, event: string) =>
  [...socket.emitted].reverse().find(e => e.event === event)?.payload;

describe('the ram row', () => {
  it('appears for a driver, named after the vehicle', () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ driving: { name: 'Galena' } }));
    expect(screen.getByRole('option', { name: /GALENA · RAM · 6d6/ })).toBeInTheDocument();
  });

  it('shows no skill, because there is no roll to make one with', () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ driving: { name: 'Galena' } }));
    // The carried weapon still shows its skill; the ram has nothing to show and must not
    // trail an empty separator.
    expect(screen.getByRole('option', { name: 'GALENA · RAM · 6d6' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /MILITECH · 3d6 · HANDGUN/ })).toBeInTheDocument();
  });

  it('stays away from a passenger and from anyone on foot', () => {
    const socket = renderPanel();
    // The server sends no `driving` unless this user holds the driver seat.
    socket.deliver('sheetData', sheet({ inVehicle: { name: 'Galena' } }));
    expect(screen.queryByRole('option', { name: /RAM/ })).not.toBeInTheDocument();

    socket.deliver('sheetData', sheet({}));
    expect(screen.queryByRole('option', { name: /RAM/ })).not.toBeInTheDocument();
  });

  it('rams the targeted token, and does not go through the attack path', async () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ driving: { name: 'Galena' } }));

    await userEvent.selectOptions(screen.getByLabelText('Weapon'), 'ram');
    // Driving into something is melee, so the button says so rather than FIRE.
    await userEvent.click(screen.getByText('SWING'));

    // Whether that token is a person or the car they are sitting in is the server's call.
    expect(last(socket, 'ramVehicle')).toEqual({ targetId: 7 });
    expect(last(socket, 'sheetAttack')).toBeUndefined();
  });

  it('still fires ordinary weapons normally', async () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ driving: { name: 'Galena' } }));

    await userEvent.selectOptions(screen.getByLabelText('Weapon'), '1');
    await userEvent.click(screen.getByText('FIRE'));

    expect(last(socket, 'sheetAttack')).toMatchObject({ targetId: 7, weaponIndex: 1 });
    expect(last(socket, 'ramVehicle')).toBeUndefined();
  });

  it('reads as melee, not as a shot', async () => {
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ driving: { name: 'Galena' } }));

    await userEvent.selectOptions(screen.getByLabelText('Weapon'), '1');
    expect(screen.getByText('FIRE')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Weapon'), 'ram');
    expect(screen.getByText('SWING')).toBeInTheDocument();
    expect(screen.queryByText('FIRE')).not.toBeInTheDocument();
  });

  it('hides the aimed shot while a ram is selected', async () => {
    // An aimed shot is a to-hit modifier, and a ram has no check to modify.
    const socket = renderPanel();
    socket.deliver('sheetData', sheet({ driving: { name: 'Galena' } }));

    await userEvent.selectOptions(screen.getByLabelText('Weapon'), '1');
    expect(screen.getByText(/AIMED SHOT/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Weapon'), 'ram');
    expect(screen.queryByText(/AIMED SHOT/)).not.toBeInTheDocument();
  });
});
