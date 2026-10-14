import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import { houseRuleList, withNewHouseRule, withHouseRule, withoutHouseRule, waitingOn, LIMITS, type HouseRule } from '../sheets/houseRules';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';

// The builder's HOUSE RULES page (4j3b; approved mockup docs/mockups/optional-rules.html,
// 2026-10-14): a system's own house rules, which the GM turns on or off for their table in the GAME
// tab. The rules down the left; the open one on the right with its name, what it means, whether a
// game starts with it on, and what waits on it, each with GO TO. Things go under a rule on their
// own pages (ONLY WITH). Deleting one asks first, and what waited on it is then always there. What
// it reads and writes is sheets/houseRules.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** Opens the page something waiting on a rule lives on. */
  onGoTo?: (page: BuilderPage) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 12px', cursor: 'pointer',
});
/** A name in the right-aligned column of the settings grid. */
const END = { justifySelf: 'end' } as const;

function Detail({ rule, definition, edit, onGoTo }: Props & { rule: HouseRule }) {
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Parameters<typeof withHouseRule>[2]) => edit(withHouseRule(definition, rule.id, patch));
  const waiting = waitingOn(definition, rule.id);
  const name = rule.name.trim() || 'this rule';
  return (
    <section aria-label={`${rule.name || rule.id} house rule`} style={{ border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>ONE OF THIS SYSTEM&apos;S RULES</span>
        {confirm
          ? <span role="group" aria-label={`Delete ${name}`} style={row}>
              <span style={{ ...why, color: 'var(--danger)' }}>
                Delete {name}?{waiting.length ? ` What waits on it (${waiting.length}) stays, always there.` : ''}
              </span>
              <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => edit(withoutHouseRule(definition, rule.id))}>DELETE</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setConfirm(false)}>KEEP</button>
            </span>
          : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setConfirm(true)}>DELETE</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' }}>
        <FieldName boxStyle={END} htmlFor={`house-name-${rule.id}`} hint={HINTS['house.name']} style={small}>NAME</FieldName>
        <input id={`house-name-${rule.id}`} type="text" maxLength={LIMITS.name} value={rule.name} style={input}
          aria-invalid={!rule.name.trim() ? true : undefined} onChange={(e) => set({ name: e.target.value })} />
        <FieldName boxStyle={END} htmlFor={`house-desc-${rule.id}`} hint={HINTS['house.description']} style={small}>WHAT IT MEANS</FieldName>
        <textarea id={`house-desc-${rule.id}`} rows={2} maxLength={LIMITS.description} value={rule.description ?? ''}
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} onChange={(e) => set({ description: e.target.value })} />
        <FieldName boxStyle={END} hint={HINTS['house.starts']} style={small}>STARTS</FieldName>
        <span role="group" aria-label="Starts" style={{ display: 'inline-flex', border: '1px solid var(--green)', justifySelf: 'start' }}>
          <button type="button" aria-pressed={rule.starts === true} style={seg(rule.starts === true)} onClick={() => set({ starts: true })}>ON</button>
          <button type="button" aria-pressed={rule.starts !== true} style={seg(rule.starts !== true)} onClick={() => set({ starts: false })}>OFF</button>
        </span>
      </div>
      <p style={{ ...why, fontSize: 11, opacity: 0.7 }}>Shown to the GM beside its checkbox in the GAME tab. STARTS is how a game begins with it, and how a copy installed from a file arrives.</p>
      <span style={small}>WHAT WAITS ON IT</span>
      {waiting.length ? (
        <ul aria-label="What waits on it" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {waiting.map((w) => (
            <li key={`${w.kind}-${w.id}`} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '4px 8px', border: '1px solid color-mix(in srgb, var(--dark-green) 80%, transparent)' }}>
              <span style={{ ...small, fontSize: 9 }}>{w.kind}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.label}</span>
              {onGoTo && <button type="button" className="utility-btn" style={btn} aria-label={`Go to ${w.label}`} onClick={() => onGoTo(w.page)}>GO TO</button>}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ ...why, fontSize: 11 }}>Nothing yet, so this rule changes nothing. Put something under it on its own page, with its ONLY WITH box: a FEATURES part, a sheet section, a condition, or a formula&apos;s alternative.</p>
      )}
    </section>
  );
}

export function HouseRulesPage({ definition, edit, onGoTo }: Props) {
  const list = houseRuleList(definition);
  const [picked, setPicked] = useState<string>(list[0]?.id ?? '');
  const current = list.find((r) => r.id === picked) ?? list[0];

  const add = () => {
    const made = withNewHouseRule(definition);
    if (!made) return;
    edit(made.definition);
    setPicked(made.id);
  };

  return (
    <div data-testid="house-rules-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1100 }}>
      <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...row, justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)' }}>
          <span style={small}>{list.length} OF {LIMITS.rules}</span>
          <button type="button" className="utility-btn" style={btn} disabled={list.length >= LIMITS.rules} onClick={add}>+ RULE</button>
        </div>
        <ul aria-label="House rules" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {list.map((r) => (
            <li key={r.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '7px 10px',
              borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)',
              background: r.id === current?.id ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none',
              boxShadow: r.id === current?.id ? 'inset 3px 0 0 var(--green)' : 'none',
            }}>
              <button type="button" aria-current={r.id === current?.id || undefined} onClick={() => setPicked(r.id)}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1,
                  color: r.name.trim() ? 'var(--green)' : 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(r.name.trim() || 'NEEDS A NAME').toUpperCase()}
              </button>
              <span style={{ fontSize: 9, letterSpacing: 1, padding: '0 4px', border: '1px solid currentColor', opacity: 0.8, color: r.starts ? 'var(--cyan)' : 'inherit' }}>
                {r.starts ? 'STARTS ON' : 'STARTS OFF'}
              </span>
            </li>
          ))}
        </ul>
        {!list.length && <p style={{ ...why, padding: '8px 10px' }}>None yet. A house rule is a choice the GM makes for their table, like MAGIC or GRITTY WOUNDS: + RULE makes one.</p>}
      </div>
      {current && <Detail key={current.id} rule={current} definition={definition} edit={edit} onGoTo={onGoTo} />}
    </div>
  );
}
