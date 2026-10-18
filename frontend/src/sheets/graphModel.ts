// The builder's GRAPH view as logic (5a2; approved mockup docs/mockups/builder-graph.html,
// 2026-10-17): a system read as nodes, wires and groups, laid out on a grid, and the map's moves
// written back. Pure, so the map only draws it.
//
// One system, two views: everything here is read from the same definition FORMS edits. A wire is
// a formula reading a name, worked out from the formula's text every time, never stored. The
// definition's `graph` section (backend systemBuilder/graph.js) holds only what the map adds:
// positions, groups of formulas, which groups are folded, and notes. Anything in it naming what
// FORMS has since deleted is left out here, never a problem.
//
// The server works the values out (POST /api/systems/preview-values), as for FORMS. This only
// needs to know what each formula reads, which referencesIn finds the way the server's
// expression.js does (a test holds the two together).

import type { Definition } from './systemsApi';
import { statGroups, formulaList, tableList, FUNCTIONS } from './statsRules';
import { houseRuleList, waitingOn } from './houseRules';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The map's grid: nodes snap to it. */
export const GRID = 24;
/** How far from the middle a node may sit, either way (backend graph.js LIMITS.reach). */
export const REACH = 100000;
/** Node sizes in the map's pixels. The map's node components draw to these. */
export const SIZE = {
  width: 240, noteWidth: 216,
  header: 26, noteHeader: 20, text: 32, row: 16, band: 14, ruleRow: 18, pad: 4,
  border: 2, noteLine: 14,
  groupHeader: 23, groupRow: 18, groupPad: 12, groupTitle: 32,
  columnGap: 72, left: 48, top: 24,
} as const;
/** The most "also under it" lines a house rule node lists; more say how many. */
const ALSO_LINES = 3;

// ─── WHAT A FORMULA READS ──────────────────────────────────────────────────

export interface References { fields: string[]; tables: string[]; rules: string[] }
/** Words the formula language uses as operators (expression.js KEYWORDS): `not(@x)` calls no table. */
const KEYWORDS = ['and', 'or', 'not'];

/**
 * Every @field, table and $rule a formula's text reads, each once, in the order first read: the
 * server's references() (expression.js) without its checks. A formula with a mistake still shows
 * what it reads; the server says what the mistake is.
 */
