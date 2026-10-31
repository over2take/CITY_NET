import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  choiceLists, picksOf, pickedOf, openedBy, followedBy, unlocksByLevel, withNewList, withList, withoutList, withNewOption, withOption, withoutOption, levelNames, LIMITS,
  type ChoiceList, type ChoiceOption, type Picked,
} from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
import { FieldName } from './HelpHint';
import { FeaturesEditor } from './FeaturesEditor';
import { ChoicesImport } from './ChoicesImport';
import { ToggleSwitch } from './ToggleSwitch';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { restingOf, DIE_CHOICES } from '../sheets/recovery';

// The builder's CHOICES page (7a2b1; approved mockup docs/mockups/builder-choices.html, 2026-10-27):
// the lists a character picks from (classes, backgrounds, feats), named in the game's own words. The
// lists down the left; the open one in the middle, with its names, how many a character picks,
// MORE THAN ONCE and LEVELLED, and its options; the open option on the right, with its name, words
// and requirement, a levelled list's HIT DIE (R1b), and its features (7a2b2, FeaturesEditor.tsx). What it reads and writes is
// sheets/choices.ts; every change goes through the builder's `edit`. IMPORT on a list (choices import 2,
// ChoicesImport.tsx) opens over the list and option columns.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** The server, for IMPORT's PREVIEW and the formula boxes; none when looking at an example. */
  api?: ReturnType<typeof systemsApi>;
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
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
/** How a list is picked, as the page offers it (7a5a2; approved mockup nested-choices), with what each means. */
const PICKED_WAYS: { id: Picked; label: string; why: string }[] = [
  { id: 'own', label: 'ON ITS OWN', why: 'A list of its own on the sheet. A feature opening it only names it.' },
  { id: 'features', label: 'THROUGH FEATURES', why: 'Only under the features that open it: as many picks as each gives, when it unlocks. Not a list of its own on the sheet.' },
  { id: 'both', label: 'BOTH', why: 'Its own picks at the start, and more under each feature that opens it, like feats.' },
  { id: 'everyone', label: 'EVERYONE HAS IT', why: 'Nothing to pick: every character has each option whose requirement they meet, its features unlocking by their level.' },
];

/** No options outlined as new. */
const NONE = new Set<string>();

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

interface ListExtras { list: ChoiceList; picked: string | null; onPick: (id: string) => void; onImport: () => void; fresh: Set<string>; status: string | null }

