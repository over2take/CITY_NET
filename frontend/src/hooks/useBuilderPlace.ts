import { useState } from 'react';

// Where a GM was on a builder page (8aL1; approved mockup docs/mockups/items-layout.html, 2026-11-14): a tab, what was
// open. Kept while the app is open, by system, so going to TRY IT and back finds the page as it was left; a reload
// starts each page fresh. Nothing is saved: it is only where the GM was looking.

const places = new Map<string, unknown>();

/** A value kept under `key` while the app is open: `start` the first time, then what it was last set to. */
export function useBuilderPlace<T>(key: string, start: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (places.has(key) ? places.get(key) as T : start));
  return [value, (next: T) => { places.set(key, next); setValue(next); }];
}

/** Every place forgotten: for tests, each starting fresh. */
export const forgetBuilderPlaces = () => places.clear();
