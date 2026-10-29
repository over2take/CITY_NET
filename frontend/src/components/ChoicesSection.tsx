import React, { useState } from 'react';
import {
  workedOn, listShown, spentAfterClick, featureDoes, pickedOf, listsOnTheirOwn, underFeature, keptAside,
  type ChoiceListShown, type ChoicesAction, type FeatureShown, type OptionShown, type PickShown, type Worked,
} from '../sheets/choicesShown';

// A character sheet's CHOICES block (7a3b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): each list the system has, the character's picks in it with their levels (the list's
// total on hover, broken down: SOLDIER 3 + MAGE 1), the features each pick has unlocked with their
// uses to tick off, the next feature to come, and the options still to pick, one not met shown with
// what it needs. What a player may do is the server's to say (backend systemBuilder/picking.js); this
// only asks, and the server's answer comes back as the sheet saved again, or in words. The GM (7a3b2)
// also takes a pick away (DROP, asked first) and picks an option not met (ADD ANYWAY).
//
// Lists inside lists (7a5a2; approved mockup docs/mockups/nested-choices.html): a feature that opens a
// list picked through features has its picks right under it, and PICK A <ONE> while it has room; a pick
// whose feature locked again shows there greyed, kept; one with nothing left to wait under shows at the
// foot, KEPT, WAITING. A list everyone has shows what every character has, nothing to pick.

interface Props {
  lists: ChoiceListShown[];
  data: Record<string, unknown>;
  readOnly: boolean;
  /** Asks the server to pick, set a level or tick a use. Absent: nothing can be changed here. */
  onChoices?: (action: ChoicesAction) => void;
  /** Why the server last said no, to show under the block. */
  refused?: string | null;
  /** The viewer is the GM: DROP, and ADD ANYWAY for an option not met. */
  gm?: boolean;
}

const small: React.CSSProperties = { fontSize: '0.55rem', letterSpacing: '1px', opacity: 0.7 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '1px 7px',
};
const danger: React.CSSProperties = { ...btn, color: 'var(--danger)', borderColor: 'var(--danger)' };
const tag = (color: string): React.CSSProperties => ({ fontSize: '0.5rem', letterSpacing: '1px', border: '1px solid currentColor', padding: '0 3px', color, whiteSpace: 'nowrap' });
const card: React.CSSProperties = { border: '1px solid color-mix(in srgb, var(--green) 45%, transparent)', padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: '4px' };

/** The highest level a pick can have (backend choices.js LIMITS.level). */
const MAX_LEVEL = 30;

/** What every card below shares: the lists, the worked-out picks, and what may be asked. */
interface Ctx {
  lists: ChoiceListShown[];
  worked: Worked;
  can: boolean;
  gm: boolean;
  ask: (action: ChoicesAction) => void;
  dropping: string | null;
  setDropping: (key: string | null) => void;
}

function Feature({ f, ctx }: { f: FeatureShown; ctx: Ctx }) {
  const does = featureDoes(f, ctx.lists);
  const use = ctx.worked.uses[f.id];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '0.68rem' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{f.label}</span>
        {does.map((d) => <span key={d} style={tag('var(--cyan)')}>{d}</span>)}
        {f.uses && use && (
          <span role="group" aria-label={`${f.label} uses`} style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
            {Array.from({ length: use.max }, (_, i) => {
              const left = i >= use.spent;
              return (
                <button key={i} type="button" aria-label={`${f.label} use ${i + 1}`} aria-pressed={!left} disabled={!ctx.can}
                  title={left ? 'Left: click to spend' : 'Spent: click to take back'}
                  onClick={() => ctx.ask({ kind: 'use', feature: f.id, spent: spentAfterClick(i, use.spent) })}
                  style={{ width: 11, height: 11, padding: 0, border: '1px solid var(--cyan)', background: left ? 'var(--cyan)' : 'none', cursor: ctx.can ? 'pointer' : 'default' }} />
              );
            })}
            <span style={small}>{use.max - use.spent} OF {use.max}{f.uses.refill ? ` · ${f.uses.refill.toUpperCase()}` : ''}</span>
          </span>
        )}
      </div>
      {f.text && <span style={{ ...small, opacity: 0.65 }}>{f.text}</span>}
    </div>
  );
}