export const referencesIn = (text: unknown): References => {
  const out: References = { fields: [], tables: [], rules: [] };
  if (typeof text !== 'string') return out;
  const add = (list: string[], name: string) => { if (!list.includes(name)) list.push(name); };
  const token = /([@$])([a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)(\s*\()?/g;
  for (const m of text.matchAll(token)) {
    if (m[1] === '@') add(out.fields, m[2]);
    else if (m[1] === '$') add(out.rules, m[2]);
    else if (m[4] && !FUNCTIONS.includes(m[3]) && !KEYWORDS.includes(m[3])) add(out.tables, m[3]);
  }
  return out;
};

// ─── NODES, WIRES, GROUPS ──────────────────────────────────────────────────

export type NodeKind = 'stat' | 'table' | 'formula' | 'condition' | 'rule' | 'note';

/**
 * One name a formula reads, a row on its node. `value`: a stat or formula on the map, wired;
 * `table`: a table, wired when it exists; `field`: a sheet field that is neither (the health
 * boxes, cash), not on the map; `engine`: one of the engine's own $rules.
 */
export interface GraphInput { key: string; name: string; kind: 'value' | 'table' | 'field' | 'engine'; source: string | null; alt: boolean }

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** The group it is drawn in: a stats group, or one of the map's own. */
  group: string | null;
  /** A formula's or condition's text (a condition's as IF / THEN / ELSE), a table's id, a rule's or note's words. */
  text: string;
  inputs: GraphInput[];
  /** A formula's alternative: the house rule it is under, and its text. */
  alternative?: { rule: string; text: string };
  /** A table's rows: what each reads as, and what it gives. */
  bands?: { upTo: number | null; value: number }[];
  /** A house rule's other things waiting on it, on other pages. */
  also?: string[];
  /** A note's node. */
  on?: string;
  width: number;
  height: number;
}

export interface GraphWire { id: string; from: string; to: string; input: string; kind: 'value' | 'table' | 'gate' | 'note'; alt: boolean }

export interface GraphGroup { id: string; label: string; kind: 'stats' | 'map'; members: string[]; collapsed: boolean }

export interface Graph { nodes: GraphNode[]; wires: GraphWire[]; groups: GraphGroup[] }

/** The definition's `graph` section, as stored (or empty). */
const layoutPart = (def: Definition): Obj => (isObject(def.graph) ? def.graph : {});

interface Derived { id: string; label?: string; kind?: string; formula?: string; when?: string; then?: string; else?: string; alternative?: { rule: string; formula: string } }

const lines = (text: string) => Math.min(6, Math.max(1, Math.ceil(text.length / 31)));

/** A node's height in the map's pixels, from what it shows. */
export const heightOf = (node: Pick<GraphNode, 'kind' | 'inputs' | 'alternative' | 'bands' | 'also' | 'text'>): number => {
  const S = SIZE;
  const base = node.inputs.filter((i) => !i.alt).length;
  const alt = node.inputs.filter((i) => i.alt).length;
  switch (node.kind) {
    case 'stat': return S.header + S.row + S.border;
    case 'table': return S.header + (node.bands?.length ?? 0) * S.band + 6 + S.border;
    case 'rule': return S.header + S.text + S.ruleRow + (node.also?.length ?? 0) * S.row + S.pad + S.border;
    case 'note': return S.noteHeader + lines(node.text) * S.noteLine + 6 + S.border;
    default: return S.header + S.text + base * S.row
      + (node.alternative ? S.row + S.text + alt * S.row : 0) + S.pad + S.border;
  }
};

/** The system as the map draws it. */
export const graphOf = (def: Definition): Graph => {
  const layout = layoutPart(def);
  const groups = statGroups(def);
  const statIds = new Set(groups.flatMap((g) => g.stats.filter(isObject).map((s) => s.id)));
  const derived = formulaList(def) as unknown as Derived[];
  const derivedIds = new Set(derived.map((d) => d.id));
  const tables = tableList(def);
  const tableIds = new Set(tables.map((t) => t.id));
  const rules = houseRuleList(def);
  const ruleIds = new Set(rules.map((r) => r.id));

  // The map's own groups: of formulas that exist, each formula in the first group naming it.
  const mapGroups: GraphGroup[] = [];
  const inMapGroup = new Map<string, string>();
  const collapsed = new Set((Array.isArray(layout.collapsed) ? layout.collapsed : []).filter((c): c is string => typeof c === 'string'));
  for (const g of Array.isArray(layout.groups) ? layout.groups : []) {
    if (!isObject(g) || typeof g.id !== 'string' || mapGroups.some((x) => x.id === g.id)) continue;
    const members = (Array.isArray(g.members) ? g.members : [])
      .filter((m): m is string => typeof m === 'string' && derivedIds.has(m) && !inMapGroup.has(m));
    members.forEach((m) => inMapGroup.set(m, g.id as string));
    mapGroups.push({ id: g.id, label: typeof g.label === 'string' ? g.label : g.id, kind: 'map', members, collapsed: collapsed.has(g.id) });
  }

  const nodes: GraphNode[] = [];
  const wires: GraphWire[] = [];
  const push = (n: Omit<GraphNode, 'width' | 'height'>) => nodes.push({ ...n, width: n.kind === 'note' ? SIZE.noteWidth : SIZE.width, height: heightOf(n) });

  for (const g of groups) {
    for (const s of g.stats.filter(isObject)) {
      push({ id: s.id, kind: 'stat', label: s.label || s.id, group: g.id, text: s.tie ? `TIED TO ${s.tie}` : '', inputs: [] });
    }
  }
  for (const r of rules) {
    const also = waitingOn(def, r.id).filter((w) => w.kind !== 'FORMULA').map((w) => `${w.label} · ${w.kind}`);
    push({
      id: `rule:${r.id}`, kind: 'rule', label: r.name || r.id, group: null, text: r.description || '', inputs: [],
      also: also.length > ALSO_LINES ? [...also.slice(0, ALSO_LINES - 1), `and ${also.length - ALSO_LINES + 1} more`] : also,
    });
  }
  for (const t of tables) {
    push({
      id: `table:${t.id}`, kind: 'table', label: t.label || t.id, group: null, text: t.id, inputs: [],
      bands: (Array.isArray(t.bands) ? t.bands : []).map((b) => ({ upTo: typeof b.upTo === 'number' ? b.upTo : null, value: Number(b.value) || 0 })),
    });
  }

  const inputsFrom = (text: string, alt: boolean): GraphInput[] => {
    const refs = referencesIn(text);
    const side = alt ? 'a' : 'b';
    return [
      ...refs.fields.map((name): GraphInput => (statIds.has(name) || derivedIds.has(name)
        ? { key: `${side}:@${name}`, name, kind: 'value', source: name, alt }
        : { key: `${side}:@${name}`, name, kind: 'field', source: null, alt })),
      ...refs.tables.map((name): GraphInput => ({ key: `${side}:${name}()`, name, kind: 'table', source: tableIds.has(name) ? `table:${name}` : null, alt })),
      ...refs.rules.map((name): GraphInput => ({ key: `${side}:$${name}`, name, kind: 'engine', source: null, alt })),
    ];
  };

  for (const d of derived) {
    const condition = d.kind === 'condition';
    const text = condition ? `IF ${d.when ?? ''} THEN ${d.then ?? ''} ELSE ${d.else ?? ''}` : String(d.formula ?? '');
    const inputs = condition ? inputsFrom([d.when, d.then, d.else].map((x) => x ?? '').join(' '), false) : inputsFrom(text, false);
    const alternative = !condition && d.alternative && typeof d.alternative.rule === 'string'
      ? { rule: d.alternative.rule, text: String(d.alternative.formula ?? '') } : undefined;
    if (alternative) inputs.push(...inputsFrom(alternative.text, true));
    push({ id: d.id, kind: condition ? 'condition' : 'formula', label: d.label || d.id, group: inMapGroup.get(d.id) ?? null, text, inputs, alternative });
    for (const i of inputs) {
      if (i.source) wires.push({ id: `${i.source}>${d.id}:${i.key}`, from: i.source, to: d.id, input: i.key, kind: i.kind === 'table' ? 'table' : 'value', alt: i.alt });
    }
    if (alternative && ruleIds.has(alternative.rule)) {
      wires.push({ id: `rule:${alternative.rule}>${d.id}:gate`, from: `rule:${alternative.rule}`, to: d.id, input: 'gate', kind: 'gate', alt: true });
    }
  }

  const pinnable = new Set(nodes.map((n) => n.id));
  const noteIds = new Set<string>();
  for (const n of Array.isArray(layout.notes) ? layout.notes : []) {
    if (!isObject(n) || typeof n.id !== 'string' || noteIds.has(n.id)) continue;
    noteIds.add(n.id);
    const on = typeof n.on === 'string' && pinnable.has(n.on) ? n.on : undefined;
    push({ id: `note:${n.id}`, kind: 'note', label: 'NOTE', group: null, text: typeof n.text === 'string' ? n.text : '', inputs: [], on });
    if (on) wires.push({ id: `note:${n.id}>${on}`, from: `note:${n.id}`, to: on, input: 'note', kind: 'note', alt: false });
  }

  return {
    nodes,
    wires,
    groups: [
      ...groups.map((g): GraphGroup => ({ id: g.id, label: g.label, kind: 'stats', members: g.stats.filter(isObject).map((s) => s.id), collapsed: collapsed.has(g.id) })),
      ...mapGroups,
    ],
  };
};

// ─── WHERE THINGS SIT ──────────────────────────────────────────────────────

export interface Point { x: number; y: number }
export type Positions = Record<string, Point>;

const snapUp = (v: number) => Math.ceil(v / GRID) * GRID;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number) => Math.max(-REACH, Math.min(REACH, v));
const columnX = (col: number) => SIZE.left + col * (SIZE.width + SIZE.columnGap);
/** A folded group's box height. */
export const foldedHeight = (members: number) => SIZE.groupHeader + members * SIZE.groupRow + 6;

