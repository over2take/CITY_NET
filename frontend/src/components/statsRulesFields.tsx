import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import {
  statGroups, allStats, withGroupLabel, withoutGroup, withNewStat, withStat, withoutStat, sampleOf, withSample,
  tableList, withTableLabel, withoutTable, withBands, lookupIn,
  formulaList, withFormula, withAlternative, withCondition, isCondition, partOf, usedBy, FUNCTIONS, CONDITION_PARTS,
  type Formula, type StatGroup, type Table, type ConditionPart,
} from '../sheets/statsRules';
import { houseRuleList } from '../sheets/houseRules';
import type { Tried } from '../hooks/usePreviewValues';
import type { FormulaBox } from '../hooks/useFormulaInsert';
import { OnlyWith } from './OnlyWith';
import { FormulaWords } from './FormulaWords';
import { isMistake, type FormulaRead } from '../sheets/formulaBox';
import { HINTS } from '../sheets/builderHelp';
import { ColumnHead, FieldName } from './HelpHint';
import { small, why, btn, field, th, td, box, head } from './statsRulesStyles';

// STATS & RULES' editing controls (5a3b1), one copy for both views: FORMS lays them out as its
// tabs (StatsRulesPage), and the graph view's node panel (5a3b2) shows the ones for the node
// picked. Every change still goes through sheets/statsRules.ts and the builder's `edit`, so an edit
// made either way is the same edit (approved mockup docs/mockups/builder-graph.html: "the panel is
// the same form as FORMS").

/** A whole number box where empty means none (null). */
const wholeOrNone = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

interface Edits { definition: Definition; edit: (next: Definition) => void }

/** One stats group: its name, its stats (name, range, tie, sample), REMOVE GROUP and + STAT. */
export function GroupSection({ definition, edit, group: g }: Edits & { group: StatGroup }) {
  const groups = statGroups(definition);
  const abilities = groups[0]?.stats ?? [];
  return (
    <section aria-label={`${g.label || g.id} stats`} style={box}>
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
            <ColumnHead style={th}>NAME</ColumnHead><ColumnHead style={th} hint={HINTS['rules.id']}>ID</ColumnHead>
            <ColumnHead style={th} hint={HINTS['rules.lowest']}>LOWEST</ColumnHead><ColumnHead style={th} hint={HINTS['rules.highest']}>HIGHEST</ColumnHead>
            <ColumnHead style={th} hint={HINTS['rules.tiedTo']}>TIED TO</ColumnHead><ColumnHead style={th} hint={HINTS['rules.sample']}>SAMPLE</ColumnHead><ColumnHead style={th} />
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
  );
}

