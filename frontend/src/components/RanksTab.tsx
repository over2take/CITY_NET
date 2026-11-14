import React from 'react';
import type { Definition } from '../sheets/systemsApi';
import {
  rankLists, withNewRankList, withRankListLabel, withoutRankList, withNewRank, withRank, withRankMoved, withoutRank, statsHolding, PRESETS, LIMITS,
  type RankList,
} from '../sheets/ranks';
import { HINTS } from '../sheets/builderHelp';
import { ColumnHead, FieldName } from './HelpHint';
import { why, btn, th, td, field, box, head } from './statsRulesStyles';

// STATS & RULES' RANKS tab (7f1b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): lists of named ranks, lowest
// first, each worth a number or a formula, that a stat may hold in place of a number (its HOLDS, on the STATS tab). Four
// presets to start from. What it reads and writes is sheets/ranks.ts; every change goes through the builder's `edit`.

interface Props { definition: Definition; edit: (next: Definition) => void }

/** One list: its name, who holds it, its ranks lowest first (name, worth, ▲ ▼ ×), + RANK and REMOVE LIST. */
function RankListSection({ definition, edit, list: l }: Props & { list: RankList }) {
  const name = l.label || l.id;
  const holding = statsHolding(definition, l.id);
  return (
    <section aria-label={`${name} ranks`} data-testid={`ranks-${l.id}`} style={box}>
      <div style={head}>
        <input type="text" aria-label="Rank list name" maxLength={LIMITS.label} value={l.label} style={{ ...field, width: 200 }}
          aria-invalid={!l.label.trim() ? true : undefined} onChange={(e) => edit(withRankListLabel(definition, l.id, e.target.value))} />
        <span style={{ ...why, fontSize: 11 }}>{holding.length ? `HELD BY ${holding.join(', ').toUpperCase()}` : 'NO STAT HOLDS IT YET: SET ONE ON STATS'}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="utility-btn" style={btn} aria-label={`Remove the ${name} ranks`}
          onClick={() => edit(withoutRankList(definition, l.id))}>REMOVE LIST</button>
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, margin: '4px 10px' }}>
        <thead><tr>
          <ColumnHead style={th}>STEP</ColumnHead><ColumnHead style={th} hint={HINTS['rules.rankName']}>NAME</ColumnHead>
          <ColumnHead style={th} hint={HINTS['rules.rankWorth']}>WORTH</ColumnHead><ColumnHead style={th} />
        </tr></thead>
        <tbody>
          {l.list.map((k, i) => (
            <tr key={i} data-testid={`rank-${l.id}-${i}`}>
              <td style={{ ...td, opacity: 0.6, fontSize: 11 }}>{i}</td>
              <td style={td}><input type="text" aria-label={`${name} rank ${i + 1} name`} maxLength={LIMITS.name} value={k.name} style={{ ...field, width: 150 }}
                aria-invalid={!k.name.trim() ? true : undefined} onChange={(e) => edit(withRank(definition, l.id, i, { name: e.target.value }))} /></td>
              <td style={td}><input type="text" aria-label={`${name} rank ${i + 1} worth`} maxLength={LIMITS.worth} value={k.worth} placeholder="0 · 2 + @level" style={{ ...field, width: 170 }}
                aria-invalid={!k.worth.trim() ? true : undefined} onChange={(e) => edit(withRank(definition, l.id, i, { worth: e.target.value }))} /></td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button type="button" className="utility-btn" style={btn} aria-label={`Move ${name} rank ${i + 1} down`} disabled={i === 0}
                  onClick={() => edit(withRankMoved(definition, l.id, i, -1))}>▲</button>{' '}
                <button type="button" className="utility-btn" style={btn} aria-label={`Move ${name} rank ${i + 1} up`} disabled={i === l.list.length - 1}
                  onClick={() => edit(withRankMoved(definition, l.id, i, 1))}>▼</button>{' '}
                <button type="button" className="utility-btn" style={{ ...btn, color: 'var(--danger)' }} aria-label={`Remove ${name} rank ${i + 1}`} disabled={l.list.length <= 1}
                  onClick={() => edit(withoutRank(definition, l.id, i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '6px 10px' }}>
        <button type="button" className="utility-btn" style={btn} disabled={l.list.length >= LIMITS.ranks}
          onClick={() => { const next = withNewRank(definition, l.id); if (next) edit(next); }}>+ RANK</button>
        <span style={{ ...why, fontSize: 11, marginLeft: 8 }}>Lowest first. A step past the top reads as the top.</span>
      </div>
    </section>
  );
}

export function RanksTab({ definition, edit }: Props) {
  const lists = rankLists(definition);
  const add = (preset?: string) => { const made = withNewRankList(definition, preset); if (made) edit(made.definition); };
  const full = lists.length >= LIMITS.lists;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...why, margin: '0 0 10px', maxWidth: '72ch' }}>
        Ranks a stat can hold instead of a number, lowest first: Pathfinder&apos;s TRAINED and EXPERT, World of Darkness&apos;s dots, Fate&apos;s ladder. Each is worth a number or a formula, which is what a formula reading the stat gets. Many stats can share one list; a stat says which on STATS (HOLDS).
      </p>
      {lists.map((l) => <RankListSection key={l.id} definition={definition} edit={edit} list={l} />)}
      <div role="group" aria-label="New rank list" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <FieldName hint={HINTS['rules.rankPresets']} style={{ fontSize: 10, letterSpacing: 2, opacity: 0.75 }}>START FROM</FieldName>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="utility-btn" style={btn} disabled={full} onClick={() => add(p.id)}>+ {p.label}</button>
        ))}
        <button type="button" className="utility-btn" style={btn} disabled={full} onClick={() => add()}>+ EMPTY LIST</button>
      </div>
    </div>
  );
}
