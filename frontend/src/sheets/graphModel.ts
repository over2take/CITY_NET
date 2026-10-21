// The builder's GRAPH view as logic (5a2, node styles 5a3a; approved mockups
// docs/mockups/builder-graph.html, 2026-10-17, and the node kit in docs/mockups/builder-design,
// 2026-09-29): a system read as nodes, wires and groups, laid out on a grid, and the map's moves
// written back. Pure, so the map only draws it.
//
// One system, two views: everything here is read from the same definition FORMS edits. A wire is
// a formula reading a name, worked out from the formula's text every time, never stored. The
// definition's `graph` section (backend systemBuilder/graph.js) holds only what the map adds:
// positions, groups of formulas, which groups are folded, and notes. Anything in it naming what
// FORMS has since deleted is left out here, never a problem.
//
// Drawn to be read, as the node kit draws it: a stats group is one list node with a row and a dot
// per stat, and a modifier worked out from each stat by one table (`attribute_mod(@str)`) is a
// column on that list rather than a node of its own; a formula's inputs and text are in the names
// players see, `max(@a, @b)` reading as BEST with a wire from each.
//
// A roll (6b4a; approved mockup docs/mockups/builder-rolls.html, 2026-10-19) is a ROLL node: what
// it is ROLLED BY wired in (a whole stats group from its list's own dot), then every name its dice,
// keeping, adding and target read, wired as a formula's are; @this and the rest of what the table
// reads for the stat rolled are rows of their own, with no wire.
//
// The server works the values out (POST /api/systems/preview-values), as for FORMS. This only
// needs to know what each formula reads, which referencesIn finds the way the server's
// expression.js does (a test holds the two together).

import type { Definition } from './systemsApi';
import { statGroups, formulaList, tableList, takenIds, FUNCTIONS } from './statsRules';
import { houseRuleList, waitingOn } from './houseRules';
import { modifierOn, type Modifier } from './modifiers';
import { rollList, stepsOf, type Roll } from './rolls';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The map's grid: nodes snap to it. */
export const GRID = 24;
/** How far from the middle a node may sit, either way (backend graph.js LIMITS.reach). */
export const REACH = 100000;
/** Node sizes in the map's pixels. The map's node components draw to these. */
export const SIZE = {
  width: 264, noteWidth: 240,
  header: 28, row: 20, listRow: 22, colHead: 18, exprLine: 16, exprPad: 8, result: 24, band: 18, ruleRow: 20, pad: 6,
  border: 2, noteHeader: 22, noteLine: 16,
  groupHeader: 25, foldedLine: 24, groupPad: 12, groupTitle: 32,
  columnGap: 120, left: 48, top: 24,
  /** How tall a column grows before the next nodes start one beside it, so a busy system spreads sideways. */
  columnHeight: 864,
  /** Characters of a formula's text on one line of a node, at its font. */
  exprChars: 32,
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

/** `max(@a, @b, ...)` or `min(...)` of names only: one input, the best or worst of several. */
const COMBINED = /\b(max|min)\(\s*(@[a-z][a-z0-9_]*(?:\s*,\s*@[a-z][a-z0-9_]*)+)\s*\)/g;
/** A modifier worked out from one stat by one table: `attribute_mod(@str)`. */
const MODIFIER = /^\s*([a-z][a-z0-9_]*)\(\s*@([a-z][a-z0-9_]*)\s*\)\s*$/;

// ─── NODES, WIRES, GROUPS ──────────────────────────────────────────────────

export type NodeKind = 'list' | 'table' | 'formula' | 'condition' | 'rule' | 'note' | 'roll';

/** Where a value comes from on the map: the node, the dot on it, and what players call it. */
export interface Source { value: string; label: string; node: string; handle: string }

/**
 * One input on a formula's node, a row with its dot. `value`: a stat or formula; `combined`: the
 * BEST (or WORST) of several, a wire from each; `table`: a table called by name; `field`: a sheet
 * field that is neither (the health boxes, cash), not on the map, `known` when the sheet has it
 * (the server reads any other @name as a field nothing fills, worth 0); `engine`: one of the
 * engine's own $rules. `missing` when what it names isn't there.
 */
export interface GraphInput {
  key: string;
  kind: 'value' | 'combined' | 'table' | 'field' | 'engine';
  /** What the row says: the name players see. */
  label: string;
  /** For a stat: the group it is in, shown as where it comes from. */
  where?: string;
  /** What its wires come from: one, several for BEST, none for a field or the engine's own. */
  from: Source[];
  alt: boolean;
  known?: boolean;
  missing?: boolean;
  /** What the formula does to this one name on its way in (×6, ÷2↓): a diamond on its wire (5b3). */
  modifier?: Modifier;
  /** What the row says it is, in place of where it comes from: a roll's ROLLED BY, its @this. */
  about?: string;
}

/** A row of a list node: a stat, and its modifier when one table works one out for each. */
export interface ListRow { stat: string; label: string; short: string | null; mod: string | null }

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** The map's own group it is drawn in. */
  group: string | null;
  /** A formula's text in the names players see (a condition's as IF / THEN / ELSE), a rule's or note's words. */
  text: string;
  inputs: GraphInput[];
  /** A formula's alternative: the house rule it is under, and its text in names. */
  alternative?: { rule: string; ruleName: string; text: string };
  /** A table's rows: what each reads as, and what it gives. */
  bands?: { upTo: number | null; value: number }[];
  /** A list's rows, and the table its modifiers are worked out by. */
  rows?: ListRow[];
  via?: { table: string; label: string };
  /** A house rule's other things waiting on it, on other pages. */
  also?: string[];
  /** A note's node. */
  on?: string;
  /** A roll's last line: what its total is read as (its bands, a target), and the changes a player may pick, ◆ for one that costs. */
  roll?: { outcome: string; changes: string[] };
  width: number;
  height: number;
}

