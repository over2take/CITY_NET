import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  featureList, levelOf, kindsOf, withNewFeature, withFeature, withoutFeature, modifierTargets, refillRests, rollChoices, choiceLists, pickedOf, unlocksByLevel, LIMITS,
  type ChoiceList, type ChoiceOption, type Feature, type FeatureKind, type FeaturePatch,
} from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';
import { useFormulaBox } from '../hooks/useFormulaBox';

// An option's features on the CHOICES page (7a2b2; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): what a pick gives, grouped by the level each unlocks at in a levelled list. Each row
// names a feature and tags what it does; the open one shows its name, words, level and every kind
// of thing it can do, several at once: modifiers on a stat, formula or health field, uses a rest
// refills, rolls it gives, changes it lets a roll take, a list it opens. What it reads and writes is
// sheets/choices.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  list: ChoiceList;
  option: ChoiceOption;
  /** The server, for the formula boxes' words and sample values; none when looking at an example. */
  api?: ReturnType<typeof systemsApi>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const xBtn: React.CSSProperties = { ...btn, padding: '2px 7px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: '8px 10px', alignItems: 'start' };
const choice = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 11, padding: '2px 8px', cursor: 'pointer',
});

/** Each kind as a tag: its word and its color, as the mockup has them. */
const TAGS: Record<FeatureKind, [string, string]> = {
  modifier: ['MODIFIER', 'var(--green)'], uses: ['USES', 'var(--cyan)'], roll: ['ROLL', 'var(--warning)'],
  change: ['CHANGE', 'var(--warning)'], choice: ['CHOICE', 'var(--warning)'], text: ['TEXT', 'color-mix(in srgb, var(--green) 60%, transparent)'],
};
const Tag = ({ kind }: { kind: FeatureKind }) => (
  <span style={{ fontSize: 9, letterSpacing: 1, border: '1px solid currentColor', padding: '0 4px', color: TAGS[kind][1], whiteSpace: 'nowrap' }}>{TAGS[kind][0]}</span>
);

type Modifier = NonNullable<Feature['modifiers']>[number];

/** One modifier: what it changes, by how much (a formula box), and × in red; the box's words and help under the row. */
function ModifierRow({ definition, api, i, m, targets, onChange, onRemove }: {
  definition: Definition; api?: Props['api']; i: number; m: Modifier; targets: ReturnType<typeof modifierTargets>;
  onChange: (next: Modifier) => void; onRemove: () => void;
}) {
  const amount = useFormulaBox({
    definition, api, kind: 'amount', value: m.amount, onChange: (text) => onChange({ ...m, amount: text }),
    label: `Modifier ${i + 1}: by`, placeholder: '1 · @mage_level', inputStyle: input,
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr) auto', gap: 6, alignItems: 'center' }}>
        <select aria-label={`Modifier ${i + 1}: changes`} value={m.target} style={input} onChange={(e) => onChange({ ...m, target: e.target.value })}>
          {!targets.some((g) => g.items.some((t) => t.id === m.target)) && <option value={m.target}>{m.target || 'PICK ONE'}</option>}
          {targets.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}
        </select>
        {amount.field}
        <button type="button" className="utility-btn" style={{ ...xBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }} aria-label={`Remove modifier ${i + 1}`} onClick={onRemove}>×</button>
      </span>
      {amount.help}
    </div>
  );
}

