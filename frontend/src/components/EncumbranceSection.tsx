import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  encumbranceOf, withEncumbrance, countable, typesWithout, started, countedBy, withNewBand, withBand, withoutBand, bandProblem,
  gearTokens, LIMITS, type Encumbrance,
} from '../sheets/encumbrance';
import { itemInstalls } from '../sheets/items';
import { allStats } from '../sheets/statsRules';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { conditionsOf } from '../sheets/conditions';

// ENCUMBRANCE on the builder's ITEMS page (8a5c; approved mockup docs/mockups/item-types.html, 2026-11-14, decision 7):
// COUNTED BY a NUMBER column of the types, IN its unit; CAN CARRY a formula; BANDS as words at a share of it, each the
// GM's to name and place (the user, 2026-11-18), and the word past them. What counts as carried, and the names formulas
// read, said under it. Shown, never enforced. What it reads and writes is sheets/encumbrance.ts; the server checks it.
//
// Under each band, and the word past them (8a5d2; approved mockup docs/mockups/encumbrance-bands.html, 2026-11-18): WHAT IT
// MEANS, words for the sheet, and a CONDITION, NONE to start, put on the token while in that band (the user: "word +
// optional (on/off) condition").

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  api?: ReturnType<typeof systemsApi>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, maxWidth: 820 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'center' };
const choice = (on: boolean): React.CSSProperties => ({ ...btn, padding: '3px 10px', border: '1px solid var(--dark-green)', cursor: 'pointer',
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)' });
const token: React.CSSProperties = { fontSize: 11, color: 'var(--cyan)', border: '1px solid color-mix(in srgb, var(--cyan) 45%, transparent)', padding: '1px 6px', whiteSpace: 'nowrap' };

/**
 * Under a band (8a5d2): WHAT IT MEANS and its CONDITION, NONE first. A condition no longer made on CONDITIONS is said gone,
 * to be picked again.
 */
function Means({ definition, id, label, says, condition, onSays, onCondition }: {
  definition: Definition; id: string; label: string; says?: string; condition?: string;
  onSays: (text: string) => void; onCondition: (id: string) => void;
}) {
  const conditions = conditionsOf(definition);
  const gone = !!condition && !conditions.some((c) => c.id === condition);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: '6px 10px', alignItems: 'center', borderLeft: '2px solid var(--dark-green)', paddingLeft: 8, marginLeft: 4 }}>
      <FieldName beside htmlFor={`${id}-means`} hint={HINTS['items.bandMeans']} style={small}>WHAT IT MEANS</FieldName>
      <input id={`${id}-means`} type="text" aria-label={`${label} means`} maxLength={LIMITS.says} value={says ?? ''} placeholder="Nothing to say (optional)"
        style={{ ...input, width: '100%' }} onChange={(ev) => onSays(ev.target.value)} />
      <FieldName beside htmlFor={`${id}-condition`} hint={HINTS['items.bandCondition']} style={small}>CONDITION</FieldName>
      <span style={row}>
        <select id={`${id}-condition`} aria-label={`${label} condition`} value={condition ?? ''} style={input} aria-invalid={gone ? true : undefined}
          onChange={(ev) => onCondition(ev.target.value)}>
          <option value="">NONE</option>
          {gone && <option value={condition}>{condition} · GONE</option>}
          {conditions.map((c) => <option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>)}
        </select>
        {gone
          ? <span role="alert" style={{ ...why, fontSize: 11, color: 'var(--danger)' }}>No condition is called {condition} any more: pick another, or NONE.</span>
          : condition
            ? <span style={{ ...why, fontSize: 11 }}>On the token while in this band, off when lighter.</span>
            : !conditions.length && <span style={{ ...why, fontSize: 11 }}>Make one on CONDITIONS to pick it here.</span>}
      </span>
    </div>
  );
}

