import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, Handle, Position, useReactFlow, useViewport, useUpdateNodeInternals,
  BaseEdge, getSmoothStepPath, useNodesInitialized,
  type Node, type Edge, type EdgeProps, type EdgeTypes, type NodeProps, type NodeChange, type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  graphOf, positionsOf, layoutOf, withPositions, withCollapsed, groupBoxOf, shownWires, exprHeight, noteHeight, SIZE, GRID,
  type Graph, type GraphGroup, type GraphNode, type GraphInput, type Positions, type Point, type Source,
} from '../sheets/graphModel';
import { sampleOf } from '../sheets/statsRules';
import { usePreviewValues } from '../hooks/usePreviewValues';
import type { BuilderPage } from '../sheets/builderSession';
import { GraphPanel } from './GraphPanel';

// STATS & RULES with GRAPH on (5a3a; approved mockup docs/mockups/builder-graph.html, 2026-10-17,
// nodes as the builder design's node kit draws them, docs/mockups/builder-design, 2026-09-29): the
// system as a map of nodes and wires, drawn to be read. Everything is read from the same draft
// FORMS edits (sheets/graphModel.ts): a wire is a formula reading a name. Nodes are dragged on a
// 24px grid and where they sit is saved with the draft through the builder's `edit`, as is a group
// folded. The values are the server's, as FORMULAS shows them. Editing a node comes with 5a3b.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the live values; without it nodes show none. */
  api?: ReturnType<typeof systemsApi>;
  /** An example being looked at: the map moves and zooms, nothing on it changes. */
  readOnly?: boolean;
  /** Where a house rule's GO TO HOUSE RULES goes: the builder's own page. */
  onGoTo?: (page: BuilderPage) => void;
}

/**
 * The ground behind the nodes: dark in every theme, as the builder design settled (approved
 * 2026-09-29), so wires and nodes in any theme's colors read on it. Everything on it follows
 * the theme.
 */
const GROUND = { base: '#0b0d0f', cell: '#14181b', major: '#1c2126' };

const tint = (pct: number, color = 'green') => `color-mix(in srgb, var(--${color}) ${pct}%, ${GROUND.cell})`;
const line: React.CSSProperties = { boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' };
const tag: React.CSSProperties = { fontSize: 10, letterSpacing: 1, color: 'var(--cyan)', flexShrink: 0 };
const dim: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.7 };
const hidden: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };
const dot = (color: string): React.CSSProperties => ({ width: 10, height: 10, minWidth: 0, minHeight: 0, background: color, border: `2px solid ${GROUND.base}`, borderRadius: '50%' });

const show = (v: number | null | undefined) => (v === undefined || v === null ? '·' : String(Math.round(v * 100) / 100).replace('-', '−'));
const signed = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? `+${show(v)}` : show(v));

/** The server's values, the sample character's stats, and which dots have wires leaving them. */
type Values = { values: Record<string, number>; problems: Record<string, string>; samples: (id: string) => number; stats: Set<string>; used: Set<string> };
type NodeData = { node: GraphNode; values: Values };
type BoxData = { group: GraphGroup; count: number; wiresOut: number; onFold: () => void; readOnly: boolean };

/** What flows from a source: a stat's sample, or a worked out value. */
const valueFrom = (s: Source, values: Values): number | undefined => (values.stats.has(s.value) ? values.samples(s.value) : values.values[s.value]);
/** What an input brings in: its one value, or the best or worst of several. */
const incoming = (i: GraphInput, values: Values): number | undefined => {
  const all = i.from.map((s) => valueFrom(s, values));
  if (!all.length || all.some((v) => v === undefined)) return undefined;
  if (i.kind !== 'combined') return all[0];
  return i.label.startsWith('BEST') ? Math.max(...(all as number[])) : Math.min(...(all as number[]));
};

/** Where each input's dot sits, from the node's top inside its border, matching heightOf. */
const inputTops = (n: GraphNode): Record<string, number> => {
  const out: Record<string, number> = {};
  let y = SIZE.header;
  for (const i of n.inputs.filter((x) => !x.alt)) { out[i.key] = y + SIZE.row / 2; y += SIZE.row; }
  y += exprHeight(n.text) + SIZE.result;
  if (n.alternative) {
    out.gate = y + SIZE.row / 2;
    y += SIZE.row;
    for (const i of n.inputs.filter((x) => x.alt)) { out[i.key] = y + SIZE.row / 2; y += SIZE.row; }
  }
  return out;
};

