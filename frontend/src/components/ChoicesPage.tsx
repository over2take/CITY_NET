import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import {
  choiceLists, picksOf, withNewList, withList, withoutList, withNewOption, withOption, withoutOption, levelNames, LIMITS,
  type ChoiceList, type ChoiceOption,
} from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { FeaturesEditor } from './FeaturesEditor';

// The builder's CHOICES page (7a2b1; approved mockup docs/mockups/builder-choices.html, 2026-10-27):
// the lists a character picks from (classes, backgrounds, feats), named in the game's own words. The
// lists down the left; the open one in the middle, with its names, how many a character picks,
// MORE THAN ONCE and LEVELLED, and its options; the open option on the right, with its name, words
// and requirement, and its features (7a2b2, FeaturesEditor.tsx). What it reads and writes is
// sheets/choices.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '3px 12px', cursor: 'pointer',
});
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
/** A name in the right-aligned column of the settings grid. */
const END = { justifySelf: 'end' } as const;

/** Asks before deleting: DELETE, then DELETE / KEEP with what goes. */
function DeleteButton({ what, gone, onDelete }: { what: string; gone: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking
    ? <span role="group" aria-label={`Delete ${what}`} style={row}>
        <span style={{ ...why, color: 'var(--danger)' }}>Delete {what}? {gone}</span>
        <button type="button" className="utility-btn danger-btn" style={btn} onClick={onDelete}>DELETE</button>
        <button type="button" className="utility-btn" style={btn} onClick={() => setAsking(false)}>KEEP</button>
      </span>
    : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setAsking(true)}>DELETE</button>;
}

/** An on/off setting, read by screen readers as a switch, with what it means under it. */
function Switch({ label, on, onFlip, disabled }: { label: string; on: boolean; onFlip: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onFlip}
      style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, color: 'var(--cyan)', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1 }}>
      {on ? '◉' : '○'} {label}
    </button>
  );
}

function ListPanel({ list, definition, edit, picked, onPick }: Props & { list: ChoiceList; picked: string | null; onPick: (id: string) => void }) {
  const set = (patch: Parameters<typeof withList>[2]) => edit(withList(definition, list.id, patch));
  const picks = picksOf(list);
  const name = list.many.trim() || 'this list';
  const add = () => {
    const made = withNewOption(definition, list.id);
    if (!made) return;
    edit(made.definition);
    onPick(made.id);
  };
  return (
    <section aria-label={`${list.many || list.id} list`} style={panel}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>THE LIST · {(list.many || list.id).toUpperCase()}</span>
        <DeleteButton what={name} gone={list.options.length ? `Its ${list.options.length} option${list.options.length === 1 ? '' : 's'} go with it, and characters lose these picks.` : ''}
          onDelete={() => edit(withoutList(definition, list.id))} />
      </div>
      <div style={grid}>
        <FieldName boxStyle={END} hint={HINTS['choices.names']} style={small}>ONE / MANY</FieldName>
        <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 }}>
          <input type="text" aria-label="One" maxLength={LIMITS.label} value={list.one} style={input}
            aria-invalid={!list.one.trim() ? true : undefined} onChange={(e) => set({ one: e.target.value })} />
          <input type="text" aria-label="Many" maxLength={LIMITS.label} value={list.many} style={input}
            aria-invalid={!list.many.trim() ? true : undefined} onChange={(e) => set({ many: e.target.value })} />
        </span>
        <FieldName boxStyle={END} hint={HINTS['choices.picks']} style={small}>A CHARACTER PICKS</FieldName>
        <span style={row}>
          <span role="group" aria-label="A character picks" style={{ display: 'inline-flex', border: '1px solid var(--green)' }}>
            <button type="button" aria-pressed={picks === 1} style={seg(picks === 1)} onClick={() => set({ picks: 1 })}>ONE</button>
            <button type="button" aria-pressed={typeof picks === 'number' && picks > 1} style={seg(typeof picks === 'number' && picks > 1)}
              onClick={() => set({ picks: typeof picks === 'number' && picks > 1 ? picks : 2 })}>SEVERAL</button>
            <button type="button" aria-pressed={picks === 'any'} style={seg(picks === 'any')} onClick={() => set({ picks: 'any' })}>ANY</button>
          </span>
          {typeof picks === 'number' && picks > 1 && (
            <input type="number" aria-label="How many" min={2} max={LIMITS.picks} step={1} value={picks} style={{ ...input, width: 64 }}
              onChange={(e) => { const n = Math.trunc(Number(e.target.value)); if (Number.isFinite(n) && n >= 2) set({ picks: n }); }} />
          )}
        </span>
        <FieldName boxStyle={END} hint={HINTS['choices.again']} style={small}>MORE LATER</FieldName>
        <Switch label="MORE THAN ONCE" on={list.again === true} disabled={picks === 'any'} onFlip={() => set({ again: list.again !== true })} />
        <FieldName boxStyle={END} hint={HINTS['choices.levelled']} style={small}>LEVELS</FieldName>
        <Switch label="LEVELLED" on={list.levelled === true} onFlip={() => set({ levelled: list.levelled !== true })} />
      </div>
      <p style={{ ...why, fontSize: 11, opacity: 0.7 }}>
        {picks === 'any' ? 'Any number of these, picked whenever.' : `${picks === 1 ? 'One' : picks} ${picks === 1 ? list.one || 'pick' : list.many || 'picks'}${list.again ? ', and more can be added later' : ' per character'}.`}
        {list.levelled ? ` Each has its own level; together they read as ${levelNames(list).list}.` : ''}
      </p>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <FieldName hint={HINTS['choices.options']} style={small}>OPTIONS · {list.options.length} OF {LIMITS.options}</FieldName>
        <button type="button" className="utility-btn" style={btn} disabled={list.options.length >= LIMITS.options} onClick={add}>+ OPTION</button>
      </div>
      {list.options.length ? (
        <div role="group" aria-label="Options" style={row}>
          {list.options.map((o) => (
            <button key={o.id} type="button" aria-pressed={o.id === picked} onClick={() => onPick(o.id)}
              style={{ ...seg(o.id === picked), border: '1px solid var(--dark-green)', color: o.id === picked ? 'var(--black)' : o.label.trim() ? 'var(--green)' : 'var(--danger)' }}>
              {(o.label.trim() || 'NEEDS A NAME').toUpperCase()}
            </button>
          ))}
        </div>
      ) : <p style={why}>No options yet. + OPTION makes one: a class, a background, a feat.</p>}
    </section>
  );
}