function FeatureForm({ definition, edit, list, option, feature, api }: Props & { feature: Feature }) {
  const [asking, setAsking] = useState(false);
  const set = (patch: FeaturePatch) => edit(withFeature(definition, list.id, option.id, feature.id, patch));
  // The level is set when the box is left (or on Enter), not as it is typed: a new level moves the
  // feature to its group, and typing 12 would otherwise move it to 1 and lose the box after the 1.
  const [levelText, setLevelText] = useState(String(levelOf(feature)));
  const commitLevel = () => {
    const n = Math.trunc(Number(levelText));
    if (Number.isFinite(n) && n >= 1) { if (n !== levelOf(feature)) set({ at: n }); } else setLevelText(String(levelOf(feature)));
  };
  const targets = modifierTargets(definition);
  const rests = refillRests(definition);
  const rolls = rollChoices(definition);
  const withChanges = rolls.filter((r) => r.changes.length);
  // A list everyone has is never picked, so no feature opens it.
  const otherLists = choiceLists(definition).filter((c) => c.id !== list.id && pickedOf(c) !== 'everyone');
  const opened = otherLists.find((c) => c.id === feature.choice);
  const mods = feature.modifiers ?? [];
  const changes = feature.changes ?? [];
  const given = new Set(feature.rolls ?? []);
  const id = (part: string) => `feature-${feature.id}-${part}`;
  const name = feature.label.trim() || 'this feature';
  // Made whether or not it has uses (a hook can't wait behind HAS USES); shown only when it does.
  const usesBox = useFormulaBox({
    definition, api, kind: 'uses', value: feature.uses?.count ?? '', onChange: (text) => { if (feature.uses) set({ uses: { ...feature.uses, count: text } }); },
    label: 'How many uses', placeholder: '1 · @level', inputStyle: input,
  });
  return (
    <div role="group" aria-label={`Feature ${feature.label || feature.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', border: '1px solid var(--green)', background: 'color-mix(in srgb, var(--green) 4%, transparent)' }}>
      <div style={grid}>
        <FieldName beside htmlFor={id('name')} hint={HINTS['choices.featureName']} style={small}>NAME</FieldName>
        <input id={id('name')} type="text" maxLength={LIMITS.label} value={feature.label} style={input}
          aria-invalid={!feature.label.trim() ? true : undefined} onChange={(e) => set({ label: e.target.value })} />
        {unlocksByLevel(definition, list) && <>
          <FieldName beside htmlFor={id('at')} hint={HINTS['choices.at']} style={small}>AT LEVEL</FieldName>
          <input id={id('at')} type="number" min={1} max={LIMITS.level} step={1} value={levelText} style={{ ...input, width: 64 }}
            onChange={(e) => setLevelText(e.target.value)} onBlur={commitLevel} onKeyDown={(e) => { if (e.key === 'Enter') commitLevel(); }} />
        </>}
        <FieldName beside htmlFor={id('text')} hint={HINTS['choices.text']} style={small}>WORDS</FieldName>
        <textarea id={id('text')} rows={2} maxLength={LIMITS.description} value={feature.text ?? ''} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          onChange={(e) => set({ text: e.target.value })} />

        <FieldName beside hint={HINTS['choices.modifiers']} style={small}>MODIFIERS</FieldName>
        <div role="group" aria-label="Modifiers" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {mods.map((m, i) => (
            <ModifierRow key={i} definition={definition} api={api} i={i} m={m} targets={targets}
              onChange={(next) => set({ modifiers: mods.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => set({ modifiers: mods.filter((_, j) => j !== i) })} />
          ))}
          <div><button type="button" className="utility-btn" style={btn} disabled={mods.length >= LIMITS.modifiers || !targets.length}
            onClick={() => set({ modifiers: [...mods, { target: targets[0].items[0].id, amount: '1' }] })}>+ MODIFIER</button></div>
          {!targets.length && <span style={{ ...why, fontSize: 11 }}>No stats or formulas yet to change: make them on STATS &amp; RULES.</span>}
        </div>

        <FieldName beside hint={HINTS['choices.uses']} style={small}>USES</FieldName>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <ToggleSwitch label="HAS USES" on={!!feature.uses} style={{ alignSelf: 'start' }}
            onChange={(has) => set({ uses: has ? { count: '1', refill: rests[0]?.id } : null })} />
          {feature.uses && (
            <span style={row}>
              <span style={{ width: 170 }}>{usesBox.field}</span>
              <span style={small}>REFILLED BY</span>
              <select aria-label="Refilled by" value={feature.uses.refill ?? ''} style={input}
                onChange={(e) => set({ uses: { count: feature.uses!.count, refill: e.target.value } })}>
                <option value="">NOTHING: THE GM REFILLS</option>
                {rests.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </span>
          )}
          {feature.uses && usesBox.help}
        </div>

        <FieldName beside hint={HINTS['choices.rolls']} style={small}>GIVES ROLLS</FieldName>
        {rolls.length
          ? <div role="group" aria-label="Gives rolls" style={row}>
              {rolls.map((r) => (
                <button key={r.id} type="button" aria-pressed={given.has(r.id)} style={choice(given.has(r.id))}
                  disabled={!given.has(r.id) && given.size >= LIMITS.rolls}
                  onClick={() => set({ rolls: given.has(r.id) ? (feature.rolls ?? []).filter((x) => x !== r.id) : [...(feature.rolls ?? []), r.id] })}>{r.label}</button>
              ))}
            </div>
          : <span style={{ ...why, fontSize: 11 }}>No rolls yet: make them on STATS &amp; RULES&apos; ROLLS tab.</span>}

        <FieldName beside hint={HINTS['choices.changes']} style={small}>CHANGES A ROLL</FieldName>
        <div role="group" aria-label="Changes a roll" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {changes.map((ch, i) => {
            const roll = withChanges.find((r) => r.id === ch.roll);
            return (
              <span key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
                <select aria-label={`Change ${i + 1}: roll`} value={ch.roll} style={input}
                  onChange={(e) => { const r = withChanges.find((x) => x.id === e.target.value); set({ changes: changes.map((x, j) => (j === i ? { roll: e.target.value, change: r?.changes[0]?.id ?? '' } : x)) }); }}>
                  {!roll && <option value={ch.roll}>{ch.roll || 'PICK ONE'}</option>}
                  {withChanges.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <select aria-label={`Change ${i + 1}: which`} value={ch.change} style={input}
                  onChange={(e) => set({ changes: changes.map((x, j) => (j === i ? { ...x, change: e.target.value } : x)) })}>
                  {!roll?.changes.some((c) => c.id === ch.change) && <option value={ch.change}>{ch.change || 'PICK ONE'}</option>}
                  {(roll?.changes ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove change ${i + 1}`}
                  onClick={() => set({ changes: changes.filter((_, j) => j !== i) })}>×</button>
              </span>
            );
          })}
          <div><button type="button" className="utility-btn" style={btn} disabled={!withChanges.length || changes.length >= LIMITS.rolls}
            onClick={() => set({ changes: [...changes, { roll: withChanges[0].id, change: withChanges[0].changes[0].id }] })}>+ CHANGE</button></div>
          {!withChanges.length && <span style={{ ...why, fontSize: 11 }}>None of the system&apos;s rolls has a change to pick yet, like ADVANTAGE: add one in a roll&apos;s step 5.</span>}
        </div>

        <FieldName beside htmlFor={id('choice')} hint={HINTS['choices.choice']} style={small}>OPENS A LIST</FieldName>
        <select id={id('choice')} value={feature.choice ?? ''} style={{ ...input, justifySelf: 'start' }} onChange={(e) => set({ choice: e.target.value || null })}>
          <option value="">NOTHING</option>
          {otherLists.map((c) => <option key={c.id} value={c.id}>{(c.one || c.id).toUpperCase()}</option>)}
        </select>
        {feature.choice && <>
          <FieldName beside htmlFor={id('count')} hint={HINTS['choices.opensCount']} style={small}>HOW MANY</FieldName>
          <span style={row}>
            <input id={id('count')} type="number" min={1} max={LIMITS.opens} step={1} value={feature.choice_count ?? 1} style={{ ...input, width: 64 }}
              onChange={(e) => { const n = Math.trunc(Number(e.target.value)); if (Number.isFinite(n) && n >= 1) set({ choice_count: n }); }} />
            {opened && pickedOf(opened) === 'own' && (
              <span style={{ ...why, fontSize: 11, color: 'var(--warning)' }}>
                {(opened.many || opened.id).toUpperCase()} is picked on its own, so this only names it. Set it to THROUGH FEATURES or BOTH on its page for a pick here.
              </span>
            )}
          </span>
        </>}
      </div>
      <div style={{ ...row, justifyContent: 'flex-end' }}>
        {asking
          ? <span role="group" aria-label={`Delete ${name}`} style={row}>
              <span style={{ ...why, color: 'var(--danger)' }}>Delete {name}?</span>
              <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => edit(withoutFeature(definition, list.id, option.id, feature.id))}>DELETE</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setAsking(false)}>KEEP</button>
            </span>
          : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setAsking(true)}>DELETE FEATURE</button>}
      </div>
    </div>
  );
}

