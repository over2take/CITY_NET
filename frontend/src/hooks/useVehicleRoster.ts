import { useState, useEffect, useCallback } from 'react';
import type { RosterVehicle } from '../components/VehiclesWindow';

/**
 * Every vehicle in play, and who is in which seat.
 *
 * Held here rather than inside the window because two things need it: the window itself,
 * and the buttons that open it — which should not appear at a table that owns no vehicles.
 * One subscription, so the button and the window can never disagree about whether there is
 * anything to show.
 */
export function useVehicleRoster(socket: any, gameSystem?: string) {
  const [vehicles, setVehicles] = useState<RosterVehicle[]>([]);
  const [players, setPlayers] = useState<string[]>([]);

  const enabled = gameSystem === 'cities_without_number';
  const refresh = useCallback(() => {
    if (enabled) socket?.emit('requestVehicleRoster');
  }, [socket, enabled]);

  useEffect(() => {
    if (!socket) return;
    if (!enabled) {
      // Switching away from CWN should empty it, or a stale roster keeps the buttons up.
      setVehicles([]);
      setPlayers([]);
      return;
    }
    const onRoster = (data: { vehicles?: RosterVehicle[]; players?: string[] }) => {
      setVehicles(data?.vehicles ?? []);
      setPlayers(data?.players ?? []);
    };
    socket.on('vehicleRoster', onRoster);
    socket.on('vehicleSeatingChanged', refresh);
    // A vehicle appears the moment someone fills one in on their sheet, not only when
    // somebody sits in it.
    socket.on('sheetUpdated', refresh);
    refresh();
    return () => {
      socket.off('vehicleRoster', onRoster);
      socket.off('vehicleSeatingChanged', refresh);
      socket.off('sheetUpdated', refresh);
    };
  }, [socket, enabled, refresh]);

  return { vehicles, players, refresh, hasVehicles: vehicles.length > 0 };
}
