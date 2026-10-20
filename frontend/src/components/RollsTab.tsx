import React, { useState } from 'react';
import type { Definition, systemsApi, TestedRoll } from '../sheets/systemsApi';
import {
  PRESETS, SIDES, rollList, rollables, stepsOf, fieldsRolledBy,
  withNewRoll, withRollPreset, withRollLabel, withRolledBy, withoutRoll,
  withRollDice, withRollDiceAdded, withRollDiceRemoved, withRollRead, withRollAdd, withRollAgainst, withRollBands,
  withRollExplode, withRollList, withRollCancel, withRollGlitch, withRollZero, withRollChange, costables,
  type Roll, type Sides, type ChangePatch,
} from '../sheets/rolls';
import { small, why, btn, field } from './statsRulesStyles';

// STATS & RULES' ROLLS tab (Phase 6, 6b1a; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19, on the builder design's Dice page): the system's rolls on the left; the one picked in
// the middle, its name, the preset it started from, its five steps and what it is ROLLED BY; TEST
// ROLL on the right, made by the server's own engine for the sample character. All five steps are
// edited in place: the dice, how they are read, what is added, a target and the bands (6b1b1); the
// special results (6b1b2); the changes a player picks before rolling (6b1b3). Every change goes
// through sheets/rolls.ts and the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  api?: ReturnType<typeof systemsApi>;
}

const PRESET_KEYS = Object.keys(PRESETS);

