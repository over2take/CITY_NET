import React from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import { HINTS } from '../sheets/builderHelp';
import { MARKED_LABELS, improveGroups, improveLine, improveNotes, improveRests, improveSet, withImprove, type MarkedBy } from '../sheets/improveByUse';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { FieldName } from './HelpHint';
import { OptionalWhole } from './OptionalWhole';

// IMPROVE BY USE on the builder's LEVELS page (7f3a2; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): STATS
// THAT IMPROVE, MARKED BY, AT which rest, the ROLL, IMPROVES IF OVER, THEN ADD and UP TO. What it reads and writes is
// sheets/improveByUse.ts; the server checks it and rolls it at the rest (improveByUse.js).

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** Reads the roll, the target and the gain for the words under each. */
  api?: Pick<ReturnType<typeof systemsApi>, 'previewFormulas'>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const field: React.CSSProperties = { background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
/** A box's words and help, under it in the grid's second column. */
const under: React.CSSProperties = { gridColumn: '2', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, marginTop: -4 };
const note: React.CSSProperties = { ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 };

export function ImproveByUseSection({ definition, edit, api }: Props) {
  const set = improveSet(definition);
  const box = (key: 'roll' | 'over' | 'gain', label: string, placeholder: string) => ({
    definition, api, kind: 'improve' as const, value: set[key], label, inputStyle: field, placeholder, maxLength: 200,
    onChange: (text: string) => edit(withImprove(definition, { [key]: text })),
  });
  const roll = useFormulaBox(box('roll', 'Improvement roll', 'd100'));
  const over = useFormulaBox(box('over', 'Improves if over', '@this'));
  const gain = useFormulaBox(box('gain', 'Gain', '1d10'));
  const groups = improveGroups(definition);
  const rests = improveRests(definition);
  return (
    <section aria-label="Improve by use" style={panel}>
      <div style={grid}>
        <FieldName beside hint={HINTS['levels.improveStats']} style={small}>STATS THAT IMPROVE</FieldName>
        <select aria-label="Which stats improve" value={set.stats ?? ''} style={field} onChange={(e) => edit(withImprove(definition, { stats: e.target.value || null }))}>
          <option value="">EVERY STAT</option>
          {set.stats !== undefined && !groups.some((g) => g.id === set.stats) && <option value={set.stats}>{set.stats}</option>}
          {groups.map((g) => <option key={g.id} value={g.id}>{g.label.toUpperCase()}</option>)}
        </select>
        <FieldName beside hint={HINTS['levels.improveMarked']} style={small}>MARKED BY</FieldName>
        <select aria-label="Marked by" value={set.marked} style={field} onChange={(e) => edit(withImprove(definition, { marked: e.target.value as MarkedBy }))}>
          {(Object.keys(MARKED_LABELS) as MarkedBy[]).map((m) => <option key={m} value={m}>{MARKED_LABELS[m]}</option>)}
        </select>
        <FieldName beside hint={HINTS['levels.improveAt']} style={small}>AT</FieldName>
        <select aria-label="At which rest" value={set.at} style={field} onChange={(e) => edit(withImprove(definition, { at: e.target.value }))}>
          {!rests.some((r) => r.id === set.at) && <option value={set.at}>{set.at}</option>}
          {rests.map((r) => <option key={r.id} value={r.id}>{r.name.toUpperCase()}</option>)}
        </select>
        <FieldName beside hint={HINTS['levels.improveRoll']} style={small}>ROLL</FieldName>
        {roll.field}
        <div style={under}>{roll.help}</div>
        <FieldName beside hint={HINTS['levels.improveOver']} style={small}>IMPROVES IF OVER</FieldName>
        {over.field}
        <div style={under}>{over.help}</div>
        <FieldName beside hint={HINTS['levels.improveGain']} style={small}>THEN ADD</FieldName>
        {gain.field}
        <div style={under}>{gain.help}</div>
        <FieldName beside hint={HINTS['levels.improveMost']} style={small}>UP TO</FieldName>
        <OptionalWhole key={set.most ?? ''} value={set.most} label="Improves up to" onChange={(most) => edit(withImprove(definition, { most }))} style={{ ...field, width: 90 }} />
      </div>
      <p style={why}>{improveLine(definition)}</p>
      {improveNotes(definition).map((n) => <p key={n} role="note" style={note}>{n}</p>)}
    </section>
  );
}