function OptionPanel({ list, option, definition, edit }: Props & { list: ChoiceList; option: ChoiceOption }) {
  const set = (patch: Parameters<typeof withOption>[3]) => edit(withOption(definition, list.id, option.id, patch));
  const features = (option.features ?? []).filter((f): f is { id: string; label?: string } => !!f && typeof f === 'object' && typeof (f as { id?: unknown }).id === 'string');
  const id = (part: string) => `choice-${list.id}-${option.id}-${part}`;
  return (
    <section aria-label={`${option.label || option.id} option`} style={panel}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>THE OPTION · {(option.label || option.id).toUpperCase()}</span>
        <DeleteButton what={option.label.trim() || 'this option'} gone={features.length ? `Its ${features.length} feature${features.length === 1 ? '' : 's'} go with it.` : ''}
          onDelete={() => edit(withoutOption(definition, list.id, option.id))} />
      </div>
      <div style={grid}>
        <FieldName boxStyle={END} htmlFor={id('name')} hint={HINTS['choices.optionName']} style={small}>NAME</FieldName>
        <input id={id('name')} type="text" maxLength={LIMITS.label} value={option.label} style={input}
          aria-invalid={!option.label.trim() ? true : undefined} onChange={(e) => set({ label: e.target.value })} />
        <FieldName boxStyle={END} htmlFor={id('description')} hint={HINTS['choices.description']} style={small}>WHAT IT IS</FieldName>
        <textarea id={id('description')} rows={2} maxLength={LIMITS.description} value={option.description ?? ''}
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} onChange={(e) => set({ description: e.target.value })} />
        <FieldName boxStyle={END} htmlFor={id('requires')} hint={HINTS['choices.requires']} style={small}>REQUIRES</FieldName>
        <input id={id('requires')} type="text" maxLength={1000} value={option.requires ?? ''} placeholder="NOTHING · @int >= 13" style={input}
          onChange={(e) => set({ requires: e.target.value })} />
      </div>
      {list.levelled && <p style={{ ...why, fontSize: 11, opacity: 0.7 }}>Its level reads as {levelNames(list).options[option.id]} in formulas: 0 for a character without it.</p>}
      <FeaturesEditor definition={definition} edit={edit} list={list} option={option} />
    </section>
  );
}

export function ChoicesPage({ definition, edit }: Props) {
  const lists = choiceLists(definition);
  const [pickedList, setPickedList] = useState<string>(lists[0]?.id ?? '');
  const list = lists.find((c) => c.id === pickedList) ?? lists[0];
  const [pickedOption, setPickedOption] = useState<string | null>(list?.options[0]?.id ?? null);
  // Option ids are one set across the system, so the one picked is only ever in its own list:
  // another list opens on its first.
  const option = list?.options.find((o) => o.id === pickedOption) ?? list?.options[0];

  const add = () => {
    const made = withNewList(definition);
    if (!made) return;
    edit(made.definition);
    setPickedList(made.id);
    setPickedOption(null);
  };

  return (
    <div data-testid="choices-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1300 }}>
      <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...row, justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)' }}>
          <FieldName hint={HINTS['choices.lists']} style={small}>{lists.length} OF {LIMITS.lists}</FieldName>
          <button type="button" className="utility-btn" style={btn} disabled={lists.length >= LIMITS.lists} onClick={add}>+ LIST</button>
        </div>
        <ul aria-label="Lists" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lists.map((c) => (
            <li key={c.id} style={{
              padding: '7px 10px', borderTop: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)',
              background: c.id === list?.id ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none',
              boxShadow: c.id === list?.id ? 'inset 3px 0 0 var(--green)' : 'none',
            }}>
              <button type="button" aria-current={c.id === list?.id || undefined} onClick={() => setPickedList(c.id)}
                style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, width: '100%',
                  color: c.many.trim() ? 'var(--green)' : 'var(--danger)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c.many.trim() || 'NEEDS A NAME').toUpperCase()}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{c.options.length} OPTION{c.options.length === 1 ? '' : 'S'}{c.levelled ? ' · LEVELLED' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        {!lists.length && <p style={{ ...why, padding: '8px 10px' }}>None yet. A list is something characters pick from, like CLASSES, BACKGROUNDS or FEATS: + LIST makes one.</p>}
      </div>
      {list && <ListPanel key={list.id} list={list} definition={definition} edit={edit} picked={option?.id ?? null} onPick={setPickedOption} />}
      {list && option && <OptionPanel key={`${list.id}:${option.id}`} list={list} option={option} definition={definition} edit={edit} />}
    </div>
  );
}
