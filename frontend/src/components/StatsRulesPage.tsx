import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  statGroups, withNewGroup, tableList, withNewTable, formulaList, withNewFormula, withNewCondition, withoutFormula,
} from '../sheets/statsRules';
import { notesOn } from '../sheets/graphNotes';
import { RollsTab } from './RollsTab';
import { DiceTab } from './DiceTab';
import { groupOf } from '../sheets/graphGroups';
import { useFormulaInsert } from '../hooks/useFormulaInsert';
import { usePreviewValues } from '../hooks/usePreviewValues';
import { HINTS } from '../sheets/builderHelp';
import { ColumnHead } from './HelpHint';
import { GroupSection, TableSection, FormulaName, FormulaBody, InsertChips } from './statsRulesFields';
import { why, btn, th, td } from './statsRulesStyles';

// The builder's STATS & RULES page (4b2d): the numbers players fill in (STATS) and the lookup
// tables formulas read (TABLES), with FORMULAS between them (approved mockup
// docs/mockups/builder-stats-rules.html, 2026-10-06). STATS are in groups, each shown as a section
// of the starter sheet; skills are a group whose stats may tie to an ability; the SAMPLE column is a
// made-up character for checking formulas, saved with the draft. What it reads and writes is
// sheets/statsRules.ts; every change goes through the builder's `edit`, which autosaves it. The
// controls themselves are statsRulesFields.tsx, shared with the graph view's node panel. Notes are
// made on the graph view (5b5); here they show, read only, under what they are pinned to, as do
// the map's own groups under each formula in them (5c2).

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the live values (FORMULAS); without it the tab shows no values. */
  api?: ReturnType<typeof systemsApi>;
  /** EDIT IN GRAPH on a note or a map group: the map, opened on it. */
  onEditInGraph?: (node: string) => void;
  /** Open a HELP topic, by id (the ROLLS tab's WHO SEES THE TARGET, 6c4h). */
  onHelp?: (topic: string) => void;
}

type Tab = 'stats' | 'formulas' | 'tables' | 'dice' | 'rolls';

export { PREVIEW_DELAY_MS } from '../hooks/usePreviewValues';

const tabStyle = (on: boolean): React.CSSProperties => ({
  background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', border: 0, borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
  color: on ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '7px 14px', cursor: 'pointer',
});

