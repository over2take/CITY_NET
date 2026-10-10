import React, { useEffect, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import type { CustomRenderSheet } from '../sheets/customTemplates';
import {
  restList, restCount, withRest, withNewRest, withoutRest, countedAs, makesLoop, refillTargets, describeRefill,
  withRefill, withNewRefill, withoutRefill, wearsOff, withWearsOff, HOW_LABELS, LIMITS, type Rest, type Target,
} from '../sheets/rests';
import { conditionsOf } from '../sheets/conditions';
import { ConditionIcon } from './ConditionIcon';
import { Switch } from './ConditionsPage';
import { TRY_DELAY_MS } from './NpcsPage';

// The builder's RESTS page (4f4a; approved mockup docs/mockups/builder-rests.html, 2026-10-09): the
// moments the game refills things and wears things off. The standard four, each with a switch,
// renamed or turned off; the system's own, added and deleted; each one's name, the rests it also
// counts as, its refills in order, and the conditions it wears off. What it reads and writes is
// sheets/rests.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the sheet the system plays with, which says what a rest can refill. */
  api?: Pick<ReturnType<typeof systemsApi>, 'previewSheet'>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const tick = (on: boolean): React.CSSProperties => ({
  ...btn, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 'normal',
  border: `1px solid ${on ? 'var(--warning)' : 'var(--dark-green)'}`, color: on ? 'var(--warning)' : 'var(--green)',
  background: on ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'none',
});

/** The ways a target allows, as its select offers them. */
const howLabel = (t: Target | undefined, how: string) => (t?.kind === 'section' ? 'ALL TO THEIR MAXIMUMS' : HOW_LABELS[how as keyof typeof HOW_LABELS] ?? how);

function Refills({ rest, definition, edit, targets }: { rest: Rest; definition: Definition; edit: Props['edit']; targets: Target[] }) {
  const inherited = countedAs(definition, rest.id).flatMap((id) => {
    const other = restList(definition).find((r) => r.id === id);
    return other ? other.refills.map((r) => `${other.name.toUpperCase()}: ${describeRefill(r, targets)}`) : [];
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {inherited.map((text, i) => (
        <div key={`from-${i}`} style={{ ...why, fontSize: 11, opacity: 0.7, borderLeft: '2px solid var(--dark-green)', paddingLeft: 8 }}>{text}</div>
      ))}
      {rest.refills.map((r, i) => {
        const t = targets.find((x) => x.id === r.what);
        const needsAmount = r.how === 'by' || r.how === 'to';
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 6 }}>
            <select aria-label={`Refill ${i + 1}: what`} value={r.what} style={input}
              onChange={(e) => edit(withRefill(definition, rest.id, i, { what: e.target.value }, targets))}>
              {targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              {!t && <option value={r.what}>{r.what} (GONE)</option>}
            </select>
            <select aria-label={`Refill ${i + 1}: how`} value={r.how} style={input}
              onChange={(e) => edit(withRefill(definition, rest.id, i, { how: e.target.value as Rest['refills'][number]['how'] }, targets))}>
              {(t?.hows ?? [r.how]).map((h) => <option key={h} value={h}>{howLabel(t, h)}</option>)}
            </select>
            {needsAmount
              ? (
                <span style={{ display: 'flex', gap: 4, minWidth: 0 }}>
                  <input type="text" aria-label={`Refill ${i + 1}: amount`} value={r.amount ?? ''} maxLength={LIMITS.amount} style={{ ...input, flex: 1 }}
                    placeholder={r.how === 'by' ? '-1, @level, 1d8 + @con_mod' : '0'}
                    onChange={(e) => edit(withRest(definition, rest.id, { refills: rest.refills.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) }))} />
                  {t?.tracks && r.how === 'by' && (
                    <select aria-label={`Refill ${i + 1}: track`} value={r.track ?? ''} style={input}
                      onChange={(e) => edit(withRefill(definition, rest.id, i, { track: e.target.value }, targets))}>
                      <option value="">{t.tracks[0]?.label ?? 'FIRST'}</option>
                      {t.tracks.slice(1).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  )}
                </span>
              )
              : <span />}
            <button type="button" className="utility-btn danger-btn" style={btn} aria-label={`Remove refill ${i + 1}`}
              onClick={() => edit(withoutRefill(definition, rest.id, i))}>×</button>
          </div>
        );
      })}
      <div style={row}>
        <button type="button" className="utility-btn" style={btn} disabled={!targets.length || rest.refills.length >= LIMITS.refills}
          onClick={() => edit(withNewRefill(definition, rest.id, targets))}>+ REFILL</button>
        <span style={{ ...why, fontSize: 11 }}>
          {targets.length ? 'An amount is a number, a formula (@level) or dice (1d8 + @con_mod), rolled for each character.' : 'Nothing to refill: this system has no health and no numbers on its sheet.'}
        </span>
      </div>
    </div>
  );
}

