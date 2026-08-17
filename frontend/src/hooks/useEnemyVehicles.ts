import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { hasVehicles as systemHasVehicles } from '../sheets/vehicleSystems';

/** An enemy vehicle, keyed by the NPC sheet that owns it rather than by a username. */
export interface EnemyVehicle {
  sheetId: number;
  /** The NPC's label — what a GM calls them, since NPC sheets have no login name. */
  owner: string;
  folder: string | null;
  index: number;
  name: string;
  type: string;
  ac: number;
  armorRating: number;
  hp: number;
  hpMax: number;
  moving: boolean;
  destroyed: boolean;
  crew: number;
  seats: string[];
}

export interface EnemyCrew {
  sheetId: number;
  label: string;
  folder: string | null;
}

/**
 * The GM's enemy vehicles, and every NPC who could be put in one.
 *
 * Asked for rather than pushed: the server refuses this to anyone but the GM, so a player's
 * client never holds enemy pools or armour at all — which is what keeps "what may players
 * see" from being a question this feature has to answer.
 *
 * Takes the ref rather than the socket, like the player roster does. A ref's `.current` is
 * not reactive, so a hook handed `socketRef.current` before the socket exists binds to
 * nothing and never binds again.
 */
export function useEnemyVehicles(
  socketRef: React.MutableRefObject<any>,
  gameSystem?: string,
  isAdmin?: boolean,
) {
  const [vehicles, setVehicles] = useState<EnemyVehicle[]>([]);
  const [crew, setCrew] = useState<EnemyCrew[]>([]);
  const [socketReadyCount, forceReady] = useReducer((n: number) => n + 1, 0);

  const enabled = !!isAdmin && systemHasVehicles(gameSystem);

  const refresh = useCallback(() => {
    if (enabled) socketRef.current?.emit('requestEnemyVehicles');
  }, [socketRef, enabled]);

  useEffect(() => {
    if (!enabled) {
      // Losing the gate — a system with no vehicles, or elevation being revoked — has to
      // empty this, or a stale list keeps the button up over something nobody may open.
      setVehicles([]);
      setCrew([]);
      return;
    }
    const socket = socketRef.current;
    if (!socket) {
      // The socket is created asynchronously. Poll until it exists rather than binding to
      // whatever `.current` happened to be at first render.
      const timer = setInterval(() => { if (socketRef.current) forceReady(); }, 200);
      return () => clearInterval(timer);
    }

    const onRoster = (data: { vehicles?: EnemyVehicle[]; crew?: EnemyCrew[] }) => {
      setVehicles(data?.vehicles ?? []);
      setCrew(data?.crew ?? []);
    };
    socket.on('enemyVehicles', onRoster);
    socket.on('enemyVehiclesChanged', refresh);
    // An NPC sheet edited through the admin panel emits `dataUpdated` rather than anything
    // vehicle-shaped, so that is what a vehicle typed onto a sheet arrives as. The window
    // also asks on open, which covers the case where a sheet was edited while it was shut.
    socket.on('dataUpdated', refresh);
    refresh();

    return () => {
      socket.off('enemyVehicles', onRoster);
      socket.off('enemyVehiclesChanged', refresh);
      socket.off('dataUpdated', refresh);
    };
  }, [socketRef, enabled, refresh, socketReadyCount]);

  return { vehicles, crew, refresh, hasEnemyVehicles: vehicles.length > 0 };
}