/** One lookup table: its name, its rows (up to / gives), TRY IT, REMOVE TABLE and + ROW. */
export function TableSection({ definition, edit, table: t }: Edits & { table: Table }) {
  const [test, setTest] = useState('10');
  return (
    <section aria-label={`${t.label || t.id} table`} style={box}>
      <div style={head}>
        <input type="text" aria-label="Table name" maxLength={40} value={t.label ?? ''} placeholder={t.id} style={{ ...field, width: 220 }}
          onChange={(e) => edit(withTableLabel(definition, t.id, e.target.value))} />
        <span style={{ fontSize: 11, opacity: 0.6 }}>{t.id}()</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="utility-btn" style={btn} aria-label={`Remove the ${t.label || t.id} table`}
          onClick={() => edit(withoutTable(definition, t.id))}>REMOVE TABLE</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, padding: '8px 10px', alignItems: 'start' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr><ColumnHead style={th} hint={HINTS['rules.upTo']}>UP TO</ColumnHead><ColumnHead style={th} hint={HINTS['rules.gives']}>GIVES</ColumnHead><ColumnHead style={th} /></tr></thead>
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
          <FieldName hint={HINTS['rules.tryTable']} style={small}>TRY IT</FieldName>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" aria-label={`Try ${t.label || t.id}`} value={test} style={{ ...field, width: 70 }}
              onChange={(e) => setTest(e.target.value)} />
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
}

/**
 * A formula's alternative under a house rule (4j4b; approved mockup docs/mockups/optional-rules.html,
 * 2026-10-14): WITH A RULE, then USE INSTEAD, and the sample character's value with that rule on (or
 * the alternative's mistake), worked out by the server like the formula's own. Nothing in a system with
 * no house rules, unless a formula still has one naming a rule since deleted.
 */
export function Alternative({ f, definition, edit, tried }: Edits & { f: Formula; tried: Record<string, Tried> }) {
  const id = React.useId();
  const rule = f.alternative?.rule;
  const rules = houseRuleList(definition);
  if (!rules.length && !rule) return null;
  const ruleName = (rules.find((r) => r.id === rule)?.name.trim() || rule || '').toUpperCase();
  const t = rule ? tried[rule] : undefined;
  const mistake = t?.problems[f.id];
  const label: React.CSSProperties = { fontSize: 9, letterSpacing: 2, opacity: 0.75 };
  return (
    <div data-testid={`alternative-${f.id}`} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 8px', alignItems: 'center', marginTop: 4 }}>
      <OnlyWith definition={definition} value={rule} label="WITH A RULE" hint={HINTS['only.alternative']} none="— none —" style={label}
        selectStyle={{ ...field, justifySelf: 'start' }} onChange={(r) => edit(withAlternative(definition, f.id, { rule: r }))} />
      {rule && <>
        <FieldName htmlFor={id} hint={HINTS['only.instead']} style={label}>USE INSTEAD</FieldName>
        <input id={id} type="text" maxLength={1000} value={f.alternative?.formula ?? ''} aria-invalid={mistake ? true : undefined}
          style={{ ...field, width: '100%', borderColor: mistake ? 'var(--danger)' : 'var(--cyan)' }}
          onChange={(e) => edit(withAlternative(definition, f.id, { formula: e.target.value }))} />
        <span />
        {mistake
          ? <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{mistake}</span>
          : <span data-testid={`alt-value-${f.id}`} style={{ color: 'var(--cyan)', fontSize: 11 }}>
              {t && t.values[f.id] !== undefined ? `${t.values[f.id]} with ${ruleName} on` : '·'}
            </span>}
      </>}
    </div>
  );
}

/** A formula's name, and its id with what reads it. */
export function FormulaName({ definition, edit, f }: Edits & { f: Formula }) {
  const users = usedBy(definition, f.id);
  return (
    <>
      <input type="text" aria-label={`${f.label || f.id} name`} maxLength={40} value={f.label ?? ''} placeholder={f.id} style={{ ...field, width: '100%' }}
        onChange={(e) => edit(withFormula(definition, f.id, { label: e.target.value }))} />
      <div style={{ fontSize: 11, opacity: 0.6 }}>@{f.id}{users.length > 0 && ` · used by ${users.join(', ')}`}</div>
    </>
  );
}

/** Where INSERT puts a name in one box: the box's input, and where its cursor is. */
export type InsertBinding = { inputRef?: (el: HTMLInputElement | null) => void; onCursor?: (at: number) => void };

/** One box of formula text, its cursor told to INSERT, described by its words line. */
function TextBox({ label, value, bad, onText, inputRef, onCursor, describedBy }: InsertBinding & { label: string; value: string; bad: boolean; onText: (text: string) => void; describedBy?: string }) {
  return (
    <input ref={inputRef} type="text" aria-label={label} maxLength={1000} value={value}
      aria-invalid={bad ? true : undefined} aria-describedby={describedBy}
      style={{ ...field, width: '100%', borderColor: bad ? 'var(--danger)' : 'var(--green)' }}
      onChange={(e) => { onText(e.target.value); onCursor?.(e.target.selectionStart ?? e.target.value.length); }}
      onSelect={(e) => onCursor?.((e.target as HTMLInputElement).selectionStart ?? 0)}
      onFocus={(e) => onCursor?.(e.target.selectionStart ?? e.target.value.length)} />
  );
}

const PART_WORD: Record<ConditionPart, string> = { when: 'IF', then: 'THEN', else: 'ELSE' };

/**
 * A formula's text, or a condition's IF, THEN and ELSE (5b6a: IF something isn't 0, THEN one
 * number, ELSE another); its mistake under it, and a formula's alternative under a house rule.
 * `bind` lets INSERT put a name where the cursor is, in whichever box. `reads` (formula box 3)
 * is what the server made of each box: a formula said in words under it, and a name the system
 * hasn't got in red with its fix, under each box it is in. The VALUE beside it says the sample's.
 */
export function FormulaBody({ definition, edit, f, problem, tried, bind, reads }: Edits & {
  f: Formula; problem?: string; tried: Record<string, Tried>; bind?: (box: FormulaBox) => InsertBinding;
  reads?: (box: FormulaBox) => FormulaRead | null;
}) {
  const name = f.label || f.id;
  const wordsId = (box: FormulaBox) => `formula-words-${f.id}-${box}`;
  return (
    <>
      {isCondition(f)
        ? (
          <div data-testid={`condition-${f.id}`} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: '4px 6px', alignItems: 'center' }}>
            {CONDITION_PARTS.map((part) => (
              <React.Fragment key={part}>
                <span style={{ ...small, color: 'var(--cyan)', opacity: 1 }}>{PART_WORD[part]}</span>
                <TextBox label={`${name} ${PART_WORD[part].toLowerCase()}`} value={partOf(f, part)} bad={!!problem || isMistake(reads?.(part))}
                  describedBy={isMistake(reads?.(part)) ? wordsId(part) : undefined}
                  onText={(text) => edit(withCondition(definition, f.id, { [part]: text }))} {...bind?.(part)} />
                {/* A condition's parts get a line only for a mistake: their words would say little. */}
                {isMistake(reads?.(part)) && <>
                  <span />
                  <FormulaWords id={wordsId(part)} kind="formula" text={partOf(f, part)} read={reads?.(part)} live={false}
                    onFix={(text) => edit(withCondition(definition, f.id, { [part]: text }))} />
                </>}
              </React.Fragment>
            ))}
          </div>
        )
        : <>
            <TextBox label={`${name} formula`} value={f.formula ?? ''} bad={!!problem || isMistake(reads?.('formula'))}
              describedBy={reads ? wordsId('formula') : undefined}
              onText={(text) => edit(withFormula(definition, f.id, { formula: text }))} {...bind?.('formula')} />
            {reads && <FormulaWords id={wordsId('formula')} kind="formula" text={f.formula ?? ''} read={reads('formula')} sample={false} live={false}
              onFix={(text) => edit(withFormula(definition, f.id, { formula: text }))} />}
          </>}
      {problem && <div role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1, fontSize: 11 }}>{problem}</div>}
      {!isCondition(f) && <Alternative f={f} definition={definition} edit={edit} tried={tried} />}
    </>
  );
}