export function FeaturesEditor({ definition, edit, list, option, api }: Props) {
  const features = featureList(option);
  const [open, setOpen] = useState<string | null>(null);
  // In a list with levels (levelled, everyone's, or opened from one of those), by the level each unlocks at; otherwise all together.
  const levels = unlocksByLevel(definition, list) ? [...new Set(features.map(levelOf))].sort((a, b) => a - b) : [null];
  const add = () => {
    const made = withNewFeature(definition, list.id, option.id, unlocksByLevel(definition, list) && features.length ? Math.max(...features.map(levelOf)) : undefined);
    if (!made) return;
    edit(made.definition);
    setOpen(made.id);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <FieldName hint={HINTS['choices.features']} style={small}>FEATURES · {features.length} OF {LIMITS.features}</FieldName>
        <button type="button" className="utility-btn" style={btn} disabled={features.length >= LIMITS.features} onClick={add}>+ FEATURE</button>
      </div>
      {!features.length && <p style={{ ...why, fontSize: 11 }}>None yet. A feature is what this pick gives a character: a bonus, uses a rest refills, a roll, another list to pick from, or words for the table.</p>}
      {features.length > 0 && levels.map((lv) => (
        <section key={lv ?? 'all'} aria-label={lv === null ? 'Features' : `Level ${lv}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '2px solid var(--dark-green)', paddingLeft: 8 }}>
          {lv !== null && <span style={small}>LEVEL {lv}</span>}
          {features.filter((f) => lv === null || levelOf(f) === lv).map((f) => (
            <React.Fragment key={f.id}>
              <button type="button" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}
                style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: 'none', border: 0, padding: '3px 0', textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12,
                  color: f.label.trim() ? 'var(--green)' : 'var(--danger)' }}>
                <span>{open === f.id ? '▾' : '▸'} {(f.label.trim() || 'NEEDS A NAME').toUpperCase()}</span>
                {kindsOf(f).map((k) => <Tag key={k} kind={k} />)}
              </button>
              {open === f.id && <FeatureForm key={`form:${f.id}`} definition={definition} edit={edit} list={list} option={option} feature={f} api={api} />}
            </React.Fragment>
          ))}
        </section>
      ))}
    </div>
  );
}