function Header({ kindTag, label, right, cyan }: { kindTag: string; label: string; right?: React.ReactNode; cyan?: boolean }) {
  return (
    <div style={{ ...line, height: SIZE.header, gap: 8, padding: '0 8px', background: tint(16, cyan ? 'cyan' : 'green'), borderBottom: `1px solid color-mix(in srgb, var(--${cyan ? 'cyan' : 'green'}) 45%, transparent)` }}>
      <span style={tag}>{kindTag}</span>
      <b style={{ flex: 1, minWidth: 0, fontSize: 13, color: cyan ? 'var(--cyan)' : 'var(--green)', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: 0.5 }}>{label}</b>
      {right}
    </div>
  );
}

const shell = (n: GraphNode, extra: React.CSSProperties = {}): React.CSSProperties => ({
  // textAlign: React Flow's stylesheet centres a node's text; the node kit reads from the left.
  position: 'relative', width: n.width, height: n.height, boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', textAlign: 'left',
  background: tint(6), border: '1px solid var(--green)', boxShadow: '0 0 10px color-mix(in srgb, var(--green) 22%, transparent)', ...extra,
});

/** A node's text: a formula in names, a rule's words. Cut short after four lines; whole on hover. */
function Words({ text, faint, color = 'var(--cyan)' }: { text: string; faint?: boolean; color?: string }) {
  return (
    <div title={text} style={{ height: exprHeight(text), boxSizing: 'border-box', padding: '4px 10px', fontSize: 12, lineHeight: `${SIZE.exprLine}px`, color, opacity: faint ? 0.5 : 1, overflow: 'hidden', wordBreak: 'break-word' }}>{text}</div>
  );
}

/** Every node takes a note's line at its top right, and most give a value out there. */
function Ends({ out = true, color = 'var(--green)' }: { out?: boolean; color?: string }) {
  return (
    <>
      <Handle type="target" id="note" position={Position.Right} isConnectable={false} style={{ ...hidden, top: 14 }} />
      {out && <Handle type="source" id="out" position={Position.Right} isConnectable={false} style={{ ...dot(color), top: 14 }} />}
    </>
  );
}

/** A stats group: a row and a dot per stat, and the modifier each is given by one table, as the node kit's ABILITIES. */
function ListNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  const v = data.values;
  const rows = n.rows ?? [];
  const mods = !!n.via;
  const top = SIZE.header + (mods ? SIZE.row : 0) + SIZE.colHead;
  const cols = mods ? '44px minmax(0, 1fr) 46px 46px' : '44px minmax(0, 1fr) 54px';
  return (
    <div data-testid={`graph-node-${n.id}`} style={shell(n)}>
      <Header kindTag="STATS" label={n.label} right={<span style={{ ...dim, opacity: 0.8 }}>{rows.length}</span>} />
      {n.via && (
        <div style={{ ...line, height: SIZE.row, padding: '0 10px 0 14px', gap: 6, fontSize: 11, borderBottom: '1px solid color-mix(in srgb, var(--green) 20%, transparent)' }}>
          <span style={dim}>MOD VIA</span><b style={{ color: 'var(--green)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.via.label}</b>
        </div>
      )}
      <div style={{ height: SIZE.colHead, display: 'grid', gridTemplateColumns: cols, alignItems: 'center', padding: '0 10px', boxSizing: 'border-box', ...dim }}>
        <span /><span>NAME</span><span style={{ textAlign: 'right' }}>SCORE</span>{mods && <span style={{ textAlign: 'right' }}>MOD</span>}
      </div>
      {rows.map((r) => (
        <div key={r.stat} style={{ height: SIZE.listRow, display: 'grid', gridTemplateColumns: cols, alignItems: 'center', padding: '0 10px', boxSizing: 'border-box', borderTop: '1px solid color-mix(in srgb, var(--green) 12%, transparent)' }}>
          <b style={{ color: 'var(--green)' }}>{r.short ?? ''}</b>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{r.label}</span>
          <span style={{ textAlign: 'right' }}>{show(v.samples(r.stat))}</span>
          {mods && <b style={{ textAlign: 'right', color: 'var(--green)' }}>{r.mod ? (v.problems[r.mod] ? '?' : signed(v.values[r.mod])) : ''}</b>}
        </div>
      ))}
      {n.via && <Handle type="target" id="via" position={Position.Left} isConnectable={false} style={{ ...dot('var(--green)'), top: SIZE.header + SIZE.row / 2 }} />}
      {rows.map((r, i) => {
        const y = top + i * SIZE.listRow + SIZE.listRow / 2;
        const scoreOut = `out:${r.stat}`;
        return (
          <React.Fragment key={r.stat}>
            {/* With a MOD column, the score's dot sits between the two, so each column's wires leave from its own number. */}
            <Handle type="source" id={scoreOut} position={Position.Right} isConnectable={false}
              style={{ ...(v.used.has(`${n.id}:${scoreOut}`) ? dot('var(--green)') : hidden), top: y, ...(r.mod ? { right: 'auto', left: n.width - 64 } : {}) }} />
            {r.mod && <Handle type="source" id={`out:${r.mod}`} position={Position.Right} isConnectable={false}
              style={{ ...(v.used.has(`${n.id}:out:${r.mod}`) ? dot('var(--green)') : hidden), top: y }} />}
          </React.Fragment>
        );
      })}
      <Handle type="target" id="note" position={Position.Right} isConnectable={false} style={{ ...hidden, top: 14 }} />
    </div>
  );
}

function TableNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  return (
    <div data-testid={`graph-node-${n.id}`} style={shell(n)}>
      <Header kindTag="TABLE" label={n.label} />
      {(n.bands ?? []).map((b, i, all) => {
        const below = i > 0 ? all[i - 1].upTo : null;
        return (
          <div key={i} style={{ ...line, height: SIZE.band, padding: '0 14px', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ opacity: 0.8 }}>{b.upTo === null ? `ABOVE ${below ?? ''}` : `UP TO ${b.upTo}`}</span><b style={{ color: 'var(--green)' }}>{signed(b.value)}</b>
          </div>
        );
      })}
      <Ends />
    </div>
  );
}

function RuleNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  return (
    <div data-testid={`graph-node-${n.id}`} style={shell(n, { borderColor: 'var(--cyan)', outline: '1px solid var(--cyan)', outlineOffset: 2, background: tint(6, 'cyan') })}>
      <Header kindTag="HOUSE RULE" label={n.label} cyan />
      {n.text && <Words text={n.text} color="var(--text)" />}
      <div style={{ ...line, height: SIZE.ruleRow, padding: '0 10px', ...dim, color: 'var(--cyan)', opacity: 1 }}>SWAPS THE FORMULAS WIRED TO IT</div>
      {(n.also ?? []).map((a) => (
        <div key={a} style={{ ...line, height: SIZE.row, padding: '0 10px', fontSize: 11, textOverflow: 'ellipsis' }}>ALSO · {a}</div>
      ))}
      <Ends color="var(--cyan)" />
    </div>
  );
}

function NoteNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  return (
    <div data-testid={`graph-node-${n.id}`} style={shell(n, { background: GROUND.cell, border: '1px dashed var(--text)', boxShadow: 'none' })}>
      <div style={{ ...line, height: SIZE.noteHeader, padding: '0 10px' }}><span style={tag}>NOTE</span></div>
      <div style={{ height: noteHeight(n.text), boxSizing: 'border-box', padding: '0 10px 8px', fontSize: 12, lineHeight: `${SIZE.noteLine}px`, overflow: 'hidden' }}>{n.text}</div>
      <Handle type="source" id="out" position={Position.Left} isConnectable={false}
        style={{ width: 10, height: 10, minWidth: 0, minHeight: 0, borderRadius: 0, background: GROUND.base, border: '2px solid var(--text)', top: 11 }} />
    </div>
  );
}