/** One of the five steps, numbered as the Dice design numbers them. */
function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} style={{ border: '1px solid var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, letterSpacing: 2, color: 'var(--green)' }}>
        <span>{n} · {title}</span>{note && <span style={{ color: 'var(--cyan)', letterSpacing: 1 }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
const None = ({ text = 'NONE' }: { text?: string }) => <span style={{ opacity: 0.55 }}>{text}</span>;

/** A whole number box: kept as typed while typing (an empty box, a lone minus), each whole number applied, the real one back when left. */
function WholeBox({ label, value, onWhole, onBlank, placeholder, width = 64 }: {
  label: string; value: number | undefined; onWhole: (n: number) => void; onBlank?: () => void; placeholder?: string; width?: number;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input type="number" step={1} aria-label={label} value={typed ?? (value ?? '')} placeholder={placeholder} style={{ ...field, width }}
      onChange={(e) => {
        setTyped(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() === '') onBlank?.();
        else if (Number.isInteger(n)) onWhole(n);
      }}
      onBlur={() => setTyped(null)} />
  );
}

/** A small on/off switch, as TRY ON THE MAP's. */
function Switch({ label, on, onFlip, disabled }: { label: string; on: boolean; onFlip: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onFlip}
      style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, display: 'inline-flex', gap: 5, alignItems: 'center', textAlign: 'left' }}>
      <span aria-hidden style={{ width: 20, height: 10, borderRadius: 5, border: '1px solid var(--cyan)', background: on ? 'var(--cyan)' : 'none', boxSizing: 'border-box', flexShrink: 0 }} />
      {label}
    </button>
  );
}
const CRITICAL: [string, string][] = [['', 'NOT A CRITICAL'], ['success', 'CRITICAL SUCCESS'], ['failure', 'CRITICAL FAILURE']];
const xBtn: React.CSSProperties = { ...btn, padding: '1px 7px' };
const sideLabel = (s: Sides) => (s === 'F' ? 'dF (FATE)' : `d${s}`);

/** Step 1: each kind of dice, how many (formula text), its size and its name; + ADD DICE. */
function DiceStep({ definition, edit, roll }: { definition: Definition; edit: (next: Definition) => void; roll: Roll }) {
  return (
    <>
      {roll.dice.map((d, i) => {
        const sizes = SIDES.includes(d.sides) ? SIDES : [...SIDES, d.sides];
        return (
          <div key={i} data-testid={`dice-${i + 1}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 96px minmax(0, 1fr) auto', gap: 6, alignItems: 'center', ...(d.name ? { borderLeft: '3px solid var(--danger)', paddingLeft: 6 } : {}) }}>
            <input type="text" aria-label={`Dice ${i + 1}: how many`} maxLength={1000} value={d.count} style={{ ...field, width: '100%' }}
              onChange={(e) => edit(withRollDice(definition, roll.id, i, { count: e.target.value }))} />
            <span>×</span>
            <select aria-label={`Dice ${i + 1}: size`} value={String(d.sides)} style={{ ...field, width: '100%' }}
              onChange={(e) => edit(withRollDice(definition, roll.id, i, { sides: e.target.value === 'F' ? 'F' : Number(e.target.value) }))}>
              {sizes.map((sz) => <option key={sz} value={String(sz)}>{sideLabel(sz)}</option>)}
            </select>
            <input type="text" aria-label={`Dice ${i + 1}: name`} maxLength={40} value={d.name ?? ''} placeholder="NAMED? (HUNGER)" style={{ ...field, width: '100%' }}
              onChange={(e) => edit(withRollDice(definition, roll.id, i, { name: e.target.value }))} />
            <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove dice ${i + 1}`} disabled={roll.dice.length <= 1}
              onClick={() => edit(withRollDiceRemoved(definition, roll.id, i))}>×</button>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="utility-btn" style={btn} disabled={roll.dice.length >= 6} onClick={() => edit(withRollDiceAdded(definition, roll.id))}>+ ADD DICE</button>
        <span style={{ ...why, fontSize: 11 }}>How many can read the sheet: @this, @hunger. A named kind (Hunger) is shown apart and can have its own effects.</span>
      </div>
    </>
  );
}

const READS: [NonNullable<Roll['read']>, string][] = [['sum', 'SUM'], ['highest', 'KEEP HIGHEST'], ['lowest', 'KEEP LOWEST'], ['count', 'COUNT SUCCESSES']];

/** Step 2: how the dice are read, with how many are kept or the face a success starts at. */
function ReadStep({ definition, edit, roll }: { definition: Definition; edit: (next: Definition) => void; roll: Roll }) {
  const read = roll.read ?? 'sum';
  return (
    <>
      <div role="group" aria-label="Read the dice as" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {READS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={read === k} onClick={() => edit(withRollRead(definition, roll.id, k))}
            style={{ background: read === k ? 'var(--green)' : 'none', color: read === k ? 'var(--black)' : 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      {(read === 'highest' || read === 'lowest') && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>KEEP</span>
          <input type="text" aria-label="How many dice are kept" value={roll.keep ?? '1'} maxLength={1000} style={{ ...field, width: 120 }}
            onChange={(e) => edit(withRollRead(definition, roll.id, read, { keep: e.target.value }))} />
          <span style={{ opacity: 0.7 }}>{read === 'highest' ? 'HIGHEST' : 'LOWEST'}</span>
        </label>
      )}
      {read === 'count' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>A DIE SHOWING</span>
          <WholeBox label="A success starts at" value={roll.at} onWhole={(n) => edit(withRollRead(definition, roll.id, 'count', { at: n }))} />
          <span>OR MORE IS A SUCCESS</span>
        </div>
      )}
    </>
  );
}

/** Step 3: what is added, a target met at or over it (or under), and the bands the total is read on. */
function CompareStep({ definition, edit, roll }: { definition: Definition; edit: (next: Definition) => void; roll: Roll }) {
  const bands = roll.bands ?? [];
  return (
    <>
      <label style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 6, alignItems: 'center' }}>
        <span>ADD</span>
        <input type="text" aria-label="Add" maxLength={1000} value={roll.add ?? ''} placeholder="NOTHING · @this + @tie_mod" style={{ ...field, width: '100%' }}
          onChange={(e) => edit(withRollAdd(definition, roll.id, e.target.value))} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 6, alignItems: 'center' }}>
        <span>AGAINST</span>
        <input type="text" aria-label="Against" maxLength={1000} value={roll.against ?? ''} placeholder="NOTHING · @this, 13" style={{ ...field, width: '100%' }}
          onChange={(e) => edit(withRollAgainst(definition, roll.id, e.target.value))} />
        <span />
        <button type="button" role="switch" aria-checked={!!roll.under} disabled={roll.against === undefined} onClick={() => edit(withRollAgainst(definition, roll.id, roll.against ?? '', !roll.under))}
          style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, color: 'var(--cyan)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, cursor: 'pointer', opacity: roll.against === undefined ? 0.4 : 1 }}>
          {roll.under ? '◉' : '○'} ROLL UNDER: AT OR UNDER SUCCEEDS
        </button>
      </div>
      {bands.length ? (
        <div data-testid="bands" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={small}>BANDS · READ TOP TO BOTTOM, LIKE A TABLE: THE FIRST THE TOTAL ISN&apos;T ABOVE</span>
          {bands.map((b, i) => {
            const last = i === bands.length - 1;
            const below = i > 0 ? bands[i - 1].upTo : undefined;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 72px minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
                <span>{last ? 'ABOVE' : 'UP TO'}</span>
                {last ? <span style={{ opacity: 0.8 }}>{below ?? 'ANY'}</span>
                  : <WholeBox label={`Band ${i + 1}: up to`} value={b.upTo} onWhole={(n) => edit(withRollBands(definition, roll.id, { set: i, upTo: n }))} />}
                <input type="text" aria-label={`Band ${i + 1}: words`} maxLength={40} value={b.label} style={{ ...field, width: '100%' }}
                  onChange={(e) => edit(withRollBands(definition, roll.id, { set: i, label: e.target.value }))} />
                <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove band ${i + 1}`} disabled={last} onClick={() => edit(withRollBands(definition, roll.id, { remove: i }))}>×</button>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="utility-btn" style={btn} disabled={bands.length >= 20} onClick={() => edit(withRollBands(definition, roll.id, { add: true }))}>+ BAND</button>
            <button type="button" className="utility-btn" style={btn} onClick={() => edit(withRollBands(definition, roll.id, { none: true }))}>NO BANDS</button>
          </div>
        </div>
      ) : (
        <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withRollBands(definition, roll.id, { start: true }))}>+ BANDS</button> <span style={{ ...why, fontSize: 11 }}>Words for the total: 6− MISS, 7–9 A COST, 10+ A HIT.</span></div>
      )}
    </>
  );
}

/** One part of the special results: its name, and what it does when on. */
function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6, borderTop: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)' }}>
      <span style={small}>{title}</span>
      {children}
    </div>
  );
}
const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };

/**
 * Step 4: exploding, naturals, matches, cancelling (counting only), a glitch, a named kind's
 * effects (with a named kind only) and the zero-dice rule, each switched on or added, then changed.
 */
function SpecialStep({ definition, edit, roll }: { definition: Definition; edit: (next: Definition) => void; roll: Roll }) {
  const id = roll.id;
  const x = roll.explode;
  const named = [...new Set(roll.dice.map((d) => d.name).filter((n): n is string => !!n))];
  const list = <K extends 'natural' | 'matches' | 'effects'>(key: K, change: Parameters<typeof withRollList<K>>[3]) => edit(withRollList(definition, id, key, change));
  return (
    <>
      <Part title="EXPLODING">
        <Switch label="A DIE ON ITS FACE ROLLS ANOTHER, ADDED" on={!!x} onFlip={() => edit(withRollExplode(definition, id, x ? null : {}))} />
        {x && (
          <>
            <div style={row}>
              <span>ON</span>
              <WholeBox label="Explodes on" value={x.on} placeholder="TOP" onWhole={(n) => edit(withRollExplode(definition, id, { on: n }))} onBlank={() => edit(withRollExplode(definition, id, { on: null }))} />
              <span style={{ opacity: 0.7 }}>(BLANK: THE HIGHEST FACE)</span>
            </div>
            <div style={row}>
              <Switch label="ONLY ONCE" on={!!x.once} onFlip={() => edit(withRollExplode(definition, id, { once: !x.once }))} />
              <Switch label="FIRST DIE ONLY" on={!!x.first} onFlip={() => edit(withRollExplode(definition, id, { first: !x.first }))} />
            </div>
            {(roll.read ?? 'sum') === 'sum' && (
              <div style={row}>
                <span>A</span>
                <WholeBox label="Takes one away on" value={x.low} placeholder="—" onWhole={(n) => edit(withRollExplode(definition, id, { low: n }))} onBlank={() => edit(withRollExplode(definition, id, { low: null }))} />
                <span>ROLLS ANOTHER, TAKEN AWAY (CP:R&apos;S 1)</span>
              </div>
            )}
          </>
        )}
      </Part>

      <Part title="NATURALS · WHAT THE DICE SHOW BEFORE ANYTHING IS ADDED">
        {(roll.natural ?? []).map((n, i) => (
          <div key={i} style={row}>
            <span>NATURAL</span>
            <WholeBox label={`Natural ${i + 1}: face`} value={n.face} onWhole={(v) => list('natural', { set: i, patch: { face: v } })} />
            <input type="text" aria-label={`Natural ${i + 1}: words`} maxLength={40} value={n.label} style={{ ...field, flex: 1, minWidth: 100 }} onChange={(e) => list('natural', { set: i, patch: { label: e.target.value } })} />
            <select aria-label={`Natural ${i + 1}: critical`} value={n.critical ?? ''} style={field} onChange={(e) => list('natural', { set: i, patch: { critical: (e.target.value || undefined) as 'success' | 'failure' | undefined } })}>
              {CRITICAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove natural ${i + 1}`} onClick={() => list('natural', { remove: i })}>×</button>
          </div>
        ))}
        <div><button type="button" className="utility-btn" style={btn} disabled={(roll.natural ?? []).length >= 10} onClick={() => list('natural', { add: true })}>+ NATURAL</button></div>
      </Part>

      <Part title="MATCHES · DICE SHOWING THE SAME FACE">
        {(roll.matches ?? []).map((m, i) => (
          <div key={i} style={row}>
            <WholeBox label={`Match ${i + 1}: how many`} value={m.count} width={52} onWhole={(v) => list('matches', { set: i, patch: { count: v } })} />
            <span>×</span>
            <WholeBox label={`Match ${i + 1}: face`} value={m.face} placeholder="ANY" width={60} onWhole={(v) => list('matches', { set: i, patch: { face: v } })} onBlank={() => list('matches', { set: i, patch: { face: undefined } })} />
            <span>ADDS</span>
            <WholeBox label={`Match ${i + 1}: adds`} value={m.adds} placeholder="0" width={52} onWhole={(v) => list('matches', { set: i, patch: { adds: v } })} onBlank={() => list('matches', { set: i, patch: { adds: undefined } })} />
            <input type="text" aria-label={`Match ${i + 1}: words`} maxLength={40} value={m.label} style={{ ...field, flex: 1, minWidth: 90 }} onChange={(e) => list('matches', { set: i, patch: { label: e.target.value } })} />
            <select aria-label={`Match ${i + 1}: critical`} value={m.critical ?? ''} style={field} onChange={(e) => list('matches', { set: i, patch: { critical: (e.target.value || undefined) as 'success' | 'failure' | undefined } })}>
              {CRITICAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove match ${i + 1}`} onClick={() => list('matches', { remove: i })}>×</button>
          </div>
        ))}
        <div><button type="button" className="utility-btn" style={btn} disabled={(roll.matches ?? []).length >= 10} onClick={() => list('matches', { add: true })}>+ MATCH</button></div>
      </Part>

      {roll.read === 'count' && (
        <Part title="CANCELLING">
          <div style={row}>
            <Switch label="EACH DIE SHOWING" on={!!roll.cancel} onFlip={() => edit(withRollCancel(definition, id, roll.cancel ? null : 1))} />
            {roll.cancel && <WholeBox label="Cancels on" value={roll.cancel.face} width={52} onWhole={(v) => edit(withRollCancel(definition, id, v))} />}
            <span>TAKES A SUCCESS AWAY</span>
          </div>
        </Part>
      )}

      <Part title="GLITCH">
        <Switch label="TOO MANY OF ONE FACE IS A GLITCH (SR6)" on={!!roll.glitch} onFlip={() => edit(withRollGlitch(definition, id, roll.glitch ? null : {}))} />
        {roll.glitch && (
          <>
            <div style={row}>
              <WholeBox label="Glitch face" value={roll.glitch.face} width={52} onWhole={(v) => edit(withRollGlitch(definition, id, { face: v }))} />
              <span>s ON</span>
              <WholeBox label="Glitch share, percent" value={Math.round(roll.glitch.share * 100)} width={60} onWhole={(v) => edit(withRollGlitch(definition, id, { share: Math.max(1, Math.min(100, v)) / 100 }))} />
              <span>% OF THE DICE OR MORE</span>
            </div>
            <div style={row}>
              <input type="text" aria-label="Glitch words" maxLength={40} value={roll.glitch.label} style={{ ...field, flex: 1, minWidth: 100 }} onChange={(e) => edit(withRollGlitch(definition, id, { label: e.target.value }))} />
              <input type="text" aria-label="Glitch words with no success" maxLength={40} value={roll.glitch.none ?? ''} placeholder="WITH NO SUCCESS: (OPTIONAL)" style={{ ...field, flex: 1, minWidth: 100 }} onChange={(e) => edit(withRollGlitch(definition, id, { none: e.target.value }))} />
            </div>
          </>
        )}
      </Part>

      <Part title="NAMED DICE · THEIR OWN EFFECTS">
        {!named.length ? <span style={{ opacity: 0.6 }}>NAME A KIND OF DICE IN STEP 1 (HUNGER) TO GIVE IT EFFECTS.</span> : (
          <>
            {(roll.effects ?? []).map((e, i) => (
              <div key={i} style={row}>
                <select aria-label={`Effect ${i + 1}: which dice`} value={e.name} style={field} onChange={(ev) => list('effects', { set: i, patch: { name: ev.target.value } })}>
                  {[...new Set([...named, e.name])].map((n) => <option key={n} value={n}>{n.toUpperCase()}</option>)}
                </select>
                <WholeBox label={`Effect ${i + 1}: face`} value={e.face} width={52} onWhole={(v) => list('effects', { set: i, patch: { face: v } })} />
                <select aria-label={`Effect ${i + 1}: when`} value={e.when} style={field} onChange={(ev) => list('effects', { set: i, patch: { when: ev.target.value as 'critical' | 'success' | 'failure' | 'any' } })}>
                  <option value="critical">ON A CRITICAL</option><option value="success">ON A SUCCESS</option><option value="failure">ON A FAILURE</option><option value="any">ON ANY ROLL</option>
                </select>
                <input type="text" aria-label={`Effect ${i + 1}: words`} maxLength={40} value={e.label} style={{ ...field, flex: 1, minWidth: 90 }} onChange={(ev) => list('effects', { set: i, patch: { label: ev.target.value } })} />
                <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove effect ${i + 1}`} onClick={() => list('effects', { remove: i })}>×</button>
              </div>
            ))}
            <div><button type="button" className="utility-btn" style={btn} disabled={(roll.effects ?? []).length >= 10} onClick={() => list('effects', { add: true })}>+ EFFECT</button></div>
          </>
        )}
      </Part>

      <Part title="NO DICE TO ROLL">
        <Switch label="ROLL SOME ANYWAY AND KEEP ONE (BLADES), NEVER A CRITICAL" on={!!roll.zero} onFlip={() => edit(withRollZero(definition, id, roll.zero ? null : {}))} />
        {roll.zero && (
          <div style={row}>
            <span>ROLL</span>
            <WholeBox label="Dice rolled with none" value={roll.zero.count} width={52} onWhole={(v) => edit(withRollZero(definition, id, { count: Math.max(1, Math.min(10, v)) }))} />
            <span>, KEEP THE</span>
            <select aria-label="Kept with none" value={roll.zero.read} style={field} onChange={(e) => edit(withRollZero(definition, id, { read: e.target.value as 'highest' | 'lowest' }))}>
              <option value="lowest">LOWEST</option><option value="highest">HIGHEST</option>
            </select>
          </div>
        )}
      </Part>
    </>
  );
}

/**
 * Step 5: the changes a player picks before rolling (asked in a chooser by the sheet): each one's
 * words, the dice it adds and which it keeps, what it adds to the total, and what it costs.
 */
function ChangesStep({ definition, edit, roll }: { definition: Definition; edit: (next: Definition) => void; roll: Roll }) {
  const id = roll.id;
  const stats = costables(definition);
  const set = (i: number, patch: ChangePatch) => edit(withRollChange(definition, id, { set: i, patch }));
  const changes = roll.changes ?? [];
  return (
    <>
      {!changes.length && <None text="NONE · ROLLS ON THE FIRST CLICK" />}
      {changes.map((c, i) => (
        <div key={c.id} role="group" aria-label={`Change ${i + 1}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6, borderTop: i ? '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)' : 0 }}>
          <div style={row}>
            <span style={{ color: 'var(--cyan)' }}>◆</span>
            <input type="text" aria-label={`Change ${i + 1}: words`} maxLength={40} value={c.label} style={{ ...field, flex: 1, minWidth: 120 }} onChange={(e) => set(i, { label: e.target.value })} />
            <span style={{ opacity: 0.6, fontSize: 11 }}>{c.id}</span>
            <button type="button" className="utility-btn" style={xBtn} aria-label={`Remove change ${i + 1}`} onClick={() => edit(withRollChange(definition, id, { remove: i }))}>×</button>
          </div>
          <div style={row}>
            <Switch label="+ DICE" on={!!c.extra} onFlip={() => set(i, { extra: c.extra ? null : { dice: 1 } })} />
            {c.extra && (
              <>
                <WholeBox label={`Change ${i + 1}: extra dice`} value={c.extra.dice} width={52} onWhole={(n) => set(i, { extra: { ...c.extra!, dice: n } })} />
                <select aria-label={`Change ${i + 1}: kept`} value={c.extra.keep ?? ''} style={field} onChange={(e) => set(i, { extra: { dice: c.extra!.dice, ...(e.target.value ? { keep: e.target.value as 'highest' | 'lowest' } : {}) } })}>
                  <option value="">JOINING THE DICE</option>
                  <option value="highest">KEEPING THE HIGHEST (ADVANTAGE)</option>
                  <option value="lowest">KEEPING THE LOWEST (DISADVANTAGE)</option>
                </select>
              </>
            )}
          </div>
          <div style={row}>
            <Switch label="+ TO THE TOTAL" on={c.add !== undefined} onFlip={() => set(i, { add: c.add !== undefined ? null : '1' })} />
            {c.add !== undefined && (
              <input type="text" aria-label={`Change ${i + 1}: adds`} maxLength={1000} value={c.add} style={{ ...field, flex: 1, minWidth: 100 }} onChange={(e) => set(i, { add: e.target.value })} />
            )}
          </div>
          <div style={row}>
            <Switch label="COSTS" on={!!c.cost} disabled={!stats.length && !c.cost} onFlip={() => set(i, { cost: c.cost ? null : { from: stats[0].id, amount: 1 } })} />
            {c.cost && (
              <>
                <WholeBox label={`Change ${i + 1}: costs how many`} value={c.cost.amount} width={52} onWhole={(n) => set(i, { cost: { ...c.cost!, amount: n } })} />
                <select aria-label={`Change ${i + 1}: costs what`} value={c.cost.from} style={field} onChange={(e) => set(i, { cost: { ...c.cost!, from: e.target.value } })}>
                  {[...stats, ...(stats.some((st) => st.id === c.cost!.from) ? [] : [{ id: c.cost.from, label: c.cost.from.toUpperCase() }])].map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                </select>
                <span style={{ opacity: 0.7, fontSize: 11 }}>TAKEN FROM THE SHEET WHEN ROLLED</span>
              </>
            )}
            {!stats.length && !c.cost && <span style={{ opacity: 0.6, fontSize: 11 }}>A COST IS TAKEN FROM A STAT: ADD ONE ON STATS (STRESS)</span>}
          </div>
        </div>
      ))}
      <div><button type="button" className="utility-btn" style={btn} disabled={changes.length >= 10} onClick={() => edit(withRollChange(definition, id, { add: true }))}>+ CHANGE</button></div>
    </>
  );
}

/** The roll picked: its name, its preset, its five steps, ROLLED BY and REMOVE. */
function RollEditor({ definition, edit, roll, onRemoved }: Props & { roll: Roll; onRemoved: () => void }) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const choices = rollables(definition);
  const by = new Set(roll.by ?? []);
  const kinds: [string, 'group' | 'stat' | 'formula'][] = [['STATS GROUPS', 'group'], ['STATS', 'stat'], ['FORMULAS', 'formula']];
  return (
    <div data-testid={`roll-${roll.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" aria-label="Roll name" maxLength={40} value={roll.label ?? ''} placeholder={roll.id} style={{ ...field, flex: 1, minWidth: 160 }}
          onChange={(e) => edit(withRollLabel(definition, roll.id, e.target.value))} />
        <span style={{ opacity: 0.6, fontSize: 11 }}>{roll.id}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={small}>START FROM A PRESET · THEN CHANGE ANYTHING</span>
        <div role="group" aria-label="Presets" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {PRESET_KEYS.map((k) => <button key={k} type="button" className="utility-btn" style={btn} onClick={() => setReplacing(k)}>{PRESETS[k].label.toUpperCase()}</button>)}
        </div>
        {replacing && (
          <div role="alertdialog" aria-label="Replace the five steps?" style={{ border: '1px solid var(--warning)', padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ flex: 1, minWidth: 0 }}>Replace {(roll.label || roll.id).toUpperCase()}&apos;s five steps with {PRESETS[replacing].label.toUpperCase()}? Its name and ROLLED BY stay.</span>
            <button type="button" className="utility-btn" style={btn} onClick={() => { edit(withRollPreset(definition, roll.id, replacing)); setReplacing(null); }}>REPLACE</button>
            <button type="button" className="utility-btn" style={btn} onClick={() => setReplacing(null)}>KEEP</button>
          </div>
        )}
      </div>
      <Step n={1} title="DICE"><DiceStep definition={definition} edit={edit} roll={roll} /></Step>
      <Step n={2} title="READ THE DICE"><ReadStep definition={definition} edit={edit} roll={roll} /></Step>
      <Step n={3} title="ADD AND COMPARE"><CompareStep definition={definition} edit={edit} roll={roll} /></Step>
      <Step n={4} title="SPECIAL RESULTS"><SpecialStep definition={definition} edit={edit} roll={roll} /></Step>
      <Step n={5} title="CHANGE A ROLL" note="ASKED BEFORE ROLLING"><ChangesStep definition={definition} edit={edit} roll={roll} /></Step>
      <section aria-label="Rolled by" style={{ border: '1px solid var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, letterSpacing: 2, color: 'var(--green)' }}>
          <span>ROLLED BY</span><span style={{ color: 'var(--cyan)', letterSpacing: 1 }}>EACH GETS A DIE BUTTON ON THE SHEET</span>
        </div>
        {kinds.map(([title, kind]) => {
          const these = choices.filter((c) => c.kind === kind);
          return these.length > 0 && (
            <div key={kind} style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
              <span style={{ ...small, width: '100%' }}>{title}</span>
              {these.map((c) => (
                <button key={c.id} type="button" aria-pressed={by.has(c.id)} onClick={() => edit(withRolledBy(definition, roll.id, c.id, !by.has(c.id)))}
                  style={{ background: by.has(c.id) ? 'var(--green)' : 'none', color: by.has(c.id) ? 'var(--black)' : 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
                  {c.label}
                </button>
              ))}
            </div>
          );
        })}
        {!choices.length && <None text="NO STATS OR FORMULAS YET: ADD THEM ON STATS AND FORMULAS" />}
        <span style={{ ...why, fontSize: 11 }}>In the roll, @this is what is rolled and @this_mod its modifier; a skill&apos;s @tie and @tie_mod are its ability&apos;s.</span>
      </section>
      <div><button type="button" className="utility-btn" style={btn} onClick={() => { edit(withoutRoll(definition, roll.id)); onRemoved(); }}>REMOVE ROLL</button></div>
    </div>
  );
}

/** TEST ROLL: the roll made by the server's engine for the sample character, for a field it is rolled by, with changes picked. */
function TestRoll({ definition, api, roll }: { definition: Definition; api?: ReturnType<typeof systemsApi>; roll: Roll }) {
  const fields = fieldsRolledBy(definition, roll);
  const names = new Map(rollables(definition).map((c) => [c.id, c.label]));
  const [pickedField, setField] = useState<string>('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [shown, setShown] = useState<{ tested?: TestedRoll; error?: string; busy?: boolean }>({});
  const fieldNow = fields.includes(pickedField) ? pickedField : fields[0] ?? '';
  const run = async () => {
    if (!api) return;
    setShown({ busy: true });
    const r = await api.testRoll(definition, roll.id, fieldNow || null, chosen.filter((c) => (roll.changes ?? []).some((x) => x.id === c)));
    setShown(r.ok ? { tested: r.value } : { error: r.error });
  };
  const res = shown.tested?.result;
  const outcome = res ? (res.band?.toUpperCase() ?? (res.success === true ? 'SUCCESS' : res.success === false ? 'FAILURE' : `= ${res.total}`)) : null;
  const tone = !res ? '' : res.critical === 'success' ? 'var(--warning)' : res.critical === 'failure' || res.success === false ? 'var(--danger)' : 'var(--green)';
  return (
    <aside aria-label="Test roll" data-testid="test-roll" style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, fontSize: 12 }}>
      <span style={{ ...small, color: 'var(--cyan)' }}>TEST ROLL · ON THE SAMPLE</span>
      {fields.length > 0 ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={small}>FOR</span>
          <select aria-label="Roll it for" value={fieldNow} style={{ ...field, width: '100%' }} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => <option key={f} value={f}>{names.get(f) ?? f}</option>)}
          </select>
        </label>
      ) : <span style={{ ...why, fontSize: 11 }}>Rolled by nothing yet, so @this reads 0.</span>}
      {(roll.changes ?? []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(roll.changes ?? []).map((c) => {
            const on = chosen.includes(c.id);
            return (
              <button key={c.id} type="button" role="switch" aria-checked={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id])}
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, cursor: 'pointer', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                <span aria-hidden style={{ width: 20, height: 10, borderRadius: 5, border: '1px solid var(--cyan)', background: on ? 'var(--cyan)' : 'none', boxSizing: 'border-box' }} />
                {c.label.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}
      <div><button type="button" className="utility-btn" style={btn} disabled={!api || shown.busy} onClick={run}>TEST ROLL ▸</button></div>
      {res && (
        <>
          <div data-testid="test-dice" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {res.groups.flatMap((g, gi) => g.faces.map((f, fi) => {
              const face = g.sides === 'F' ? (f.value > 0 ? '+' : f.value < 0 ? '−' : ' ') : `${f.minus ? '−' : ''}${f.value}`;
              const color = g.name ? 'var(--danger)' : 'var(--green)';
              return (
                <span key={`${gi}-${fi}`} title={`${g.name ?? (g.sides === 'F' ? 'dF' : `d${g.sides}`)}${f.kept ? '' : ', not counted'}${f.extra ? ', exploded' : ''}`}
                  style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', fontWeight: 'bold', border: `2px solid ${color}`, background: f.kept ? color : 'none', color: f.kept ? 'var(--black)' : color, opacity: f.kept ? 1 : 0.45 }}>
                  {face}
                </span>
              );
            }))}
          </div>
          <span data-testid="test-working" style={{ wordBreak: 'break-word' }}>{shown.tested!.historyText.replace(/^.*?\[/, '[')}</span>
          <b data-testid="test-outcome" style={{ fontSize: 16, letterSpacing: 2, color: tone }}>{outcome}</b>
          {res.costs.length > 0 && <span style={{ ...why, fontSize: 11 }}>At the table this costs {res.costs.map((c) => `${c.amount} ${c.from.toUpperCase()}`).join(' and ')}.</span>}
        </>
      )}
      {shown.error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{shown.error}</span>}
      <span style={{ ...why, fontSize: 11 }}>Never reaches the game or the log. The table rolls with the same engine, on the server.</span>
    </aside>
  );
}

export function RollsTab({ definition, edit, api }: Props) {
  const rolls = rollList(definition);
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const roll = rolls.find((r) => r.id === picked) ?? rolls[0];
  const add = (preset: string) => {
    const r = withNewRoll(definition, preset);
    if (!r) return;
    edit(r.definition);
    setPicked(r.id);
    setAdding(false);
  };
  return (
    // textAlign: the page around the builder centres text; the tab reads from the left, as FORMS does.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
      <p style={{ ...why, margin: 0, maxWidth: '72ch' }}>
        The system&apos;s own rolls: the dice, how they are read, what is added, and what the result means. Give each the stats it is rolled by and players get a die button by them on the sheet.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 200px) minmax(0, 1fr) minmax(200px, 280px)', gap: 14, alignItems: 'start' }}>
        <nav aria-label="Rolls" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rolls.map((r) => (
            <button key={r.id} type="button" aria-current={r.id === roll?.id && !adding} onClick={() => { setPicked(r.id); setAdding(false); }}
              style={{ textAlign: 'left', background: r.id === roll?.id && !adding ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'none', border: `1px solid ${r.id === roll?.id && !adding ? 'var(--green)' : 'transparent'}`, color: 'var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>{(r.label || r.id).toUpperCase()}</span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>{stepsOf(r).dice.join(' + ')}</span>
            </button>
          ))}
          <div><button type="button" className="utility-btn" style={btn} onClick={() => setAdding(true)}>+ ROLL</button></div>
        </nav>
        {adding || !roll ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={small}>A NEW ROLL · START FROM A PRESET, THEN CHANGE ANYTHING</span>
            <div role="group" aria-label="New roll from a preset" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESET_KEYS.map((k) => <button key={k} type="button" className="utility-btn" style={btn} onClick={() => add(k)}>{PRESETS[k].label.toUpperCase()}</button>)}
            </div>
            {!roll && <span style={{ ...why, fontSize: 11 }}>No rolls yet. A system without any rolls has no die buttons on its sheet.</span>}
            {roll && <div><button type="button" className="utility-btn" style={btn} onClick={() => setAdding(false)}>CANCEL</button></div>}
          </div>
        ) : (
          <RollEditor key={roll.id} definition={definition} edit={edit} roll={roll} onRemoved={() => setPicked(null)} />
        )}
        {roll && !adding ? <TestRoll key={roll.id} definition={definition} api={api} roll={roll} /> : <span />}
      </div>
    </div>
  );
}
