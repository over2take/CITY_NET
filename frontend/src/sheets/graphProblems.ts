// PROBLEMS on the graph view (5b6b; approved mockup docs/mockups/builder-graph.html, 2026-10-17:
// "the same server check as PROBLEMS, each one clickable to the node, with the bad input drawn
// red", and a map-only warning: a formula that isn't on the character sheet and that nothing
// reads). Pure: the server's problems (the PROBLEMS page's own list) tied to the node that shows
// what each is about, in the names players see. The mockup's other warning, a wire making a loop,
// is the server's own "Depends on itself", and the map refuses to draw one (graphEdits.ts).

import type { Definition } from './systemsApi';
import { allStats, formulaList, tableList, usedBy } from './statsRules';
import { houseRuleList } from './houseRules';
import { sheetOf, fieldsOn } from './sheetDesigner';
import type { Graph } from './graphModel';

export interface MapProblem {
  kind: 'error' | 'warning';
  /** What it is about and what is wrong, in players' names. */
  text: string;
  /** The node that shows it, or null for one on another page. */
  node: string | null;
}

const upper = (s: string) => s.toUpperCase();

/** The node a stat or formula is shown on: its own, or the stats list it is a row (or a modifier) of. */
export const nodeShowing = (graph: Graph, id: string): string | null => {
  if (graph.nodes.some((n) => n.id === id && n.kind !== 'note')) return id;
  return graph.nodes.find((n) => n.kind === 'list' && (n.rows ?? []).some((r) => r.stat === id || r.mod === id))?.id ?? null;
};

/** What a problem is about, from the server's `where`: its node and its name, or null when not on the map. */
const aboutOf = (def: Definition, graph: Graph, where: string): { node: string; name: string } | null => {
  const m = /^(derived|stat|stats|samples|lookup|house rule|roll) ([a-z][a-z0-9_]*)(?:,|$)/.exec(where);
  if (!m) return null;
  const [, what, id] = m;
  if (what === 'derived') {
    const node = nodeShowing(graph, id);
    const f = formulaList(def).find((x) => x.id === id);
    return node ? { node, name: upper(f?.label || id) } : null;
  }
  if (what === 'stat' || what === 'samples') {
    const node = nodeShowing(graph, id);
    return node ? { node, name: upper(allStats(def).find((s) => s.id === id)?.label || id) } : null;
  }
  const node = what === 'stats' ? id : what === 'lookup' ? `table:${id}` : what === 'roll' ? `roll:${id}` : `rule:${id}`;
  const shown = graph.nodes.find((n) => n.id === node);
  if (!shown) return null;
  if (what === 'lookup') return { node, name: `TABLE ${upper(tableList(def).find((t) => t.id === id)?.label || id)}` };
  if (what === 'roll') return { node, name: `ROLL ${shown.label}` };
  if (what === 'house rule') return { node, name: `HOUSE RULE ${upper(houseRuleList(def).find((r) => r.id === id)?.name || id)}` };
  return { node, name: `STATS ${shown.label}` };
};

/**
 * The map's PROBLEMS: every one of the server's, tied to its node where the map shows it (the rest
 * say where they are), then a warning for each formula a customized sheet leaves off that nothing
 * reads either, so it shows nowhere. A system on the starter sheet has every formula on it.
 */
export const mapProblems = (def: Definition, graph: Graph, problems: { where: string; message: string }[]): MapProblem[] => {
  const errors = problems.map((p): MapProblem => {
    const about = aboutOf(def, graph, p.where);
    return about ? { kind: 'error', text: `${about.name}: ${p.message}`, node: about.node } : { kind: 'error', text: `${p.where}: ${p.message}`, node: null };
  });
  const sheet = sheetOf(def);
  const onSheet = new Set(fieldsOn(sheet).map((f) => f.id));
  // A formula already in error says that, not this too.
  const broken = new Set(problems.map((p) => /^derived ([a-z][a-z0-9_]*)(?:,|$)/.exec(p.where)?.[1]));
  const warnings = sheet
    ? formulaList(def)
      .filter((f) => !onSheet.has(f.id) && !usedBy(def, f.id).length && !broken.has(f.id))
      .map((f): MapProblem => ({ kind: 'warning', text: `${upper(f.label || f.id)} isn't on the character sheet, and nothing reads it`, node: nodeShowing(graph, f.id) }))
    : [];
  return [...errors, ...warnings];
};
