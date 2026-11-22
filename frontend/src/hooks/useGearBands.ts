import { useState } from 'react';
import type { GearBand } from '../sheets/gearTypes';

// Which of the GEAR tab's bands are closed (G2; approved mockup sheet-gear-layout.html: "a band's head closes it, and the
// sheet remembers. The STASH closed to start."). Kept in this browser, for this viewer: where it can't be, STASH closed.

const KEY = 'city.gearBandsShut';
const START: GearBand[] = ['stash'];

const read = (): Set<GearBand> => {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return new Set(Array.isArray(kept) ? kept as GearBand[] : START);
  } catch { return new Set(START); }
};

export const useGearBands = () => {
  const [shut, setShut] = useState<Set<GearBand>>(read);
  const keep = (next: Set<GearBand>) => {
    setShut(next);
    try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* not kept: still closed or open for now */ }
  };
  /** Its head clicked: closed if open, open if closed. */
  const toggle = (band: GearBand) => { const next = new Set(shut); if (next.has(band)) next.delete(band); else next.add(band); keep(next); };
  /** Opened, if closed: a line made by hand is shown where it lands. */
  const openBand = (band: GearBand) => { if (shut.has(band)) { const next = new Set(shut); next.delete(band); keep(next); } };
  return { shut, toggle, openBand };
};