/** One input's row: what players call it, where it comes from, and what it brings in. */
function InputRow({ i, values }: { i: GraphInput; values: Values }) {
  const bad = i.missing && i.kind !== 'field';
  const about = i.kind === 'combined'
    ? `${i.from.map((s) => s.label).join(', ')} · ${i.label.startsWith('BEST') ? 'HIGHEST' : 'LOWEST'}`
    : i.kind === 'table' ? (i.missing ? 'NO SUCH TABLE' : 'TABLE')
      : i.kind === 'field' ? (i.known ? 'SHEET FIELD' : 'ON NO SHEET')
        : i.kind === 'engine' ? 'BUILT-IN'
          : i.where ? `↗ ${i.where}` : '';
  const v = i.kind === 'value' || i.kind === 'combined' ? incoming(i, values) : undefined;
  return (
    <div style={{ ...line, height: SIZE.row, padding: '0 10px 0 14px', gap: 8, opacity: i.alt ? 0.6 : 1, color: bad ? 'var(--danger)' : undefined }}>
      <b style={{ color: bad ? 'var(--danger)' : 'var(--green)', fontSize: 12, flexShrink: 0 }}>{i.label}</b>
      <span style={{ ...dim, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: i.kind === 'field' && !i.known ? 'var(--warning)' : undefined, opacity: i.kind === 'field' && !i.known ? 1 : 0.7 }}>{about}</span>
      {v !== undefined && <span style={{ fontSize: 12 }}>{show(v)}</span>}
    </div>
  );
}

