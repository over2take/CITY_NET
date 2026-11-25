import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  damageList, damageCount, withDamageType, withNewDamageType, withoutDamageType, meaningTyped, withMeaning, nameTrouble,
  worksOutOf, withWorksOut, workOutOf, withWorkOut, applyOf, withApply, unpublishedOf,
  LIMITS, KINDS, MEANS, STANDARD, WORKS_OUT, WORKS_OUT_WORDS, APPLY, type Listed, type Kind, type WorksOut,
} from '../sheets/damageTypes';
import { DAMAGE_ICON_IDS } from '../sheets/conditionIcons';
import { PicturePicker, OnTheRing } from './PicturePicker';
import { IconLook } from './IconLook';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';

// The builder's DAMAGE TYPES page (8b1b; approved mockup docs/mockups/damage-pipeline.html, section 1, answered 2026-11-23):
// what kind of hurt a hit is. At the top, what RESIST, IMMUNE and VULNERABLE mean in this game; below, the starter set with a
// switch each, edited or switched off, and the system's own, added and deleted, laid out as CONDITIONS is. Each type's name
// (what a hit says: "2d6 FIRE DMG"), its picture (a drawn icon, an upload, or a drawing on the 16 x 16 pad), and what it is.
// What a hit does (8b5b; the mockup's answers 3 and 5): beside each word, what it WORKS OUT AS (HALF, NONE, DOUBLE, WORDS
// ONLY); under them WORK IT OUT, and APPLY DAMAGE (AUTO, CONFIRM, OFF), each the system's start, a table's to overrule.
// What it reads and writes is sheets/damageTypes.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For uploading an icon; without it only the drawn icons and DRAW are offered. */
  api?: ReturnType<typeof systemsApi>;
  /** The version the table runs, for what a draft hasn't reached yet (8b5b); none where never published. */
  published?: Definition | null;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const WORD: Record<Kind, string> = { resist: 'RESIST', immune: 'IMMUNE', vulnerable: 'VULNERABLE' };
const APPLY_WORDS = {
  auto: 'AUTO: a hit is taken off its target\'s health at once, worked out as above.',
  confirm: 'CONFIRM: a hit waits on its target\'s HEALTH until the GM, or the player it belongs to, applies or dismisses it.',
  off: 'OFF: rolled and logged only; the table does the sums.',
} as const;

