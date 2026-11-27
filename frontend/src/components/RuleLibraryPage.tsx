import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  dyingOn, dyingOf, withDyingOn, withPreset, presetNow, withDying, withSave, withNpcs, wholeTyped, withNaturalAdded, withNatural, withoutNatural,
  asks, startsWhen, LIMITS, WAYS, HURTS, NATURAL_THENS, PRESETS, type NaturalThen,
  helperFields, stabilizeConditions, stabilizeOf, withStabilizePart, STABILIZE_THENS,
} from '../sheets/dying';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';

// The builder's RULE LIBRARY page (8c2; approved mockup docs/mockups/rule-library.html, 2026-11-26, every recommended answer):
// rules the app already knows, a card each, for the GM to switch on and fill in, never wire. Its first, WHEN HEALTH RUNS OUT:
// death saves in one of four ways, picked from a preset named after a game and then changed as the GM likes. The card's switch
// is the PARTS row DEATH SAVES'. STABILIZE (8c4b1): what someone else rolls to bring them back, under its own line. LUCK (8c5)
// comes later. What it reads and writes is sheets/dying.ts; every
// change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the formula boxes' live reading; without it they are plain text boxes. */
  api?: ReturnType<typeof systemsApi>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '10px 12px', alignItems: 'center' };
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 10px', cursor: 'pointer',
});
const segs: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start', alignSelf: 'flex-start' };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const num: React.CSSProperties = { ...input, width: '5em' };

/**
 * A whole number's box: what is typed shown as typed while it is being written (a box cleared to type 4 holds nothing, not the
 * old number), written once it is a whole number, held to its range; back to the number when left.
 */
function NumberBox({ id, label, value, lo, hi, onChange }: { id?: string; label?: string; value: number; lo: number; hi: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input id={id} aria-label={label} type="text" inputMode="numeric" value={draft ?? String(value)} style={num}
      onChange={(e) => {
        setDraft(e.target.value);
        if (/^\s*-?\d+\s*$/.test(e.target.value)) onChange(wholeTyped(e.target.value, lo, hi, value));
      }}
      onBlur={() => setDraft(null)} />
  );
}

/** A group of buttons, one pressed. */
function Segs<T extends string>({ name, of, value, onPick }: { name: string; of: readonly { id: T; label: string }[]; value: T; onPick: (id: T) => void }) {
  return (
    <span role="group" aria-label={name} style={segs}>
      {of.map((o) => <button key={o.id} type="button" aria-pressed={value === o.id} style={seg(value === o.id)} onClick={() => onPick(o.id)}>{o.label}</button>)}
    </span>
  );
}