/**
 * Which column each node goes in: stats first, then tables and house rules, then each formula one
 * to the right of the furthest stat or formula it reads, and a note beside its node.
 */
export const columnsOf = (graph: Graph): Record<string, number> => {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const col: Record<string, number> = {};
  const visiting = new Set<string>();
  const of = (id: string): number => {
    if (col[id] !== undefined) return col[id];
    const n = byId.get(id);
    if (!n) return 0;
    if (n.kind === 'stat') return (col[id] = 0);
    if (n.kind === 'table' || n.kind === 'rule') return (col[id] = 1);
    if (n.kind === 'note') return (col[id] = n.on ? of(n.on) + 1 : 0);
    if (visiting.has(id)) return 1; // a loop: the server reports it; the map just needs a column
    visiting.add(id);
    let furthest = 0;
    for (const i of n.inputs) if (i.kind === 'value' && i.source) furthest = Math.max(furthest, of(i.source));
    visiting.delete(id);
    return (col[id] = Math.max(1, furthest + 1));
  };
  graph.nodes.forEach((n) => of(n.id));
  return col;
};

/** Every node placed by columnsOf, top to bottom, groups kept together, on the grid. */
export const layoutOf = (graph: Graph): Positions => {
  const col = columnsOf(graph);
  const groupOf = new Map(graph.groups.flatMap((g) => g.members.map((m) => [m, g] as const)));
  const pos: Positions = {};
  const columns = [...new Set(Object.values(col))].sort((a, b) => a - b);
  for (const c of columns) {
    const x = columnX(c);
    const here = graph.nodes.filter((n) => col[n.id] === c);
    let y: number = SIZE.top;
    const done = new Set<string>();
    for (const n of here) {
      if (done.has(n.id)) continue;
      const g = groupOf.get(n.id);
      if (g) {
        const members = here.filter((m) => groupOf.get(m.id) === g);
        y = snapUp(y) + SIZE.groupTitle;
        let my = snapUp(y);
        for (const m of members) { pos[m.id] = { x, y: my }; my = snapUp(my + m.height + 16); done.add(m.id); }
        y = g.collapsed ? y + foldedHeight(members.length) + GRID : my + 20;
        continue;
      }
      if (n.kind === 'note' && n.on && pos[n.on]) y = Math.max(y, pos[n.on].y);
      pos[n.id] = { x, y: snapUp(y) };
      y = snapUp(y) + n.height + GRID;
      done.add(n.id);
    }
  }
  return pos;
};

