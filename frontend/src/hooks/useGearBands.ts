import { useState } from 'react';
import { GEAR_BANDS, landedIn, type GearBand } from '../sheets/gearTypes';

// Which of the GEAR tab's bands are closed (G2; approved mockup sheet-gear-layout.html: "a band's head closes it, and the
// sheet remembers. The STASH closed to start."). Kept in this browser, for this viewer: where it can't be, STASH closed.
// And which closed bands something has landed in since (G3): their heads pulse and stay bright until opened.

const KEY = 'city.gearBandsShut';
const START: GearBand[] = ['stash'];

const read = (): Set<GearBand> => {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return new Set(Array.isArray(kept) ? kept as GearBand[] : START);
  } catch { return new Set(START); }
};

/** `counts`: each band's count as drawn now, to see what landed where. */
export const useGearBands = (counts: Partial<Record<GearBand, number>> | null = null) => {
  const [shut, setShut] = useState<Set<GearBand>>(read);
  const [news, setNews] = useState<Set<GearBand>>(() => new Set());
  const [before, setBefore] = useState(counts);
  // Counts changed since the last drawing: a closed band that went up has news. Worked out while drawing, as React has
  // state that follows what it is given, so the head is bright in the same frame the number goes up.
  if (counts && GEAR_BANDS.some((b) => (counts[b.id] ?? 0) !== (before?.[b.id] ?? 0))) {
    setBefore(counts);
    const landed = landedIn(before, counts, shut);
    if (landed.length) setNews(new Set([...news, ...landed]));
  }
  const keep = (next: Set<GearBand>) => {
    setShut(next);
    // Opened: seen.
    setNews((n) => new Set([...n].filter((b) => next.has(b))));
    try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* not kept: still closed or open for now */ }
  };
  /** Its head clicked: closed if open, open if closed. */
  const toggle = (band: GearBand) => { const next = new Set(shut); if (next.has(band)) next.delete(band); else next.add(band); keep(next); };
  /** Opened, if closed: a line made by hand is shown where it lands. */
  const openBand = (band: GearBand) => { if (shut.has(band)) { const next = new Set(shut); next.delete(band); keep(next); } };
  return { shut, toggle, openBand, news };
};