/** A wire: from a node's dot (`out`, or a list's `out:<stat or modifier>`) to an input. `value` is what flows. */
export interface GraphWire { id: string; from: string; fromHandle: string; value: string; to: string; input: string; kind: 'value' | 'table' | 'gate' | 'note'; alt: boolean; modifier?: string }

export interface GraphGroup { id: string; label: string; members: string[]; collapsed: boolean }

export interface Graph { nodes: GraphNode[]; wires: GraphWire[]; groups: GraphGroup[] }

/** The definition's `graph` section, as stored (or empty). */
const layoutPart = (def: Definition): Obj => (isObject(def.graph) ? def.graph : {});

interface Derived { id: string; label?: string; kind?: string; formula?: string; when?: string; then?: string; else?: string; alternative?: { rule: string; formula: string } }

const upper = (s: string) => s.toUpperCase();
const exprLines = (text: string) => Math.min(4, Math.max(1, Math.ceil(text.length / SIZE.exprChars)));
const noteLines = (text: string) => Math.min(8, Math.max(1, Math.ceil(text.length / 30)));
/** How tall a formula's text is drawn (up to four lines, then cut short with its whole on hover). */
export const exprHeight = (text: string) => exprLines(text) * SIZE.exprLine + SIZE.exprPad;
/** How tall a note's words are drawn. */
export const noteHeight = (text: string) => noteLines(text) * SIZE.noteLine + 8;

/** A node's height in the map's pixels, from what it shows. */
export const heightOf = (node: Pick<GraphNode, 'kind' | 'inputs' | 'alternative' | 'bands' | 'also' | 'text' | 'rows' | 'via'>): number => {
  const S = SIZE;
  const expr = exprHeight;
  switch (node.kind) {
    case 'list': return S.header + (node.via ? S.row : 0) + S.colHead + (node.rows?.length ?? 0) * S.listRow + S.pad + S.border;
    case 'table': return S.header + (node.bands?.length ?? 0) * S.band + S.pad + S.border;
    // Its words, what it does, its TRY ON THE MAP switch (5b6c), and what else is under it.
    case 'rule': return S.header + (node.text ? expr(node.text) : 0) + S.ruleRow + S.row + (node.also?.length ?? 0) * S.row + S.pad + S.border;
    case 'note': return S.noteHeader + noteHeight(node.text) + S.border;
    default: {
      const base = node.inputs.filter((i) => !i.alt).length;
      const alt = node.inputs.filter((i) => i.alt).length;
      return S.header + base * S.row + expr(node.text) + S.result
        + (node.alternative ? S.row + alt * S.row + expr(node.alternative.text) : 0) + S.pad + S.border;
    }
  }
};

