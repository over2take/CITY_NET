import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { statGroups, allStats, tableList, formulaList, withoutFormula, withFormula, withAlternative } from '../sheets/statsRules';
import { modifiersIn, withModifierNumber } from '../sheets/modifiers';
import { houseRuleList } from '../sheets/houseRules';
import type { GraphNode } from '../sheets/graphModel';
import { notesOf, pinChoices, withNoteText, withNotePinned, withoutNote, NOTE_MAX } from '../sheets/graphNotes';
import type { Tried } from '../hooks/usePreviewValues';
import { useFormulaInsert } from '../hooks/useFormulaInsert';
import { GroupSection, TableSection, FormulaName, FormulaBody, InsertChips } from './statsRulesFields';
import { small, why, btn, field } from './statsRulesStyles';

// The graph view's node panel (5a3b2; approved mockup docs/mockups/builder-graph.html, 2026-10-17:
// "the panel is the same form as FORMS"). The node picked on the map, edited with the very controls
// FORMS lays out (statsRulesFields), through the same `edit`: a stats list as its group's section,
// with the modifiers its table gives; a formula's name, text, INSERT, value and alternative; a
// table's rows and TRY IT. A house rule is made on HOUSE RULES, so it says what it is and goes
// there; a note (5b5) is written here, pinned to a node or to nothing, and removed.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  node: GraphNode;
  preview: Tried | null;
  tried: Record<string, Tried>;
  onClose: () => void;
  onGoTo?: (page: BuilderPage) => void;
  /** The house rules TRY ON THE MAP has on (5b6c), which the values here are worked out with. */
  trying?: Set<string>;
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

/** A note: its words, what it is pinned to, and REMOVE. */
function NoteForm({ definition, edit, node }: { definition: Definition; edit: (next: Definition) => void; node: GraphNode }) {
  const id = node.id.slice('note:'.length);
  const note = notesOf(definition).find((n) => n.id === id);
  if (!note) return null;
  const choices = pinChoices(definition);
  // Pinned to a stat (a file written by hand): the list that shows it.
  const on = choices.some((c) => c.id === note.on) ? note.on! : node.on ?? '';
  return (
    <div data-testid={`panel-note-${id}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={small}>NOTE · {note.text.length} / {NOTE_MAX}</span>
        <textarea aria-label="Note" value={note.text} maxLength={NOTE_MAX} rows={6}
          style={{ ...field, width: '100%', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace' }}
          onChange={(e) => edit(withNoteText(definition, id, e.target.value))} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={small}>PINNED TO</span>
        <select aria-label="Pinned to" value={on} style={{ ...field, width: '100%' }}
          onChange={(e) => edit(withNotePinned(definition, id, e.target.value || null))}>
          <option value="">NOTHING</option>
          {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <p style={{ ...why, margin: 0 }}>Only you see notes. FORMS shows this one under what it is pinned to. Drag its square dot onto a node to pin it there; cut its line to unpin it.</p>
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withoutNote(definition, id))}>REMOVE NOTE</button></div>
    </div>
  );
}

/** A formula as FORMULAS shows it, laid out down the panel: name, text, = value, alternative. */
function FormulaForm({ definition, edit, id, preview, tried, insert, trying }: Omit<Props, 'node' | 'onClose' | 'onGoTo'> & { id: string; insert: ReturnType<typeof useFormulaInsert> }) {
  const f = formulaList(definition).find((x) => x.id === id);
  if (!f) return null;
  const value = preview?.values[f.id];
  const rule = f.alternative && trying?.has(f.alternative.rule) ? houseRuleList(definition).find((r) => r.id === f.alternative!.rule) : undefined;
  return (
    <div data-testid={`panel-formula-${f.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FormulaName definition={definition} edit={edit} f={f} />
      <FormulaBody definition={definition} edit={edit} f={f} problem={preview?.problems[f.id]} tried={tried} bind={(box) => insert.bind(f.id, box)} />
      <OnTheWayIn definition={definition} edit={edit} id={f.id} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 8 }}>
        <span style={small}>ON THE SAMPLE{rule ? `, WITH ${(rule.name || rule.id).toUpperCase()} (TRYING)` : ''}</span>
        <b data-testid={`panel-value-${f.id}`} style={{ color: 'var(--cyan)', fontSize: 15 }}>{value !== undefined ? `= ${value}` : '·'}</b>
      </div>
    </div>
  );
}

export function GraphPanel({ definition, edit, node, preview, tried, onClose, onGoTo, trying }: Props) {
  const insert = useFormulaInsert(definition, edit);
  const formulaIds = node.kind === 'formula' || node.kind === 'condition' ? [node.id]
    : node.kind === 'list' ? (node.rows ?? []).map((r) => r.mod).filter((m): m is string => !!m) : [];
  // A note is named by what it is pinned to.
  const pinned = node.kind === 'note' ? pinChoices(definition).find((c) => c.id === node.on) : undefined;
  const title = node.kind === 'note' ? (pinned ? `ON ${pinned.label}` : 'NOT PINNED') : node.label;
  let body: React.ReactNode;
  if (node.kind === 'list') {
    const group = statGroups(definition).find((g) => g.id === node.id);
    body = group && (
      <>
        <div style={{ overflowX: 'auto' }}><GroupSection definition={definition} edit={edit} group={group} /></div>
        {formulaIds.length > 0 && (
          <>
            <span style={small}>MODIFIERS · FROM {node.via?.label}</span>
            {formulaIds.map((id) => <FormulaForm key={id} definition={definition} edit={edit} id={id} preview={preview} tried={tried} insert={insert} trying={trying} />)}
          </>
        )}
      </>
    );
  } else if (node.kind === 'formula' || node.kind === 'condition') {
    body = (
      <>
        <FormulaForm definition={definition} edit={edit} id={node.id} preview={preview} tried={tried} insert={insert} trying={trying} />
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
        <p style={{ ...why, margin: 0 }}>TRY ON THE MAP, on its node, changes only the numbers here, never the game. The GM switches it for the table in the GAME tab.</p>
        {onGoTo && <div><button type="button" className="utility-btn" style={btn} onClick={() => onGoTo('house_rules')}>GO TO HOUSE RULES</button></div>}
      </>
    );
  } else {
    body = <NoteForm definition={definition} edit={edit} node={node} />;
  }

  return (
    <aside data-testid="graph-panel" aria-label={`${KIND[node.kind]} ${title}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      // textAlign: the page around the builder centres text; the panel reads from the left, as FORMS does.
      style={{ width: 460, flexShrink: 0, boxSizing: 'border-box', borderLeft: '1px solid var(--green)', background: 'var(--black)', display: 'flex', flexDirection: 'column', minHeight: 0, fontFamily: 'monospace', textAlign: 'left' }}>
      <div style={{ height: 40, flexShrink: 0, padding: '0 8px 0 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--dark-green)' }}>
        <span style={{ fontSize: 10, letterSpacing: 1, color: 'var(--cyan)' }}>{KIND[node.kind]}</span>
        <b style={{ flex: 1, minWidth: 0, color: 'var(--green)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
        <button type="button" className="utility-btn" style={btn} aria-label="Close the panel" data-browse onClick={onClose}>×</button>
      </div>
      <div className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        {node.kind !== 'note' && <p style={{ ...why, margin: 0, fontSize: 11 }}>The same boxes as FORMS: a change here is a change there.</p>}
        {body}
        {formulaIds.length > 0 && (
          <div style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <InsertChips definition={definition} active={insert.active} onInsert={insert.insert} />
          </div>
        )}
      </div>
    </aside>
  );
}
