import React, { useState } from 'react';
import type { Definition, systemsApi, TestedRoll } from '../sheets/systemsApi';
import {
  PRESETS, SIDES, rollList, rollables, stepsOf, fieldsRolledBy,
  withNewRoll, withRollPreset, withRollLabel, withRolledBy, withoutRoll,
  withRollDice, withRollDiceAdded, withRollDiceRemoved, withRollRead, withRollAdd, withRollAgainst, withRollBands,
  type Roll, type Sides,
} from '../sheets/rolls';
import { small, why, btn, field } from './statsRulesStyles';

// STATS & RULES' ROLLS tab (Phase 6, 6b1a; approved mockup docs/mockups/builder-rolls.html,
// 2026-10-19, on the builder design's Dice page): the system's rolls on the left; the one picked in
// the middle, its name, the preset it started from, its five steps and what it is ROLLED BY; TEST
// ROLL on the right, made by the server's own engine for the sample character. Steps 1 to 3 (the
// dice, how they are read, what is added, a target and the bands) are edited in place (6b1b1);
// special results and changes show in words until 6b1b2. Every change goes through
// sheets/rolls.ts and the builder's `edit`.

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
function WholeBox({ label, value, onWhole, width = 64 }: { label: string; value: number | undefined; onWhole: (n: number) => void; width?: number }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input type="number" step={1} aria-label={label} value={typed ?? (value ?? '')} style={{ ...field, width }}
      onChange={(e) => { setTyped(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isInteger(n)) onWhole(n); }}
      onBlur={() => setTyped(null)} />
  );
}
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

/** The roll picked: its name, its preset, its five steps, ROLLED BY and REMOVE. */
function RollEditor({ definition, edit, roll, onRemoved }: Props & { roll: Roll; onRemoved: () => void }) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const steps = stepsOf(roll);
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
      <Step n={4} title="SPECIAL RESULTS">{steps.special.length ? steps.special.map((s) => <span key={s}>■ {s}</span>) : <None />}</Step>
      <Step n={5} title="CHANGE A ROLL" note="ASKED BEFORE ROLLING">{steps.changes.length ? steps.changes.map((c) => <span key={c}>◆ {c}</span>) : <None text="NONE · ROLLS ON THE FIRST CLICK" />}</Step>
      <p style={{ ...why, margin: 0, fontSize: 11 }}>Special results and changes are edited here next. Until then, start a roll from the preset that has the ones you want.</p>
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