function Detail({ rest, definition, edit, targets }: { rest: Rest; definition: Definition; edit: Props['edit']; targets: Target[] }) {
  const [confirm, setConfirm] = useState(false);
  const others = restList(definition).filter((r) => r.id !== rest.id && r.on);
  const order = new Set([...countedAs(definition, rest.id), rest.id]);
  const conditions = conditionsOf(definition);
  const nameOf = (id: string) => restList(definition).find((r) => r.id === id)?.name ?? id;
  const stored = (definition.rests as Record<string, Record<string, unknown>> | undefined)?.[rest.id] ?? {};
  const typedName = typeof stored.name === 'string' ? stored.name : (rest.standard ? '' : rest.name);

  return (
    <section aria-label={`${rest.name || rest.id} rest`} style={{ border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>{rest.standard ? 'STANDARD REST' : 'ONE OF THIS SYSTEM\'S OWN'}</span>
        {rest.standard
          ? <span style={why}>{rest.on ? 'On: the GM can call it.' : 'Off: not offered in the GAME tab.'}</span>
          : confirm
            ? <span style={row}>
                <span style={{ ...why, color: 'var(--danger)' }}>Delete {rest.name || 'this rest'}?</span>
                <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => edit(withoutRest(definition, rest.id))}>DELETE</button>
                <button type="button" className="utility-btn" style={btn} onClick={() => setConfirm(false)}>KEEP</button>
              </span>
            : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setConfirm(true)}>DELETE</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'start' }}>
        <label style={{ ...small, textAlign: 'right', paddingTop: 6 }} htmlFor={`rest-name-${rest.id}`}>NAME</label>
        <input id={`rest-name-${rest.id}`} type="text" maxLength={LIMITS.name} value={typedName} style={input}
          placeholder={rest.standard ? restList({ format: 1, name: '' }).find((r) => r.id === rest.id)?.name : 'Name'}
          aria-invalid={!rest.standard && !rest.name.trim() ? true : undefined}
          onChange={(e) => edit(withRest(definition, rest.id, { name: e.target.value }))} />

        <span style={{ ...small, textAlign: 'right', paddingTop: 6 }}>ALSO COUNTS AS</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div role="group" aria-label="Also counts as" style={{ ...row, gap: 4 }}>
            {others.map((o) => {
              const on = rest.counts_as.includes(o.id);
              const loops = !on && makesLoop(definition, rest.id, o.id);
              return (
                <button key={o.id} type="button" role="checkbox" aria-checked={on} disabled={loops} style={{ ...tick(on), ...(loops ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}
                  title={loops ? 'That rest already counts as this one' : undefined}
                  onClick={() => edit(withRest(definition, rest.id, { counts_as: on ? rest.counts_as.filter((c) => c !== o.id) : [...rest.counts_as, o.id] }))}>
                  {o.name.toUpperCase()}
                </button>
              );
            })}
            {!others.length && <span style={why}>No other rest is on.</span>}
          </div>
          <p style={{ ...why, fontSize: 11 }}>Everything those rests do happens first, then this one&apos;s own.</p>
        </div>

        <span style={{ ...small, textAlign: 'right', paddingTop: 6 }}>REFILLS</span>
        <Refills rest={rest} definition={definition} edit={edit} targets={targets} />

        <span style={{ ...small, textAlign: 'right', paddingTop: 6 }}>WEARS OFF</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div role="group" aria-label="Wears off" style={{ ...row, gap: 4 }}>
            {conditions.map((c) => {
              const own = wearsOff(definition, rest.id).includes(c.id);
              const rounds = c.ends === 'rounds';
              const via = !own && c.ends === 'rest' ? (c.at ?? []).find((a) => order.has(a)) : undefined;
              return (
                <button key={c.id} type="button" role="checkbox" aria-checked={own} disabled={rounds}
                  title={rounds ? `Ends after ${c.rounds ?? 1} round${c.rounds === 1 ? '' : 's'}` : undefined}
                  style={{ ...tick(own), ...(rounds ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}
                  onClick={() => edit(withWearsOff(definition, c.id, rest.id, !own))}>
                  <ConditionIcon icon={c.icon} />{c.name.toUpperCase()}
                  {rounds && <span style={{ opacity: 0.6 }}>· {c.rounds ?? 1}R</span>}
                  {via && <span style={{ opacity: 0.6 }}>(as {nameOf(via).toLowerCase()})</span>}
                </button>
              );
            })}
          </div>
          <p style={{ ...why, fontSize: 11 }}>The same switch as AT A REST on the CONDITIONS page. A condition that ends after rounds keeps counting them.</p>
        </div>
      </div>
    </section>
  );
}

export function RestsPage({ definition, edit, api }: Props) {
  const list = restList(definition);
  const [picked, setPicked] = useState<string>(list[1]?.id ?? list[0]?.id ?? '');
  const current = list.find((r) => r.id === picked) ?? list[0];
  const count = restCount(definition);
  const [sheet, setSheet] = useState<CustomRenderSheet | null>(null);

  // The sheet as the game draws it: the numbers a rest can refill.
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewSheet(definition).then((r) => { if (live && r.ok) setSheet(r.value.sheet); });
    }, sheet ? TRY_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition]); // eslint-disable-line react-hooks/exhaustive-deps
  const targets = refillTargets(definition, sheet);

  const add = () => {
    const made = withNewRest(definition);
    if (!made) return;
    edit(made.definition);
    setPicked(made.id);
  };

  return (
    <div data-testid="rests-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1100 }}>
      <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...row, justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)' }}>
          <span style={small}>{list.filter((r) => r.on).length} ON · {count} OF {LIMITS.rests}</span>
          <button type="button" className="utility-btn" style={btn} disabled={count >= LIMITS.rests} onClick={add}>+ REST</button>
        </div>
        <ul aria-label="Rests" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {list.map((r) => (
            <li key={r.id} style={{
              display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '7px 10px',
              borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)',
              background: r.id === current?.id ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none',
              boxShadow: r.id === current?.id ? 'inset 3px 0 0 var(--green)' : 'none',
            }}>
              {r.standard ? <Switch on={r.on} label={`${r.name} on`} onChange={(on) => edit(withRest(definition, r.id, { on }))} /> : <span />}
              <button type="button" aria-current={r.id === current?.id || undefined} onClick={() => setPicked(r.id)}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1,
                  color: r.name.trim() ? 'var(--green)' : 'var(--danger)', opacity: r.on ? 1 : 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(r.name.trim() || 'NEEDS A NAME').toUpperCase()}
              </button>
              <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.6 }}>{r.standard ? '' : 'OWN'}</span>
            </li>
          ))}
        </ul>
      </div>
      {current && <Detail key={current.id} rest={current} definition={definition} edit={edit} targets={targets} />}
    </div>
  );
}