/** The options still to pick, each button asking; one not met says what it needs (ADD ANYWAY for the GM). */
function Offer({ label, open, onPick, ctx }: { label: string; open: { option: OptionShown; unmet: string | null }[]; onPick: (option: string) => void; ctx: Ctx }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
      <span style={small}>{label.toUpperCase().replace(/^PICK A /, '+ ')}</span>
      {open.map(({ option, unmet }) => (
        <span key={option.id} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
          <button type="button" style={{ ...btn, opacity: unmet && !ctx.gm ? 0.4 : 1, cursor: unmet && !ctx.gm ? 'not-allowed' : 'pointer' }} disabled={!!unmet && !ctx.gm}
            title={unmet && ctx.gm ? 'Not met: as the GM, you can add it anyway' : option.description}
            onClick={() => onPick(option.id)}>{option.label.toUpperCase()}</button>
          {unmet && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>NEEDS {unmet}{ctx.gm ? ' · ADD ANYWAY' : ''}</span>}
        </span>
      ))}
    </div>
  );
}

/** DROP, asked first: the GM's alone. */
function Drop({ list, option, ctx }: { list: string; option: OptionShown; ctx: Ctx }) {
  const key = `${list}:${option.id}`;
  if (!ctx.can || !ctx.gm) return null;
  return ctx.dropping === key ? (
    <div role="group" aria-label={`Take ${option.label} away`} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ ...small, color: 'var(--danger)', opacity: 1 }}>TAKE {option.label.toUpperCase()} AWAY, AND WHAT IT GIVES?</span>
      <button type="button" style={danger} onClick={() => { ctx.setDropping(null); ctx.ask({ kind: 'drop', list, option: option.id }); }}>YES, DROP</button>
      <button type="button" style={btn} onClick={() => ctx.setDropping(null)}>KEEP</button>
    </div>
  ) : (
    <button type="button" style={danger} aria-label={`Drop ${option.label}`} onClick={() => ctx.setDropping(key)}>DROP</button>
  );
}

/** What hangs under a feature opening a list: its picks (each a card, and so on down), those waiting, and PICK. */
function Under({ f, unlocked, ctx }: { f: FeatureShown; unlocked: boolean; ctx: Ctx }) {
  const under = underFeature(f, ctx.lists, ctx.worked);
  if (!under || (!unlocked && !under.waiting.length && !under.picks.length)) return null;
  return (
    <div role="group" aria-label={`Under ${f.label}`}
      style={{ marginLeft: '10px', paddingLeft: '8px', borderLeft: '2px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {under.picks.map((p) => <Pick key={p.option.id} list={under.list} p={p} ctx={ctx} />)}
      {under.waiting.map((o) => (
        <div key={o.id} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...small, opacity: 0.45 }}>{o.label.toUpperCase()} · WAITS FOR {f.label.toUpperCase()}{f.at ? ` AT LEVEL ${f.at}` : ''}, KEPT</span>
          <Drop list={under.list.id} option={o} ctx={ctx} />
        </div>
      ))}
      {unlocked && under.room > 0 && ctx.can && under.open.length > 0 && (
        <Offer label={`Pick a ${under.list.one}`} open={under.open} ctx={ctx}
          onPick={(option) => ctx.ask({ kind: 'pick', list: under.list.id, option, from: f.id })} />
      )}
      {unlocked && under.room > 0 && !ctx.can && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>A {under.list.one.toUpperCase()} TO PICK</span>}
    </div>
  );
}

