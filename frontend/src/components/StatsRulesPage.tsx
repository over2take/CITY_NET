import React, { useEffect, useRef, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  statGroups, allStats, withNewGroup, withGroupLabel, withoutGroup, withNewStat, withStat, withoutStat, sampleOf, withSample,
  tableList, withNewTable, withTableLabel, withoutTable, withBands, lookupIn,
  formulaList, withNewFormula, withFormula, withoutFormula, usedBy, problemsByFormula, insertToken, FUNCTIONS,
} from '../sheets/statsRules';

// The builder's STATS & RULES page (4b2d): the numbers players fill in (STATS) and the lookup
// tables formulas read (TABLES), with FORMULAS between them (approved mockup
// docs/mockups/builder-stats-rules.html, 2026-10-06). STATS are in groups, each shown as a section
// of the starter sheet; skills are a group whose stats may tie to an ability; the SAMPLE column is a
// made-up character for checking formulas, saved with the draft. What it reads and writes is
// sheets/statsRules.ts; every change goes through the builder's `edit`, which autosaves it.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the live values (FORMULAS); without it the tab shows no values. */
  api?: ReturnType<typeof systemsApi>;
}

type Tab = 'stats' | 'formulas' | 'tables';

/** How long after the last keystroke the live values are asked for. */
export const PREVIEW_DELAY_MS = 400;

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const field: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px', minWidth: 0, boxSizing: 'border-box',
};
const th: React.CSSProperties = { textAlign: 'left', ...small, fontWeight: 'normal', padding: '6px 8px 4px 10px' };
const td: React.CSSProperties = { padding: '3px 8px 3px 10px', verticalAlign: 'middle', borderTop: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)' };
const box: React.CSSProperties = { border: '1px solid var(--dark-green)', marginBottom: 12 };
const head: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)', background: 'color-mix(in srgb, var(--green) 8%, transparent)', flexWrap: 'wrap' };
const tabStyle = (on: boolean): React.CSSProperties => ({
  background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', border: 0, borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
  color: on ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '7px 14px', cursor: 'pointer',
});

/** A whole number box where empty means none (null). */
const wholeOrNone = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

function StatsTab({ definition, edit }: Props) {
  const groups = statGroups(definition);
  const abilities = groups[0]?.stats ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        The numbers players fill in on their sheet. Each group becomes a section of the starter sheet. The SAMPLE column is a made-up character to check formulas with.
      </p>
      {groups.map((g) => (
        <section key={g.id} aria-label={`${g.label || g.id} stats`} style={box}>
          <div style={head}>
            <input type="text" aria-label="Group name" maxLength={40} value={g.label} style={{ ...field, width: 180 }}
              onChange={(e) => edit(withGroupLabel(definition, g.id, e.target.value))} />
            <span style={{ ...why, fontSize: 11 }}>{g.stats.length} stat{g.stats.length === 1 ? '' : 's'}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="utility-btn" style={btn} aria-label={`Remove the ${g.label || g.id} group`}
              onClick={() => edit(withoutGroup(definition, g.id))}>REMOVE GROUP</button>
          </div>
          {g.stats.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                <th scope="col" style={th}>NAME</th><th scope="col" style={th}>ID</th><th scope="col" style={th}>LOWEST</th><th scope="col" style={th}>HIGHEST</th>
                <th scope="col" style={th}>TIED TO</th><th scope="col" style={th}>SAMPLE</th><th scope="col" style={th} />
              </tr></thead>
              <tbody>
                {g.stats.map((s) => (
                  <tr key={s.id} data-testid={`stat-${s.id}`}>
                    <td style={td}><input type="text" aria-label={`${s.label || s.id} name`} maxLength={40} value={s.label} style={{ ...field, width: '100%' }}
                      onChange={(e) => edit(withStat(definition, s.id, { label: e.target.value }))} /></td>
                    <td style={{ ...td, fontSize: 11, opacity: 0.6 }}>@{s.id}</td>
                    <td style={td}><input type="number" aria-label={`${s.label} lowest`} value={s.min ?? ''} placeholder="none" style={{ ...field, width: 70 }}
                      onChange={(e) => edit(withStat(definition, s.id, { min: wholeOrNone(e.target.value) }))} /></td>
                    <td style={td}><input type="number" aria-label={`${s.label} highest`} value={s.max ?? ''} placeholder="none" style={{ ...field, width: 70 }}
                      onChange={(e) => edit(withStat(definition, s.id, { max: wholeOrNone(e.target.value) }))} /></td>
                    <td style={td}>
                      <select aria-label={`${s.label} tied to`} value={s.tie ?? ''} style={field}
                        onChange={(e) => edit(withStat(definition, s.id, { tie: e.target.value || null }))}>
                        <option value="">none</option>
                        {groups.flatMap((x) => x.stats).filter((o) => o.id !== s.id).map((o) => <option key={o.id} value={o.id}>{o.label || o.id}</option>)}
                      </select>
                    </td>
                    <td style={td}><input type="number" aria-label={`${s.label} sample`} value={sampleOf(definition, s.id) ?? ''} placeholder="0"
                      style={{ ...field, width: 70, borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
                      onChange={(e) => edit(withSample(definition, s.id, e.target.value.trim() === '' ? null : Number(e.target.value)))} /></td>
                    <td style={td}><button type="button" className="utility-btn" style={btn} aria-label={`Remove ${s.label || s.id}`}
                      onClick={() => edit(withoutStat(definition, s.id))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ padding: '6px 10px' }}>
            <button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewStat(definition, g.id))}>+ STAT</button>
            {g.stats.length === 0 && abilities.length === 0 && <span style={{ ...why, marginLeft: 8 }}>Abilities, skills, level: anything players write down as a number.</span>}
          </div>
        </section>
      ))}
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewGroup(definition))}>+ GROUP</button></div>
    </div>
  );
}

