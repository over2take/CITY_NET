import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRollFlash } from '../useRollFlash';

/**
 * DICE_TRAY.EXE's flash (6c4g): someone else's roll while the tray is shut flashes it till the tray
 * opens; the tray opens on the roll history; shut again, it waits for new rolls.
 */

const rook = { userName: 'ROOK', account: 'rook' };
const mine = { userName: 'KES', account: 'kes' };

const flash = (props: { trayOpen: boolean; bell: boolean }) =>
  renderHook((p: { trayOpen: boolean; bell: boolean }) => useRollFlash('kes', p.trayOpen, p.bell), { initialProps: props });

describe('the tray\'s flash', () => {
  it('starts still, and someone else\'s roll while the tray is shut flashes it', () => {
    const { result } = flash({ trayOpen: false, bell: true });
    expect(result.current.flashing).toBe(false);
    act(() => result.current.arrived(rook));
    expect(result.current.flashing).toBe(true);
    expect(result.current.openOnHistory).toBe(true);
  });

  it('not for your own roll, nor with the bell off', () => {
    const { result, rerender } = flash({ trayOpen: false, bell: true });
    act(() => result.current.arrived(mine));
    expect(result.current.flashing).toBe(false);
    rerender({ trayOpen: false, bell: false });
    act(() => result.current.arrived(rook));
    expect(result.current.flashing).toBe(false);
  });

  it('not for a roll made with the tray open', () => {
    const { result } = flash({ trayOpen: true, bell: true });
    act(() => result.current.arrived(rook));
    expect(result.current.flashing).toBe(false);
    expect(result.current.openOnHistory).toBe(false);
  });

  it('stops the moment the tray opens, which still opens on the history; shut again, it is forgotten', () => {
    const { result, rerender } = flash({ trayOpen: false, bell: true });
    act(() => result.current.arrived(rook));
    rerender({ trayOpen: true, bell: true });
    // The very render the tray opens in: no flash, and the tray mounts seeing there was one.
    expect(result.current.flashing).toBe(false);
    expect(result.current.openOnHistory).toBe(true);
    rerender({ trayOpen: false, bell: true });
    expect(result.current.flashing).toBe(false);
    expect(result.current.openOnHistory).toBe(false);
    // The next roll flashes it again.
    act(() => result.current.arrived(rook));
    expect(result.current.flashing).toBe(true);
  });

  it('keeps flashing through more rolls, and is one handler for the socket, not a new one each render', () => {
    const { result, rerender } = flash({ trayOpen: false, bell: true });
    const first = result.current.arrived;
    act(() => result.current.arrived(rook));
    act(() => result.current.arrived(rook));
    rerender({ trayOpen: false, bell: true });
    expect(result.current.flashing).toBe(true);
    expect(result.current.arrived).toBe(first);
  });

  it('reads the tray and bell as they are now from that one handler', () => {
    const { result, rerender } = flash({ trayOpen: false, bell: false });
    const handler = result.current.arrived;
    rerender({ trayOpen: false, bell: true });
    act(() => handler(rook));
    expect(result.current.flashing).toBe(true);
  });
});