/** WHEN HEALTH RUNS OUT: its switch, its presets, and the rule's numbers once it is on. */
function DyingCard({ definition, edit, api }: Props) {
  const on = dyingOn(definition);
  const d = dyingOf(definition);
  const preset = presetNow(definition);
  const shows = asks(d.way);
  const dice = useFormulaBox({
    definition, api, kind: 'refill', value: d.save.dice, label: 'The save\'s dice', id: 'dying-dice', inputStyle: input, maxLength: LIMITS.text,
    placeholder: '1d20', onChange: (text) => edit(withSave(definition, { dice: text })),
  });
  const target = useFormulaBox({
    definition, api, kind: 'formula', value: d.save.target, label: 'The save\'s target', id: 'dying-target', inputStyle: input, maxLength: LIMITS.text,
    placeholder: '10, @body', onChange: (text) => edit(withSave(definition, { target: text })),
  });
  const way = WAYS.find((w) => w.id === d.way)!;

  return (
    <section aria-label="When health runs out" style={{ border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 1000 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1, fontSize: 12 }}>WHEN HEALTH RUNS OUT</h3>
        <span style={row}>
          <ToggleSwitch on={on} name="When health runs out" onChange={(next) => edit(withDyingOn(definition, next))} />
          <span style={{ ...small, opacity: 1 }}>{on ? 'ON' : 'OFF'}</span>
        </span>
      </div>
      <p style={why}>
        Like death saves in D&amp;D 5e, Cyberpunk RED&apos;s death save, and the turns a Cities Without Number character has before dying.
        It starts when this game&apos;s health runs out: <b>{startsWhen(definition)}</b>. The same switch as DEATH SAVES on PARTS.
      </p>
      {on && <>
        <div style={row}>
          <FieldName hint={HINTS['library.presets']} style={small}>PRESETS</FieldName>
          <span role="group" aria-label="Presets" style={row}>
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className="utility-btn" aria-pressed={preset === p.id} onClick={() => edit(withPreset(definition, p.id))}
                style={{ ...btn, background: preset === p.id ? 'var(--green)' : 'none', color: preset === p.id ? 'var(--black)' : 'var(--green)' }}>
                {p.label}
              </button>
            ))}
          </span>
        </div>
        <div style={grid}>
          <FieldName beside htmlFor="dying-word" hint={HINTS['library.word']} style={small}>THE SHEET SAYS</FieldName>
          <input id="dying-word" type="text" maxLength={LIMITS.word} value={d.word} placeholder="DYING" style={{ ...input, width: '16em', maxWidth: '100%' }}
            aria-invalid={!d.word.trim() ? true : undefined} onChange={(e) => edit(withDying(definition, { word: e.target.value }))} />

          <FieldName beside hint={HINTS['library.way']} style={small}>HOW IT GOES</FieldName>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <Segs name="How it goes" of={WAYS} value={d.way} onPick={(w) => edit(withDying(definition, { way: w }))} />
            <span style={{ ...why, fontSize: 11 }}>{way.means}</span>
          </span>

          {shows.save && <>
            <FieldName beside htmlFor="dying-dice" hint={HINTS['library.save']} style={small}>THE SAVE</FieldName>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={row}>
                <span style={{ width: '10em', minWidth: 0 }}>{dice.field}</span>
                <Segs name="The save is" of={[{ id: 'at_least', label: 'AT LEAST' }, { id: 'under', label: 'UNDER' }] as const} value={d.save.way}
                  onPick={(w) => edit(withSave(definition, { way: w }))} />
                <span style={{ width: '10em', minWidth: 0 }}>{target.field}</span>
              </span>
              {dice.help}
              {target.help}
            </span>
          </>}

          {shows.count && <>
            <FieldName beside htmlFor="dying-live" hint={HINTS['library.count']} style={small}>SUCCESSES TO LIVE</FieldName>
            <span style={row}>
              <NumberBox id="dying-live" value={d.to_live} lo={1} hi={LIMITS.count} onChange={(n) => edit(withDying(definition, { to_live: n }))} />
              <span style={{ ...why, fontSize: 11 }}>stable, at 0</span>
            </span>
            <FieldName beside htmlFor="dying-die" hint={HINTS['library.count']} style={small}>FAILURES TO DIE</FieldName>
            <NumberBox id="dying-die" value={d.to_die} lo={1} hi={LIMITS.count} onChange={(n) => edit(withDying(definition, { to_die: n }))} />
          </>}

          {shows.harder && <>
            <FieldName beside htmlFor="dying-harder" hint={HINTS['library.harder']} style={small}>GETS HARDER</FieldName>
            <span style={row}>
              <NumberBox id="dying-harder" value={d.harder} lo={-LIMITS.harder} hi={LIMITS.harder} onChange={(n) => edit(withDying(definition, { harder: n }))} />
              <span style={{ ...why, fontSize: 11 }}>added to the roll after each save made</span>
            </span>
          </>}

          {shows.save && <>
            <FieldName beside hint={HINTS['library.naturals']} style={small}>ON A NATURAL</FieldName>
            <span role="group" aria-label="On a natural" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              {d.naturals.map((n, i) => (
                <span key={i} style={row}>
                  <NumberBox label={`Natural ${i + 1}`} value={n.face} lo={1} hi={LIMITS.face} onChange={(face) => edit(withNatural(definition, i, { face }))} />
                  <select aria-label={`Natural ${i + 1} does`} value={n.then} style={input} onChange={(e) => edit(withNatural(definition, i, { then: e.target.value as NaturalThen }))}>
                    {NATURAL_THENS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <button type="button" className="utility-btn" aria-label={`Take off natural ${i + 1}`} style={btn} onClick={() => edit(withoutNatural(definition, i))}>✕</button>
                </span>
              ))}
              <span>
                <button type="button" className="utility-btn" style={{ ...btn, borderStyle: 'dashed' }} disabled={d.naturals.length >= LIMITS.naturals}
                  onClick={() => edit(withNaturalAdded(definition))}>+ NATURAL</button>
              </span>
            </span>
          </>}

          {shows.turns && <>
            <FieldName beside htmlFor="dying-turns" hint={HINTS['library.turns']} style={small}>TURNS LEFT</FieldName>
            <span style={row}>
              <NumberBox id="dying-turns" value={d.turns} lo={1} hi={LIMITS.turns} onChange={(n) => edit(withDying(definition, { turns: n }))} />
              <span style={{ ...why, fontSize: 11 }}>then dead, unless stabilized</span>
            </span>
          </>}

          <FieldName beside hint={HINTS['library.hurt']} style={small}>HURT WHILE DOWN</FieldName>
          <Segs name="Hurt while down" of={HURTS} value={d.hurt} onPick={(h) => edit(withDying(definition, { hurt: h }))} />

          <FieldName beside hint={HINTS['library.who']} style={small}>WHO GOES DOWN</FieldName>
          <span style={row}>
            <span style={{ ...why, fontSize: 11 }}>players&apos; characters, and</span>
            {([['friendly', 'FRIENDLY NPCS'], ['enemy', 'ENEMY NPCS']] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={d.npcs[k]} onClick={() => edit(withNpcs(definition, { [k]: !d.npcs[k] }))}
                style={{ ...btn, border: '1px solid var(--green)', background: d.npcs[k] ? 'var(--green)' : 'none', color: d.npcs[k] ? 'var(--black)' : 'var(--green)', cursor: 'pointer' }}>
                {label}
              </button>
            ))}
            <span style={{ ...why, fontSize: 11 }}>an NPC left out is out at 0, as today</span>
          </span>
        </div>
        <StabilizePart definition={definition} edit={edit} />
        <p style={{ ...why, fontSize: 11 }}>
          Healed above 0 at any time, by anyone (a potion, a spell, a rest): all of it is cleared, DEAD too. No roll or turn undoes DEAD.
          The save is rolled on the character&apos;s sheet, and in a fight on their turn.
        </p>
      </>}
    </section>
  );
}