/** INSERT: the names a formula can read, put at the cursor by a click. */
export function InsertChips({ definition, active, onInsert }: { definition: Definition; active: boolean; onInsert: (token: string) => void }) {
  const chips = (title: string, tokens: string[]) => tokens.length > 0 && (
    <>
      <span style={{ ...small, opacity: 0.55 }}>{title}</span>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {tokens.map((t) => (
          <button key={t} type="button" disabled={!active} onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(t)}
            style={{ border: '1px solid var(--dark-green)', background: 'none', color: 'var(--green)', fontFamily: 'monospace', fontSize: 11, padding: '1px 6px', cursor: active ? 'pointer' : 'default' }}>{t}</button>
        ))}
      </div>
    </>
  );
  return (
    <>
      <span style={small}>INSERT</span>
      {chips('STATS', allStats(definition).map((s) => `@${s.id}`))}
      {chips('FORMULAS', formulaList(definition).map((f) => `@${f.id}`))}
      {chips('TABLES', tableList(definition).map((t) => `${t.id}()`))}
      {chips('FUNCTIONS', FUNCTIONS.map((fn) => `${fn}()`))}
      <span style={{ ...why, fontSize: 11 }}>{active ? 'Click one to put it at the cursor.' : 'Click in a formula first, then a name to put it there.'}</span>
    </>
  );
}
