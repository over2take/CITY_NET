import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { statGroups, allStats, tableList, formulaList, withoutFormula, withFormula, withAlternative } from '../sheets/statsRules';
import { modifiersIn, withModifierNumber } from '../sheets/modifiers';
import { houseRuleList } from '../sheets/houseRules';
import type { GraphNode } from '../sheets/graphModel';
import type { Tried } from '../hooks/usePreviewValues';
import { useFormulaInsert } from '../hooks/useFormulaInsert';
import { GroupSection, TableSection, FormulaName, FormulaBody, InsertChips } from './statsRulesFields';
import { small, why, btn, field } from './statsRulesStyles';

// The graph view's node panel (5a3b2; approved mockup docs/mockups/builder-graph.html, 2026-10-17:
// "the panel is the same form as FORMS"). The node picked on the map, edited with the very controls
// FORMS lays out (statsRulesFields), through the same `edit`: a stats list as its group's section,
// with the modifiers its table gives; a formula's name, text, INSERT, value and alternative; a
// table's rows and TRY IT. A house rule is made on HOUSE RULES, so it says what it is and goes
// there; a note is read here, and written on the map with 5b.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  node: GraphNode;
  preview: Tried | null;
  tried: Record<string, Tried>;
  onClose: () => void;
  onGoTo?: (page: BuilderPage) => void;
}

const KIND: Record<GraphNode['kind'], string> = { list: 'STATS', table: 'TABLE', formula: 'FORMULA', condition: 'CONDITION', rule: 'HOUSE RULE', note: 'NOTE' };

/**
 * ON THE WAY IN (5b3): the diamonds on a formula's wires, each number changeable, which rewrites
 * the formula's text (and its WITH-rule formula's) as typing it would.
 */
