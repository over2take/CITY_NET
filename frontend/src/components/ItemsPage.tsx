import React, { useEffect, useRef, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  itemSlots, itemList, withNewSlot, withSlot, withoutSlot, withNewItem, withItem, withoutItem, needsChoices, needsWords, LIMITS,
  itemInstalls, withNewInstall, withInstall, withoutInstall, installOf,
  type Item, type ItemInstall,
} from '../sheets/items';
import { modifierTargets, tokenMaxTarget } from '../sheets/choices';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { HINTS } from '../sheets/builderHelp';
import { ColumnHead, FieldName } from './HelpHint';
import { ItemFeaturesEditor } from './FeaturesEditor';
import { ItemTypesSection, ItemValues } from './ItemTypesSection';
import { useBuilderPlace } from '../hooks/useBuilderPlace';
import { ownTypes, typeOf, itemTypes, withItemType } from '../sheets/itemTypes';

// The builder's ITEMS page (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): SLOTS, what an item may need
// besides being worn, each character having so many (ATTUNED, 3); and the ITEMS, each with its name, words, what its
// features need (carried, worn, or worn and in a slot) and the features themselves, the CHOICES form without a level, a
// list or an increase. A shop sells an item by its name, as it sells anything. Wearing and attuning at the table are
// 7e3's. What it reads and writes is sheets/items.ts; every change goes through the builder's `edit`.
//
// INSTALLS (7e4b; approved mockup docs/mockups/installed.html, 2026-11-11): what an item may be put in as, each costing
// against a stat or formula, ADDS TO or TAKES FROM, up to or down to its limit; an item needing one has a COST.
//
// ITEM TYPES (8a2; approved mockup docs/mockups/item-types.html, 2026-11-14): ItemTypesSection.tsx; an item has a TYPE
// and fills its columns.
//
// TABS (8aL1; approved mockup docs/mockups/items-layout.html, 2026-11-14): TYPES · SLOTS & INSTALLS · ITEMS, in the order
// a system is set up, styled as STATS & RULES' tabs, one line of words each, the rest in HELP; the tab and the open item
// kept while the builder is open (hooks/useBuilderPlace).
//
// ITEMS beside their list (8aL2, the same mockup): grouped by type, + per type, FIND as it is typed into, the open item
// with what every item fills first.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** The server, for the formula boxes; none when looking at an example. */
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
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, letterSpacing: 2, opacity: 0.75, fontWeight: 'normal', padding: '4px 6px' };
const td: React.CSSProperties = { padding: '3px 6px' };
const tabStyle = (on: boolean): React.CSSProperties => ({
  background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', border: 0, borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
  color: on ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '7px 14px', cursor: 'pointer',
});
const tag: React.CSSProperties = { fontSize: 9, letterSpacing: 1, border: '1px solid currentColor', padding: '0 4px', color: 'var(--cyan)', whiteSpace: 'nowrap' };

/** Asks before deleting: DELETE, then DELETE / KEEP with what goes. */
function DeleteButton({ what, gone, onDelete }: { what: string; gone: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking
    ? <span role="group" aria-label={`Delete ${what}`} style={row}>
        <span style={{ ...why, color: 'var(--danger)' }}>Delete {what}? {gone}</span>
        <button type="button" className="utility-btn danger-btn" style={btn} onClick={onDelete}>DELETE</button>
        <button type="button" className="utility-btn" style={btn} onClick={() => setAsking(false)}>KEEP</button>
      </span>
    : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setAsking(true)}>DELETE ITEM</button>;
}

/**
 * The open item (8aL2; approved mockup docs/mockups/items-layout.html, 2026-11-14): what every item fills first, its
 * NAME, TYPE and its type's columns; then what only some need, ITS FEATURES NEED, COST and WORDS; then its features.
 * `fresh` is a new one: its name is selected, ready to type over.
 */