function ListPanel({ list, definition, edit, picked, onPick, onImport, fresh, status }: Props & ListExtras) {
  const set = (patch: Parameters<typeof withList>[2]) => edit(withList(definition, list.id, patch));
  const picks = picksOf(list);
  const way = pickedOf(list);
  const openers = openedBy(definition, list.id);
  const followed = followedBy(definition, list);
  const ownPicks = way === 'own' || way === 'both';
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
        <span style={row}>
          <button type="button" className="utility-btn" style={btn} title={`Fill ${name} from a file`} onClick={onImport}>IMPORT</button>
          <DeleteButton what={name} gone={list.options.length ? `Its ${list.options.length} option${list.options.length === 1 ? '' : 's'} go with it, and characters lose these picks.` : ''}
            onDelete={() => edit(withoutList(definition, list.id))} />
        </span>
      </div>
      {status && <p role="status" style={{ ...why, color: 'var(--cyan)', opacity: 1, letterSpacing: 1 }}>{status}</p>}
      {openers.length > 0 && (
        <p aria-label="Opened by" style={{ ...why, color: 'var(--warning)', border: '1px dashed var(--warning)', padding: '4px 8px', opacity: 1, letterSpacing: 1 }}>
          OPENED BY · {openers.map((o) => `${(o.option.label || o.option.id).toUpperCase()}: ${(o.feature.label || o.feature.id).toUpperCase()}${unlocksByLevel(definition, o.list) && o.feature.at ? ` (LV ${o.feature.at})` : ''}`).join(' · ')}
        </p>
      )}
      <div style={grid}>
        <FieldName beside hint={HINTS['choices.names']} style={small}>ONE / MANY</FieldName>
        <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 }}>
          <input type="text" aria-label="One" maxLength={LIMITS.label} value={list.one} style={input}
            aria-invalid={!list.one.trim() ? true : undefined} onChange={(e) => set({ one: e.target.value })} />
          <input type="text" aria-label="Many" maxLength={LIMITS.label} value={list.many} style={input}
            aria-invalid={!list.many.trim() ? true : undefined} onChange={(e) => set({ many: e.target.value })} />
        </span>
        <FieldName beside hint={HINTS['choices.picked']} style={small}>PICKED</FieldName>
        <span role="group" aria-label="Picked" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)', justifySelf: 'start' }}>
          {PICKED_WAYS.map((w) => (
            <button key={w.id} type="button" aria-pressed={way === w.id} title={w.why} style={seg(way === w.id)} onClick={() => set({ picked: w.id })}>{w.label}</button>
          ))}
        </span>
        <span />
        <span style={{ ...why, fontSize: 11, opacity: 0.7 }}>
          {PICKED_WAYS.find((w) => w.id === way)!.why}
          {openers.length > 0 && way === 'own' ? ' Features open this list: THROUGH FEATURES or BOTH puts their picks under them.' : ''}
        </span>
        {ownPicks && <>
        <FieldName beside hint={HINTS['choices.picks']} style={small}>A CHARACTER PICKS</FieldName>
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
        <FieldName beside hint={HINTS['choices.again']} style={small}>MORE LATER</FieldName>
        <ToggleSwitch label="MORE THAN ONCE" on={list.again === true} disabled={picks === 'any'} onChange={() => set({ again: list.again !== true })} />
        </>}
        {way !== 'everyone' && <>
        <FieldName beside hint={HINTS['choices.levelled']} style={small}>LEVELS</FieldName>
        <ToggleSwitch label="LEVELLED" on={list.levelled === true} onChange={() => set({ levelled: list.levelled !== true })} />
        </>}
      </div>
      <p style={{ ...why, fontSize: 11, opacity: 0.7 }}>
        {!ownPicks ? '' : picks === 'any' ? 'Any number of these, picked whenever.' : `${picks === 1 ? 'One' : picks} ${picks === 1 ? list.one || 'pick' : list.many || 'picks'}${list.again ? ', and more can be added later' : ' per character'}${way === 'both' ? ' at the start' : ''}.`}
        {list.levelled ? ` Each has its own level; together they read as ${levelNames(list).list}.` : ''}
        {followed.length ? ` Each one's features unlock by the level of the pick that opened it: ${followed.map((o) => (o.label || o.id).toUpperCase()).join(', ')}.` : ''}
      </p>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <FieldName hint={HINTS['choices.options']} style={small}>OPTIONS · {list.options.length} OF {LIMITS.options}</FieldName>
        <button type="button" className="utility-btn" style={btn} disabled={list.options.length >= LIMITS.options} onClick={add}>+ OPTION</button>
      </div>
      {list.options.length ? (
        <div role="group" aria-label="Options" style={row}>
          {list.options.map((o) => (
            <button key={o.id} type="button" aria-pressed={o.id === picked} onClick={() => onPick(o.id)}
              style={{ ...seg(o.id === picked), border: `1px solid ${fresh.has(o.id) ? 'var(--cyan)' : 'var(--dark-green)'}`, color: o.id === picked ? 'var(--black)' : o.label.trim() ? 'var(--green)' : 'var(--danger)' }}>
              {(o.label.trim() || 'NEEDS A NAME').toUpperCase()}
            </button>
          ))}
        </div>
      ) : <p style={why}>No options yet. + OPTION makes one: a class, a background, a feat.</p>}
    </section>
  );
}

/**
 * HIT DIE (R1b; approved mockup rest-on-sheet): none, the usual dice, or OTHER with its sides typed.
 * OTHER stays open while typing, so 1 on the way to 10 doesn't close it.
 */
/** A die's button: narrower than the other settings' so all eight fit the option's column on one line. */
const dieSeg = (on: boolean): React.CSSProperties => ({ ...seg(on), padding: '3px 7px' });

function DiePicker({ die, onChange }: { die?: number; onChange: (die: number | null) => void }) {
  const other = die !== undefined && !(DIE_CHOICES as readonly number[]).includes(die);
  const [typing, setTyping] = useState(other);
  const pick = (next: number | null) => { setTyping(false); onChange(next); };
  return (
    <span style={row}>
      <span role="group" aria-label="Hit die" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--green)' }}>
        <button type="button" aria-pressed={die === undefined && !typing} style={dieSeg(die === undefined && !typing)} onClick={() => pick(null)}>NONE</button>
        {DIE_CHOICES.map((n) => (
          <button key={n} type="button" aria-pressed={die === n && !typing} style={dieSeg(die === n && !typing)} onClick={() => pick(n)}>D{n}</button>
        ))}
        <button type="button" aria-pressed={other || typing} style={dieSeg(other || typing)} onClick={() => { setTyping(true); if (!other) onChange(3); }}>OTHER</button>
      </span>
      {(other || typing) && (
        <input type="number" aria-label="Sides" min={LIMITS.dieLeast} max={LIMITS.dieMost} step={1} value={die ?? ''} style={{ ...input, width: 64 }}
          onChange={(e) => { const n = Math.trunc(Number(e.target.value)); if (n >= LIMITS.dieLeast && n <= LIMITS.dieMost) onChange(n); }} />
      )}
    </span>
  );
}

