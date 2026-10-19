// Drawing and cutting wires on the graph view (5b2; approved mockup docs/mockups/builder-graph.html,
// 2026-10-17, decision 3: "a wire is a formula reading a name"). Pure: a wire drawn or cut is a
// change to one formula's text (or its WITH-rule alternative), the same change typing it in FORMS
// makes, through the same statsRules.ts edits. Nothing about wires is stored.
//
// Drawn: from a stat or formula onto a formula, `+ @name` at the end (a formula of just 0 becomes
// `@name`); from a house rule, a WITH-rule formula to change in the panel. Cut: the name taken out
// where that leaves a whole formula (`a + @x`, `@x + a`, one of the names in a BEST); anywhere else
// (`floor(@level / 2)`, read twice) the panel opens on the formula to change by hand.
//
// Into a condition (5b6a): drawn, its panel opens to compare the name in IF; cut, the name comes out
// of THEN or ELSE as from a formula, never out of IF's comparison.
//
// A note's dashed line is the one wire that is stored (5b5): its square dot dropped on a node pins
// it there, and cutting the line unpins it.

import type { Definition } from './systemsApi';
import { allStats, formulaList, withFormula, withAlternative, withCondition, isCondition, partOf, type Formula } from './statsRules';
import { houseRuleList } from './houseRules';
import { referencesIn, type Graph, type GraphWire } from './graphModel';
import { withNotePinned } from './graphNotes';

/** What a wire drawn or cut does: the system after it (null when nothing changes), what to say, and a node to open the panel on. */
export interface WireEdit { definition: Definition | null; message: string; open?: string }

type Dot = { node: string; handle: string };
type Given = { kind: 'value' | 'table' | 'rule' | 'note'; id: string } | null;

const upper = (s: string) => s.toUpperCase();
/** What players call a stat or formula. */
const nameOf = (def: Definition, id: string): string => upper(
  allStats(def).find((s) => s.id === id)?.label || formulaList(def).find((f) => f.id === id)?.label || id,
);
const ruleName = (def: Definition, id: string) => upper(houseRuleList(def).find((r) => r.id === id)?.name || id);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What flows from a dot on the map: a stat's or formula's value, a table, a house rule, a note to pin, or nothing to wire. */
export const givenBy = (graph: Graph, dot: Dot): Given => {
  const n = graph.nodes.find((x) => x.id === dot.node);
  if (!n) return null;
  if (n.kind === 'list' && dot.handle.startsWith('out:')) return { kind: 'value', id: dot.handle.slice(4) };
  if ((n.kind === 'formula' || n.kind === 'condition') && dot.handle === 'out') return { kind: 'value', id: n.id };
  if (n.kind === 'table' && dot.handle === 'out') return { kind: 'table', id: n.id.slice('table:'.length) };
  if (n.kind === 'rule' && dot.handle === 'out') return { kind: 'rule', id: n.id.slice('rule:'.length) };
  if (n.kind === 'note' && dot.handle === 'out') return { kind: 'note', id: n.id.slice('note:'.length) };
  return null;
};

/** Whether formula `from` reads `to`, however far along (its alternative's names count too). */
export const reads = (def: Definition, from: string, to: string): boolean => {
  const byId = new Map(formulaList(def).map((f) => [f.id, f]));
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const f = byId.get(id) as (Formula & { when?: string; then?: string; else?: string }) | undefined;
    if (!f) continue;
    for (const text of [f.formula, f.when, f.then, f.else, f.alternative?.formula]) stack.push(...referencesIn(text).fields);
  }
  return false;
};

/** A wire drawn from `from` (a dot on the map) onto node `to`. */
export const withWire = (def: Definition, graph: Graph, from: Dot, to: string): WireEdit => {
  const target = graph.nodes.find((n) => n.id === to);
  const given = givenBy(graph, from);
  if (!given) return { definition: null, message: 'Wires start from a stat, a formula, a table or a house rule.' };
  if (given.kind === 'note') {
    if (!target || target.kind === 'note') return { definition: null, message: 'Drop the note\'s square dot on a stats group, a formula, a table or a house rule to pin it there.' };
    return { definition: withNotePinned(def, given.id, target.id), message: `Note pinned to ${upper(target.label)}.` };
  }
  if (!target) return { definition: null, message: 'Drop the wire on a formula.' };
  if (target.kind === 'list') return { definition: null, message: 'Players fill in stats, so nothing is wired into them. Drop the wire on a formula.' };
  if (target.kind !== 'formula' && target.kind !== 'condition') return { definition: null, message: 'Wires go into formulas.' };
  const f = formulaList(def).find((x) => x.id === to)!;
  const label = upper(f.label || f.id);
  if (isCondition(f)) {
    // A condition compares, so where the name goes and against what is the GM's to say.
    if (given.kind === 'rule') return { definition: null, message: `${label} is a condition: only a formula has one to use WITH a house rule.` };
    if (given.kind === 'table') return { definition: null, message: `A table needs a number to read: type ${given.id}(@something) in ${label}'s IF, THEN or ELSE.`, open: to };
    const name = nameOf(def, given.id);
    if (given.id === f.id) return { definition: null, message: 'A condition can\'t read itself.' };
    if (reads(def, given.id, f.id)) return { definition: null, message: `That would make a loop: ${name} already reads ${label}.` };
    return { definition: null, message: `A condition compares: add ${name} to ${label}'s IF in the panel, and say how it compares (@${given.id} > 2).`, open: to };
  }

  if (given.kind === 'rule') {
    if (f.alternative) return { definition: null, message: `${label} already has a formula to use WITH ${ruleName(def, f.alternative.rule)}.`, open: to };
    return { definition: withAlternative(def, f.id, { rule: given.id }), message: `${label} now has a formula to use WITH ${ruleName(def, given.id)}: change it in the panel.`, open: to };
  }
  if (given.kind === 'table') return { definition: null, message: `A table needs a number to read: type ${given.id}(@something) in ${label}'s formula.`, open: to };

  const name = nameOf(def, given.id);
  if (given.id === f.id) return { definition: null, message: 'A formula can\'t read itself.' };
  if (referencesIn(f.formula).fields.includes(given.id)) return { definition: null, message: `${label} already reads ${name}.` };
  if (reads(def, given.id, f.id)) return { definition: null, message: `That would make a loop: ${name} already reads ${label}.` };
  const text = (f.formula ?? '').trim();
  const next = text === '' || text === '0' ? `@${given.id}` : `${f.formula} + @${given.id}`;
  return { definition: withFormula(def, f.id, { formula: next }), message: `${label}: added + ${name}.` };
};