/** A formula or condition, as the node kit's PHYSICAL SAVE: its inputs by name, its text in names, and = its value. */
function FormulaNode({ data }: NodeProps<Node<NodeData>>) {
  const n = data.node;
  const problem = data.values.problems[n.id];
  const value = data.values.values[n.id];
  const tops = inputTops(n);
  const dotColor = (i: GraphInput) => (i.from.length ? 'var(--green)' : i.missing && i.kind !== 'field' ? 'var(--danger)' : 'color-mix(in srgb, var(--green) 35%, transparent)');
  return (
    <div data-testid={`graph-node-${n.id}`} style={shell(n, problem ? { borderColor: 'var(--danger)', boxShadow: '0 0 10px color-mix(in srgb, var(--danger) 30%, transparent)' } : {})}>
      <Header kindTag={n.kind === 'condition' ? 'CONDITION' : 'FORMULA'} label={n.label} />
      {n.inputs.filter((i) => !i.alt).map((i) => <InputRow key={i.key} i={i} values={data.values} />)}
      <Words text={n.text} />
      <div style={{ ...line, height: SIZE.result, padding: '0 10px', justifyContent: problem ? 'flex-start' : 'flex-end', gap: 8, borderTop: '1px solid color-mix(in srgb, var(--green) 15%, transparent)' }}>
        {problem
          ? <span role="alert" title={problem} style={{ color: 'var(--danger)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>✕ {problem}</span>
          : <><span style={{ fontSize: 15, color: 'var(--green)', opacity: 0.75 }}>=</span><b data-value style={{ color: 'var(--green)', fontSize: 16 }}>{show(value)}</b></>}
      </div>
      {n.alternative && (
        <>
          <div style={{ ...line, height: SIZE.row, padding: '0 10px 0 14px', ...dim, opacity: 1, color: 'var(--cyan)', background: 'color-mix(in srgb, var(--cyan) 10%, transparent)', borderTop: '1px solid color-mix(in srgb, var(--cyan) 35%, transparent)' }}>
            WITH {n.alternative.ruleName}, USE
          </div>
          {n.inputs.filter((i) => i.alt).map((i) => <InputRow key={i.key} i={i} values={data.values} />)}
          <Words text={n.alternative.text} faint />
        </>
      )}
      {n.inputs.map((i) => (
        <Handle key={i.key} type="target" id={i.key} position={Position.Left} isConnectable={false} style={{ ...dot(dotColor(i)), top: tops[i.key] }} />
      ))}
      {n.alternative && <Handle type="target" id="gate" position={Position.Left} isConnectable={false} style={{ ...dot('var(--cyan)'), top: tops.gate }} />}
      <Ends />
    </div>
  );
}

/** A group open: a box around its members, under them, its title bar the only part that takes the pointer. */
function GroupBox({ data, width, height }: NodeProps<Node<BoxData>>) {
  return (
    <div data-testid={`graph-group-${data.group.id}`} style={{ width, height, boxSizing: 'border-box', border: '1px dashed color-mix(in srgb, var(--green) 45%, transparent)', background: 'color-mix(in srgb, var(--green) 3%, transparent)', fontFamily: 'monospace' }}>
      <GroupTitle data={data} />
    </div>
  );
}

function GroupTitle({ data }: { data: BoxData }) {
  const g = data.group;
  return (
    <div className="graph-group-head" style={{ height: 22, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: 2, color: 'var(--green)', cursor: data.readOnly ? 'default' : 'grab', pointerEvents: 'all' }}>
      <button type="button" className="nodrag" aria-label={`${g.collapsed ? 'Open' : 'Fold'} ${g.label}`} aria-expanded={!g.collapsed} disabled={data.readOnly} onClick={data.onFold}
        style={{ background: 'none', border: '1px solid color-mix(in srgb, var(--green) 50%, transparent)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 10, width: 18, height: 16, padding: 0, cursor: 'pointer' }}>
        {g.collapsed ? '▸' : '▾'}
      </button>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
      {!g.collapsed && <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.6 }}>{data.count}</span>}
    </div>
  );
}

/** A group folded, as the node kit's: one box saying how many nodes and how many wires leave it. */
function FoldedBox({ data, width, height }: NodeProps<Node<BoxData>>) {
  return (
    <div data-testid={`graph-group-${data.group.id}`} style={{ position: 'relative', width, height, boxSizing: 'border-box', border: '1px solid var(--green)', background: tint(6), boxShadow: '0 0 10px color-mix(in srgb, var(--green) 22%, transparent)', fontFamily: 'monospace' }}>
      <div style={{ height: SIZE.groupHeader, boxSizing: 'border-box', background: tint(16), borderBottom: '1px solid color-mix(in srgb, var(--green) 45%, transparent)', display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}><GroupTitle data={data} /></div>
      </div>
      <div style={{ ...line, height: SIZE.foldedLine, padding: '0 12px', fontSize: 11, letterSpacing: 1 }}>
        {data.count} NODE{data.count === 1 ? '' : 'S'} · {data.wiresOut} WIRE{data.wiresOut === 1 ? '' : 'S'} OUT
      </div>
      <Handle type="target" id="in" position={Position.Left} isConnectable={false} style={{ ...dot('var(--green)'), top: SIZE.groupHeader + SIZE.foldedLine / 2 }} />
      <Handle type="source" id="out" position={Position.Right} isConnectable={false} style={{ ...dot('var(--green)'), top: SIZE.groupHeader + SIZE.foldedLine / 2 }} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  list: ListNode, table: TableNode, rule: RuleNode, note: NoteNode, formula: FormulaNode, condition: FormulaNode,
  groupBox: GroupBox, folded: FoldedBox,
};

const EDGE_STYLE: Record<string, React.CSSProperties> = {
  value: { stroke: 'color-mix(in srgb, var(--green) 75%, transparent)', strokeWidth: 1.6 },
  table: { stroke: 'color-mix(in srgb, var(--green) 50%, transparent)', strokeWidth: 1.6 },
  gate: { stroke: 'var(--cyan)', strokeWidth: 2, strokeDasharray: '2 4', strokeLinecap: 'round' },
  note: { stroke: 'var(--text)', strokeWidth: 1, strokeDasharray: '6 4', opacity: 0.6 },
};

const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * A wire, as a circuit trace: straight out, one turn just before the input it goes to (each input
 * on a node in a lane of its own, so wires into one node don't merge into one line), straight in,
 * solder at each turn. Drawn this way, the wires into a busy column stay apart.
 */
function Wire({ id, sourceX, sourceY, targetX, targetY, style, data }: EdgeProps<Edge<{ lane: number }>>) {
  const lane = (data?.lane ?? 0) % 5;
  const fill = (style?.stroke as string) ?? 'var(--green)';
  const solder = (points: [number, number][]) => points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.6} style={{ fill }} />);
  if (targetX - sourceX > 60) {
    const centerX = targetX - 30 - lane * 9;
    const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition: Position.Right, targetX, targetY, targetPosition: Position.Left, centerX, borderRadius: 0 });
    return (
      <>
        <BaseEdge id={id} path={path} style={style} />
        {Math.abs(sourceY - targetY) > 1 && solder([[centerX, sourceY], [centerX, targetY]])}
      </>
    );
  }
  // Backwards (what feeds a node sits to its right, as after a node is dragged past it): out to
  // the right, back along a lane above both ends, and in from the left, never through either node.
  const out = sourceX + 20 + lane * 6;
  const back = targetX - 20 - lane * 6;
  const above = Math.min(sourceY, targetY) - 48 - lane * 6;
  const path = `M${sourceX} ${sourceY} H${out} V${above} H${back} V${targetY} H${targetX}`;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {solder([[out, sourceY], [out, above], [back, above], [back, targetY]])}
    </>
  );
}
const EDGE_TYPES: EdgeTypes = { wire: Wire };

