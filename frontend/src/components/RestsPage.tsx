import React, { useEffect, useState } from 'react';
import type { Definition, systemsApi, TriedRest } from '../sheets/systemsApi';
import type { CustomRenderSheet } from '../sheets/customTemplates';
import {
  restList, restCount, withRest, withNewRest, withoutRest, countedAs, makesLoop, refillTargets, describeRefill,
  withRefill, withNewRefill, withoutRefill, wearsOff, withWearsOff, HOW_LABELS, LIMITS, type Rest, type Target,
} from '../sheets/rests';
import { conditionsOf } from '../sheets/conditions';
import { ConditionIcon } from './ConditionIcon';
import { TRY_DELAY_MS } from './NpcsPage';
import { sampleCharacter, hurtToken } from '../sheets/tryIt';
import { changeText } from '../sheets/restCalls';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';
import { useFormulaBox } from '../hooks/useFormulaBox';
import {
  restingOf, withFinish, withRecovery, withRecoveryOn, withBack, withBackAmount, withSpentAt, diceOptions,
  LIMITS as RECOVERY_LIMITS, type BackHow, type Recovery,
} from '../sheets/recovery';

// The builder's RESTS page (4f4a; approved mockup docs/mockups/builder-rests.html, 2026-10-09): the
// moments the game refills things and wears things off. The standard four, each with a switch,
// renamed or turned off; the system's own, added and deleted; each one's name, the rests it also
// counts as, its refills in order, the conditions it wears off, and what it does to the sample
// character (4f6c, the server running it as the game would). What it reads and writes is
// sheets/rests.ts; every change goes through the builder's `edit`. Under them, the system's recovery
// dice and who finishes a called rest (R1b, sheets/recovery.ts).

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the sheet the system plays with (what a rest can refill), and ON THE SAMPLE. */
  api?: Pick<ReturnType<typeof systemsApi>, 'previewSheet' | 'tryRest' | 'previewFormulas'>;
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

/**
 * One refill: what, how, and an amount where it takes one, a formula box (formula box 2) saying it in
 * words with the least and most it comes to for the sample, its help under the row.
 */