/**
 * `text` without `@name` where that leaves a whole formula, or null where it doesn't: one of
 * several names in a BEST or WORST (two left becomes the one), a term added or taken away, or the
 * whole formula (which becomes 0).
 */
export const withoutName = (text: string, name: string): string | null => {
  const at = new RegExp(`@${escape(name)}(?![a-z0-9_])`, 'g');
  if ((text.match(at) ?? []).length !== 1) return null;
  const combo = new RegExp(`\\b(max|min)\\(\\s*((?:@[a-z][a-z0-9_]*\\s*,\\s*)*@${escape(name)}(?:\\s*,\\s*@[a-z][a-z0-9_]*)*)\\s*\\)`);
  const m = combo.exec(text);
  if (m) {
    const rest = m[2].split(',').map((s) => s.trim()).filter((s) => s !== `@${name}`);
    if (rest.length) return text.replace(m[0], rest.length === 1 ? rest[0] : `${m[1]}(${rest.join(', ')})`);
  }
  if (new RegExp(`^\\s*@${escape(name)}\\s*$`).test(text)) return '0';
  // Added or taken away, and not part of a product, a division or a call's arguments.
  const term = new RegExp(`\\s*[+-]\\s*@${escape(name)}(?![a-z0-9_])(?!\\s*[*/(])`);
  const before = text.search(term);
  if (before >= 0) {
    const after = text.slice(before).match(term)![0];
    const prev = text.slice(0, before).trimEnd().slice(-1);
    const nextChar = text.slice(before + after.length).trimStart()[0];
    // A term taken from the front leaves the next one's + leading: that goes too.
    if (!'*/'.includes(prev || ' ') && !'*/'.includes(nextChar || ' ')) return (text.slice(0, before) + text.slice(before + after.length)).replace(/^\s*\+\s*/, '');
  }
  const first = new RegExp(`^(\\s*)@${escape(name)}\\s*\\+\\s*`);
  if (first.test(text)) return text.replace(first, '$1');
  return null;
};

/** A wire cut. */
export const withoutWire = (def: Definition, graph: Graph, wire: GraphWire): WireEdit => {
  if (wire.kind === 'note') return { definition: withNotePinned(def, wire.value, null), message: 'Note unpinned. Drag its square dot onto a node to pin it again.' };
  const f = formulaList(def).find((x) => x.id === wire.to);
  if (!f) return { definition: null, message: 'These modifiers are each a formula reading the table: change them in the panel.', open: wire.to };
  const label = upper(f.label || f.id);
  if (wire.kind === 'gate') {
    const rule = f.alternative ? ruleName(def, f.alternative.rule) : '';
    return { definition: withAlternative(def, f.id, { rule: null }), message: `${label} no longer has a formula to use WITH ${rule}.` };
  }
  if (wire.kind === 'table') return { definition: null, message: `The table is read inside ${label}'s formula: change it in the panel.`, open: f.id };
  if (isCondition(f)) {
    const name = nameOf(def, wire.value);
    const at = new RegExp(`@${escape(wire.value)}(?![a-z0-9_])`);
    if (at.test(partOf(f, 'when'))) return { definition: null, message: `${name} is compared in ${label}'s IF: change it in the panel.`, open: f.id };
    const parts = (['then', 'else'] as const).filter((p) => at.test(partOf(f, p)));
    const next = parts.length === 1 ? withoutName(partOf(f, parts[0]), wire.value) : null;
    if (next === null) return { definition: null, message: `${name} is part of a bigger piece of ${label}: change it in the panel.`, open: f.id };
    return { definition: withCondition(def, f.id, { [parts[0]]: next }), message: `${label}: took out ${name}.` };
  }
  const text = wire.alt ? f.alternative?.formula ?? '' : f.formula ?? '';
  const next = withoutName(text, wire.value);
  const name = nameOf(def, wire.value);
  if (next === null) return { definition: null, message: `${name} is part of a bigger piece of ${label}'s formula: change it in the panel.`, open: f.id };
  return {
    definition: wire.alt ? withAlternative(def, f.id, { formula: next }) : withFormula(def, f.id, { formula: next }),
    message: `${label}: took out ${name}.`,
  };
};

/** What a wire is, in the names players see: "STR MOD into MELEE", for asking before it is cut. */
export const wireLabel = (def: Definition, wire: GraphWire): string => {
  const f = formulaList(def).find((x) => x.id === wire.to);
  const into = upper(f?.label || f?.id || wire.to.replace(/^[a-z]+:/, ''));
  if (wire.kind === 'gate') return `${ruleName(def, wire.value)} swapping ${into}'s formula`;
  if (wire.kind === 'table') return `The table ${wire.value} into ${into}`;
  if (wire.kind === 'note') return `A note pinned to ${into}: cutting unpins it`;
  return `${nameOf(def, wire.value)} into ${into}${wire.alt ? ' (WITH-rule formula)' : ''}`;
};