function OnTheWayIn({ definition, edit, id }: { definition: Definition; edit: (next: Definition) => void; id: string }) {
  const f = formulaList(definition).find((x) => x.id === id);
  if (!f || (f as { kind?: string }).kind === 'condition') return null;
  const name = (n: string) => (allStats(definition).find((s) => s.id === n)?.label || formulaList(definition).find((x) => x.id === n)?.label || n).toUpperCase();
  const rows = [
    ...modifiersIn(f.formula ?? '').map((m) => ({ m, alt: false })),
    ...(f.alternative ? modifiersIn(f.alternative.formula).map((m) => ({ m, alt: true })) : []),
  ];
  if (!rows.length) return null;
  const change = (alt: boolean, n: string, value: string) => {
    const text = alt ? f.alternative!.formula : f.formula ?? '';
    const next = withModifierNumber(text, n, Number(value));
    if (next !== null) edit(alt ? withAlternative(definition, f.id, { formula: next }) : withFormula(definition, f.id, { formula: next }));
  };
  return (
    <div style={{ border: '1px solid var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={small}>ON THE WAY IN</span>
      {rows.map(({ m, alt }) => {
        const label = `${name(m.name)} ${m.words}${alt ? ' (WITH-rule formula)' : ''}`;
        return (
          <label key={`${alt}:${m.name}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 72px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span><b style={{ color: 'var(--cyan)' }}>{m.label}</b> {label}</span>
            <NumberBox label={label} value={m.n} onNumber={(v) => change(alt, m.name, v)} />
          </label>
        );
      })}
    </div>
  );
}

/** A number typed: kept as typed (an empty box while retyping), each number that will do applied, and the real one back when left. */
function NumberBox({ label, value, onNumber }: { label: string; value: number; onNumber: (v: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input type="number" min={0} step="any" aria-label={label} value={typed ?? String(value)} style={{ ...field, width: '100%' }}
      onChange={(e) => { setTyped(e.target.value); onNumber(e.target.value); }} onBlur={() => setTyped(null)} />
  );
}

/** A formula as FORMULAS shows it, laid out down the panel: name, text, = value, alternative. */
function FormulaForm({ definition, edit, id, preview, tried, insert }: Omit<Props, 'node' | 'onClose' | 'onGoTo'> & { id: string; insert: ReturnType<typeof useFormulaInsert> }) {
  const f = formulaList(definition).find((x) => x.id === id);
  if (!f) return null;
  const value = preview?.values[f.id];
  return (
    <div data-testid={`panel-formula-${f.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FormulaName definition={definition} edit={edit} f={f} />
      <FormulaBody definition={definition} edit={edit} f={f} problem={preview?.problems[f.id]} tried={tried} {...insert.bind(f.id)} />
      <OnTheWayIn definition={definition} edit={edit} id={f.id} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 8 }}>
        <span style={small}>ON THE SAMPLE</span>
        <b data-testid={`panel-value-${f.id}`} style={{ color: 'var(--cyan)', fontSize: 15 }}>{value !== undefined ? `= ${value}` : '·'}</b>
      </div>
    </div>
  );
}

export function GraphPanel({ definition, edit, node, preview, tried, onClose, onGoTo }: Props) {
  const insert = useFormulaInsert(definition, edit);
  const formulaIds = node.kind === 'formula' || node.kind === 'condition' ? [node.id]
    : node.kind === 'list' ? (node.rows ?? []).map((r) => r.mod).filter((m): m is string => !!m) : [];
  let body: React.ReactNode;
  if (node.kind === 'list') {
    const group = statGroups(definition).find((g) => g.id === node.id);
    body = group && (
      <>
        <div style={{ overflowX: 'auto' }}><GroupSection definition={definition} edit={edit} group={group} /></div>
        {formulaIds.length > 0 && (
          <>
            <span style={small}>MODIFIERS · FROM {node.via?.label}</span>
            {formulaIds.map((id) => <FormulaForm key={id} definition={definition} edit={edit} id={id} preview={preview} tried={tried} insert={insert} />)}
          </>
        )}
      </>
    );
  } else if (node.kind === 'formula' || node.kind === 'condition') {
    body = (
      <>
        <FormulaForm definition={definition} edit={edit} id={node.id} preview={preview} tried={tried} insert={insert} />
        <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withoutFormula(definition, node.id))}>REMOVE {node.kind === 'condition' ? 'CONDITION' : 'FORMULA'}</button></div>
      </>
    );
  } else if (node.kind === 'table') {
    const table = tableList(definition).find((t) => `table:${t.id}` === node.id);
    body = table && <TableSection definition={definition} edit={edit} table={table} />;
  } else if (node.kind === 'rule') {
    const rule = houseRuleList(definition).find((r) => `rule:${r.id}` === node.id);
    body = rule && (
      <>
        <p style={{ ...why, margin: 0 }}>{rule.description || 'No description yet.'}</p>
        <p style={{ ...why, margin: 0 }}>The formulas wired to it are worked out by their WITH {node.label} formula while the table has it on.{node.also?.length ? ' Also under it:' : ''}</p>
        {(node.also ?? []).map((a) => <span key={a} style={{ fontSize: 12 }}>· {a}</span>)}
        {onGoTo && <div><button type="button" className="utility-btn" style={btn} onClick={() => onGoTo('house_rules')}>GO TO HOUSE RULES</button></div>}
      </>
    );
  } else {
    body = (
      <>
        <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{node.text}</p>
        <p style={{ ...why, margin: 0 }}>Notes are written and moved on the map itself, coming next.</p>
      </>
    );
  }

  return (
    <aside data-testid="graph-panel" aria-label={`${KIND[node.kind]} ${node.label}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      // textAlign: the page around the builder centres text; the panel reads from the left, as FORMS does.
      style={{ width: 460, flexShrink: 0, boxSizing: 'border-box', borderLeft: '1px solid var(--green)', background: 'var(--black)', display: 'flex', flexDirection: 'column', minHeight: 0, fontFamily: 'monospace', textAlign: 'left' }}>
      <div style={{ height: 40, flexShrink: 0, padding: '0 8px 0 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--dark-green)' }}>
        <span style={{ fontSize: 10, letterSpacing: 1, color: 'var(--cyan)' }}>{KIND[node.kind]}</span>
        <b style={{ flex: 1, minWidth: 0, color: 'var(--green)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</b>
        <button type="button" className="utility-btn" style={btn} aria-label="Close the panel" data-browse onClick={onClose}>×</button>
      </div>
      <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        <p style={{ ...why, margin: 0, fontSize: 11 }}>The same boxes as FORMS: a change here is a change there.</p>
        {body}
        {formulaIds.length > 0 && node.kind !== 'condition' && (
          <div style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InsertChips definition={definition} active={insert.active} onInsert={insert.insert} />
          </div>
        )}
      </div>
    </aside>
  );
}