/** What a roll's text reads for the stat rolled (tableRolls.js fieldsFor): rows of their own, never wired. */
const OWN: Record<string, string> = { '@this': 'THE STAT ROLLED', '@this_mod': 'ITS MODIFIER', '@tie': 'ITS ABILITY', '@tie_mod': "ITS ABILITY'S MODIFIER" };

/** A roll in a line, as the node kit's: `2d6 + @this + @tie_mod`, its keeping and target in words. */
export const rollText = (r: Roll): string => {
  const count = (c: string) => (/^\s*\d+\s*$/.test(String(c)) ? String(c).trim() : `(${String(c).trim()})`);
  const dice = r.dice.map((d) => `${count(d.count)}${d.sides === 'F' ? 'dF' : `d${d.sides}`}${d.name ? ` ${upper(d.name)}` : ''}`).join(' + ') || 'NO DICE';
  const keep = r.read === 'highest' ? ` KEEP HIGHEST ${r.keep ?? '1'}` : r.read === 'lowest' ? ` KEEP LOWEST ${r.keep ?? '1'}` : r.read === 'count' ? ` COUNT ${r.at}+` : '';
  return `${dice}${keep}${r.add ? ` + ${r.add}` : ''}${r.against !== undefined ? ` ${r.under ? 'UNDER' : 'VS'} ${r.against}` : ''}`;
};

