import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  itemTypes, ownTypes, typeOf, itemValues, withNewType, withType, withoutType, withNewColumn, withColumn, withoutColumn,
  withItemType, withItemValue, wordsFrom, KINDS, PRESETS, LIMITS, type ItemColumn, type ItemType, type ColumnKind,
} from '../sheets/itemTypes';
import { itemList, type Item } from '../sheets/items';
import { restsOf } from '../sheets/rests';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { HINTS } from '../sheets/builderHelp';
import { ColumnHead, FieldName } from './HelpHint';

// ITEM TYPES on the builder's ITEMS page (8a2; approved mockup docs/mockups/item-types.html, 2026-11-14): the types,
// each a name, what one is called and its columns, started from a preset or blank; and, on an item, its type and a
// field for each of that type's columns. What it reads and writes is sheets/itemTypes.ts; every change goes through
// the builder's `edit`.

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
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, letterSpacing: 2, opacity: 0.75, fontWeight: 'normal', padding: '4px 6px' };
const td: React.CSSProperties = { padding: '3px 6px', verticalAlign: 'top' };
const tag: React.CSSProperties = { fontSize: 9, letterSpacing: 1, border: '1px solid currentColor', padding: '0 4px', color: 'var(--cyan)', whiteSpace: 'nowrap' };
const pressed = (on: boolean): React.CSSProperties => ({ ...btn, background: on ? 'var(--green)' : undefined, color: on ? 'var(--black)' : undefined });

const nameOf = (t: ItemType) => t.label.trim() || t.id;
const columnName = (c: ItemColumn) => c.label.trim() || c.id;