function OptionPanel({ list, option, definition, edit, api }: Props & { list: ChoiceList; option: ChoiceOption }) {
  const set = (patch: Parameters<typeof withOption>[3]) => edit(withOption(definition, list.id, option.id, patch));
  const features = (option.features ?? []).filter((f): f is { id: string; label?: string } => !!f && typeof f === 'object' && typeof (f as { id?: unknown }).id === 'string');
  const id = (part: string) => `choice-${list.id}-${option.id}-${part}`;
  const requires = useFormulaBox({
    definition, api, kind: 'requires', value: option.requires ?? '', onChange: (text) => set({ requires: text }),
    label: 'REQUIRES', id: id('requires'), placeholder: 'NOTHING · @int >= 13', inputStyle: input,
  });
  const recovery = restingOf(definition).recovery;
  return (
    <section aria-label={`${option.label || option.id} option`} style={panel}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={small}>THE OPTION · {(option.label || option.id).toUpperCase()}</span>
        <DeleteButton what={option.label.trim() || 'this option'} gone={features.length ? `Its ${features.length} feature${features.length === 1 ? '' : 's'} go with it.` : ''}
          onDelete={() => edit(withoutOption(definition, list.id, option.id))} />
      </div>
      <div style={grid}>
        <FieldName beside htmlFor={id('name')} hint={HINTS['choices.optionName']} style={small}>NAME</FieldName>
        <input id={id('name')} type="text" maxLength={LIMITS.label} value={option.label} style={input}
          aria-invalid={!option.label.trim() ? true : undefined} onChange={(e) => set({ label: e.target.value })} />
        <FieldName beside htmlFor={id('description')} hint={HINTS['choices.description']} style={small}>WHAT IT IS</FieldName>
        <textarea id={id('description')} rows={2} maxLength={LIMITS.description} value={option.description ?? ''}
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} onChange={(e) => set({ description: e.target.value })} />
        <FieldName beside htmlFor={id('requires')} hint={HINTS['choices.requires']} style={small}>REQUIRES</FieldName>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>{requires.field}{requires.help}</div>
        {list.levelled && <>
        <FieldName beside hint={HINTS['choices.die']} style={small}>HIT DIE</FieldName>
        <DiePicker die={option.die} onChange={(die) => set({ die })} />
        </>}
      </div>
      {list.levelled && <p style={{ ...why, fontSize: 11, opacity: 0.7 }}>
        Its level reads as {levelNames(list).options[option.id]} in formulas: 0 for a character without it.
        {option.die !== undefined && (recovery ? ` Its d${option.die} is what its ${(recovery.name.trim() || 'recovery dice').toLowerCase()} roll at a rest.` : ` Turn on RECOVERY DICE on RESTS to spend its d${option.die} at a rest.`)}
      </p>}
      <FeaturesEditor definition={definition} edit={edit} list={list} option={option} api={api} />
    </section>
  );
}

export function ChoicesPage({ definition, edit, api }: Props) {
  const lists = choiceLists(definition);
  const [pickedList, setPickedList] = useState<string>(lists[0]?.id ?? '');
  const list = lists.find((c) => c.id === pickedList) ?? lists[0];
  const [pickedOption, setPickedOption] = useState<string | null>(list?.options[0]?.id ?? null);
  // Option ids are one set across the system, so the one picked is only ever in its own list:
  // another list opens on its first.
  const option = list?.options.find((o) => o.id === pickedOption) ?? list?.options[0];
  /** The list IMPORT is open on, what its last APPLY said, and the options it added (outlined). */
  const [importing, setImporting] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ list: string; text: string; added: Set<string> } | null>(null);

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
              <button type="button" aria-current={c.id === list?.id || undefined} onClick={() => { setPickedList(c.id); setImporting(null); }}
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
      {list && importing === list.id && (
        <ChoicesImport key={list.id} definition={definition} list={list} api={api} edit={edit} onClose={() => setImporting(null)}
          onApplied={(added, text) => { setApplied({ list: list.id, text, added: new Set(added) }); setImporting(null); }} />
      )}
      {list && importing !== list.id && (
        <ListPanel key={list.id} list={list} definition={definition} edit={edit} picked={option?.id ?? null} onPick={setPickedOption}
          onImport={() => { setImporting(list.id); setApplied(null); }}
          fresh={applied?.list === list.id ? applied.added : NONE} status={applied?.list === list.id ? applied.text : null} />
      )}
      {list && option && importing !== list.id && <OptionPanel key={`${list.id}:${option.id}`} list={list} option={option} definition={definition} edit={edit} api={api} />}
    </div>
  );
}
