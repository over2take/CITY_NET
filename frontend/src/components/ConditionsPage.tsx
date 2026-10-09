import React, { useEffect, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  conditionList, conditionCount, withCondition, withNewCondition, withoutCondition, modifierTargets,
  LIMITS, ALL_ROLLS, STANDARD, type Listed,
} from '../sheets/conditions';
import { ConditionIcon } from './ConditionIcon';
import { ConditionIconPicker } from './ConditionIconPicker';

// The builder's CONDITIONS page (4e1b; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09): what can happen to a character besides losing health. The standard set, each with
// a switch, edited or turned off; the system's own, added and deleted; each one's name, chip label,
// icon (drawn, or uploaded), description, how it ends, and its modifiers. What it reads and writes
// is sheets/conditions.ts; every change goes through the builder's `edit`.

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

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ width: 28, height: 14, borderRadius: 7, border: '1px solid var(--green)', padding: 0, position: 'relative', cursor: 'pointer', flexShrink: 0,
        background: on ? 'color-mix(in srgb, var(--green) 30%, transparent)' : 'none' }}>
      <span aria-hidden style={{ position: 'absolute', top: 1, left: on ? 15 : 1, width: 10, height: 10, borderRadius: '50%', background: 'var(--green)' }} />
    </button>
  );
}

function Detail({ c, definition, edit, api }: Props & { c: Listed }) {
  const [confirm, setConfirm] = useState(false);
  const base = STANDARD.find((s) => s.id === c.id);
  const targets = modifierTargets(definition);
  const set = (patch: Parameters<typeof withCondition>[2]) => edit(withCondition(definition, c.id, patch));
  const stored = (definition.conditions as Record<string, Record<string, unknown>> | undefined)?.[c.id] ?? {};
  const typed = (key: 'name' | 'short') => (typeof stored[key] === 'string' ? stored[key] as string : (base ? '' : c[key]));

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
      <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' }}>
        <label style={{ ...small, textAlign: 'right' }} htmlFor={`cond-name-${c.id}`}>NAME</label>
        <input id={`cond-name-${c.id}`} type="text" maxLength={LIMITS.name} value={typed('name')} placeholder={base?.name ?? 'Name'} style={input}
          aria-invalid={!base && !c.name.trim() ? true : undefined}
          onChange={(e) => set({ name: e.target.value })} />
        <label style={{ ...small, textAlign: 'right' }} htmlFor={`cond-short-${c.id}`}>ON THE CHIP</label>
        <input id={`cond-short-${c.id}`} type="text" maxLength={LIMITS.short} value={typed('short')} placeholder={c.short} style={{ ...input, width: 120 }}
          onChange={(e) => set({ short: e.target.value.toUpperCase() })} />
        <span style={{ ...small, textAlign: 'right' }}>ICON</span>
        <ConditionIconPicker value={c.icon} onPick={(icon) => set({ icon })} api={api} name={c.name || c.id} />
        <label style={{ ...small, textAlign: 'right' }} htmlFor={`cond-desc-${c.id}`}>DESCRIPTION</label>
        <textarea id={`cond-desc-${c.id}`} rows={2} maxLength={LIMITS.description} value={c.description} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          onChange={(e) => set({ description: e.target.value })} />
        <label style={{ ...small, textAlign: 'right' }} htmlFor={`cond-ends-${c.id}`}>ENDS</label>
        <div style={row}>
          <select id={`cond-ends-${c.id}`} value={c.ends} style={input} onChange={(e) => set({ ends: e.target.value as Listed['ends'] })}>
            <option value="removed">WHEN REMOVED</option>
            <option value="rounds">AFTER ROUNDS</option>
            <option value="refresh" disabled>AT A REFRESH EVENT (COMING)</option>
          </select>
          {c.ends === 'rounds' && <>
            <WholeBox aria="Rounds" value={c.rounds ?? 1} min={1} max={LIMITS.rounds} onChange={(n) => set({ rounds: n })} />
            <span style={{ ...why, fontSize: 11 }}>rounds, unless changed when it&apos;s put on</span>
          </>}
        </div>
        <span style={{ ...small, textAlign: 'right' }}>MODIFIERS</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {c.modifiers.map((m, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 70px auto', gap: 6 }}>
              <select aria-label={`Modifier ${i + 1} target`} value={m.target} style={input}
                onChange={(e) => set({ modifiers: c.modifiers.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)) })}>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                {!targets.some((t) => t.id === m.target) && <option value={m.target}>{m.target} (GONE)</option>}
              </select>
              <WholeBox aria={`Modifier ${i + 1} amount`} value={m.amount} min={-LIMITS.amount} max={LIMITS.amount} width={70}
                onChange={(n) => set({ modifiers: c.modifiers.map((x, j) => (j === i ? { ...x, amount: n } : x)) })} />
              <button type="button" className="utility-btn danger-btn" style={btn} aria-label={`Remove modifier ${i + 1}`}
                onClick={() => set({ modifiers: c.modifiers.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <div>
            <button type="button" className="utility-btn" style={btn} disabled={c.modifiers.length >= LIMITS.modifiers}
              onClick={() => set({ modifiers: [...c.modifiers, { target: ALL_ROLLS, amount: -1 }] })}>+ MODIFIER</button>
          </div>
          <p style={{ ...why, fontSize: 11, borderLeft: '3px solid var(--warning)', paddingLeft: 8 }}>
            Shown to the GM and the token&apos;s owner as a reminder. They change no number until this system&apos;s rolls are built.
          </p>
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
                ? <Switch on={c.on} label={`${c.name} on`} onChange={(on) => edit(withCondition(definition, c.id, { on }))} />
                : <span />}
              <span style={{ color: 'var(--green)', opacity: c.on ? 1 : 0.4 }}><ConditionIcon icon={c.icon} /></span>
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