function TablesTab({ definition, edit }: Props) {
  const tables = tableList(definition);
  const [tests, setTests] = useState<Record<string, string>>({});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        Tables a formula reads by name, like an ability score to its modifier: mod(@str). Read top to bottom: the first row the number isn't above gives the answer.
      </p>
      {tables.map((t) => {
        const test = tests[t.id] ?? '10';
        return (
          <section key={t.id} aria-label={`${t.label || t.id} table`} style={box}>
            <div style={head}>
              <input type="text" aria-label="Table name" maxLength={40} value={t.label ?? ''} placeholder={t.id} style={{ ...field, width: 220 }}
                onChange={(e) => edit(withTableLabel(definition, t.id, e.target.value))} />
              <span style={{ fontSize: 11, opacity: 0.6 }}>{t.id}()</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="utility-btn" style={btn} aria-label={`Remove the ${t.label || t.id} table`}
                onClick={() => edit(withoutTable(definition, t.id))}>REMOVE TABLE</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 16, padding: '8px 10px', alignItems: 'start' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr><th scope="col" style={th}>UP TO</th><th scope="col" style={th}>GIVES</th><th scope="col" style={th} /></tr></thead>
                <tbody>
                  {t.bands.map((b, i) => {
                    const last = i === t.bands.length - 1;
                    return (
                      <tr key={i} data-testid={`band-${t.id}-${i}`}>
                        <td style={td}>{last
                          ? <span style={{ opacity: 0.6 }}>anything higher</span>
                          : <input type="number" aria-label={`Row ${i + 1} up to`} value={b.upTo ?? ''} style={{ ...field, width: 80 }}
                              onChange={(e) => edit(withBands(definition, t.id, { set: i, upTo: Number(e.target.value) }))} />}</td>
                        <td style={td}><input type="number" aria-label={`Row ${i + 1} gives`} value={b.value} style={{ ...field, width: 80 }}
                          onChange={(e) => edit(withBands(definition, t.id, { set: i, value: Number(e.target.value) }))} /></td>
                        <td style={td}>{!last && <button type="button" className="utility-btn" style={btn} aria-label={`Remove row ${i + 1}`}
                          onClick={() => edit(withBands(definition, t.id, { remove: i }))}>×</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ border: '1px solid var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={small}>TRY IT</span>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" aria-label={`Try ${t.label || t.id}`} value={test} style={{ ...field, width: 70 }}
                    onChange={(e) => setTests({ ...tests, [t.id]: e.target.value })} />
                  <span>→</span>
                  <b data-testid={`try-${t.id}`} style={{ color: 'var(--cyan)' }}>{lookupIn(t.bands, Number(test) || 0)}</b>
                </label>
              </div>
            </div>
            <div style={{ padding: '0 10px 8px' }}>
              <button type="button" className="utility-btn" style={btn} onClick={() => edit(withBands(definition, t.id, { add: true }))}>+ ROW</button>
            </div>
          </section>
        );
      })}
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
  const [preview, setPreview] = useState<{ values: Record<string, number>; problems: Record<string, string> } | null>(null);
  const [cursor, setCursor] = useState<{ id: string; at: number } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewValues(definition).then((r) => {
        if (live && r.ok) setPreview({ values: r.value.values, problems: problemsByFormula(r.value.problems) });
      });
    }, PREVIEW_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition]);

  const insert = (token: string) => {
    if (!cursor) return;
    const f = formulas.find((x) => x.id === cursor.id);
    if (!f) return;
    const next = insertToken(f.formula ?? '', cursor.at, token);
    edit(withFormula(definition, f.id, { formula: next.text }));
    setCursor({ id: f.id, at: next.cursor });
    requestAnimationFrame(() => { const el = inputs.current[f.id]; if (el) { el.focus(); el.setSelectionRange(next.cursor, next.cursor); } });
  };
  const chips = (title: string, tokens: string[]) => tokens.length > 0 && (
    <>
      <span style={{ ...small, opacity: 0.55 }}>{title}</span>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {tokens.map((t) => (
          <button key={t} type="button" disabled={!cursor} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t)}
            style={{ border: '1px solid var(--dark-green)', background: 'none', color: 'var(--green)', fontFamily: 'monospace', fontSize: 11, padding: '1px 6px', cursor: cursor ? 'pointer' : 'default' }}>{t}</button>
        ))}
      </div>
    </>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 230px', gap: 16, alignItems: 'start' }}>
      <div>
        <p style={{ ...why, margin: '0 0 10px', maxWidth: '68ch' }}>
          Values worked out from stats, tables and each other, written the way a rulebook says them. The value on the right is the sample character's.
        </p>
        {formulas.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <th scope="col" style={{ ...th, width: 190 }}>NAME</th><th scope="col" style={th}>FORMULA</th>
              <th scope="col" style={{ ...th, width: 60, textAlign: 'right' }}>VALUE</th><th scope="col" style={th} />
            </tr></thead>
            <tbody>
              {formulas.map((f) => {
                const problem = preview?.problems[f.id];
                const value = preview?.values[f.id];
                const users = usedBy(definition, f.id);
                const condition = (f as { kind?: string }).kind === 'condition';
                return (
                  <tr key={f.id} data-testid={`formula-${f.id}`}>
                    <td style={td}>
                      <input type="text" aria-label={`${f.label || f.id} name`} maxLength={40} value={f.label ?? ''} placeholder={f.id} style={{ ...field, width: '100%' }}
                        onChange={(e) => edit(withFormula(definition, f.id, { label: e.target.value }))} />
                      <div style={{ fontSize: 11, opacity: 0.6 }}>@{f.id}{users.length > 0 && ` · used by ${users.join(', ')}`}</div>
                    </td>
                    <td style={td}>
                      {condition
                        ? <span style={{ ...why, fontSize: 11 }}>A condition: if {(f as { when?: string }).when} then {(f as { then?: string }).then} else {(f as { else?: string }).else}. Edited in the node graph later.</span>
                        : <input ref={(el) => { inputs.current[f.id] = el; }} type="text" aria-label={`${f.label || f.id} formula`} maxLength={1000} value={f.formula ?? ''}
                            aria-invalid={problem ? true : undefined}
                            style={{ ...field, width: '100%', borderColor: problem ? 'var(--danger)' : 'var(--green)' }}
                            onChange={(e) => { edit(withFormula(definition, f.id, { formula: e.target.value })); setCursor({ id: f.id, at: e.target.selectionStart ?? e.target.value.length }); }}
                            onSelect={(e) => setCursor({ id: f.id, at: (e.target as HTMLInputElement).selectionStart ?? 0 })}
                            onFocus={(e) => setCursor({ id: f.id, at: e.target.selectionStart ?? e.target.value.length })} />}
                      {problem && <div role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1, fontSize: 11 }}>{problem}</div>}
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
        <span style={small}>INSERT</span>
        {chips('STATS', allStats(definition).map((s) => `@${s.id}`))}
        {chips('FORMULAS', formulas.map((f) => `@${f.id}`))}
        {chips('TABLES', tableList(definition).map((t) => `${t.id}()`))}
        {chips('FUNCTIONS', FUNCTIONS.map((fn) => `${fn}()`))}
        <span style={{ ...why, fontSize: 11 }}>{cursor ? 'Click one to put it at the cursor.' : 'Click in a formula first, then a name to put it there.'}</span>
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
