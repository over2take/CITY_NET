import React, { useEffect, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  conditionList, conditionCount, withCondition, withNewCondition, withoutCondition, modifierTargets, withModifier, amountFrom,
  withEachTurn, eachTurnWords, rollNamed, NEW_EACH_TURN, WHENS, DOES,
  LIMITS, ALL_ROLLS, STANDARD, type Listed, type ConditionPatch, type Modifier, type ModifierWay, type EachTurn,
} from '../sheets/conditions';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { restList } from '../sheets/rests';
import { ConditionIcon } from './ConditionIcon';
import { PicturePicker, OnAChip } from './PicturePicker';
import { OnlyWith } from './OnlyWith';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';

// The builder's CONDITIONS page (4e1b; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09): what can happen to a character besides losing health. The standard set, each with
// a switch, edited or turned off; the system's own, added and deleted; each one's name, chip label,
// icon (drawn, or uploaded), description, how it ends (when removed, after rounds, or at a rest,
// 4f4b), and its modifiers. What it reads and writes
// is sheets/conditions.ts; every change goes through the builder's `edit`.
//
// A modifier's way and a formula amount, and ITS MODIFIERS A REMINDER or APPLIED (8a5e2; approved mockup
// docs/mockups/condition-modifiers.html, 2026-11-18): ADD, TIMES, SET TO or AT MOST, the amount a formula box with eˣ, ALL
// ROLLS adding a whole number as before; APPLIED, a character whose token has it sees the number change.
//
// EACH TURN (8a9b; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19): up to three things a condition does on
// initiative turns, none to start: WHEN, DOES, its ROLL (a dice box reading the sheet), ENDS ON for a save, CHANGES HP for
// damage and healing, ROLLED BY, and the line in the GM's words. And ENDS AT THE END OF ITS NEXT TURN.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For uploading an icon; without it only the drawn icons are offered. */
  api?: ReturnType<typeof systemsApi>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const choice = (on: boolean): React.CSSProperties => ({ ...btn, padding: '3px 10px', border: '1px solid var(--dark-green)', cursor: 'pointer',
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)' });

/**
 * A whole number box that keeps what is typed: a lone minus sign, or a field cleared to type
 * again, stays as typed rather than becoming 0 under the cursor.
 */
function WholeBox({ aria, value, min, max, width = 64, onChange }: { aria: string; value: number; min: number; max: number; width?: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(value))); }, [value]);
  return (
    <input type="text" inputMode="numeric" aria-label={aria} value={text} style={{ ...input, width }}
      onChange={(e) => {
        setText(e.target.value);
        if (/^-?\d+$/.test(e.target.value.trim())) onChange(Math.max(min, Math.min(max, parseInt(e.target.value, 10))));
      }} />
  );
}


/**
 * AT A REST (4f4b; approved mockup builder-rests, 2026-10-09): the rests that end a condition, ticked
 * here or as WEARS OFF on the RESTS page, the same setting. The rests that are on, and any picked one
 * since turned off, so it can be unticked.
 */
function EndsAt({ c, definition, set }: { c: Listed; definition: Definition; set: (patch: ConditionPatch) => void }) {
  const at = c.at ?? [];
  const offered = restList(definition).filter((r) => r.on || at.includes(r.id));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexBasis: '100%', minWidth: 0 }}>
      <div role="group" aria-label="Ends at" style={{ ...row, gap: 4 }}>
        {offered.map((r) => {
          const on = at.includes(r.id);
          return (
            <button key={r.id} type="button" role="checkbox" aria-checked={on}
              onClick={() => set({ ends: 'rest', at: on ? at.filter((a) => a !== r.id) : [...at, r.id] })}
              style={{ ...btn, cursor: 'pointer', fontWeight: 'normal', opacity: r.on ? 1 : 0.5,
                border: `1px solid ${on ? 'var(--warning)' : 'var(--dark-green)'}`, color: on ? 'var(--warning)' : 'var(--green)',
                background: on ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'none' }}>
              {(r.name || r.id).toUpperCase()}{!r.on && ' (OFF)'}
            </button>
          );
        })}
      </div>
      <span style={{ ...why, fontSize: 11, ...(at.length ? {} : { color: 'var(--warning)' }) }}>
        {at.length ? 'Comes off at any of these, or a rest that counts as one. The RESTS page shows the same choice.' : 'Pick at least one rest.'}
      </span>
    </div>
  );
}