/** STABILIZE (8c4b1; the mockup's card): what someone else rolls, from their own sheet, to bring a character down back. */
function StabilizePart({ definition, edit }: Pick<Props, 'definition' | 'edit'>) {
  const s = stabilizeOf(definition);
  const fields = helperFields(definition);
  const field = s ? fields.find((f) => f.field === s.field) : undefined;
  const conditions = stabilizeConditions(definition);
  const set = (patch: Parameters<typeof withStabilizePart>[1]) => edit(withStabilizePart(definition, patch));
  return (
    <section aria-label="Stabilize" style={{ borderTop: '1px dashed var(--dark-green)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={small}>STABILIZE · someone else brings them back</span>
      <div style={grid}>
        <FieldName beside htmlFor="stabilize-field" hint={HINTS['library.helper']} style={small}>THE HELPER ROLLS</FieldName>
        <span style={row}>
          <select id="stabilize-field" value={s?.field ?? ''} style={input} onChange={(e) => set({ field: e.target.value })}>
            <option value="">— none: the GM says</option>
            {fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
            {s && !field && <option value={s.field}>{s.field.toUpperCase()} (NO ROLL)</option>}
          </select>
          {field && field.rolls.length > 1 && (
            <select aria-label="Its roll" value={s?.roll ?? ''} style={input} onChange={(e) => set({ roll: e.target.value || undefined })}>
              <option value="">{field.rolls[0].label} (ITS FIRST)</option>
              {field.rolls.slice(1).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          )}
          <span style={{ ...why, fontSize: 11 }}>{fields.length ? 'one of this game\'s rolls, on the helper\'s own sheet' : 'this game has no rolls yet: give a field one on STATS & RULES'}</span>
        </span>
        {s && <>
          <FieldName beside htmlFor="stabilize-vs" hint={HINTS['library.vs']} style={small}>VS</FieldName>
          <span style={row}>
            <input id="stabilize-vs" type="text" maxLength={LIMITS.text} value={s.vs} placeholder="10, 8 + @turns" style={{ ...input, width: '10em' }}
              aria-invalid={!s.vs.trim() ? true : undefined} onChange={(e) => set({ vs: e.target.value })} />
            <span style={{ ...why, fontSize: 11 }}>a number, or a formula: @turns is how long they&apos;ve been down</span>
          </span>
          <FieldName beside hint={HINTS['library.then']} style={small}>THEN THEY ARE</FieldName>
          <Segs name="Then they are" of={STABILIZE_THENS} value={s.then} onPick={(t) => set({ then: t })} />
          <FieldName beside htmlFor="stabilize-gets" hint={HINTS['library.gets']} style={small}>AND GET</FieldName>
          <select id="stabilize-gets" value={s.gets ?? ''} style={{ ...input, justifySelf: 'start' }} onChange={(e) => set({ gets: e.target.value || undefined })}>
            <option value="">— nothing</option>
            {conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {s.gets && <>
            <FieldName beside hint={HINTS['library.again']} style={small}>DOWN AGAIN WITH IT</FieldName>
            <span style={row}>
              <ToggleSwitch on={!!s.again} name="Dead at once down again with it" onChange={(on) => set({ again: on })} />
              <span style={{ ...why, fontSize: 11 }}>{s.again ? 'DEAD AT ONCE' : 'goes down as usual'}</span>
            </span>
          </>}
        </>}
      </div>
    </section>
  );
}

export function RuleLibraryPage({ definition, edit, api }: Props) {
  return (
    <div data-testid="rule-library-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ ...why, maxWidth: '72ch' }}>Rules the app already knows, for you to switch on and fill in: pick a preset named after a game, then change anything.</p>
      <DyingCard definition={definition} edit={edit} api={api} />
    </div>
  );
}