/** The system as the map draws it. */
export const graphOf = (def: Definition): Graph => {
  const layout = layoutPart(def);
  const groups = statGroups(def);
  const derived = formulaList(def) as unknown as Derived[];
  const derivedIds = new Set(derived.map((d) => d.id));
  const tables = tableList(def);
  const tableIds = new Set(tables.map((t) => t.id));
  const tableName = (id: string) => upper(tables.find((t) => t.id === id)?.label || id);
  const rules = houseRuleList(def);
  const ruleIds = new Set(rules.map((r) => r.id));
  /** Every name the sheet has: its starter fields, the health boxes, a customized sheet's own. */
  const onSheet = new Set(takenIds(def));

  // The map's own groups: of formulas that exist, each formula in the first group naming it.
  const mapGroups: GraphGroup[] = [];
  const inMapGroup = new Map<string, string>();
  const collapsed = new Set((Array.isArray(layout.collapsed) ? layout.collapsed : []).filter((c): c is string => typeof c === 'string'));
  for (const g of Array.isArray(layout.groups) ? layout.groups : []) {
    if (!isObject(g) || typeof g.id !== 'string' || mapGroups.some((x) => x.id === g.id)) continue;
    const members = (Array.isArray(g.members) ? g.members : [])
      .filter((m): m is string => typeof m === 'string' && derivedIds.has(m) && !inMapGroup.has(m));
    members.forEach((m) => inMapGroup.set(m, g.id as string));
    mapGroups.push({ id: g.id, label: typeof g.label === 'string' ? g.label : g.id, members, collapsed: collapsed.has(g.id) });
  }

  // Modifiers that join their stat's row: one table, one stat each, every one in a group by the same table.
  const groupOfStat = new Map(groups.flatMap((g) => g.stats.filter(isObject).map((s) => [s.id, g.id] as const)));
  const offered = new Map<string, { stat: string; mod: string; table: string }[]>();
  for (const d of derived) {
    if (d.kind === 'condition' || d.alternative || inMapGroup.has(d.id)) continue;
    const m = MODIFIER.exec(String(d.formula ?? ''));
    if (!m || !tableIds.has(m[1]) || !groupOfStat.has(m[2])) continue;
    const g = groupOfStat.get(m[2])!;
    offered.set(g, [...(offered.get(g) ?? []), { stat: m[2], mod: d.id, table: m[1] }]);
  }
  const modOf = new Map<string, string>();
  const via = new Map<string, string>();
  for (const [g, list] of offered) {
    if (new Set(list.map((x) => x.table)).size !== 1 || new Set(list.map((x) => x.stat)).size !== list.length) continue;
    via.set(g, list[0].table);
    for (const x of list) modOf.set(x.stat, x.mod);
  }
  const absorbed = new Set(modOf.values());

  // Where every value comes from: a list's row, or a formula's own node.
  const at = new Map<string, Source & { where?: string }>();
  for (const g of groups) {
    for (const s of g.stats.filter(isObject)) {
      at.set(s.id, { value: s.id, label: upper(s.label || s.id), node: g.id, handle: `out:${s.id}`, where: upper(g.label || g.id) });
      const mod = modOf.get(s.id);
      const d = mod ? derived.find((x) => x.id === mod) : undefined;
      if (mod) at.set(mod, { value: mod, label: upper(d?.label || mod), node: g.id, handle: `out:${mod}`, where: upper(g.label || g.id) });
    }
  }
  for (const d of derived) if (!absorbed.has(d.id)) at.set(d.id, { value: d.id, label: upper(d.label || d.id), node: d.id, handle: 'out' });

  const nodes: GraphNode[] = [];
  const wires: GraphWire[] = [];
  const push = (n: Omit<GraphNode, 'width' | 'height'>) => nodes.push({ ...n, width: n.kind === 'note' ? SIZE.noteWidth : SIZE.width, height: heightOf(n) });
  const wire = (to: string, i: GraphInput) => {
    for (const f of i.from) wires.push({ id: `${f.node}:${f.handle}>${to}:${i.key}`, from: f.node, fromHandle: f.handle, value: f.value, to, input: i.key, kind: i.kind === 'table' ? 'table' : 'value', alt: i.alt, ...(i.modifier ? { modifier: i.modifier.label } : {}) });
  };

  for (const g of groups) {
    const t = via.get(g.id);
    const inputs: GraphInput[] = t ? [{ key: 'via', kind: 'table', label: tableName(t), from: [{ value: t, label: tableName(t), node: `table:${t}`, handle: 'out' }], alt: false }] : [];
    push({
      id: g.id, kind: 'list', label: upper(g.label || g.id), group: null, text: '', inputs,
      via: t ? { table: t, label: tableName(t) } : undefined,
      rows: g.stats.filter(isObject).map((s) => ({ stat: s.id, label: upper(s.label || s.id), short: s.id.length <= 4 ? upper(s.id) : null, mod: modOf.get(s.id) ?? null })),
    });
    for (const i of inputs) wire(g.id, i);
  }
  for (const r of rules) {
    const also = waitingOn(def, r.id).filter((w) => w.kind !== 'FORMULA').map((w) => `${w.label} · ${w.kind}`);
    push({
      id: `rule:${r.id}`, kind: 'rule', label: upper(r.name || r.id), group: null, text: r.description || '', inputs: [],
      also: also.length > ALSO_LINES ? [...also.slice(0, ALSO_LINES - 1), `and ${also.length - ALSO_LINES + 1} more`] : also,
    });
  }
  for (const t of tables) {
    push({
      id: `table:${t.id}`, kind: 'table', label: tableName(t.id), group: null, text: t.id, inputs: [],
      bands: (Array.isArray(t.bands) ? t.bands : []).map((b) => ({ upTo: typeof b.upTo === 'number' ? b.upTo : null, value: Number(b.value) || 0 })),
    });
  }

  /** A formula's inputs, in the order its text first reads each, and its text in names. */
  const read = (text: string, alt: boolean): { inputs: GraphInput[]; text: string } => {
    const side = alt ? 'a' : 'b';
    const found: { at: number; input: GraphInput }[] = [];
    const modified = (name: string) => { const m = modifierOn(text, name); return m ? { modifier: m } : {}; };
    const combos = [...text.matchAll(COMBINED)].filter((m) => m[2].split(',').every((n) => at.has(n.trim().slice(1))));
    let rest = text;
    let shown = text;
    combos.forEach((m, k) => {
      const name = `${m[1] === 'max' ? 'BEST' : 'WORST'}${combos.length > 1 ? ` ${k + 1}` : ''}`;
      const from = [...new Set(m[2].split(',').map((n) => n.trim().slice(1)))].map((n) => at.get(n)!);
      found.push({ at: m.index ?? 0, input: { key: `${side}:${name.toLowerCase().replace(' ', '')}`, kind: 'combined', label: name, from, alt } });
      rest = rest.replace(m[0], ' '.repeat(m[0].length));
      shown = shown.replace(m[0], name);
    });
    const refs = referencesIn(rest);
    for (const name of refs.fields) {
      const src = at.get(name);
      const input: GraphInput = src
        ? { key: `${side}:@${name}`, kind: 'value', label: src.label, where: src.where, from: [src], alt, ...modified(name) }
        : { key: `${side}:@${name}`, kind: 'field', label: `@${name}`, from: [], alt, known: onSheet.has(name), missing: !onSheet.has(name) && !derivedIds.has(name) };
      found.push({ at: rest.indexOf(`@${name}`), input });
    }
    for (const name of referencesIn(text).tables) {
      const has = tableIds.has(name);
      found.push({ at: text.indexOf(name), input: { key: `${side}:${name}()`, kind: 'table', label: has ? tableName(name) : name, from: has ? [{ value: name, label: tableName(name), node: `table:${name}`, handle: 'out' }] : [], alt, missing: !has } });
    }
    for (const name of refs.rules) found.push({ at: rest.indexOf(`$${name}`), input: { key: `${side}:$${name}`, kind: 'engine', label: upper(name.replace(/_/g, ' ')), from: [], alt } });
    shown = shown
      .replace(/@([a-z][a-z0-9_]*)/g, (_, id: string) => at.get(id)?.label ?? `@${id}`)
      .replace(/\$([a-z][a-z0-9_]*)/g, (_, id: string) => upper(id.replace(/_/g, ' ')))
      .replace(/\b([a-z][a-z0-9_]*)(\s*\()/g, (m: string, id: string, p: string) => (FUNCTIONS.includes(id) || KEYWORDS.includes(id) || !tableIds.has(id) ? m : `${tableName(id)}${p}`))
      .replace(/\*/g, '×').replace(/-/g, '−');
    return { inputs: found.sort((a, b) => a.at - b.at).map((f) => f.input), text: shown };
  };

  for (const d of derived) {
    if (absorbed.has(d.id)) continue;
    const condition = d.kind === 'condition';
    const own = condition
      ? read(`IF ${d.when ?? ''} THEN ${d.then ?? ''} ELSE ${d.else ?? ''}`, false)
      : read(String(d.formula ?? ''), false);
    const inputs = [...own.inputs];
    let alternative: GraphNode['alternative'];
    if (!condition && d.alternative && typeof d.alternative.rule === 'string') {
      const alt = read(String(d.alternative.formula ?? ''), true);
      inputs.push(...alt.inputs);
      alternative = { rule: d.alternative.rule, ruleName: upper(rules.find((r) => r.id === d.alternative!.rule)?.name || d.alternative.rule), text: alt.text };
    }
    push({ id: d.id, kind: condition ? 'condition' : 'formula', label: upper(d.label || d.id), group: inMapGroup.get(d.id) ?? null, text: own.text, inputs, alternative });
    for (const i of inputs) wire(d.id, i);
    if (alternative && ruleIds.has(alternative.rule)) {
      wires.push({ id: `rule:${alternative.rule}>${d.id}:gate`, from: `rule:${alternative.rule}`, fromHandle: 'out', value: alternative.rule, to: d.id, input: 'gate', kind: 'gate', alt: true });
    }
  }

  // Rolls, after the formulas they read.
  const groupIds = new Set(groups.map((g) => g.id));
  for (const r of rollList(def)) {
    const by = (Array.isArray(r.by) ? r.by : []).map((b): GraphInput => {
      if (groupIds.has(b)) {
        const g = groups.find((x) => x.id === b)!;
        return { key: `by:${b}`, kind: 'value', label: upper(g.label || g.id), about: 'ROLLED BY · EACH STAT', from: [{ value: b, label: upper(g.label || g.id), node: b, handle: 'out' }], alt: false };
      }
      const src = at.get(b);
      return src
        ? { key: `by:${b}`, kind: 'value', label: src.label, about: 'ROLLED BY', from: [src], alt: false }
        : { key: `by:${b}`, kind: 'value', label: upper(b), about: 'ROLLED BY · NOT HERE', from: [], alt: false, missing: true };
    });
    const main = rollText(r);
    const shown = read(main, false);
    // A change's ADD reads names too: wired in, though the node's words are the roll's own.
    const reads = read([main, ...(r.changes ?? []).map((c) => c.add ?? '')].join(' + '), false).inputs
      .map((i): GraphInput => (OWN[i.key.slice(2)] ? { key: i.key, kind: 'field', label: i.label, about: OWN[i.key.slice(2)], from: [], alt: false, known: true } : i));
    const inputs = [...by, ...reads];
    const steps = stepsOf(r);
    push({
      id: `roll:${r.id}`, kind: 'roll', label: upper(r.label || r.id), group: null, text: shown.text, inputs,
      roll: {
        outcome: steps.bands.length ? steps.bands.map(([when]) => when).reverse().join(' · ')
          : r.against !== undefined ? (r.under ? 'AT OR UNDER THE TARGET' : 'AT OR OVER THE TARGET') : r.read === 'count' ? 'SUCCESSES' : 'THE TOTAL',
        changes: (r.changes ?? []).map((c) => `${upper(c.label)}${c.cost ? ' ◆' : ''}`),
      },
    });
    for (const i of inputs) wire(`roll:${r.id}`, i);
  }

  // Notes, pinned to the node that shows what they are pinned to (a stat's list).
  const pinnable = new Set(nodes.map((n) => n.id));
  const noteIds = new Set<string>();
  for (const n of Array.isArray(layout.notes) ? layout.notes : []) {
    if (!isObject(n) || typeof n.id !== 'string' || noteIds.has(n.id)) continue;
    noteIds.add(n.id);
    const pin = typeof n.on === 'string' ? (at.get(n.on)?.node ?? n.on) : undefined;
    const on = pin && pinnable.has(pin) ? pin : undefined;
    push({ id: `note:${n.id}`, kind: 'note', label: 'NOTE', group: null, text: typeof n.text === 'string' ? n.text : '', inputs: [], on });
    if (on) wires.push({ id: `note:${n.id}>${on}`, from: `note:${n.id}`, fromHandle: 'out', value: n.id, to: on, input: 'note', kind: 'note', alt: false });
  }

  return { nodes, wires, groups: mapGroups };
};

// ─── WHERE THINGS SIT ──────────────────────────────────────────────────────

export interface Point { x: number; y: number }
export type Positions = Record<string, Point>;

/** Up to the next whole cell. */
export const snapUp = (v: number) => Math.ceil(v / GRID) * GRID;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number) => Math.max(-REACH, Math.min(REACH, v));
const STEP = SIZE.width + SIZE.columnGap;
/** A folded group's box height: its title, and how many nodes and wires out. */
export const foldedHeight = () => SIZE.groupHeader + SIZE.foldedLine + 6;