function RefillRow({ rest, i, definition, edit, targets, api }: { rest: Rest; i: number; definition: Definition; edit: Props['edit']; targets: Target[]; api?: Props['api'] }) {
  const r = rest.refills[i];
  const t = targets.find((x) => x.id === r.what);
  const needsAmount = r.how === 'by' || r.how === 'to';
  const amount = useFormulaBox({
    definition, api, kind: 'refill', value: r.amount ?? '', label: `Refill ${i + 1}: amount`, inputStyle: input, maxLength: LIMITS.amount,
    placeholder: r.how === 'by' ? '-1, @level, 1d8 + @con_mod' : '0',
    onChange: (text) => edit(withRest(definition, rest.id, { refills: rest.refills.map((x, j) => (j === i ? { ...x, amount: text } : x)) })),
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto', gap: 6 }}>
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
              <span style={{ flex: 1, minWidth: 0 }}>{amount.field}</span>
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
      {needsAmount && amount.help}
    </div>
  );
}

function Refills({ rest, definition, edit, targets, api }: { rest: Rest; definition: Definition; edit: Props['edit']; targets: Target[]; api?: Props['api'] }) {
  const inherited = countedAs(definition, rest.id).flatMap((id) => {
    const other = restList(definition).find((r) => r.id === id);
    return other ? other.refills.map((r) => `${other.name.toUpperCase()}: ${describeRefill(r, targets)}`) : [];
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {inherited.map((text, i) => (
        <div key={`from-${i}`} style={{ ...why, fontSize: 11, opacity: 0.7, borderLeft: '2px solid var(--dark-green)', paddingLeft: 8 }}>{text}</div>
      ))}
      {rest.refills.map((_, i) => <RefillRow key={i} rest={rest} i={i} definition={definition} edit={edit} targets={targets} api={api} />)}
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

/**
 * ON THE SAMPLE (4f6c): the rest on the sample character, its token hurt to half so "to full" shows,
 * worked out by the server as the game would and dice left to roll. Asked again a moment after the
 * last change; a late answer never replaces a newer one.
 */
function Sample({ rest, definition, api }: { rest: Rest; definition: Definition; api: NonNullable<Props['api']> }) {
  const [tried, setTried] = useState<TriedRest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = React.useRef(true);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api.tryRest(definition, { rest: rest.id, sheet: sampleCharacter(definition), token: hurtToken(definition) }).then((r) => {
        if (!live) return;
        if (r.ok) { setTried(r.value); setError(null); } else { setTried(null); setError(r.error); }
      });
    }, first.current ? 0 : TRY_DELAY_MS);
    first.current = false;
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition, rest.id]);
  const token = hurtToken(definition);
  return (
    <div data-testid="rest-sample" style={{ border: '1px dashed var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={small}>THE SAMPLE CHARACTER · HP {token.current}/{token.max}</span>
      {!rest.on ? <span style={why}>Turn it on to see what it does.</span>
        : error ? <span role="alert" style={{ ...why, color: 'var(--danger)' }}>{error}</span>
          : !tried ? <span style={why}>WORKING IT OUT…</span>
            : tried.changes.length
              ? tried.changes.map((c) => <span key={c.what} style={{ fontSize: 12, color: 'var(--cyan)' }}>{changeText(c)}</span>)
              : <span style={why}>Nothing changes for the sample.</span>}
    </div>
  );
}

function Detail({ rest, definition, edit, targets, api }: { rest: Rest; definition: Definition; edit: Props['edit']; targets: Target[]; api?: Props['api'] }) {
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
      <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'start' }}>
        <FieldName beside htmlFor={`rest-name-${rest.id}`} style={small}>NAME</FieldName>
        <input id={`rest-name-${rest.id}`} type="text" maxLength={LIMITS.name} value={typedName} style={input}
          placeholder={rest.standard ? restList({ format: 1, name: '' }).find((r) => r.id === rest.id)?.name : 'Name'}
          aria-invalid={!rest.standard && !rest.name.trim() ? true : undefined}
          onChange={(e) => edit(withRest(definition, rest.id, { name: e.target.value }))} />

        <FieldName beside style={small}>ALSO COUNTS AS</FieldName>
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

        <FieldName beside hint={HINTS['rests.refills']} style={small}>REFILLS</FieldName>
        <Refills rest={rest} definition={definition} edit={edit} targets={targets} api={api} />

        <FieldName beside style={small}>WEARS OFF</FieldName>
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

        {api && <>
          <FieldName beside hint={HINTS['rests.sample']} style={small}>ON THE SAMPLE</FieldName>
          <Sample rest={rest} definition={definition} api={api} />
        </>}
      </div>
    </section>
  );
}

const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 12px', cursor: 'pointer',
});
const segs: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start', alignSelf: 'flex-start' };
const settings: React.CSSProperties = { display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'start' };
/** What a rest gives back, as its buttons say it; nothing is no entry. */
const BACK_WAYS: { id: BackHow | null; label: string }[] = [{ id: null, label: 'NOTHING' }, { id: 'all', label: 'ALL' }, { id: 'half', label: 'HALF, AT LEAST 1' }, { id: 'by', label: 'BY AN AMOUNT' }];

