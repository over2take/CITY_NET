import React from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import { HINTS } from '../sheets/builderHelp';
import { BUY_NAMES, groupChoices, listChoices, spendNotes, spendSet, withBuy, withBuyAdded, withBuyOff, withWait, type Buy } from '../sheets/spendXp';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { FieldName, HelpHint } from './HelpHint';
import { ToggleSwitch } from './ToggleSwitch';
import { OptionalWhole } from './OptionalWhole';

// SPEND XP on the builder's LEVELS page (7f2b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): WHAT XP BUYS,
// each a card, RAISE A STAT IN a group COSTS a formula UP TO a most, or AN OPTION FROM a list COSTS a formula; and
// PURCHASES WAIT FOR THE GM. What it reads and writes is sheets/spendXp.ts; the server checks it (spendXp.js).

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** Reads a cost for the words under it. */
  api?: Pick<ReturnType<typeof systemsApi>, 'previewFormulas'>;
  /** What this system calls XP. */
  word: string;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const field: React.CSSProperties = { background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 12, padding: '3px 6px', width: '100%', boxSizing: 'border-box' };
const mini: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '0 6px', background: 'none', color: 'var(--green)', border: '1px solid var(--dark-green)', cursor: 'pointer' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const card: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
const tag: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 2, color: 'var(--cyan)' };
const note: React.CSSProperties = { ...why, fontSize: 11, color: 'var(--warning)', opacity: 1 };

/** One thing XP buys, as a card. */
function BuyCard({ definition, edit, api, buy, i }: { definition: Definition; edit: Props['edit']; api: Props['api']; buy: Buy; i: number }) {
  const name = `${BUY_NAMES[buy.what]} ${i + 1}`;
  const cost = useFormulaBox({
    definition, api, kind: buy.what === 'stat' ? 'cost' : 'price', value: buy.cost, label: `${name}: costs`, inputStyle: field,
    placeholder: buy.what === 'stat' ? '@new * 5' : '10', onChange: (text) => edit(withBuy(definition, i, { cost: text })),
  });
  const groups = groupChoices(definition);
  const lists = listChoices(definition);
  return (
    <div role="group" aria-label={name} style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={tag}>{BUY_NAMES[buy.what]}</span>
        <button type="button" style={mini} aria-label={`Take off ${name}`} onClick={() => edit(withBuyOff(definition, i))}>×</button>
      </div>
      <div style={grid}>
        {buy.what === 'stat' ? <>
          <FieldName beside hint={HINTS['levels.buyIn']} style={small}>IN</FieldName>
          <select aria-label={`${name}: in`} value={buy.stats ?? ''} style={field} onChange={(e) => edit(withBuy(definition, i, { stats: e.target.value || null }))}>
            <option value="">EVERY STAT</option>
            {buy.stats !== undefined && !groups.some((g) => g.id === buy.stats) && <option value={buy.stats}>{buy.stats}</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label.toUpperCase()}</option>)}
          </select>
        </> : <>
          <FieldName beside hint={HINTS['levels.buyFrom']} style={small}>FROM</FieldName>
          <select aria-label={`${name}: from`} value={buy.list ?? ''} style={field} onChange={(e) => edit(withBuy(definition, i, { list: e.target.value }))}>
            {(buy.list === undefined || !lists.some((l) => l.id === buy.list)) && <option value={buy.list ?? ''}>{buy.list ?? 'PICK A LIST'}</option>}
            {lists.map((l) => <option key={l.id} value={l.id}>{l.label.toUpperCase()}</option>)}
          </select>
        </>}
        <FieldName beside hint={HINTS[buy.what === 'stat' ? 'levels.buyCost' : 'levels.optionCost']} style={small}>COSTS</FieldName>
        {cost.field}
        {buy.what === 'stat' && <>
          <FieldName beside hint={HINTS['levels.buyMost']} style={small}>UP TO</FieldName>
          <OptionalWhole key={`${buy.id}-${buy.most ?? ''}`} value={buy.most} label={`${name}: up to`} onChange={(most) => edit(withBuy(definition, i, { most }))} style={{ ...field, width: 90 }} />
        </>}
      </div>
      {cost.help}
    </div>
  );
}

export function SpendXpSection({ definition, edit, api, word }: Props) {
  const { buys, wait } = spendSet(definition);
  const notes = spendNotes(definition);
  return (
    <section aria-label={`Spend ${word}`} style={panel}>
      <FieldName hint={HINTS['levels.buys']} style={small}>WHAT {word} BUYS</FieldName>
      {buys.length
        ? buys.map((b, i) => <BuyCard key={b.id} definition={definition} edit={edit} api={api} buy={b} i={i} />)
        : <p style={why}>Nothing yet. Add a stat to raise, or a list to buy from.</p>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="utility-btn" style={btn} onClick={() => edit(withBuyAdded(definition, 'stat'))}>+ RAISE A STAT</button>
        <button type="button" className="utility-btn" style={btn} onClick={() => edit(withBuyAdded(definition, 'option'))}>+ AN OPTION</button>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ToggleSwitch label="PURCHASES WAIT FOR THE GM" on={wait} onChange={(on) => edit(withWait(definition, on))} />
        <HelpHint text={HINTS['levels.wait']} />
      </span>
      <p style={why}>{wait
        ? `A player's purchase waits, its ${word} held, until the GM approves or declines it. The GM's own never wait.`
        : `A purchase is made at once. The GM can undo any, giving its ${word} back.`}</p>
      {notes.map((n) => <p key={n} role="note" style={note}>{n}</p>)}
    </section>
  );
}