/** At least this zoom when the map opens, so it can be read; FIT shows everything at any zoom. */
const OPENING_ZOOM = 0.8;

/**
 * AUTO-LAYOUT puts every node back in its column (5c's, brought forward: places are kept once
 * anything moves, so this is the way back to a tidy map). It asks first, as there is no undo
 * until 5b: a second click within a few seconds does it.
 */
function Toolbar({ onTidy }: { onTidy?: () => void }) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return undefined;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);
  const b: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '3px 9px' };
  return (
    <div role="toolbar" aria-label="Map" style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', gap: 4, alignItems: 'center', background: 'var(--black)', border: '1px solid var(--dark-green)', padding: 4 }}>
      {onTidy && (
        <button type="button" className="utility-btn" style={{ ...b, ...(asking ? { borderColor: 'var(--warning)', color: 'var(--warning)' } : {}) }}
          title="Every node back in its column, stats on the left and each formula right of what it reads"
          onClick={() => { if (asking) { setAsking(false); onTidy(); } else setAsking(true); }}>
          {asking ? 'REPLACE MY LAYOUT?' : 'AUTO-LAYOUT'}
        </button>
      )}
      <button type="button" data-browse className="utility-btn" style={b} aria-label="Zoom out" onClick={() => flow.zoomOut()}>−</button>
      <span data-testid="graph-zoom" style={{ minWidth: 44, textAlign: 'center', fontSize: 11, color: 'var(--green)' }}>{Math.round(zoom * 100)}%</span>
      <button type="button" data-browse className="utility-btn" style={b} aria-label="Zoom in" onClick={() => flow.zoomIn()}>+</button>
      <button type="button" data-browse className="utility-btn" style={b} onClick={() => flow.fitView({ padding: 0.1, maxZoom: 1 })}>FIT</button>
    </div>
  );
}

/** Under the map, as the builder design's: how much is on it, the grid, and the sample character it is worked out on. */
function StatusLine({ graph, definition }: { graph: Graph; definition: Definition }) {
  const sample = graph.nodes.filter((n) => n.kind === 'list').flatMap((n) => n.rows ?? [])
    .map((r) => `${r.short ?? r.label} ${show(sampleOf(definition, r.stat) ?? 0)}`).join(' · ');
  return (
    <div data-testid="graph-status" style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5, height: 24, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 16,
      background: 'var(--black)', borderTop: '1px solid var(--dark-green)', fontSize: 10, letterSpacing: 1, whiteSpace: 'nowrap', overflow: 'hidden', fontFamily: 'monospace',
    }}>
      <span style={{ color: 'var(--green)' }}>{graph.nodes.length} NODES · {graph.wires.filter((w) => w.kind !== 'note').length} WIRES</span>
      <span style={{ opacity: 0.7 }}>SNAP 24 · ZOOM 10–400% · CTRL + WHEEL</span>
      {sample && <span style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>SAMPLE: {sample}</span>}
    </div>
  );
}