function ItemPanel({ definition, edit, item, api, fresh }: Props & { item: Item; fresh: boolean }) {
  const id = (part: string) => `item-${item.id}-${part}`;
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (fresh) { nameBox.current?.focus(); nameBox.current?.select(); } }, [fresh]);
  return (
    <div role="region" aria-label={`${item.label || item.id} item`} style={{ ...panel, border: '1px solid var(--green)' }}>
      <div style={grid}>
        <FieldName beside htmlFor={id('name')} hint={HINTS['items.name']} style={small}>NAME</FieldName>
        <input ref={nameBox} id={id('name')} type="text" maxLength={LIMITS.label} value={item.label} style={{ ...input, width: 240, justifySelf: 'start' }}
          aria-invalid={!item.label.trim() ? true : undefined} onChange={(e) => edit(withItem(definition, item.id, { label: e.target.value }))} />
        <ItemValues definition={definition} edit={edit} api={api} item={item} />
      </div>
      <div style={{ borderTop: '1px dashed var(--dark-green)' }} />
      <div style={grid}>
        <FieldName beside htmlFor={id('needs')} hint={HINTS['items.needs']} style={small}>ITS FEATURES NEED</FieldName>
        <select id={id('needs')} value={item.needs || 'worn'} style={{ ...input, justifySelf: 'start' }}
          onChange={(e) => edit(withItem(definition, item.id, { needs: e.target.value }))}>
          {!needsChoices(definition).some((n) => n.id === (item.needs || 'worn')) && <option value={item.needs}>{needsWords(definition, item)}</option>}
          {needsChoices(definition).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {/* What installing it costs (7e4b), only for an item needing an install. */}
        {installOf(definition, item) && <>
          <FieldName beside htmlFor={id('cost')} hint={HINTS['items.cost']} style={small}>COST</FieldName>
          <span style={row}>
            <input id={id('cost')} type="number" min={0} max={LIMITS.cost} step="any" value={item.cost ?? ''} style={{ ...input, width: 80 }}
              onChange={(e) => { const n = Number(e.target.value); if (e.target.value.trim() && Number.isFinite(n)) edit(withItem(definition, item.id, { cost: n })); }} />
            <span style={{ ...why, fontSize: 11 }}>{costWords(definition, installOf(definition, item)!)}</span>
          </span>
        </>}
        <FieldName beside htmlFor={id('words')} hint={HINTS['items.words']} style={small}>WORDS</FieldName>
        <textarea id={id('words')} rows={2} maxLength={LIMITS.description} value={item.description ?? ''} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
          onChange={(e) => edit(withItem(definition, item.id, { description: e.target.value }))} />
      </div>
      <ItemFeaturesEditor definition={definition} edit={edit} item={item} api={api} />
      <div style={{ ...row, justifyContent: 'flex-end' }}>
        <DeleteButton what={item.label.trim() || item.id} gone="Its features go with it." onDelete={() => edit(withoutItem(definition, item.id))} />
      </div>
    </div>
  );
}

/** What an item needs, as a short tag in the list: its slot's or install's name, or CARRIED; nothing for WORN. */
const needsTag = (definition: Definition, item: Item): string | null => {
  const needs = item.needs || 'worn';
  if (needs === 'worn') return null;
  // CARRIED, or a slot or install gone, says its own word.
  const named = [...itemSlots(definition), ...itemInstalls(definition)].find((s) => s.id === needs);
  return (named ? named.label.trim() || named.id : needs).toUpperCase();
};

/**
 * ITEMS (8aL2): the items in a list grouped by type beside the open one, as CHOICES has its lists; each type with its own
 * + (+ WEAPON makes a weapon, opened, its name ready to type); FIND filters as it is typed into, matching anywhere in a
 * name, a type with none left folded away.
 */