/** PICK ONE's words as one box, commas between: what is typed is kept while it is being typed, the words written each time. */
function WordsBox({ words, label, onWords }: { words: string[]; label: string; onWords: (words: string[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? words.join(', ');
  return (
    <input type="text" aria-label={label} value={value} placeholder="LIGHT, MEDIUM, HEAVY" style={{ ...input, width: 220 }}
      aria-invalid={!words.length ? true : undefined}
      onFocus={() => setDraft(value)} onBlur={() => setDraft(null)}
      onChange={(e) => { setDraft(e.target.value); onWords(wordsFrom(e.target.value)); }} />
  );
}

/** What a column's kind has besides: a NUMBER's unit, a COUNT's button, rest and reloads, PICK ONE's words. */
function ColumnAnd({ definition, edit, type, c }: Props & { type: ItemType; c: ItemColumn }) {
  const name = columnName(c);
  const set = (patch: Parameters<typeof withColumn>[3]) => edit(withColumn(definition, type.id, c.id, patch));
  if (c.kind === 'number') {
    return (
      <span style={row}>
        <input type="text" aria-label={`${name} unit`} maxLength={LIMITS.unit} value={c.unit ?? ''} style={{ ...input, width: 70 }}
          onChange={(e) => set({ unit: e.target.value })} />
        <span style={{ ...why, fontSize: 11 }}>UNIT</span>
      </span>
    );
  }
  if (c.kind === 'pick') return <WordsBox words={c.options ?? []} label={`${name} words`} onWords={(options) => set({ options })} />;
  if (c.kind !== 'count') return <span style={{ ...why, fontSize: 11 }}>—</span>;
  const rests = restsOf(definition);
  const items = itemList(definition);
  const reload = c.reload ?? [];
  const label = (id: string) => items.find((i) => i.id === id)?.label.trim() || id;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={row}>
        <input type="text" aria-label={`${name} button`} maxLength={LIMITS.word} value={c.button ?? ''} placeholder="USE" style={{ ...input, width: 80 }}
          onChange={(e) => set({ button: e.target.value })} />
        <span style={{ ...why, fontSize: 11 }}>SPENDS ONE · REFILLED BY</span>
        <select aria-label={`${name} refilled by`} value={c.refill ?? ''} style={input} onChange={(e) => set({ refill: e.target.value })}>
          <option value="">NO REST</option>
          {c.refill && !rests.some((r) => r.id === c.refill) && <option value={c.refill}>{c.refill.toUpperCase()}</option>}
          {rests.map((r) => <option key={r.id} value={r.id}>{r.name.toUpperCase()}</option>)}
        </select>
      </span>
      <span role="group" aria-label={`${name} reloads from`} style={row}>
        <span style={{ ...why, fontSize: 11 }}>RELOADS FROM</span>
        {reload.map((id) => (
          <span key={id} style={{ ...tag, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {label(id)}
            <button type="button" aria-label={`${name} no longer reloads from ${label(id)}`} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, fontFamily: 'monospace' }}
              onClick={() => set({ reload: reload.filter((r) => r !== id) })}>×</button>
          </span>
        ))}
        <select aria-label={`${name}: reload from an item`} value="" style={input} disabled={reload.length >= LIMITS.reload || items.every((i) => reload.includes(i.id))}
          onChange={(e) => { if (e.target.value) set({ reload: [...reload, e.target.value] }); }}>
          <option value="">{items.length ? '+ AN ITEM' : 'NO ITEMS YET'}</option>
          {items.filter((i) => !reload.includes(i.id)).map((i) => <option key={i.id} value={i.id}>{i.label.trim() || i.id}</option>)}
        </select>
      </span>
    </span>
  );
}

/** ITEM TYPES: a tab for each, the presets and BLANK, and the open type's name, ONE and columns. */
export function ItemTypesSection({ definition, edit }: Props) {
  const types = itemTypes(definition);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastKind, setLastKind] = useState<ColumnKind | null>(null);
  const [asking, setAsking] = useState(false);
  const type = types.find((t) => t.id === openId) ?? types[0];
  const full = types.length >= LIMITS.types;
  const add = (preset?: string) => { const made = withNewType(definition, preset); if (made) { edit(made.definition); setOpenId(made.id); setAsking(false); } };
  const shownKind = lastKind ?? type.columns[type.columns.length - 1]?.kind ?? 'number';
  const count = itemList(definition).filter((i) => typeOf(definition, i.type).id === type.id).length;
  return (
    <section aria-label="Item types" style={panel}>
      <div style={row}>
        <FieldName hint={HINTS['items.types']} style={small}>ITEM TYPES · {types.length} OF {LIMITS.types}</FieldName>
      </div>
      <div role="group" aria-label="The item types" style={row}>
        {types.map((t) => (
          <button key={t.id} type="button" className="utility-btn" aria-pressed={t.id === type.id} style={pressed(t.id === type.id)}
            onClick={() => { setOpenId(t.id); setAsking(false); setLastKind(null); }}>{nameOf(t).toUpperCase()}</button>
        ))}
      </div>
      <div role="group" aria-label="Add an item type" style={row}>
        <span style={{ ...why, fontSize: 11 }}>+ FROM A PRESET</span>
        {PRESETS.map((p) => <button key={p.id} type="button" className="utility-btn" style={btn} disabled={full} onClick={() => add(p.id)}>{p.label}</button>)}
        <button type="button" className="utility-btn" style={btn} disabled={full} onClick={() => add()}>+ BLANK</button>
      </div>
      {!ownTypes(definition) && <p style={{ ...why, fontSize: 11 }}>Every system starts with GEAR, a WEIGHT and a PRICE: change it, or add a type beside it.</p>}

      <div role="region" aria-label={`${nameOf(type)} type`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', border: '1px solid var(--green)' }}>
        <div style={grid}>
          <FieldName beside htmlFor={`type-${type.id}-name`} hint={HINTS['items.typeName']} style={small}>NAME</FieldName>
          <input id={`type-${type.id}-name`} type="text" maxLength={LIMITS.label} value={type.label} style={{ ...input, width: 200, justifySelf: 'start' }}
            aria-invalid={!type.label.trim() ? true : undefined} onChange={(e) => edit(withType(definition, type.id, { label: e.target.value }))} />
          <FieldName beside htmlFor={`type-${type.id}-one`} hint={HINTS['items.one']} style={small}>ONE</FieldName>
          <input id={`type-${type.id}-one`} type="text" maxLength={LIMITS.label} value={type.one ?? ''} placeholder={type.label} style={{ ...input, width: 200, justifySelf: 'start' }}
            onChange={(e) => edit(withType(definition, type.id, { one: e.target.value }))} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <ColumnHead style={th} hint={HINTS['items.column']}>COLUMN</ColumnHead>
              <ColumnHead style={th} hint={HINTS['items.kind']}>KIND</ColumnHead>
              <ColumnHead style={th} hint={HINTS['items.and']}>AND</ColumnHead>
              <ColumnHead style={th} />
            </tr></thead>
            <tbody>
              {type.columns.map((c) => (
                <tr key={c.id} data-testid={`column-${type.id}-${c.id}`}>
                  <td style={td}><input type="text" aria-label={`${columnName(c)} column name`} maxLength={LIMITS.label} value={c.label} style={{ ...input, width: 150 }}
                    aria-invalid={!c.label.trim() ? true : undefined} onChange={(e) => edit(withColumn(definition, type.id, c.id, { label: e.target.value }))} /></td>
                  <td style={td}>
                    <select aria-label={`${columnName(c)} kind`} value={c.kind} style={input}
                      onChange={(e) => { const kind = e.target.value as ColumnKind; setLastKind(kind); edit(withColumn(definition, type.id, c.id, { kind })); }}>
                      {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                  </td>
                  <td style={td}><ColumnAnd definition={definition} edit={edit} type={type} c={c} /></td>
                  <td style={td}><button type="button" className="utility-btn" style={{ ...btn, padding: '2px 7px' }} aria-label={`Remove the ${columnName(c)} column`}
                    onClick={() => edit(withoutColumn(definition, type.id, c.id))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!type.columns.length && <p style={{ ...why, fontSize: 11 }}>No columns: its items have only a name and how many.</p>}
        <div style={row}>
          <button type="button" className="utility-btn" style={btn} disabled={type.columns.length >= LIMITS.columns}
            onClick={() => { const made = withNewColumn(definition, type.id); if (made) { edit(made.definition); setLastKind('number'); } }}>+ COLUMN</button>
          <span style={{ flex: 1 }} />
          {types.length > 1 && (asking
            ? <span role="group" aria-label={`Delete ${nameOf(type)}`} style={row}>
                <span style={{ ...why, color: 'var(--danger)' }}>
                  Delete {nameOf(type)}? {count ? `Its ${count === 1 ? 'item becomes' : `${count} items become`} ${nameOf(types.find((t) => t.id !== type.id)!)}, with nothing filled in.` : 'No item is one.'}
                </span>
                <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => { edit(withoutType(definition, type.id)); setOpenId(null); setAsking(false); }}>DELETE</button>
                <button type="button" className="utility-btn" style={btn} onClick={() => setAsking(false)}>KEEP</button>
              </span>
            : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setAsking(true)}>DELETE TYPE</button>)}
        </div>
        <p role="status" style={{ ...why, fontSize: 11 }}>{KINDS.find((k) => k.id === shownKind)?.why}</p>
      </div>
    </section>
  );
}

// ─── AN ITEM'S TYPE AND VALUES ──────────────────────────────────────────────

/** A DAMAGE or DICE value: a formula box reading the sheet, as a rest's amount is, its sample under it. */
function DiceValue({ definition, edit, api, item, c, id }: Props & { api?: ReturnType<typeof systemsApi>; item: Item; c: ItemColumn; id: string }) {
  const value = itemValues(definition, item)[c.id];
  const box = useFormulaBox({
    definition, api, kind: 'refill', value: typeof value === 'string' ? value : '', id,
    onChange: (text) => edit(withItemValue(definition, item.id, c.id, text)),
    label: `${item.label || item.id} ${columnName(c)}`, placeholder: c.kind === 'damage' ? '1d8 + @might_mod' : '2d4 + 2', maxLength: LIMITS.text,
    inputStyle: { ...input, width: '100%' },
  });
  return <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>{box.field}{box.help}</span>;
}

/** One of an item's values, by its column's kind. */
function ValueField({ definition, edit, api, item, c, id }: Props & { api?: ReturnType<typeof systemsApi>; item: Item; c: ItemColumn; id: string }) {
  const value = itemValues(definition, item)[c.id];
  const set = (v: string | number | undefined) => edit(withItemValue(definition, item.id, c.id, v));
  if (c.kind === 'damage' || c.kind === 'dice') return <DiceValue definition={definition} edit={edit} api={api} item={item} c={c} id={id} />;
  if (c.kind === 'text') {
    return <input id={id} type="text" maxLength={LIMITS.text} value={typeof value === 'string' ? value : ''} style={{ ...input, width: 220, justifySelf: 'start' }} onChange={(e) => set(e.target.value)} />;
  }
  if (c.kind === 'pick') {
    return (
      <select id={id} value={typeof value === 'string' ? value : ''} style={{ ...input, justifySelf: 'start' }} onChange={(e) => set(e.target.value || undefined)}>
        <option value="">—</option>
        {(c.options ?? []).map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
    );
  }
  const count = c.kind === 'count';
  return (
    <span style={row}>
      <input id={id} type="number" min={count ? 0 : undefined} max={count ? LIMITS.count : undefined} step={count ? 1 : 'any'} value={typeof value === 'number' ? value : ''} style={{ ...input, width: 90 }}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!e.target.value.trim()) set(undefined);
          else if (Number.isFinite(n)) set(count ? Math.min(LIMITS.count, Math.max(0, Math.trunc(n))) : n);
        }} />
      <span style={{ ...why, fontSize: 11 }}>{count ? `IT HOLDS · ${(c.button?.trim() || 'USE').toUpperCase()} SPENDS ONE` : (c.unit ?? '')}</span>
    </span>
  );
}

/** An item's TYPE and a field for each of its type's columns, as rows of the item's grid of names beside fields. */
export function ItemValues({ definition, edit, api, item }: Props & { api?: ReturnType<typeof systemsApi>; item: Item }) {
  const types = itemTypes(definition);
  const type = typeOf(definition, item.type);
  const id = (part: string) => `item-${item.id}-${part}`;
  return (
    <>
      <FieldName beside htmlFor={id('type')} hint={HINTS['items.type']} style={small}>TYPE</FieldName>
      <select id={id('type')} value={type.id} style={{ ...input, justifySelf: 'start' }} onChange={(e) => edit(withItemType(definition, item.id, e.target.value))}>
        {types.map((t) => <option key={t.id} value={t.id}>{nameOf(t).toUpperCase()}</option>)}
      </select>
      {type.columns.map((c) => (
        <React.Fragment key={c.id}>
          <FieldName beside htmlFor={id(`value-${c.id}`)} style={small}>{columnName(c).toUpperCase()}</FieldName>
          <ValueField definition={definition} edit={edit} api={api} item={item} c={c} id={id(`value-${c.id}`)} />
        </React.Fragment>
      ))}
    </>
  );
}