/** The notes pinned to an entry (a stats group, a formula, `table:<id>`), read only, each with EDIT IN GRAPH. */
function PinnedNotes({ definition, on, onEditInGraph }: { definition: Definition; on: string; onEditInGraph?: (node: string) => void }) {
  const notes = notesOn(definition, on);
  if (!notes.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '2px 0 8px' }}>
      {notes.map((n) => (
        <div key={n.id} data-testid={`forms-note-${n.id}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 10px', border: '1px dashed color-mix(in srgb, var(--text) 50%, transparent)', fontFamily: 'monospace', fontSize: 12 }}>
          <span style={{ fontSize: 10, letterSpacing: 1, opacity: 0.7, paddingTop: 1 }}>NOTE</span>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{n.text}</span>
          {onEditInGraph && <button type="button" className="utility-btn" style={btn} onClick={() => onEditInGraph(`note:${n.id}`)}>EDIT IN GRAPH</button>}
        </div>
      ))}
    </div>
  );
}

function StatsTab({ definition, edit, onEditInGraph }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        The numbers players fill in on their sheet. Each group becomes a section of the starter sheet. The SAMPLE column is a made-up character to check formulas with.
      </p>
      {statGroups(definition).map((g) => (
        <React.Fragment key={g.id}>
          <GroupSection definition={definition} edit={edit} group={g} />
          <PinnedNotes definition={definition} on={g.id} onEditInGraph={onEditInGraph} />
        </React.Fragment>
      ))}
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewGroup(definition))}>+ GROUP</button></div>
    </div>
  );
}

function TablesTab({ definition, edit, onEditInGraph }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        Tables a formula reads by name, like an ability score to its modifier: mod(@str). Read top to bottom: the first row the number isn't above gives the answer.
      </p>
      {tableList(definition).map((t) => (
        <React.Fragment key={t.id}>
          <TableSection definition={definition} edit={edit} table={t} />
          <PinnedNotes definition={definition} on={`table:${t.id}`} onEditInGraph={onEditInGraph} />
        </React.Fragment>
      ))}
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewTable(definition))}>+ TABLE</button></div>
    </div>
  );
}

/**
 * FORMULAS: each formula's name and text, its value for the sample character a moment after
 * typing stops (worked out by the server, POST /api/systems/preview-values, so it is the game's own
 * engine), its mistake under it, and which formulas read it; INSERT puts a name at the cursor.
 */
function FormulasTab({ definition, edit, api, onEditInGraph }: Props) {
  const formulas = formulaList(definition);
  const { preview, tried } = usePreviewValues(definition, api);
  const insert = useFormulaInsert(definition, edit);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 230px', gap: 16, alignItems: 'start' }}>
      <div>
        <p style={{ ...why, margin: '0 0 10px', maxWidth: '68ch' }}>
          Values worked out from stats, tables and each other, written the way a rulebook says them. The value on the right is the sample character's.
        </p>
        {formulas.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <ColumnHead style={{ ...th, width: 190 }}>NAME</ColumnHead><ColumnHead style={th} hint={HINTS['rules.formula']}>FORMULA</ColumnHead>
              <ColumnHead style={{ ...th, width: 60, textAlign: 'right' }} hint={HINTS['rules.value']}>VALUE</ColumnHead><ColumnHead style={th} />
            </tr></thead>
            <tbody>
              {formulas.map((f) => {
                const value = preview?.values[f.id];
                const pinned = notesOn(definition, f.id).length > 0;
                const group = groupOf(definition, f.id);
                return (
                  <React.Fragment key={f.id}>
                    <tr data-testid={`formula-${f.id}`}>
                      <td style={td}><FormulaName definition={definition} edit={edit} f={f} /></td>
                      <td style={td}>
                        <FormulaBody definition={definition} edit={edit} f={f} problem={preview?.problems[f.id]} tried={tried} bind={(box) => insert.bind(f.id, box)} />
                      </td>
                      <td data-testid={`value-${f.id}`} style={{ ...td, textAlign: 'right', color: 'var(--cyan)', fontSize: 13 }}>
                        {value !== undefined ? value : '·'}
                      </td>
                      <td style={td}><button type="button" className="utility-btn" style={btn} aria-label={`Remove ${f.label || f.id}`}
                        onClick={() => edit(withoutFormula(definition, f.id))}>×</button></td>
                    </tr>
                    {group && (
                      <tr><td colSpan={4} style={{ padding: '0 0 6px 8px' }}>
                        <div data-testid={`forms-group-${f.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: 'monospace', fontSize: 12 }}>
                          <span style={{ fontSize: 10, letterSpacing: 1, opacity: 0.7 }}>MAP GROUP</span>
                          <span style={{ flex: 1, minWidth: 0 }}>{group.label}</span>
                          {onEditInGraph && <button type="button" className="utility-btn" style={btn} aria-label={`Edit ${group.label} in graph`} onClick={() => onEditInGraph(`group:${group.id}`)}>EDIT IN GRAPH</button>}
                        </div>
                      </td></tr>
                    )}
                    {pinned && <tr><td colSpan={4} style={{ padding: '0 0 0 8px' }}><PinnedNotes definition={definition} on={f.id} onEditInGraph={onEditInGraph} /></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ padding: '8px 0' }}>
          <button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewFormula(definition))}>+ FORMULA</button>{' '}
          <button type="button" className="utility-btn" style={btn} title="IF something THEN one number ELSE another" onClick={() => edit(withNewCondition(definition))}>+ CONDITION</button>
        </div>
      </div>
      <aside aria-label="Insert" style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <InsertChips definition={definition} active={insert.active} onInsert={insert.insert} />
      </aside>
    </div>
  );
}

export function StatsRulesPage({ definition, edit, api, onEditInGraph, onHelp }: Props) {
  const [tab, setTab] = useState<Tab>('stats');
  const tabs: [Tab, string][] = [['stats', 'STATS'], ['formulas', 'FORMULAS'], ['tables', 'TABLES'], ['dice', 'DICE'], ['rolls', 'ROLLS']];
  return (
    <div style={{ maxWidth: 1000 }}>
      <div role="tablist" aria-label="Stats and rules" style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)', marginBottom: 14 }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'stats' && <StatsTab definition={definition} edit={edit} onEditInGraph={onEditInGraph} />}
      {tab === 'formulas' && <FormulasTab definition={definition} edit={edit} api={api} onEditInGraph={onEditInGraph} />}
      {tab === 'tables' && <TablesTab definition={definition} edit={edit} onEditInGraph={onEditInGraph} />}
      {tab === 'dice' && <DiceTab definition={definition} edit={edit} api={api} />}
      {tab === 'rolls' && <RollsTab definition={definition} edit={edit} api={api} onHelp={onHelp} />}
    </div>
  );
}
