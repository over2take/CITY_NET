import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiceMenu } from '../Sidebar';

/**
 * Telling the attacker what they are shooting at.
 *
 * The vehicle is on the defender's sheet, which the attacker cannot see. Without this
 * they fire, watch most of the damage disappear into an Armour Rating they had no way to
 * know about, and read it as a bug.
 */

const socketRef = { current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } } as never;

const renderMenu = (vehicle: unknown) =>
  render(
    <DiceMenu
      userName="GHOST"
      token="t"
      socketRef={socketRef}
      rhombusState={{ color: '#00ff00' }}
      setIsDiceTrayOpen={vi.fn()}
      setNotification={vi.fn()}
      gameSystem="cities_without_number"
      attackPending={{ targetId: 7, targetName: 'MOUSE', attackType: 'ranged', ac: 8, vehicle } as never}
      onCancelAttack={vi.fn()}
    />
  );

beforeEach(() => {
  vi.spyOn(global, 'fetch' as never).mockResolvedValue({ json: async () => [] } as never);
});

describe('target in a vehicle', () => {
  it('names the vehicle and its numbers before the shot', () => {
    renderMenu({ name: 'Kestrel', ac: 15, armorRating: 5, hp: 18, hpMax: 20, moving: true });
    expect(screen.getByText(/TARGET IN VEHICLE/)).toBeInTheDocument();
    expect(screen.getByText(/KESTREL/)).toBeInTheDocument();
    // Armour Rating is the number that explains where the damage went.
    expect(screen.getByText(/AR 5/)).toBeInTheDocument();
    expect(screen.getByText(/18\/20/)).toBeInTheDocument();
  });

  it('says whether it is moving, which is worth eight points of AC', () => {
    renderMenu({ name: 'Kestrel', ac: 15, armorRating: 5, hp: 20, hpMax: 20, moving: true });
    expect(screen.getByText(/MOVING/)).toBeInTheDocument();
  });

  it('says stationary when it is parked', () => {
    renderMenu({ name: 'Kestrel', ac: 8, armorRating: 5, hp: 20, hpMax: 20, moving: false });
    expect(screen.getByText(/STATIONARY/)).toBeInTheDocument();
  });

  it('shows nothing for a target on foot', () => {
    renderMenu(null);
    expect(screen.queryByText(/TARGET IN VEHICLE/)).toBeNull();
  });
});