/** The places the definition keeps, for nodes on the map now. */
export const savedPositions = (def: Definition, graph: Graph): Positions => {
  const stored = layoutPart(def).positions;
  if (!isObject(stored)) return {};
  const out: Positions = {};
  for (const n of graph.nodes) {
    const p = stored[n.id];
    if (Array.isArray(p) && p.length === 2 && p.every((v) => Number.isInteger(v))) out[n.id] = { x: p[0] as number, y: p[1] as number };
  }
  return out;
};

/**
 * Where every node sits: where it was put, and a node never put anywhere (new since, or the
 * first time the map opens) laid out in its column, under what is there already.
 */
export const positionsOf = (def: Definition, graph: Graph): Positions => {
  const saved = savedPositions(def, graph);
  const laid = layoutOf(graph);
  if (!Object.keys(saved).length) return laid;
  const out: Positions = { ...saved };
  const col = columnsOf(graph);
  const bottom: Record<number, number> = {};
  for (const n of graph.nodes) {
    if (!saved[n.id]) continue;
    const c = col[n.id];
    bottom[c] = Math.max(bottom[c] ?? SIZE.top, saved[n.id].y + n.height + GRID);
  }
  for (const n of graph.nodes) {
    if (out[n.id]) continue;
    const c = col[n.id];
    const y = snapUp(bottom[c] ?? laid[n.id].y);
    out[n.id] = { x: laid[n.id].x, y };
    bottom[c] = y + n.height + GRID;
  }
  return out;
};

