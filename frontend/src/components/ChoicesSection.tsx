import React, { useState } from 'react';
import {
  workedOn, listShown, spentAfterClick, featureDoes,
  type ChoiceListShown, type ChoicesAction, type FeatureShown,
} from '../sheets/choicesShown';

// A character sheet's CHOICES block (7a3b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): each list the system has, the character's picks in it with their levels (the list's
// total on hover, broken down: SOLDIER 3 + MAGE 1), the features each pick has unlocked with their
// uses to tick off, the next feature to come, and the options still to pick, one not met shown with
// what it needs. What a player may do is the server's to say (backend systemBuilder/picking.js); this
// only asks, and the server's answer comes back as the sheet saved again, or in words. The GM (7a3b2)
// also takes a pick away (DROP, asked first) and picks an option not met (ADD ANYWAY).

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
const tag = (color: string): React.CSSProperties => ({ fontSize: '0.5rem', letterSpacing: '1px', border: '1px solid currentColor', padding: '0 3px', color, whiteSpace: 'nowrap' });

/** The highest level a pick can have (backend choices.js LIMITS.level). */
const MAX_LEVEL = 30;

function Feature({ f, lists, use, canTick, onTick }: {
  f: FeatureShown; lists: ChoiceListShown[]; use?: { max: number; spent: number }; canTick: boolean; onTick: (spent: number) => void;
}) {
  const does = featureDoes(f, lists);
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
                <button key={i} type="button" aria-label={`${f.label} use ${i + 1}`} aria-pressed={!left} disabled={!canTick}
                  title={left ? 'Left: click to spend' : 'Spent: click to take back'}
                  onClick={() => onTick(spentAfterClick(i, use.spent))}
                  style={{ width: 11, height: 11, padding: 0, border: '1px solid var(--cyan)', background: left ? 'var(--cyan)' : 'none', cursor: canTick ? 'pointer' : 'default' }} />
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

export function ChoicesSection({ lists, data, readOnly, onChoices, refused, gm = false }: Props) {
  const worked = workedOn(data);
  // The pick the GM asked to take away, waiting for YES: "list:option".
  const [dropping, setDropping] = useState<string | null>(null);
  const can = !readOnly && !!onChoices;
  // In the builder's previews nothing is published yet: the block says what will be here.
  if (!lists.length) return <div style={small}>A character&apos;s picks from the system&apos;s lists show here: classes, backgrounds, feats.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {lists.map((list) => {
        const view = listShown(list, worked);
        return (
          <section key={list.id} aria-label={list.many} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.65rem', letterSpacing: '2px' }}>{list.many.toUpperCase()}</span>
              {view.level !== null && view.picks.length > 0 && (
                <span title={view.breakdown} aria-label={`Level ${view.level}: ${view.breakdown}`} style={{ ...small, cursor: 'help', borderBottom: '1px dotted currentColor' }}>
                  LEVEL {view.level}
                </span>
              )}
            </div>
            {view.picks.map((p) => (
              <div key={p.option.id} role="group" aria-label={p.option.label}
                style={{ border: '1px solid color-mix(in srgb, var(--green) 45%, transparent)', padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                  <span title={p.option.description} style={{ fontSize: '0.72rem', letterSpacing: '1px' }}>{p.option.label.toUpperCase()}</span>
                  {p.level !== null && (
                    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', fontSize: '0.62rem' }}>
                      {can && <button type="button" style={btn} aria-label={`${p.option.label} level down`} disabled={p.level <= 1}
                        onClick={() => onChoices!({ kind: 'level', list: list.id, option: p.option.id, level: p.level! - 1 })}>−</button>}
                      <span>LV {p.level}</span>
                      {can && <button type="button" style={btn} aria-label={`${p.option.label} level up`} disabled={p.level >= MAX_LEVEL}
                        onClick={() => onChoices!({ kind: 'level', list: list.id, option: p.option.id, level: p.level! + 1 })}>+</button>}
                    </span>
                  )}
                  {can && gm && dropping !== `${list.id}:${p.option.id}` && (
                    <button type="button" style={{ ...btn, color: 'var(--danger)', borderColor: 'var(--danger)' }} aria-label={`Drop ${p.option.label}`}
                      onClick={() => setDropping(`${list.id}:${p.option.id}`)}>DROP</button>
                  )}
                </div>
                {can && gm && dropping === `${list.id}:${p.option.id}` && (
                  <div role="group" aria-label={`Take ${p.option.label} away`} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ ...small, color: 'var(--danger)', opacity: 1 }}>TAKE {p.option.label.toUpperCase()} AWAY, AND WHAT IT GIVES?</span>
                    <button type="button" style={{ ...btn, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => { setDropping(null); onChoices!({ kind: 'drop', list: list.id, option: p.option.id }); }}>YES, DROP</button>
                    <button type="button" style={btn} onClick={() => setDropping(null)}>KEEP</button>
                  </div>
                )}
                {p.unlocked.map((f) => (
                  <Feature key={f.id} f={f} lists={lists} use={worked.uses[f.id]} canTick={can}
                    onTick={(spent) => onChoices!({ kind: 'use', feature: f.id, spent })} />
                ))}
                {!p.unlocked.length && <span style={small}>Nothing unlocked yet.</span>}
                {p.next && <span style={{ ...small, opacity: 0.5 }}>NEXT · LV {p.next.at ?? 1}: {p.next.label}</span>}
              </div>
            ))}
            {!view.picks.length && <span style={small}>No {list.one || list.many} picked yet.</span>}
            {can && view.room && view.open.length > 0 && (
              <div role="group" aria-label={`Pick a ${list.one}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                <span style={small}>+ {list.one.toUpperCase()}</span>
                {view.open.map(({ option, unmet }) => (
                  <span key={option.id} style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                    <button type="button" style={{ ...btn, opacity: unmet && !gm ? 0.4 : 1, cursor: unmet && !gm ? 'not-allowed' : 'pointer' }} disabled={!!unmet && !gm}
                      title={unmet && gm ? 'Not met: as the GM, you can add it anyway' : option.description}
                      onClick={() => onChoices!({ kind: 'pick', list: list.id, option: option.id })}>{option.label.toUpperCase()}</button>
                    {unmet && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>NEEDS {unmet}{gm ? ' · ADD ANYWAY' : ''}</span>}
                  </span>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {refused && <div role="alert" style={{ fontSize: '0.62rem', color: 'var(--warning)' }}>{refused}</div>}
    </div>
  );
}