/**
 * Which column each node goes in, as the node kit's map reads left to right: tables, house rules
 * and stats with nothing to look up first, then a list whose modifiers come from a table, then
 * each formula one to the right of the furthest node it reads, and a note beside its node.
 */
export const columnsOf = (graph: Graph): Record<string, number> => {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const col: Record<string, number> = {};
  const visiting = new Set<string>();
  const of = (id: string): number => {
    if (col[id] !== undefined) return col[id];
    const n = byId.get(id);
    if (!n) return 0;
    if (n.kind === 'table' || n.kind === 'rule') return (col[id] = 0);
    if (n.kind === 'list') return (col[id] = n.via ? 1 : 0);
    if (n.kind === 'note') return (col[id] = n.on ? of(n.on) + 1 : 0);
    if (visiting.has(id)) return 1; // a loop: the server reports it; the map just needs a column
    visiting.add(id);
    let furthest = 0;
    for (const i of n.inputs) if (i.kind === 'value' || i.kind === 'combined') for (const f of i.from) furthest = Math.max(furthest, of(f.node));
    visiting.delete(id);
    return (col[id] = Math.max(1, furthest + 1));
  };
  graph.nodes.forEach((n) => of(n.id));
  return col;
};

/**
 * Every node placed by columnsOf, top to bottom, groups kept together, on the grid. A column
 * that would grow past SIZE.columnHeight carries on in another beside it (a group moves across
 * whole), and the next column starts to the right of them all.
 */
