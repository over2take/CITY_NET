import { useEffect, useState } from 'react';

// A token's health under a custom system's model, as the server lets this viewer see it
// (backend/systemBuilder/healthView.js). The GM, a player granted editing and the token's owner
// get the full detail; everyone else a description with no numbers or notes. Asked over the
// socket, which is where the server knows who is asking, and asked again whenever a sheet or
// the map changes, since damage changes both.

export type HealthModel = 'pool' | 'tracks' | 'typed' | 'harm' | 'wounds' | 'locations' | 'none';

export interface HealthView {
  location_id: number;
  /** Null for a built-in system, which draws its own health. */
  model: HealthModel | null;
  full?: boolean;
  /** pool: the system's own word for health. */
  label?: string;
  /** tracks */
  tracks?: { id: string; label: string }[];
  overflow?: boolean;
  second?: { id?: string; label: string; current?: number; max?: number; fill?: number; full?: boolean };
  /** typed: each type's marks in full; light and heavy shares otherwise. */
  boxes?: number;
  types?: { id: string; label: string; marks: number }[];
  light?: number;
  heavy?: number;
  /** harm: the notes in full; the worst level's name otherwise. */
  levels?: { id: string; label: string; penalty: string; slots: string[] }[];
  levelCount?: number;
  worst?: number;
  worstLabel?: string | null;
  out?: boolean;
  /** wounds */
  penalty?: number;
  state?: 'unhurt' | 'wounded' | 'incapacitated';
  /** locations: the notes in full; only which are hurt otherwise. */
  locations?: { id: string; label: string; note?: string; hit?: boolean }[];
}

/** The view of `locationId`'s health, or null while unknown, off, or for a built-in system. */
export function useHealthView(socket: any, locationId: number | null | undefined, enabled: boolean): HealthView | null {
  const [view, setView] = useState<HealthView | null>(null);
  useEffect(() => {
    setView(null);
    if (!socket || !enabled || locationId === null || locationId === undefined || locationId < 0) return undefined;
    const ask = () => socket.emit('requestHealthView', { location_id: locationId });
    const onView = (v: HealthView) => { if (v && v.location_id === locationId) setView(v); };
    socket.on('healthView', onView);
    socket.on('sheetUpdated', ask);
    socket.on('dataUpdated', ask);
    ask();
    return () => {
      socket.off('healthView', onView);
      socket.off('sheetUpdated', ask);
      socket.off('dataUpdated', ask);
    };
  }, [socket, locationId, enabled]);
  return view && view.model ? view : null;
}
