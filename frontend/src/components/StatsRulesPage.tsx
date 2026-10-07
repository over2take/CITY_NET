import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import {
  statGroups, withNewGroup, withGroupLabel, withoutGroup, withNewStat, withStat, withoutStat, sampleOf, withSample,
  tableList, withNewTable, withTableLabel, withoutTable, withBands, lookupIn,
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
}

type Tab = 'stats' | 'tables';

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

export function StatsRulesPage({ definition, edit }: Props) {
  const [tab, setTab] = useState<Tab>('stats');
  const tabs: [Tab, string][] = [['stats', 'STATS'], ['tables', 'TABLES']];
  return (
    <div style={{ maxWidth: 1000 }}>
      <div role="tablist" aria-label="Stats and rules" style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)', marginBottom: 14 }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'stats' && <StatsTab definition={definition} edit={edit} />}
      {tab === 'tables' && <TablesTab definition={definition} edit={edit} />}
    </div>
  );
}