function GraphMap({ definition, edit, api, readOnly = false, onGoTo }: Props) {
  const graph = useMemo(() => graphOf(definition), [definition]);
  const { preview, tried } = usePreviewValues(definition, api);
  // The node picked on the map, whose controls the panel shows (5a3b2). Gone when it is: a formula
  // removed, or turned into a modifier its stat's list now shows.
  const [selected, setSelected] = useState<string | null>(null);
  const picked = selected ? graph.nodes.find((n) => n.id === selected) : undefined;
  const values: Values = useMemo(() => ({
    values: preview?.values ?? {},
    problems: preview?.problems ?? {},
    samples: (id: string) => sampleOf(definition, id) ?? 0,
    stats: new Set(graph.nodes.flatMap((n) => (n.rows ?? []).map((r) => r.stat))),
    used: new Set(graph.wires.map((w) => `${w.from}:${w.fromHandle}`)),
  }), [preview, definition, graph]);

  // Where nodes sit: the draft's places, and while a drag lasts, the dragged nodes' own over them.
  const saved = useMemo(() => positionsOf(definition, graph), [definition, graph]);
  const [dragged, setDragged] = useState<Positions>({});
  const positions = useMemo(() => ({ ...saved, ...dragged }), [saved, dragged]);
  /** The drag's places as of its last move, for when it ends (read in handlers, never while drawing). */
  const latest = useRef<Positions>({});
  /** A group's box and its members' places when its drag began. */
  const grabbed = useRef<{ box: Point; members: Record<string, Point> } | null>(null);
  /**
   * Each node's size as React Flow measured it, handed back with the node: React Flow keeps where
   * a node's dots are only for a node that comes with its size, so without it every change (a
   * value worked out, a group folded) had it measure every node again and draw no wires meanwhile.
   */
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  // A node's dots can change while its size doesn't (@a read instead of @b): measured again
  // whenever the system changes, not when only values or places do.
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals([...graph.nodes.map((n) => n.id), ...graph.groups.map((g) => `group:${g.id}`)]); }, [graph, updateInternals]);

  const fold = useCallback((g: GraphGroup) => {
    if (!readOnly) edit(withCollapsed(definition, g.id, !g.collapsed));
  }, [definition, edit, readOnly]);

  const nodes: Node[] = useMemo(() => {
    const folded = new Set(graph.groups.filter((g) => g.collapsed).flatMap((g) => g.members));
    const out: Node[] = [];
    for (const g of graph.groups) {
      const box = groupBoxOf(g, graph, positions);
      if (!box) continue;
      out.push({
        id: `group:${g.id}`, type: g.collapsed ? 'folded' : 'groupBox', position: { x: box.x, y: box.y },
        width: box.width, height: box.height, measured: measured[`group:${g.id}`], zIndex: g.collapsed ? 0 : -1, selectable: false, draggable: !readOnly,
        dragHandle: '.graph-group-head', style: g.collapsed ? undefined : { pointerEvents: 'none' },
        data: { group: g, count: box.members.length, wiresOut: box.wiresOut, onFold: () => fold(g), readOnly } satisfies BoxData,
      });
    }
    for (const n of graph.nodes) {
      out.push({
        id: n.id, type: n.kind, position: positions[n.id] ?? { x: 0, y: 0 }, width: n.width, height: n.height, measured: measured[n.id],
        hidden: folded.has(n.id), draggable: !readOnly, selectable: false, data: { node: n, values } satisfies NodeData,
        style: n.id === picked?.id ? { outline: '2px solid var(--cyan)', outlineOffset: 3 } : undefined,
      });
    }
    return out;
  }, [graph, positions, values, readOnly, fold, measured, picked]);

  const edges: Edge[] = useMemo(() => shownWires(graph).map((w) => ({
    id: w.id, source: w.source, target: w.target, sourceHandle: w.sourceHandle, targetHandle: w.targetHandle,
    type: w.kind === 'note' ? 'straight' : 'wire', selectable: false, focusable: false,
    data: { lane: Math.max(0, graph.nodes.find((n) => n.id === w.to)?.inputs.findIndex((i) => i.key === w.input) ?? 0) },
    style: { ...EDGE_STYLE[w.kind], ...(w.alt && w.kind !== 'gate' ? { strokeDasharray: '5 4', opacity: 0.4 } : {}) },
  })), [graph]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sizes = changes.filter((c): c is Extract<NodeChange, { type: 'dimensions' }> => c.type === 'dimensions' && !!c.dimensions);
    if (sizes.length) setMeasured((was) => ({ ...was, ...Object.fromEntries(sizes.map((c) => [c.id, c.dimensions!])) }));
    if (!changes.some((c) => c.type === 'position')) return;
    setDragged((before) => {
      const prev = { ...saved, ...before };
      let next = before;
      for (const c of changes) {
        if (c.type !== 'position' || !c.position) continue;
        if (c.id.startsWith('group:')) {
          const g = graph.groups.find((x) => `group:${x.id}` === c.id);
          if (!g) continue;
          if (!grabbed.current) {
            const box = groupBoxOf(g, graph, prev);
            if (!box) continue;
            grabbed.current = { box: { x: box.x, y: box.y }, members: Object.fromEntries(box.members.map((m) => [m, prev[m]])) };
          }
          const dx = snap(c.position.x - grabbed.current.box.x);
          const dy = snap(c.position.y - grabbed.current.box.y);
          next = { ...next };
          for (const [m, p] of Object.entries(grabbed.current.members)) next[m] = { x: p.x + dx, y: p.y + dy };
        } else {
          next = { ...next, [c.id]: { x: snap(c.position.x), y: snap(c.position.y) } };
        }
      }
      latest.current = next;
      return next;
    });
  }, [graph, saved]);

  const flow = useReactFlow();
  // Opened: all of it if that can be read, otherwise its top left at a zoom that can, the
  // minimap showing the rest. Once, when React Flow has measured the nodes.
  const opened = useRef(false);
  const measuredAll = useNodesInitialized();
  useEffect(() => {
    if (!measuredAll || opened.current) return;
    opened.current = true;
    const shown = flow.getNodes().filter((n) => !n.hidden);
    if (!shown.length) return;
    const bounds = flow.getNodesBounds(shown);
    const pane = document.querySelector('[data-testid="graph-map"]')?.getBoundingClientRect();
    const fits = pane ? Math.min(pane.width / (bounds.width * 1.1), pane.height / (bounds.height * 1.1), 1) : 1;
    if (fits >= OPENING_ZOOM) void flow.fitView({ padding: 0.1, maxZoom: 1 });
    else void flow.setViewport({ x: 24 - bounds.x * OPENING_ZOOM, y: 24 - bounds.y * OPENING_ZOOM, zoom: OPENING_ZOOM });
  }, [measuredAll, flow]);

  const tidy = useCallback(() => {
    edit(withPositions(definition, graph, layoutOf(graph)));
    requestAnimationFrame(() => { void flow.fitView({ padding: 0.1, maxZoom: 1 }); });
  }, [definition, edit, graph, flow]);

  /** The map slid just enough that a node the panel opened over is in view again. */
  const keepInView = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      const area = document.querySelector('[data-testid="graph-map"]')?.getBoundingClientRect();
      if (!node || !area || node.right <= area.right - 16) return;
      const vp = flow.getViewport();
      void flow.setViewport({ ...vp, x: vp.x - (node.right - area.right + 40) }, { duration: 200 });
    });
  }, [flow]);

  const onNodeDragStop = useCallback(() => {
    grabbed.current = null;
    const moves = latest.current;
    latest.current = {};
    setDragged({});
    if (readOnly) return;
    // Only a real move is saved: a click on a node ends a "drag" too, and saving then would pin
    // every node where auto-layout happened to put it.
    const moved = Object.entries(moves).some(([id, p]) => !saved[id] || saved[id].x !== p.x || saved[id].y !== p.y);
    if (moved) edit(withPositions(definition, graph, moves));
  }, [definition, edit, graph, readOnly, saved]);

  return (
    <div data-testid="graph-view" onKeyDown={(e) => { if (e.key === 'Escape' && picked) setSelected(null); }} style={{
      display: 'flex', width: '100%', height: '100%',
      ['--xy-background-color' as string]: GROUND.base,
      ['--xy-minimap-background-color' as string]: GROUND.base,
      ['--xy-handle-border-color' as string]: GROUND.base,
    }}>
      <div data-testid="graph-map" style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%' }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, n) => { if (!n.id.startsWith('group:')) { setSelected(n.id); keepInView(n.id); } }}
        onPaneClick={() => setSelected(null)}
        nodesConnectable={false} elementsSelectable={false} deleteKeyCode={null}
        panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false}
        minZoom={0.1} maxZoom={4}
        attributionPosition="top-left"
        colorMode="dark"
      >
        <Background id="cells" variant={BackgroundVariant.Lines} gap={GRID} color={GROUND.cell} bgColor={GROUND.base} />
        <Background id="major" variant={BackgroundVariant.Lines} gap={GRID * 5} color={GROUND.major} />
        <MiniMap pannable zoomable ariaLabel="Map overview"
          nodeColor={(n) => (n.type === 'rule' ? 'var(--cyan)' : n.type === 'groupBox' ? 'transparent' : 'var(--green)')}
          nodeStrokeColor={(n) => (n.type === 'groupBox' ? 'var(--dark-green)' : 'transparent')}
          maskColor="rgba(0, 0, 0, 0.55)" style={{ background: GROUND.base, border: '1px solid var(--dark-green)', bottom: 24 }} />
        <Toolbar onTidy={readOnly ? undefined : tidy} />
      </ReactFlow>
      <StatusLine graph={graph} definition={definition} />
      </div>
      {picked && (
        <GraphPanel definition={definition} edit={edit} node={picked} preview={preview} tried={tried}
          onClose={() => setSelected(null)} onGoTo={onGoTo} />
      )}
    </div>
  );
}

/** The map, with React Flow's state for it. */
export function GraphView(props: Props) {
  return <ReactFlowProvider><GraphMap {...props} /></ReactFlowProvider>;
}