function ItemsTab({ definition, edit, api, open, setOpen }: Props & { open: string | null; setOpen: (id: string | null) => void }) {
  const items = itemList(definition);
  const types = itemTypes(definition);
  const [find, setFind] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const looking = find.trim().toLowerCase();
  const shown = items.filter((i) => !looking || (i.label || i.id).toLowerCase().includes(looking));
  const current = items.find((i) => i.id === open) ?? items[0];
  const add = (typeId: string, one: string) => {
    const made = withNewItem(definition);
    if (!made) return;
    let next = withItem(made.definition, made.id, { label: `NEW ${one.toUpperCase()}` });
    if (ownTypes(definition)) next = withItemType(next, made.id, typeId);
    edit(next);
    setOpen(made.id);
    setFresh(made.id);
    setFind('');
  };
  const full = items.length >= LIMITS.items;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
      <section aria-label="Items" style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <FieldName hint={HINTS['items.items']} style={small}>ITEMS · {items.length} OF {LIMITS.items}</FieldName>
          <input type="search" aria-label="Find an item" placeholder="FIND" value={find} style={{ ...input, width: '100%' }} onChange={(e) => setFind(e.target.value)} />
          {looking && <span role="status" style={{ ...small, letterSpacing: 1 }}>{shown.length} OF {items.length}</span>}
        </div>
        <div className="crt-scroll" style={{ maxHeight: 520, overflowY: 'auto' }}>
          {types.map((t) => {
            const mine = shown.filter((i) => typeOf(definition, i.type).id === t.id);
            if (looking && !mine.length) return null;
            const name = (t.label.trim() || t.id).toUpperCase();
            const one = t.one?.trim() || t.label.trim() || t.id;
            return (
              <div key={t.id} role="group" aria-label={`${name} items`} style={{ borderTop: '1px solid var(--dark-green)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px' }}>
                  <span style={{ ...small, letterSpacing: 2 }}>{name} · {mine.length}</span>
                  <button type="button" className="utility-btn" style={{ ...btn, padding: '2px 7px' }} disabled={full} aria-label={`Add a ${one}`}
                    onClick={() => add(t.id, one)}>+ {one.toUpperCase()}</button>
                </div>
                {mine.map((i) => {
                  const on = current?.id === i.id;
                  const needs = needsTag(definition, i);
                  return (
                    <button key={i.id} type="button" aria-current={on ? 'true' : undefined} title={needsWords(definition, i)}
                      onClick={() => { setOpen(i.id); setFresh(null); }}
                      style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between', width: '100%', background: on ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'none',
                        border: 0, borderLeft: `2px solid ${on ? 'var(--green)' : 'transparent'}`, color: i.label.trim() ? 'var(--green)' : 'var(--danger)',
                        fontFamily: 'monospace', fontSize: 12, padding: '4px 8px 4px 14px', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ overflowWrap: 'anywhere' }}>{i.label.trim() || 'NEEDS A NAME'}</span>
                      {needs && <span style={tag}>{needs}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>
      {current
        ? <ItemPanel key={current.id} definition={definition} edit={edit} item={current} api={api} fresh={fresh === current.id} />
        : <p style={{ ...why, fontSize: 11, padding: '8px 0' }}>None yet. + beside a type makes one: an item here is one that does something, or has columns worth filling. A rope or a lantern needs nothing on this page.</p>}
    </div>
  );
}

/** What an install's cost counts on, in words: "STRAIN · FRACTIONS ARE FINE: 0.25". */
const costWords = (definition: Definition, install: ItemInstall) => {
  const target = modifierTargets(definition).flatMap((g) => g.items).find((t) => t.id === install.against);
  return `${target ? target.label : 'WHAT ITS INSTALL COSTS AGAINST'} · FRACTIONS ARE FINE: 0.25`;
};

/** One install: its name, what it costs against, which way, its limit (a formula box), and × in red. */
function InstallRow({ definition, edit, api, s }: Props & { s: ItemInstall }) {
  const name = s.label || s.id;
  // The token's maximum takes its bonuses on the token: an install never costs against it (the server refuses it too).
  const onToken = tokenMaxTarget(definition);
  const targets = modifierTargets(definition).map((g) => ({ ...g, items: g.items.filter((t) => t.id !== onToken) })).filter((g) => g.items.length);
  const takes = s.way === 'takes';
  const limit = useFormulaBox({
    definition, api, kind: 'formula', value: s.limit, onChange: (text) => edit(withInstall(definition, s.id, { limit: text })),
    label: `${name} limit`, placeholder: takes ? '0' : '@might', inputStyle: { ...input, width: '100%' },
  });
  const choice = (on: boolean): React.CSSProperties => ({ ...btn, padding: '3px 8px', border: '1px solid var(--dark-green)', cursor: 'pointer',
    background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)' });
  return (
    <div role="group" aria-label={`${name} install`} data-testid={`install-${s.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '2px solid var(--dark-green)', paddingLeft: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '6px 12px', alignItems: 'center' }}>
        <FieldName beside htmlFor={`install-${s.id}-name`} style={small}>NAME</FieldName>
        <span style={row}>
          <input id={`install-${s.id}-name`} type="text" maxLength={LIMITS.label} value={s.label} style={{ ...input, width: 180 }}
            aria-invalid={!s.label.trim() ? true : undefined} onChange={(e) => edit(withInstall(definition, s.id, { label: e.target.value }))} />
          <span style={{ flex: 1 }} />
          <button type="button" className="utility-btn" style={{ ...btn, padding: '2px 7px', color: 'var(--danger)', borderColor: 'var(--danger)' }} aria-label={`Remove the ${name} install`}
            onClick={() => edit(withoutInstall(definition, s.id))}>×</button>
        </span>
        <FieldName beside htmlFor={`install-${s.id}-against`} hint={HINTS['items.against']} style={small}>COSTS AGAINST</FieldName>
        <select id={`install-${s.id}-against`} value={s.against} style={{ ...input, justifySelf: 'start' }} aria-invalid={!s.against ? true : undefined}
          onChange={(e) => edit(withInstall(definition, s.id, { against: e.target.value }))}>
          {!targets.some((g) => g.items.some((t) => t.id === s.against)) && <option value={s.against}>{s.against || 'PICK ONE'}</option>}
          {targets.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}
        </select>
        <FieldName beside hint={HINTS['items.way']} style={small}>EACH ONE</FieldName>
        <span role="group" aria-label={`${name}: each one`} style={{ display: 'inline-flex', justifySelf: 'start' }}>
          <button type="button" aria-pressed={!takes} style={choice(!takes)} onClick={() => edit(withInstall(definition, s.id, { way: 'adds' }))}>ADDS TO IT</button>
          <button type="button" aria-pressed={takes} style={choice(takes)} onClick={() => edit(withInstall(definition, s.id, { way: 'takes' }))}>TAKES FROM IT</button>
        </span>
        <FieldName beside hint={HINTS['items.limit']} style={small}>{takes ? 'NEVER BELOW' : 'NEVER PAST'}</FieldName>
        {limit.field}
      </div>
      {limit.help}
    </div>
  );
}

type ItemsTab = 'types' | 'slots' | 'items';
/** The tabs in the order a system is set up (8aL1, the user's call): what an item can be and need, then the items. */
const TABS: [ItemsTab, string][] = [['types', 'TYPES'], ['slots', 'SLOTS & INSTALLS'], ['items', 'ITEMS']];

export function ItemsPage({ definition, edit, api, place = 'items' }: Props & { place?: string }) {
  const installs = itemInstalls(definition);
  const slots = itemSlots(definition);
  // Where the GM was, kept while the builder is open (8aL1): a first visit opens on TYPES.
  const [tab, setTab] = useBuilderPlace<ItemsTab>(`${place}:tab`, 'types');
  const [open, setOpen] = useBuilderPlace<string | null>(`${place}:item`, null);
  const line = (words: string) => <p style={{ ...why, fontSize: 11, maxWidth: '80ch' }}>{words}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1100 }}>
      <div role="tablist" aria-label="Items" style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)', flexWrap: 'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'types' && <>
        {line('What kinds of thing your game has, each with its own columns. A sheet shows each as its own table.')}
        <ItemTypesSection definition={definition} edit={edit} place={place} />
      </>}

      {tab === 'slots' && <>
        {line('For the few games that need them: how many items can work at once, and what is put in rather than worn.')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, alignItems: 'start' }}>
          <section aria-label="Slots" style={panel}>
            <div style={row}>
              <FieldName hint={HINTS['items.slots']} style={small}>SLOTS · {slots.length} OF {LIMITS.slots}</FieldName>
              <span style={{ flex: 1 }} />
              <button type="button" className="utility-btn" style={btn} disabled={slots.length >= LIMITS.slots}
                onClick={() => { const made = withNewSlot(definition); if (made) edit(made.definition); }}>+ SLOT</button>
            </div>
            {slots.length
              ? (
                <table style={{ borderCollapse: 'collapse', fontSize: 12, alignSelf: 'start' }}>
                  <thead><tr>
                    <ColumnHead style={th}>NAME</ColumnHead>
                    <ColumnHead style={th} hint={HINTS['items.count']}>EACH CHARACTER HAS</ColumnHead>
                    <ColumnHead style={th} />
                  </tr></thead>
                  <tbody>
                    {slots.map((s) => (
                      <tr key={s.id} data-testid={`slot-${s.id}`}>
                        <td style={td}><input type="text" aria-label={`${s.label || s.id} slot name`} maxLength={LIMITS.label} value={s.label} style={{ ...input, width: 180 }}
                          aria-invalid={!s.label.trim() ? true : undefined} onChange={(e) => edit(withSlot(definition, s.id, { label: e.target.value }))} /></td>
                        <td style={td}><input type="number" aria-label={`${s.label || s.id} each character has`} min={0} max={LIMITS.count} step={1} value={s.count} style={{ ...input, width: 70 }}
                          onChange={(e) => { if (e.target.value.trim()) edit(withSlot(definition, s.id, { count: Number(e.target.value) })); }} /></td>
                        <td style={td}><button type="button" className="utility-btn" style={{ ...btn, padding: '2px 7px' }} aria-label={`Remove the ${s.label || s.id} slot`}
                          onClick={() => edit(withoutSlot(definition, s.id))}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
              : <p style={{ ...why, fontSize: 11 }}>None: every item counts carried or worn, and the word never shows at the table. D&amp;D&apos;s ATTUNED, three each, is a slot: an item needing one works only while worn and holding one.</p>}
          </section>

          <section aria-label="Installs" style={panel}>
            <div style={row}>
              <FieldName hint={HINTS['items.installs']} style={small}>INSTALLS · {installs.length} OF {LIMITS.installs}</FieldName>
              <span style={{ flex: 1 }} />
              <button type="button" className="utility-btn" style={btn} disabled={installs.length >= LIMITS.installs}
                onClick={() => { const made = withNewInstall(definition); if (made) edit(made.definition); }}>+ INSTALL</button>
            </div>
            {installs.length
              ? installs.map((s) => <InstallRow key={s.id} definition={definition} edit={edit} api={api} s={s} />)
              : <p style={{ ...why, fontSize: 11 }}>None: no item can need installing, and the word never shows at the table. Cyberware against System Strain, or bioware against Essence, is an install.</p>}
          </section>
        </div>
      </>}

      {tab === 'items' && <>
        {line('The things a character carries, wears or installs that do something. A shop sells one by its name; GIVE.EXE hands one out.')}
        <ItemsTab definition={definition} edit={edit} api={api} open={open} setOpen={setOpen} />
      </>}
    </div>
  );
}