/** The panel while it counts: COUNTED BY, CAN CARRY, BANDS, and what it means at the table. */
function Counting({ definition, edit, api, e }: Props & { e: Encumbrance }) {
  const [stopping, setStopping] = useState(false);
  const put = (next: Encumbrance) => edit(withEncumbrance(definition, next));
  const cols = countable(definition);
  const counted = cols.find((c) => c.id === e.column);
  const without = typesWithout(definition, e.column);
  const bands = e.bands ?? [];
  const capacity = useFormulaBox({
    definition, api, kind: 'formula', value: e.capacity ?? '', onChange: (text) => put({ ...e, capacity: text }),
    label: 'Can carry', id: 'encumbrance-capacity', placeholder: allStats(definition)[0] ? `@${allStats(definition)[0].id} * 10` : '100', inputStyle: { ...input, width: '100%' },
  });
  const noCapacity = !(e.capacity ?? '').trim();
  const installs = itemInstalls(definition);
  const tokens = gearTokens(definition);
  return (
    <>
      <div style={grid}>
        <FieldName beside hint={HINTS['items.countedBy']} style={small}>COUNTED BY</FieldName>
        <span style={row}>
          <span role="group" aria-label="Counted by" style={{ display: 'inline-flex', flexWrap: 'wrap' }}>
            {cols.map((c) => <button key={c.id} type="button" aria-pressed={c.id === e.column} style={choice(c.id === e.column)}
              onClick={() => put(countedBy(definition, e, c.id))}>{c.label.toUpperCase()}</button>)}
          </span>
          <FieldName htmlFor="encumbrance-unit" style={small}>IN</FieldName>
          <input id="encumbrance-unit" type="text" maxLength={LIMITS.unit} value={e.unit ?? ''} placeholder="LB" style={{ ...input, width: 70 }}
            onChange={(ev) => put({ ...e, unit: ev.target.value })} />
        </span>
        <span />
        {counted
          ? <p style={{ ...why, fontSize: 11 }}>{counted.types.join(', ')} {counted.types.length === 1 ? 'counts' : 'count'} {counted.label.toUpperCase()}, one of each times how many{without.length ? `; ${without.join(', ')} ${without.length === 1 ? 'weighs' : 'weigh'} nothing` : ''}.</p>
          : <p role="alert" style={{ ...why, fontSize: 11, color: 'var(--danger)' }}>No type has a NUMBER column called {e.column} any more: pick what it counts.</p>}

        <FieldName beside htmlFor="encumbrance-capacity" hint={HINTS['items.canCarry']} style={small}>CAN CARRY</FieldName>
        {capacity.field}
      </div>
      {capacity.help}

      <section aria-label="Bands" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={row}>
          <FieldName hint={HINTS['items.bands']} style={small}>BANDS · {bands.length} OF {LIMITS.bands}</FieldName>
          <span style={{ flex: 1 }} />
          <button type="button" className="utility-btn" style={btn} disabled={bands.length >= LIMITS.bands}
            onClick={() => { const next = withNewBand(e); if (next) put(next); }}>+ BAND</button>
        </div>
        {bands.length > 0 && noCapacity && (
          <p role="alert" style={{ ...why, fontSize: 11, color: 'var(--warning)' }}>A band is a share of CAN CARRY: say what can be carried, or take the bands away.</p>
        )}
        {bands.map((b, i) => {
          const problem = bandProblem(bands, i);
          return (
            <div key={i} role="group" aria-label={`Band ${i + 1}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={row}>
              <input type="text" aria-label={`Band ${i + 1} word`} maxLength={LIMITS.word} value={b.word} style={{ ...input, width: 160 }}
                aria-invalid={!b.word.trim() ? true : undefined} onChange={(ev) => put(withBand(e, i, { word: ev.target.value }))} />
              <span style={small}>UP TO</span>
              <input type="number" aria-label={`Band ${i + 1} up to`} min={1} max={LIMITS.upto} step={1} value={Number.isFinite(b.upto) ? b.upto : ''} style={{ ...input, width: 70 }}
                aria-invalid={problem ? true : undefined} title={problem ?? undefined}
                onChange={(ev) => { if (ev.target.value.trim()) put(withBand(e, i, { upto: Number(ev.target.value) })); }} />
              <span style={small}>% OF CAN CARRY</span>
              <button type="button" className="utility-btn" style={{ ...btn, padding: '2px 7px', color: 'var(--danger)', borderColor: 'var(--danger)' }} aria-label={`Remove band ${i + 1}`}
                onClick={() => put(withoutBand(e, i))}>×</button>
              {problem && <span style={{ ...why, fontSize: 11, color: 'var(--danger)' }}>{problem}</span>}
            </div>
            <Means definition={definition} id={`band-${i}`} label={`Band ${i + 1}`} says={b.says} condition={b.condition}
              onSays={(text) => put(withBand(e, i, { says: text }))} onCondition={(id) => put(withBand(e, i, { condition: id }))} />
            </div>
          );
        })}
        {bands.length > 0
          ? (
            <div role="group" aria-label="Past the bands" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={row}>
                <input type="text" aria-label="Past the last band" maxLength={LIMITS.word} value={e.past ?? ''} style={{ ...input, width: 160 }}
                  aria-invalid={!(e.past ?? '').trim() ? true : undefined} onChange={(ev) => put({ ...e, past: ev.target.value })} />
                <span style={small}>PAST THE LAST</span>
              </div>
              <Means definition={definition} id="band-past" label="Past the last band" says={e.past_says} condition={e.past_condition}
                onSays={(text) => put({ ...e, past_says: text })} onCondition={(id) => put({ ...e, past_condition: id })} />
            </div>
          )
          : <p style={{ ...why, fontSize: 11 }}>None: the sheet says how much is carried, and of how much, with no word for it.</p>}
      </section>

      <section aria-label="What counts as carried" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={small}>WHAT COUNTS AS CARRIED</span>
        <p style={{ ...why, fontSize: 11 }}>READIED and STOWED count; STASHED is not on them and doesn&apos;t. Worn counts, as readied.
          {installs.length ? ' An installed item counts only where its install says WEIGHS WHILE INSTALLED, on SLOTS & INSTALLS.' : ''}
          {' '}Shown, never enforced: the GM applies a condition by hand if they want one.</p>
        {tokens.length > 0 && (
          <span style={row}><span style={small}>FORMULAS READ</span>{tokens.map((t) => <span key={t.token} style={token} title={t.label}>{t.token}</span>)}</span>
        )}
      </section>

      {stopping
        ? (
          <span role="group" aria-label="Stop counting encumbrance" style={row}>
            <span style={{ ...why, color: 'var(--danger)' }}>Stop counting? What it counts, CAN CARRY and the bands go, and formulas reading @carried or @capacity read 0.</span>
            <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => edit(withEncumbrance(definition, null))}>STOP</button>
            <button type="button" className="utility-btn" style={btn} onClick={() => setStopping(false)}>KEEP</button>
          </span>
        )
        : <span style={row}><button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setStopping(true)}>STOP COUNTING</button></span>}
    </>
  );
}

export function EncumbranceSection({ definition, edit, api }: Props) {
  const e = encumbranceOf(definition);
  const first = allStats(definition)[0];
  const start = started(definition, first ? first.id : null);
  return (
    <section aria-label="Encumbrance" style={panel}>
      <FieldName hint={HINTS['items.encumbrance']} style={small}>ENCUMBRANCE</FieldName>
      {e
        ? <Counting definition={definition} edit={edit} api={api} e={e} />
        : (
          <>
            <p style={{ ...why, fontSize: 11 }}>Not counted: nothing is weighed, and CARRYING never shows at the table. Count it, and GEAR says CARRYING 42 / 150 LB · LIGHT.</p>
            <span style={row}>
              <button type="button" className="utility-btn" style={btn} disabled={!start} onClick={() => { if (start) edit(withEncumbrance(definition, start)); }}>COUNT ENCUMBRANCE</button>
              {!start && <span style={{ ...why, fontSize: 11 }}>Give a type a NUMBER column first, like WEIGHT, on TYPES.</span>}
            </span>
          </>
        )}
    </section>
  );
}