export const layoutOf = (graph: Graph): Positions => {
  const col = columnsOf(graph);
  const groupOf = new Map(graph.groups.flatMap((g) => g.members.map((m) => [m, g] as const)));
  const pos: Positions = {};
  const columns = [...new Set(Object.values(col))].sort((a, b) => a - b);
  let x: number = SIZE.left;
  for (const c of columns) {
    // Tables and house rules at the top, so what feeds a list sits above or left of it, never after it.
    const first = (n: GraphNode) => (n.kind === 'table' ? 0 : n.kind === 'rule' ? 1 : 2);
    const here = graph.nodes.filter((n) => col[n.id] === c).sort((a, b) => first(a) - first(b));
    let y: number = SIZE.top;
    /** Room for `height` more in this column, or a fresh column beside it. */
    const room = (height: number) => {
      // On the grid first: a node lands at the next grid line, which is where its height counts from.
      if (y > SIZE.top && snapUp(y) + height > SIZE.top + SIZE.columnHeight) { x += STEP; y = SIZE.top; }
    };
    const done = new Set<string>();
    for (const n of here) {
      if (done.has(n.id)) continue;
      const g = groupOf.get(n.id);
      if (g) {
        const members = here.filter((m) => groupOf.get(m.id) === g);
        const open = members.reduce((h, m) => snapUp(h + m.height + 16), 0) + 20;
        room(SIZE.groupTitle + (g.collapsed ? foldedHeight() + GRID : open));
        y = snapUp(y) + SIZE.groupTitle;
        let my = snapUp(y);
        for (const m of members) { pos[m.id] = { x, y: my }; my = snapUp(my + m.height + 16); done.add(m.id); }
        y = g.collapsed ? y + foldedHeight() + GRID : my + 20;
        continue;
      }
      room(n.height);
      if (n.kind === 'note' && n.on && pos[n.on] && pos[n.on].x <= x) y = Math.max(y, pos[n.on].y);
      pos[n.id] = { x, y: snapUp(y) };
      y = snapUp(y) + n.height + GRID;
      done.add(n.id);
    }
    x += STEP;
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
  // The lowest node already put in each column, by where its left edge sits.
  const bottom: Record<number, number> = {};
  for (const n of graph.nodes) {
    if (!saved[n.id]) continue;
    const x = saved[n.id].x;
    bottom[x] = Math.max(bottom[x] ?? SIZE.top, saved[n.id].y + n.height + GRID);
  }
  for (const n of graph.nodes) {
    if (out[n.id]) continue;
    const x = laid[n.id].x;
    const y = snapUp(bottom[x] ?? laid[n.id].y);
    out[n.id] = { x, y };
    bottom[x] = y + n.height + GRID;
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

export interface GroupBox { id: string; x: number; y: number; width: number; height: number; collapsed: boolean; members: string[]; wiresOut: number }

/** A group's box: around its members, or folded at the same corner into one line. */
export const groupBoxOf = (group: GraphGroup, graph: Graph, positions: Positions): GroupBox | null => {
  const members = group.members.map((id) => graph.nodes.find((n) => n.id === id)).filter((n): n is GraphNode => !!n && !!positions[n.id]);
  if (!members.length) return null;
  const ids = new Set(members.map((m) => m.id));
  const wiresOut = graph.wires.filter((w) => ids.has(w.from) && !ids.has(w.to)).length;
  const x = Math.min(...members.map((m) => positions[m.id].x)) - SIZE.groupPad;
  const y = Math.min(...members.map((m) => positions[m.id].y)) - SIZE.groupTitle;
  if (group.collapsed) return { id: group.id, x, y, width: SIZE.width + SIZE.groupPad * 2, height: foldedHeight(), collapsed: true, members: [...ids], wiresOut };
  const right = Math.max(...members.map((m) => positions[m.id].x + m.width)) + SIZE.groupPad;
  const bottom = Math.max(...members.map((m) => positions[m.id].y + m.height)) + SIZE.groupPad;
  return { id: group.id, x, y, width: right - x, height: bottom - y, collapsed: false, members: [...ids], wiresOut };
};

// ─── ROOM FOR SOMETHING NEW ────────────────────────────────────────────────

type Box = { x: number; y: number; width: number; height: number };

/** What a new node must keep a cell clear of: every node placed (but `skip`), and every group's box. */
export const takenBoxes = (graph: Graph, positions: Positions, skip?: string): Box[] => [
  ...graph.nodes.filter((n) => n.id !== skip && positions[n.id]).map((n) => ({ ...positions[n.id], width: n.width, height: n.height })),
  ...graph.groups.map((g) => groupBoxOf({ ...g, members: g.members.filter((m) => m !== skip) }, graph, positions)).filter((b): b is GroupBox => !!b),
];

/** Whether a box at `at` of `size` keeps a cell clear of all of `taken`. */
export const clearOf = (taken: Box[], at: Point, size: { width: number; height: number }): boolean => taken.every((b) =>
  at.x + size.width + GRID <= b.x || b.x + b.width + GRID <= at.x || at.y + size.height + GRID <= b.y || b.y + b.height + GRID <= at.y);

/** Steps a cell at a time out from a spot, nearest first (and down, then right, before up and left). */
const STEPS = (() => {
  const reach = 40;
  const out: Point[] = [];
  for (let dx = -reach; dx <= reach; dx += 1) for (let dy = -reach; dy <= reach; dy += 1) out.push({ x: dx, y: dy });
  return out.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || b.y - a.y || b.x - a.x);
})();

/**
 * The nearest place to `at`, whole cells away, where a box of `size` covers no node or group (5b6a:
 * something added where the GM is looking lands beside what is there, not on it). `at` itself when
 * nothing near is clear.
 */
export const clearSpot = (graph: Graph, positions: Positions, at: Point, size: { width: number; height: number }, skip?: string): Point => {
  const taken = takenBoxes(graph, positions, skip);
  for (const s of STEPS) {
    const spot = { x: at.x + s.x * GRID, y: at.y + s.y * GRID };
    if (clearOf(taken, spot, size)) return spot;
  }
  return at;
};

export interface ShownWire extends GraphWire { source: string; target: string; sourceHandle: string; targetHandle: string }

/**
 * The wires as drawn: a folded group is one box with one dot in (`in`) and one out (`out`), its
 * members' wires going through them, and a wire between two of its members isn't drawn. Anything
 * else goes from its own dot to the input's.
 */
export const shownWires = (graph: Graph): ShownWire[] => {
  const folded = new Map(graph.groups.filter((g) => g.collapsed).flatMap((g) => g.members.map((m) => [m, `group:${g.id}`] as const)));
  const out: ShownWire[] = [];
  for (const w of graph.wires) {
    const from = folded.get(w.from), to = folded.get(w.to);
    if (from && from === to) continue;
    out.push({
      ...w,
      source: from ?? w.from, sourceHandle: from ? 'out' : w.fromHandle,
      target: to ?? w.to, targetHandle: to ? 'in' : w.input,
    });
  }
  return out;
};

// ─── WHAT A NODE IS PART OF ────────────────────────────────────────────────

/**
 * Everything a node is wired to however far along (5c1; approved mockup builder-graph, "hover a
 * node to light what feeds it and what it feeds"): what it reads, what those read, and so on up;
 * what reads it, and so on down; and the notes pinned to any of those. Siblings that only share an
 * input aren't part of it. A note's own line leads nowhere, so a note lights itself and its node.
 */
export const relatedTo = (graph: Graph, id: string): Set<string> => {
  const wires = graph.wires.filter((w) => w.kind !== 'note');
  const walk = (next: (w: GraphWire, at: Set<string>) => string | null) => {
    const seen = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const w of wires) {
        const add = next(w, seen);
        if (add && !seen.has(add)) { seen.add(add); grew = true; }
      }
    }
    return seen;
  };
  const up = walk((w, at) => (at.has(w.to) ? w.from : null));
  const down = walk((w, at) => (at.has(w.from) ? w.to : null));
  const all = new Set([...up, ...down]);
  const note = graph.nodes.find((n) => n.id === id && n.kind === 'note');
  if (note?.on) all.add(note.on);
  for (const n of graph.nodes) if (n.kind === 'note' && n.on && all.has(n.on)) all.add(n.id);
  return all;
};