/** One rest's line of GIVES BACK: nothing, all, half, or by an amount in a formula box. */
function BackRow({ rest, back, definition, edit, api }: { rest: Rest; back: Recovery['back'][number] | undefined; definition: Definition; edit: Props['edit']; api?: Props['api'] }) {
  const name = (rest.name.trim() || rest.id).toUpperCase();
  const amount = useFormulaBox({
    definition, api, kind: 'formula', value: back?.amount ?? '', label: `${name} gives back by`, inputStyle: { ...input, width: '100%' }, maxLength: RECOVERY_LIMITS.formula,
    placeholder: '1, @level', onChange: (text) => edit(withBackAmount(definition, rest.id, text)),
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={row}>
        <span style={{ minWidth: 120, fontSize: 11, letterSpacing: 1, opacity: rest.on ? 1 : 0.5 }}>{name}{rest.on ? '' : ' (OFF)'}</span>
        <span role="group" aria-label={`${name} gives back`} style={segs}>
          {BACK_WAYS.map((w) => (
            <button key={w.label} type="button" aria-pressed={(back?.how ?? null) === w.id} style={seg((back?.how ?? null) === w.id)}
              onClick={() => edit(withBack(definition, rest.id, w.id))}>{w.label}</button>
          ))}
        </span>
        {back?.how === 'by' && <span style={{ flex: '1 1 140px', minWidth: 0 }}>{amount.field}</span>}
      </div>
      {back?.how === 'by' && amount.help}
    </div>
  );
}

/** The recovery dice's settings, once they are on: hooks for the formula boxes, so a component of its own. */
function RecoveryFields({ recovery, definition, edit, api }: { recovery: Recovery; definition: Definition; edit: Props['edit']; api?: Props['api'] }) {
  const rests = restList(definition);
  const dice = diceOptions(definition);
  const set = (patch: Partial<Recovery>) => edit(withRecovery(definition, patch));
  const byLevel = recovery.count === 'levels';
  const count = useFormulaBox({
    definition, api, kind: 'formula', value: byLevel ? '' : recovery.count, label: 'How many each has', inputStyle: input, maxLength: RECOVERY_LIMITS.formula,
    placeholder: '8, @level', onChange: (text) => set({ count: text }),
  });
  const plus = useFormulaBox({
    definition, api, kind: 'formula', value: recovery.plus ?? '', label: 'Added to each', inputStyle: input, maxLength: RECOVERY_LIMITS.formula,
    placeholder: 'NOTHING · @con_mod', onChange: (text) => set({ plus: text }),
  });
  const spent = recovery.spentAt;
  // Every rest that is on, and any the dice still name that has been turned off.
  const shown = rests.filter((r) => r.on || (spent !== 'any' && spent.includes(r.id)) || recovery.back.some((b) => b.rest === r.id));
  return (
    <div style={settings}>
      <FieldName beside htmlFor="recovery-name" style={small}>NAME</FieldName>
      <input id="recovery-name" type="text" maxLength={RECOVERY_LIMITS.name} value={recovery.name} style={{ ...input, width: 200, justifySelf: 'start' }}
        aria-invalid={!recovery.name.trim() ? true : undefined} onChange={(e) => set({ name: e.target.value })} />

      <FieldName beside style={small}>DICE</FieldName>
      {dice.length
        ? <span style={{ ...why, fontSize: 11 }}>{dice.map((d) => `${d.label.toUpperCase()} D${d.die}`).join(' · ')}</span>
        : <span role="alert" style={{ ...why, color: 'var(--danger)' }}>No option has a die to roll: give a levelled list&apos;s options a HIT DIE on CHOICES.</span>}

      <FieldName beside hint={HINTS['rests.recoveryCount']} style={small}>EACH HAS</FieldName>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={row}>
          <span role="group" aria-label="Each has" style={segs}>
            <button type="button" aria-pressed={byLevel} style={seg(byLevel)} onClick={() => set({ count: 'levels' })}>ONE PER LEVEL</button>
            <button type="button" aria-pressed={!byLevel} style={seg(!byLevel)} onClick={() => { if (byLevel) set({ count: '1' }); }}>A FORMULA</button>
          </span>
          {!byLevel && <span style={{ flex: '1 1 140px', minWidth: 0 }}>{count.field}</span>}
        </div>
        {!byLevel && count.help}
      </div>

      <FieldName beside hint={HINTS['rests.recoveryHeals']} style={small}>ONE HEALS</FieldName>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={row}>
          <span role="group" aria-label="One heals" style={segs}>
            <button type="button" aria-pressed={!recovery.perLevel} style={seg(!recovery.perLevel)} onClick={() => set({ perLevel: false })}>ITS DIE</button>
            <button type="button" aria-pressed={recovery.perLevel} style={seg(recovery.perLevel)} onClick={() => set({ perLevel: true })}>ITS DIE FOR EACH LEVEL</button>
          </span>
          <span>+</span>
          <span style={{ flex: '1 1 140px', minWidth: 0 }}>{plus.field}</span>
        </div>
        {plus.help}
      </div>

      <FieldName beside hint={HINTS['rests.recoverySpent']} style={small}>SPENT AT</FieldName>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div role="group" aria-label="Spent at" style={{ ...row, gap: 4 }}>
          {shown.map((r) => {
            const at = spent !== 'any' && spent.includes(r.id);
            return (
              <button key={r.id} type="button" role="checkbox" aria-checked={at} style={tick(at)} onClick={() => edit(withSpentAt(definition, r.id, !at))}>
                {(r.name.trim() || r.id).toUpperCase()}{r.on ? '' : ' (OFF)'}
              </button>
            );
          })}
          <button type="button" role="checkbox" aria-checked={spent === 'any'} style={tick(spent === 'any')}
            onClick={() => set({ spentAt: spent === 'any' ? [] : 'any' })}>ANY TIME</button>
        </div>
        {spent !== 'any' && !spent.length && <span role="alert" style={{ ...why, color: 'var(--danger)' }}>Tick the rests they are spent at, or ANY TIME.</span>}
      </div>

      <FieldName beside hint={HINTS['rests.recoveryBack']} style={small}>GIVES BACK</FieldName>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {shown.map((r) => <BackRow key={r.id} rest={r} back={recovery.back.find((b) => b.rest === r.id)} definition={definition} edit={edit} api={api} />)}
      </div>
    </div>
  );
}

/**
 * RECOVERY DICE and RESTS ARE FINISHED (R1b; approved mockup docs/mockups/rest-on-sheet.html,
 * 2026-10-30), under the rests: the system's pool to heal from at a rest, named as the game names
 * it, and who finishes a rest the GM calls. What it reads and writes is sheets/recovery.ts.
 */
function Resting({ definition, edit, api }: Props) {
  const { finish, recovery } = restingOf(definition);
  const onRests = restList(definition).filter((r) => r.on).map((r) => r.id);
  return (
    <section aria-label="Resting" style={{ gridColumn: '1 / -1', border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, textAlign: 'left' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <FieldName hint={HINTS['rests.recovery']} style={small}>RECOVERY DICE{recovery?.name.trim() ? ` · ${recovery.name.trim().toUpperCase()}` : ''}</FieldName>
        <ToggleSwitch label={recovery ? 'ON' : 'OFF'} name="Recovery dice" on={!!recovery}
          onChange={(on) => edit(on ? withRecoveryOn(definition, onRests) : withRecovery(definition, null))} />
      </div>
      {recovery
        ? <RecoveryFields recovery={recovery} definition={definition} edit={edit} api={api} />
        : <p style={why}>None. A pool each character spends to heal at a rest, like D&amp;D&apos;s hit dice or 13th Age&apos;s recoveries: turn it on to name it and choose how it works.</p>}
      <div style={settings}>
        <FieldName beside hint={HINTS['rests.finish']} style={small}>RESTS ARE FINISHED</FieldName>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span role="group" aria-label="Rests are finished" style={segs}>
            <button type="button" aria-pressed={finish === 'call'} style={seg(finish === 'call')} onClick={() => edit(withFinish(definition, 'call'))}>AT THE GM&apos;S CALL</button>
            <button type="button" aria-pressed={finish === 'sheet'} style={seg(finish === 'sheet')} onClick={() => edit(withFinish(definition, 'sheet'))}>ON EACH SHEET</button>
          </span>
          <span style={{ ...why, fontSize: 11 }}>
            {finish === 'sheet'
              ? 'A called rest opens a REST panel on every player\'s sheet, and applies to each when they press FINISH. NPCs finish at once.'
              : 'A called rest applies to everyone at once.'}
          </span>
        </div>
      </div>
      {(recovery || finish === 'sheet') && (
        <p style={{ ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 }}>
          COMING NEXT: the pools on each sheet and the REST panel. Until then these are saved with the system, and rests apply at the GM&apos;s call.
        </p>
      )}
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
              {r.standard ? <ToggleSwitch on={r.on} name={`${r.name} on`} onChange={(on) => edit(withRest(definition, r.id, { on }))} /> : <span />}
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
      {current && <Detail key={current.id} rest={current} definition={definition} edit={edit} targets={targets} api={api} />}
      <Resting definition={definition} edit={edit} api={api} />
    </div>
  );
}