/** A modifier's ways, as the box says them (8a5e2). */
const WAY_WORDS: [ModifierWay, string][] = [['add', 'ADD'], ['times', 'TIMES'], ['set', 'SET TO'], ['most', 'AT MOST']];

/**
 * One modifier (8a5e2): what it changes, its way, its amount and ×. ALL ROLLS only adds a whole number; a stat or formula takes a
 * formula box, eˣ to help write it, a number kept as a number.
 */
function ModifierRow({ m, i, definition, api, targets, put, remove }: {
  m: Modifier; i: number; definition: Definition; api?: Props['api']; targets: { id: string; label: string }[];
  put: (next: Modifier) => void; remove: () => void;
}) {
  const rolls = m.target === ALL_ROLLS;
  const amount = useFormulaBox({
    // Its sample said its way (8a5e2): ×0.5, to 0, at most 10; an ADD signed, as a formula's is.
    definition, api, kind: m.way && m.way !== 'add' ? m.way : 'formula', value: String(m.amount), onChange: (text) => put(withModifier(m, { amount: amountFrom(text) })),
    label: `Modifier ${i + 1} amount`, placeholder: '0.5', maxLength: LIMITS.formula, inputStyle: { ...input, width: '100%' },
  });
  return (
    <div role="group" aria-label={`Modifier ${i + 1}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 100px minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
        <select aria-label={`Modifier ${i + 1} target`} value={m.target} style={input} onChange={(e) => put(withModifier(m, { target: e.target.value }))}>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          {!targets.some((t) => t.id === m.target) && <option value={m.target}>{m.target} (GONE)</option>}
        </select>
        <select aria-label={`Modifier ${i + 1} way`} value={rolls ? 'add' : m.way ?? 'add'} disabled={rolls} title={rolls ? 'All rolls only take an ADD' : undefined} style={input}
          onChange={(e) => put(withModifier(m, { way: e.target.value as ModifierWay }))}>
          {WAY_WORDS.map(([w, word]) => <option key={w} value={w}>{word}</option>)}
        </select>
        {rolls
          ? <WholeBox aria={`Modifier ${i + 1} amount`} value={typeof m.amount === 'number' ? m.amount : -1} min={-LIMITS.amount} max={LIMITS.amount} width={70}
              onChange={(n) => put(withModifier(m, { amount: n }))} />
          : amount.field}
        <button type="button" className="utility-btn danger-btn" style={btn} aria-label={`Remove modifier ${i + 1}`} onClick={remove}>×</button>
      </div>
      {!rolls && amount.help}
    </div>
  );
}

/** One EACH TURN (8a9b): WHEN and DOES, the ROLL, what goes with what it does, who rolls it, ×, and the line in words. */
function EachTurnRow({ e, i, name, definition, api, put, remove }: {
  e: EachTurn; i: number; name: string; definition: Definition; api?: Props['api'];
  put: (next: EachTurn) => void; remove: () => void;
}) {
  const label = `Each turn ${i + 1}`;
  const roll = useFormulaBox({
    definition, api, kind: 'refill', value: e.roll, onChange: (text) => put(withEachTurn(e, { roll: text })),
    label: `${label} roll`, placeholder: '1d4', maxLength: LIMITS.formula, inputStyle: { ...input, width: '100%' },
  });
  const hp = e.does === 'damage' || e.does === 'heal';
  return (
    <div role="group" aria-label={label} style={{ borderLeft: '2px solid var(--cyan)', paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
        <select aria-label={`${label} when`} value={e.when} style={input} onChange={(ev) => put(withEachTurn(e, { when: ev.target.value as EachTurn['when'] }))}>
          {WHENS.map(([w, word]) => <option key={w} value={w}>{word}</option>)}
        </select>
        <select aria-label={`${label} does`} value={e.does} style={input} onChange={(ev) => put(withEachTurn(e, { does: ev.target.value as EachTurn['does'] }))}>
          {DOES.map(([d, word]) => <option key={d} value={d}>{word}</option>)}
        </select>
        <button type="button" className="utility-btn danger-btn" style={btn} aria-label={`Remove each turn ${i + 1}`} onClick={remove}>×</button>
      </div>
      {roll.field}
      {roll.help}
      {e.does === 'roll_to_end' && (
        <span style={row}>
          <span style={small}>ENDS ON</span>
          <WholeBox aria={`${label} ends on`} value={e.ends_on ?? 10} min={-LIMITS.endsOn} max={LIMITS.endsOn} onChange={(n) => put(withEachTurn(e, { ends_on: n }))} />
          <span style={{ ...why, fontSize: 11 }}>or more takes it off</span>
        </span>
      )}
      {hp && (
        <span role="group" aria-label={`${label} changes HP`} style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
          <button type="button" aria-pressed={e.changes_hp !== false} style={choice(e.changes_hp !== false)} onClick={() => put(withEachTurn(e, { changes_hp: true }))}>ON ITS OWN</button>
          <button type="button" aria-pressed={e.changes_hp === false} style={choice(e.changes_hp === false)} onClick={() => put(withEachTurn(e, { changes_hp: false }))}>ROLL ONLY, THE GM APPLIES</button>
        </span>
      )}
      <span role="group" aria-label={`${label} rolled by`} style={{ display: 'inline-flex', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        <button type="button" aria-pressed={e.rolled_by === 'player'} style={choice(e.rolled_by === 'player')} onClick={() => put(withEachTurn(e, { rolled_by: 'player' }))}>THE PLAYER · THE GM FOR AN NPC</button>
        <button type="button" aria-pressed={e.rolled_by !== 'player'} style={choice(e.rolled_by !== 'player')} onClick={() => put(withEachTurn(e, { rolled_by: 'table' }))}>THE TABLE</button>
      </span>
      <p role="note" aria-label={`${label} in words`} style={{ ...why, fontSize: 11, color: 'var(--cyan)' }}>{eachTurnWords(name, e, rollNamed(definition))}</p>
    </div>
  );
}

function Detail({ c, definition, edit, api }: Props & { c: Listed }) {
  const [confirm, setConfirm] = useState(false);
  const base = STANDARD.find((s) => s.id === c.id);
  const targets = modifierTargets(definition);
  const set = (patch: Parameters<typeof withCondition>[2]) => edit(withCondition(definition, c.id, patch));
  const stored = (definition.conditions as Record<string, Record<string, unknown>> | undefined)?.[c.id] ?? {};
  const typed = (key: 'name' | 'short') => (typeof stored[key] === 'string' ? stored[key] as string : (base ? '' : c[key]));
  // EACH TURN as stored (8a9b): what the GM typed, a roll not yet typed included, never the server's tidied copy.
  const eachTurn = (Array.isArray(stored.each_turn) ? stored.each_turn : []) as EachTurn[];

  return (
    <section aria-label={`${c.name || c.id} condition`} style={{ border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>{base ? 'STANDARD CONDITION' : 'ONE OF THIS SYSTEM\'S OWN'}</span>
        {base
          ? <span style={why}>{c.on ? 'On: offered for tokens.' : 'Off: not offered for tokens.'}</span>
          : confirm
            ? <span style={row}>
                <span style={{ ...why, color: 'var(--danger)' }}>Delete {c.name || 'this condition'}?</span>
                <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => edit(withoutCondition(definition, c.id))}>DELETE</button>
                <button type="button" className="utility-btn" style={btn} onClick={() => setConfirm(false)}>KEEP</button>
              </span>
            : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setConfirm(true)}>DELETE</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' }}>
        <FieldName beside htmlFor={`cond-name-${c.id}`} style={small}>NAME</FieldName>
        <input id={`cond-name-${c.id}`} type="text" maxLength={LIMITS.name} value={typed('name')} placeholder={base?.name ?? 'Name'} style={input}
          aria-invalid={!base && !c.name.trim() ? true : undefined}
          onChange={(e) => set({ name: e.target.value })} />
        <FieldName beside htmlFor={`cond-short-${c.id}`} hint={HINTS['conditions.chip']} style={small}>ON THE CHIP</FieldName>
        <input id={`cond-short-${c.id}`} type="text" maxLength={LIMITS.short} value={typed('short')} placeholder={c.short} style={{ ...input, width: 120 }}
          onChange={(e) => set({ short: e.target.value.toUpperCase() })} />
        <FieldName beside hint={HINTS['conditions.icon']} style={small}>ICON</FieldName>
        <PicturePicker icon={c.icon} drawn={c.drawn} api={api} name={c.name || c.id} onIcon={(icon) => set({ icon })} onDrawn={(drawn) => set({ drawn })}
          preview={(rows) => <OnAChip drawn={rows} short={c.short} />} />
        <FieldName beside htmlFor={`cond-desc-${c.id}`} hint={HINTS['conditions.description']} style={small}>DESCRIPTION</FieldName>
        <textarea id={`cond-desc-${c.id}`} rows={2} maxLength={LIMITS.description} value={c.description} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          onChange={(e) => set({ description: e.target.value })} />
        <FieldName beside htmlFor={`cond-ends-${c.id}`} hint={HINTS['conditions.ends']} style={small}>ENDS</FieldName>
        <div style={row}>
          <select id={`cond-ends-${c.id}`} value={c.ends} style={input} onChange={(e) => set({ ends: e.target.value as Listed['ends'] })}>
            <option value="removed">WHEN REMOVED</option>
            <option value="rounds">AFTER ROUNDS</option>
            <option value="rest">AT A REST</option>
            <option value="next_turn">AT THE END OF ITS NEXT TURN</option>
          </select>
          {c.ends === 'next_turn' && <span style={{ ...why, fontSize: 11 }}>comes off on its own when NEXT ends this character&apos;s next turn</span>}
          {c.ends === 'rounds' && <>
            <WholeBox aria="Rounds" value={c.rounds ?? 1} min={1} max={LIMITS.rounds} onChange={(n) => set({ rounds: n })} />
            <span style={{ ...why, fontSize: 11 }}>rounds, unless changed when it&apos;s put on</span>
          </>}
          {c.ends === 'rest' && <EndsAt c={c} definition={definition} set={set} />}
        </div>
        <OnlyWith definition={definition} value={typeof stored.only_with === 'string' ? stored.only_with : undefined} style={small} beside
          selectStyle={{ ...input, justifySelf: 'start' }} onChange={(rule) => set({ only_with: rule })} />
        <FieldName beside hint={HINTS['conditions.applied']} style={small}>ITS MODIFIERS</FieldName>
        <span role="group" aria-label="Its modifiers" style={{ display: 'inline-flex', justifySelf: 'start' }}>
          <button type="button" aria-pressed={!c.applied} style={choice(!c.applied)} onClick={() => set({ applied: false })}>A REMINDER</button>
          <button type="button" aria-pressed={!!c.applied} style={choice(!!c.applied)} onClick={() => set({ applied: true })}>APPLIED</button>
        </span>
        <FieldName beside hint={HINTS['conditions.modifiers']} style={small}>MODIFIERS</FieldName>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          {c.modifiers.map((m, i) => (
            <ModifierRow key={i} m={m} i={i} definition={definition} api={api} targets={targets}
              put={(next) => set({ modifiers: c.modifiers.map((x, j) => (j === i ? next : x)) })}
              remove={() => set({ modifiers: c.modifiers.filter((_, j) => j !== i) })} />
          ))}
          <div>
            <button type="button" className="utility-btn" style={btn} disabled={c.modifiers.length >= LIMITS.modifiers}
              onClick={() => set({ modifiers: [...c.modifiers, { target: ALL_ROLLS, amount: -1 }] })}>+ MODIFIER</button>
          </div>
          <p role="note" aria-label="What its modifiers do" style={{ ...why, fontSize: 11, borderLeft: '3px solid var(--warning)', paddingLeft: 8 }}>
            {c.applied
              ? 'APPLIED: a character whose token has it sees these numbers change on their sheet, after every other bonus, and back when it comes off. Conditions don\'t stack: of two changing one number one way, the stronger counts. A table can keep them reminders on the GAME tab.'
              : 'A REMINDER: shown to the GM and the token\'s owner, changing no number.'}
            {c.modifiers.some((m) => m.target === ALL_ROLLS) ? ' ALL ROLLS always reaches every roll of this system\'s own.' : ''}
          </p>
        </div>
        <FieldName beside hint={HINTS['conditions.eachTurn']} style={small}>EACH TURN</FieldName>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {eachTurn.map((e, i) => (
            <EachTurnRow key={i} e={e} i={i} name={c.name || c.id} definition={definition} api={api}
              put={(next) => set({ each_turn: eachTurn.map((x, j) => (j === i ? next : x)) })}
              remove={() => set({ each_turn: eachTurn.filter((_, j) => j !== i) })} />
          ))}
          <div style={row}>
            <button type="button" className="utility-btn" style={btn} disabled={eachTurn.length >= LIMITS.eachTurn}
              onClick={() => set({ each_turn: [...eachTurn, NEW_EACH_TURN] })}>+ EACH TURN</button>
            {!eachTurn.length && <span style={{ ...why, fontSize: 11 }}>Nothing on turns: a reminder until someone takes it off.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ConditionsPage({ definition, edit, api }: Props) {
  const list = conditionList(definition);
  const [picked, setPicked] = useState<string>(list[0]?.id ?? '');
  const current = list.find((c) => c.id === picked) ?? list[0];
  const count = conditionCount(definition);

  const add = () => {
    const made = withNewCondition(definition);
    if (!made) return;
    edit(made.definition);
    setPicked(made.id);
  };

  return (
    <div data-testid="conditions-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1100 }}>
      <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...row, justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)' }}>
          <span style={small}>{list.filter((c) => c.on).length} ON · {count} OF {LIMITS.conditions}</span>
          <button type="button" className="utility-btn" style={btn} disabled={count >= LIMITS.conditions} onClick={add}>+ CONDITION</button>
        </div>
        <ul aria-label="Conditions" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {list.map((c) => (
            <li key={c.id} style={{
              display: 'grid', gridTemplateColumns: '28px 18px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '6px 10px',
              borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)',
              background: c.id === current?.id ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none',
              boxShadow: c.id === current?.id ? 'inset 3px 0 0 var(--green)' : 'none',
            }}>
              {c.standard
                ? <ToggleSwitch on={c.on} name={`${c.name} on`} onChange={(on) => edit(withCondition(definition, c.id, { on }))} />
                : <span />}
              <span style={{ color: 'var(--green)', opacity: c.on ? 1 : 0.4 }}><ConditionIcon icon={c.icon} drawn={c.drawn} /></span>
              <button type="button" aria-current={c.id === current?.id || undefined} onClick={() => setPicked(c.id)}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1,
                  color: c.name.trim() ? 'var(--green)' : 'var(--danger)', opacity: c.on ? 1 : 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(c.name.trim() || 'NEEDS A NAME').toUpperCase()}
              </button>
              <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.6 }}>{c.standard ? '' : 'OWN'}</span>
            </li>
          ))}
        </ul>
      </div>
      {current && <Detail key={current.id} c={current} definition={definition} edit={edit} api={api} />}
    </div>
  );
}
