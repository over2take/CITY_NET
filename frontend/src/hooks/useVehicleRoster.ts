import React, { useState, useEffect, useCallback, useReducer } from 'react';
import type { RosterVehicle } from '../components/VehiclesWindow';
import { hasVehicles as systemHasVehicles } from '../sheets/vehicleSystems';

/**
 * Every vehicle in play, and who is in which seat.
 *
 * Held here rather than inside the window because two things need it: the window itself,
 * and the buttons that open it — which should not appear at a table that owns no vehicles.
 * One subscription, so the button and the window can never disagree about whether there is
 * anything to show.
 *
 * Takes the ref rather than the socket, like useInitiative does. A ref's `.current` is not
 * reactive: mutating it does not re-render, so a hook handed `socketRef.current` before
 * the socket exists binds to nothing and never binds again. That looked exactly like an
 * empty roster on a sheet with a vehicle plainly on it.
 */
export function useVehicleRoster(socketRef: React.MutableRefObject<any>, gameSystem?: string) {
  const [vehicles, setVehicles] = useState<RosterVehicle[]>([]);
  const [players, setPlayers] = useState<{ username: string; name: string }[]>([]);
  const [socketReadyCount, forceReady] = useReducer((n: number) => n + 1, 0);

  const enabled = systemHasVehicles(gameSystem);
  const refresh = useCallback(() => {
    if (enabled) socketRef.current?.emit('requestVehicleRoster');
  }, [socketRef, enabled]);

  useEffect(() => {
    if (!enabled) {
      // Switching to a system without vehicles should empty it, or a stale roster keeps
      // the buttons up over a game that has nothing to put in them.
      setVehicles([]);
      setPlayers([]);
      return;
    }
    if (!socketRef.current) {
      const interval = setInterval(() => {
        if (socketRef.current) {
          clearInterval(interval);
          forceReady();
        }
      }, 200);
      return () => clearInterval(interval);
    }

    const s = socketRef.current;
    const onRoster = (data: { vehicles?: RosterVehicle[]; players?: { username: string; name: string }[] }) => {
      setVehicles(data?.vehicles ?? []);
      setPlayers(data?.players ?? []);
    };
    s.on('vehicleRoster', onRoster);
    s.on('vehicleSeatingChanged', refresh);
    // A vehicle appears the moment someone fills one in on their sheet, not only when
    // somebody sits in it.
    s.on('sheetUpdated', refresh);
    refresh();
    return () => {
      s.off('vehicleRoster', onRoster);
      s.off('vehicleSeatingChanged', refresh);
      s.off('sheetUpdated', refresh);
    };
  }, [socketRef, enabled, refresh, socketReadyCount]);

  return { vehicles, players, refresh, hasVehicles: vehicles.length > 0 };
}