/** What RESIST, IMMUNE and VULNERABLE mean in this game, in words, and what each does to a hit; how a hit is taken (8b5b). */
function Meanings({ definition, edit, published }: Props) {
  const workOut = workOutOf(definition);
  const apply = applyOf(definition);
  const unpublished = unpublishedOf(definition, published);
  const notYet = (words?: string) => words && <span role="note" style={{ ...why, fontSize: 11, color: 'var(--warning)', flexBasis: '100%' }}>{words}</span>;
  return (
    <section aria-label="In this game" style={{ border: '1px solid var(--dark-green)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 1100 }}>
      <span style={small}>IN THIS GAME</span>
      <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr) auto auto', gap: '8px 12px', alignItems: 'center' }}>
        {KINDS.map((k) => (
          <React.Fragment key={k}>
            <FieldName beside htmlFor={`damage-means-${k}`} hint={HINTS['damage.means']} style={small}>{WORD[k]}</FieldName>
            <input id={`damage-means-${k}`} type="text" maxLength={LIMITS.means} value={meaningTyped(definition, k)} placeholder={MEANS[k]} style={input}
              onChange={(e) => edit(withMeaning(definition, k, e.target.value))} />
            <FieldName beside htmlFor={`damage-works-${k}`} hint={HINTS['damage.worksOut']} style={{ ...small, opacity: workOut ? 0.75 : 0.4 }}>WORKS OUT AS</FieldName>
            <select id={`damage-works-${k}`} aria-label={`${WORD[k]} works out as`} value={worksOutOf(definition, k)} style={{ ...input, opacity: workOut ? 1 : 0.5 }}
              onChange={(e) => edit(withWorksOut(definition, k, e.target.value as WorksOut))}>
              {WORKS_OUT.map((w) => <option key={w} value={w}>{WORKS_OUT_WORDS[w]}</option>)}
            </select>
          </React.Fragment>
        ))}
        <FieldName beside hint={HINTS['damage.workOut']} style={small}>WORK IT OUT</FieldName>
        <span style={{ ...row, gridColumn: '2 / -1' }}>
          <ToggleSwitch on={workOut} name="Work out resistances" onChange={(on) => edit(withWorkOut(definition, on))} />
          <span style={{ ...why, fontSize: 11 }}>{workOut
            ? 'On: a hit\'s number changes as each word WORKS OUT AS says.'
            : 'Off: every hit is taken as rolled, its resistances said beside it.'}</span>
          {notYet(unpublished.workOut)}
        </span>
        <FieldName beside hint={HINTS['damage.apply']} style={small}>APPLY DAMAGE</FieldName>
        <span style={{ ...row, gridColumn: '2 / -1' }}>
          <span role="group" aria-label="Apply damage" style={{ display: 'inline-flex' }}>
            {APPLY.map((a) => (
              <button key={a} type="button" className="utility-btn" aria-pressed={apply === a} onClick={() => edit(withApply(definition, a))}
                style={{ ...btn, borderStyle: 'solid', background: apply === a ? 'var(--green)' : 'none', color: apply === a ? 'var(--black)' : 'var(--green)' }}>
                {a.toUpperCase()}
              </button>
            ))}
          </span>
          <span style={{ ...why, fontSize: 11, flex: '1 1 260px' }}>{APPLY_WORDS[apply]}</span>
          {notYet(unpublished.apply)}
        </span>
      </div>
      <p style={{ ...why, fontSize: 11 }}>The words show with a character&apos;s resistances on the HEALTH page. WORK IT OUT and APPLY DAMAGE are where your game starts: a table changes them in the GAME tab&apos;s HOUSE RULES.</p>
    </section>
  );
}

function Detail({ t, definition, edit, api }: Props & { t: Listed }) {
  const [confirm, setConfirm] = useState(false);
  const base = STANDARD.find((s) => s.id === t.id);
  const set = (patch: Parameters<typeof withDamageType>[2]) => edit(withDamageType(definition, t.id, patch));
  const stored = ((definition.damage as { types?: Record<string, Record<string, unknown>> } | undefined)?.types ?? {})[t.id] ?? {};
  const typedName = typeof stored.name === 'string' ? stored.name : (base ? '' : t.name);
  const trouble = nameTrouble(definition, t.id);
  const name = (t.name.trim() || t.id).toUpperCase();

  return (
    <section aria-label={`${t.name || t.id} damage type`} style={{ border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>{base ? 'STARTER TYPE' : 'ONE OF THIS SYSTEM\'S OWN'}</span>
        {base
          ? <span style={why}>{t.on ? 'On: offered for hits and resistances.' : 'Off: hidden everywhere, kept.'}</span>
          : confirm
            ? <span style={row}>
                <span style={{ ...why, color: 'var(--danger)' }}>Delete {t.name || 'this type'}?</span>
                <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => edit(withoutDamageType(definition, t.id))}>DELETE</button>
                <button type="button" className="utility-btn" style={btn} onClick={() => setConfirm(false)}>KEEP</button>
              </span>
            : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setConfirm(true)}>DELETE</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' }}>
        <FieldName beside htmlFor={`damage-name-${t.id}`} hint={HINTS['damage.name']} style={small}>NAME</FieldName>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <input id={`damage-name-${t.id}`} type="text" maxLength={LIMITS.name} value={typedName} placeholder={base?.name ?? 'Name'} style={input}
            aria-invalid={trouble ? true : undefined} aria-describedby={trouble ? `damage-trouble-${t.id}` : undefined}
            onChange={(e) => set({ name: e.target.value })} />
          {trouble && <span id={`damage-trouble-${t.id}`} role="alert" style={{ ...why, fontSize: 11, color: 'var(--danger)' }}>{trouble}</span>}
        </div>
        <FieldName beside hint={HINTS['damage.icon']} style={small}>ICON</FieldName>
        <PicturePicker icon={t.icon} drawn={t.drawn} icons={DAMAGE_ICON_IDS} api={api} name={t.name || t.id}
          onIcon={(icon) => set({ icon })} onDrawn={(drawn) => set({ drawn })} preview={(rows) => <OnTheRing drawn={rows} />} />
        <FieldName beside htmlFor={`damage-desc-${t.id}`} hint={HINTS['damage.description']} style={small}>DESCRIPTION</FieldName>
        <textarea id={`damage-desc-${t.id}`} rows={2} maxLength={LIMITS.description} value={t.description} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          onChange={(e) => set({ description: e.target.value })} />
        <FieldName beside hint={HINTS['damage.readAs']} style={small}>READ AS</FieldName>
        <span style={{ ...why, fontSize: 11 }} aria-label="Read as">&quot;2d6 {name} DMG&quot; on a line, any case; {name} on a resistance.</span>
      </div>
    </section>
  );
}

export function DamageTypesPage({ definition, edit, api, published }: Props) {
  const list = damageList(definition);
  const [picked, setPicked] = useState<string>(list[0]?.id ?? '');
  const current = list.find((t) => t.id === picked) ?? list[0];
  const count = damageCount(definition);

  const add = () => {
    const made = withNewDamageType(definition);
    if (!made) return;
    edit(made.definition);
    setPicked(made.id);
  };

  return (
    <div data-testid="damage-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Meanings definition={definition} edit={edit} published={published} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1100 }}>
        <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...row, justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)' }}>
            <span style={small}>{list.filter((t) => t.on).length} ON · {count} OF {LIMITS.types}</span>
            <button type="button" className="utility-btn" style={btn} disabled={count >= LIMITS.types} onClick={add}>+ TYPE</button>
          </div>
          <ul aria-label="Damage types" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((t) => (
              <li key={t.id} style={{
                display: 'grid', gridTemplateColumns: '28px 18px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '6px 10px',
                borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)',
                background: t.id === current?.id ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none',
                boxShadow: t.id === current?.id ? 'inset 3px 0 0 var(--green)' : 'none',
              }}>
                {t.standard
                  ? <ToggleSwitch on={t.on} name={`${t.name} on`} onChange={(on) => edit(withDamageType(definition, t.id, { on }))} />
                  : <span />}
                <span style={{ color: 'var(--green)', opacity: t.on ? 1 : 0.4 }}><IconLook icon={t.icon} drawn={t.drawn} size={18} /></span>
                <button type="button" aria-current={t.id === current?.id || undefined} onClick={() => setPicked(t.id)}
                  style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1,
                    color: nameTrouble(definition, t.id) ? 'var(--danger)' : 'var(--green)', opacity: t.on ? 1 : 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(t.name.trim() || 'NEEDS A NAME').toUpperCase()}
                </button>
                <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.6 }}>{t.standard ? '' : 'OWN'}</span>
              </li>
            ))}
          </ul>
        </div>
        {current && <Detail key={current.id} t={current} definition={definition} edit={edit} api={api} />}
      </div>
    </div>
  );
}
