// The game-system picker's rules, kept apart from its window so they can be tested alone.
//
// The picker was a row of buttons, which holds four systems and not forty. Now it is a
// searchable list in two groups: the systems CITY_NET ships with, in a fixed order, then the
// GM's own published ones, A to Z.

export interface PickerSystem {
  id: string;
  name: string;
  /** A GM-built system (backend/systemBuilder/runtime.js list()). */
  custom?: boolean;
  /** The published version running, for a custom system. */
  version?: number;
}

export interface PickerGroup {
  label: string;
  items: PickerSystem[];
}

/** The built-in systems' order in the list. Any built-in not named here follows, A to Z. */
export const BUILT_IN_ORDER = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

const rank = (id: string) => {
  const i = BUILT_IN_ORDER.indexOf(id);
  return i === -1 ? BUILT_IN_ORDER.length : i;
};

/** Does `system` match what has been typed? Every word typed must appear in its name. */
export const matches = (system: PickerSystem, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const name = system.name.toLowerCase();
  return words.every((w) => name.includes(w));
};

/** The list as shown: BUILT-IN then YOUR SYSTEMS, filtered by the query, empty groups left out. */
export const groupSystems = (systems: PickerSystem[], query = ''): PickerGroup[] => {
  const shown = systems.filter((s) => matches(s, query));
  const builtIn = shown.filter((s) => !s.custom)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  const custom = shown.filter((s) => s.custom).sort((a, b) => a.name.localeCompare(b.name));
  return [
    { label: 'BUILT-IN', items: builtIn },
    { label: 'YOUR SYSTEMS', items: custom },
  ].filter((g) => g.items.length > 0);
};

/** Every system in the order shown, for moving through with the arrow keys. */
export const flatten = (groups: PickerGroup[]): PickerSystem[] => groups.flatMap((g) => g.items);

/** The highlighted row after pressing up (-1) or down (+1), wrapping at either end. */
export const moveActive = (index: number, delta: number, count: number): number => {
  if (count <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return (index + delta + count) % count;
};

/** What the picker's button says about a system: its name, and its version when custom. */
export const describe = (system: PickerSystem | undefined): { name: string; tag: string | null } => {
  if (!system) return { name: 'UNKNOWN SYSTEM', tag: null };
  return { name: system.name.toUpperCase(), tag: system.custom ? `CUSTOM · v${system.version ?? 0}` : null };
};