/** One pick: its name, level and DROP, its features (each with what it opens under it), and the next to come. */
function Pick({ list, p, ctx, fixed = false }: { list: ChoiceListShown; p: PickShown; ctx: Ctx; fixed?: boolean }) {
  const locked = p.option.features.filter((f) => !p.unlocked.includes(f));
  return (
    <div role="group" aria-label={p.option.label} style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
        <span title={p.option.description} style={{ fontSize: '0.72rem', letterSpacing: '1px' }}>{p.option.label.toUpperCase()}</span>
        {p.level !== null && (
          <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', fontSize: '0.62rem' }}>
            {ctx.can && <button type="button" style={btn} aria-label={`${p.option.label} level down`} disabled={p.level <= 1}
              onClick={() => ctx.ask({ kind: 'level', list: list.id, option: p.option.id, level: p.level! - 1 })}>−</button>}
            <span>LV {p.level}</span>
            {ctx.can && <button type="button" style={btn} aria-label={`${p.option.label} level up`} disabled={p.level >= MAX_LEVEL}
              onClick={() => ctx.ask({ kind: 'level', list: list.id, option: p.option.id, level: p.level! + 1 })}>+</button>}
          </span>
        )}
        {!fixed && ctx.dropping !== `${list.id}:${p.option.id}` && <Drop list={list.id} option={p.option} ctx={ctx} />}
      </div>
      {!fixed && ctx.dropping === `${list.id}:${p.option.id}` && <Drop list={list.id} option={p.option} ctx={ctx} />}
      {p.unlocked.map((f) => (
        <React.Fragment key={f.id}>
          <Feature f={f} ctx={ctx} />
          <Under f={f} unlocked ctx={ctx} />
        </React.Fragment>
      ))}
      {locked.map((f) => <Under key={f.id} f={f} unlocked={false} ctx={ctx} />)}
      {!p.unlocked.length && <span style={small}>Nothing unlocked yet.</span>}
      {p.next && <span style={{ ...small, opacity: 0.5 }}>NEXT · LV {p.next.at ?? 1}: {p.next.label}</span>}
    </div>
  );
}

export function ChoicesSection({ lists, data, readOnly, onChoices, refused, gm = false }: Props) {
  const worked = workedOn(data);
  // The pick the GM asked to take away, waiting for YES: "list:option".
  const [dropping, setDropping] = useState<string | null>(null);
  const can = !readOnly && !!onChoices;
  // In the builder's previews nothing is published yet: the block says what will be here.
  if (!lists.length) return <div style={small}>A character&apos;s picks from the system&apos;s lists show here: classes, backgrounds, feats.</div>;
  const ctx: Ctx = { lists, worked, can, gm, ask: (action) => onChoices?.(action), dropping, setDropping };
  const aside = keptAside(lists, worked);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {listsOnTheirOwn(lists).map((list) => {
        const view = listShown(list, worked);
        const everyone = pickedOf(list) === 'everyone';
        return (
          <section key={list.id} aria-label={list.many} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.65rem', letterSpacing: '2px' }}>{list.many.toUpperCase()}</span>
              {everyone && <span style={small}>EVERY CHARACTER HAS THESE</span>}
              {view.level !== null && view.picks.length > 0 && (
                <span title={view.breakdown} aria-label={`Level ${view.level}: ${view.breakdown}`} style={{ ...small, cursor: 'help', borderBottom: '1px dotted currentColor' }}>
                  LEVEL {view.level}
                </span>
              )}
            </div>
            {view.picks.map((p) => <Pick key={p.option.id} list={list} p={p} ctx={ctx} fixed={everyone} />)}
            {everyone && view.open.filter((o) => o.unmet).map(({ option, unmet }) => (
              <span key={option.id} style={{ ...small, opacity: 0.45 }}>{option.label.toUpperCase()} · NEEDS {unmet}</span>
            ))}
            {!everyone && !view.picks.length && <span style={small}>No {list.one || list.many} picked yet.</span>}
            {can && view.room && view.open.length > 0 && (
              <Offer label={`Pick a ${list.one}`} open={view.open} ctx={ctx}
                onPick={(option) => ctx.ask({ kind: 'pick', list: list.id, option })} />
            )}
          </section>
        );
      })}
      {aside.length > 0 && (
        <section aria-label="Kept, waiting" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ ...small, letterSpacing: '2px' }}>KEPT, WAITING</span>
          {aside.map(({ list, option }) => (
            <div key={`${list.id}:${option.id}`} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ ...small, opacity: 0.45 }}>{list.one.toUpperCase()} · {option.label.toUpperCase()}: counts again when what gave it comes back</span>
              <Drop list={list.id} option={option} ctx={ctx} />
            </div>
          ))}
        </section>
      )}
      {refused && <div role="alert" style={{ fontSize: '0.62rem', color: 'var(--warning)' }}>{refused}</div>}
    </div>
  );
}
