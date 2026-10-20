// The map's own groups of formulas (5c2; approved mockup docs/mockups/builder-graph.html,
// 2026-10-17: "you can also group formulas, which only the map has"). Pure: a formula put in a
// group, a new one, or none; a group named and ungrouped. They live in the definition's `graph`
// section (backend graph.js checks them: an id, a name of up to 40 characters, formulas only, each in
// one group, up to 50 groups); FORMS shows a formula's group read only, with EDIT IN GRAPH.

import type { Definition } from './systemsApi';
import { formulaList } from './statsRules';

export interface MapGroup { id: string; label: string; members: string[] }

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The longest a group's name may be (backend graph.js LIMITS.label). */
export const GROUP_NAME_MAX = 40;
/** The most groups a map may have (backend graph.js LIMITS.groups). */
export const GROUPS_MAX = 50;

/** The map's own groups, as stored. */
export const mapGroupsOf = (def: Definition): MapGroup[] => {
  const layout = isObject(def.graph) ? def.graph : {};
  return (Array.isArray(layout.groups) ? layout.groups : [])
    .filter((g): g is Obj => isObject(g) && typeof g.id === 'string')
    .map((g) => ({
      id: g.id as string,
      label: typeof g.label === 'string' ? g.label : (g.id as string),
      members: Array.isArray(g.members) ? g.members.filter((m): m is string => typeof m === 'string') : [],
    }));
};

/** The group a formula is in, if any. */
export const groupOf = (def: Definition, formula: string): MapGroup | undefined => mapGroupsOf(def).find((g) => g.members.includes(formula));

/** The groups written back: an empty one dropped (and its folding), an empty section with them. */
const withGroups = (def: Definition, groups: MapGroup[]): Definition => {
  const kept = groups.filter((g) => g.members.length);
  const layout: Obj = { ...(isObject(def.graph) ? def.graph : {}) };
  if (kept.length) layout.groups = kept; else delete layout.groups;
  if (Array.isArray(layout.collapsed)) {
    const ids = new Set(kept.map((g) => g.id));
    const collapsed = (layout.collapsed as unknown[]).filter((c) => typeof c === 'string' && ids.has(c));
    if (collapsed.length) layout.collapsed = collapsed; else delete layout.collapsed;
  }
  const next: Definition = { ...def, graph: layout };
  if (!Object.keys(layout).length) delete next.graph;
  return next;
};

/**
 * A formula put in group `to` (out of any other), in a new group of its own ('new'), or in none
 * (null): the system after, and the group it is in. Null when there's no such formula or group, or
 * a new one past the most there may be.
 */
export const withFormulaInGroup = (def: Definition, formula: string, to: string | 'new' | null): { definition: Definition; group: string | null } | null => {
  if (!formulaList(def).some((f) => f.id === formula)) return null;
  const groups = mapGroupsOf(def).map((g) => ({ ...g, members: g.members.filter((m) => m !== formula) }));
  if (to === null) return { definition: withGroups(def, groups), group: null };
  if (to === 'new') {
    if (groups.filter((g) => g.members.length).length >= GROUPS_MAX) return null;
    let n = 1;
    while (groups.some((g) => g.id === `group_${n}`)) n += 1;
    const id = `group_${n}`;
    return { definition: withGroups(def, [...groups, { id, label: 'NEW GROUP', members: [formula] }]), group: id };
  }
  const into = groups.find((g) => g.id === to);
  if (!into) return null;
  into.members = [...into.members, formula];
  return { definition: withGroups(def, groups), group: to };
};

/** A group renamed, kept to the most a name may hold. */
export const withMapGroupLabel = (def: Definition, id: string, label: string): Definition =>
  withGroups(def, mapGroupsOf(def).map((g) => (g.id === id ? { ...g, label: label.slice(0, GROUP_NAME_MAX) } : g)));

/** A group taken apart: its formulas stay where they are, in no group. */
export const withoutMapGroup = (def: Definition, id: string): Definition => withGroups(def, mapGroupsOf(def).filter((g) => g.id !== id));
