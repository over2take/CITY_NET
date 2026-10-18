import React, { useRef, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  statGroups, withNewGroup, tableList, withNewTable, formulaList, withNewFormula, withFormula, withoutFormula, insertToken,
} from '../sheets/statsRules';
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
// controls themselves are statsRulesFields.tsx, shared with the graph view's node panel.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the live values (FORMULAS); without it the tab shows no values. */
  api?: ReturnType<typeof systemsApi>;
}

type Tab = 'stats' | 'formulas' | 'tables';

export { PREVIEW_DELAY_MS } from '../hooks/usePreviewValues';

const tabStyle = (on: boolean): React.CSSProperties => ({
  background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', border: 0, borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
  color: on ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '7px 14px', cursor: 'pointer',
});

function StatsTab({ definition, edit }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        The numbers players fill in on their sheet. Each group becomes a section of the starter sheet. The SAMPLE column is a made-up character to check formulas with.
      </p>
      {statGroups(definition).map((g) => <GroupSection key={g.id} definition={definition} edit={edit} group={g} />)}
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewGroup(definition))}>+ GROUP</button></div>
    </div>
  );
}

function TablesTab({ definition, edit }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        Tables a formula reads by name, like an ability score to its modifier: mod(@str). Read top to bottom: the first row the number isn't above gives the answer.
      </p>
      {tableList(definition).map((t) => <TableSection key={t.id} definition={definition} edit={edit} table={t} />)}
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewTable(definition))}>+ TABLE</button></div>
    </div>
  );
}

/**
 * FORMULAS: each formula's name and text, its value for the sample character a moment after
 * typing stops (worked out by the server, POST /api/systems/preview-values, so it is the game's own
 * engine), its mistake under it, and which formulas read it; INSERT puts a name at the cursor.
 */
function FormulasTab({ definition, edit, api }: Props) {
  const formulas = formulaList(definition);
  const { preview, tried } = usePreviewValues(definition, api);
  const [cursor, setCursor] = useState<{ id: string; at: number } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const insert = (token: string) => {
    if (!cursor) return;
    const f = formulas.find((x) => x.id === cursor.id);
    if (!f) return;
    const next = insertToken(f.formula ?? '', cursor.at, token);
    edit(withFormula(definition, f.id, { formula: next.text }));
    setCursor({ id: f.id, at: next.cursor });
    requestAnimationFrame(() => { const el = inputs.current[f.id]; if (el) { el.focus(); el.setSelectionRange(next.cursor, next.cursor); } });
  };

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
                return (
                  <tr key={f.id} data-testid={`formula-${f.id}`}>
                    <td style={td}><FormulaName definition={definition} edit={edit} f={f} /></td>
                    <td style={td}>
                      <FormulaBody definition={definition} edit={edit} f={f} problem={preview?.problems[f.id]} tried={tried}
                        inputRef={(el) => { inputs.current[f.id] = el; }} onCursor={(at) => setCursor({ id: f.id, at })} />
                    </td>
                    <td data-testid={`value-${f.id}`} style={{ ...td, textAlign: 'right', color: 'var(--cyan)', fontSize: 13 }}>
                      {value !== undefined ? value : '·'}
                    </td>
                    <td style={td}><button type="button" className="utility-btn" style={btn} aria-label={`Remove ${f.label || f.id}`}
                      onClick={() => edit(withoutFormula(definition, f.id))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ padding: '8px 0' }}>
          <button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewFormula(definition))}>+ FORMULA</button>
        </div>
      </div>
      <aside aria-label="Insert" style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <InsertChips definition={definition} active={!!cursor} onInsert={insert} />
      </aside>
    </div>
  );
}

export function StatsRulesPage({ definition, edit, api }: Props) {
  const [tab, setTab] = useState<Tab>('stats');
  const tabs: [Tab, string][] = [['stats', 'STATS'], ['formulas', 'FORMULAS'], ['tables', 'TABLES']];
  return (
    <div style={{ maxWidth: 1000 }}>
      <div role="tablist" aria-label="Stats and rules" style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)', marginBottom: 14 }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'stats' && <StatsTab definition={definition} edit={edit} />}
      {tab === 'formulas' && <FormulasTab definition={definition} edit={edit} api={api} />}
      {tab === 'tables' && <TablesTab definition={definition} edit={edit} />}
    </div>
  );
}