/**
 * The definition with the map's places written in: every node's place (so nothing moves once
 * anything has), on the grid and within reach, and places of nodes no longer on the map gone.
 */
export const withPositions = (def: Definition, graph: Graph, moved: Positions = {}): Definition => {
  const all = { ...positionsOf(def, graph), ...moved };
  const positions: Record<string, [number, number]> = {};
  for (const n of graph.nodes) {
    const p = all[n.id];
    if (p) positions[n.id] = [clamp(snap(p.x)), clamp(snap(p.y))];
  }
  return { ...def, graph: { ...layoutPart(def), positions } };
};

/** A group folded into one box, or opened out. */
export const withCollapsed = (def: Definition, groupId: string, folded: boolean): Definition => {
  const layout = layoutPart(def);
  const now = (Array.isArray(layout.collapsed) ? layout.collapsed : []).filter((c) => c !== groupId);
  const collapsed = folded ? [...now, groupId] : now;
  const next: Obj = { ...layout, collapsed };
  if (!collapsed.length) delete next.collapsed;
  const out: Definition = { ...def, graph: next };
  if (!Object.keys(next).length) delete out.graph;
  return out;
};

// ─── WHAT IS DRAWN, WITH GROUPS FOLDED ─────────────────────────────────────

export interface GroupBox { id: string; x: number; y: number; width: number; height: number; collapsed: boolean; members: string[] }

/** A group's box: around its members, or folded at the same corner with a row per member. */
export const groupBoxOf = (group: GraphGroup, graph: Graph, positions: Positions): GroupBox | null => {
  const members = group.members.map((id) => graph.nodes.find((n) => n.id === id)).filter((n): n is GraphNode => !!n && !!positions[n.id]);
  if (!members.length) return null;
  const x = Math.min(...members.map((m) => positions[m.id].x)) - SIZE.groupPad;
  const y = Math.min(...members.map((m) => positions[m.id].y)) - SIZE.groupTitle;
  if (group.collapsed) return { id: group.id, x, y, width: SIZE.width + SIZE.groupPad * 2, height: foldedHeight(members.length), collapsed: true, members: members.map((m) => m.id) };
  const right = Math.max(...members.map((m) => positions[m.id].x + m.width)) + SIZE.groupPad;
  const bottom = Math.max(...members.map((m) => positions[m.id].y + m.height)) + SIZE.groupPad;
  return { id: group.id, x, y, width: right - x, height: bottom - y, collapsed: false, members: members.map((m) => m.id) };
};

export interface ShownWire extends GraphWire { source: string; target: string; sourceHandle: string; targetHandle: string }

/**
 * The wires as drawn: a node in a folded group is reached through the group's box, at its row
 * (handles `out:<id>` and `in:<id>`), and a wire between two members of one folded group isn't
 * drawn. Anything else goes from a node's `out` handle to the input's own handle.
 */
export const shownWires = (graph: Graph): ShownWire[] => {
  const folded = new Map(graph.groups.filter((g) => g.collapsed).flatMap((g) => g.members.map((m) => [m, `group:${g.id}`] as const)));
  const out: ShownWire[] = [];
  for (const w of graph.wires) {
    const from = folded.get(w.from), to = folded.get(w.to);
    if (from && from === to) continue;
    out.push({
      ...w,
      source: from ?? w.from, sourceHandle: from ? `out:${w.from}` : 'out',
      target: to ?? w.to, targetHandle: to ? `in:${w.to}` : w.input,
    });
  }
  return out;
};
