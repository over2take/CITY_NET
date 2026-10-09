import React, { useMemo, useState } from 'react';
import { systemsApi } from '../sheets/systemsApi';
import { LIMITS } from '../sheets/conditions';
import {
  ownOf, standardOf, canAdd, draftProblem, withAdded, withRemoved, EMPTY_DRAFT, type Draft, type TableEntry,
} from '../sheets/tableConditions';
import { useConditionList, CONDITIONS_CHANGED_EVENT } from '../hooks/useConditionList';
import { ConditionIcon } from './ConditionIcon';
import { ConditionIconPicker } from './ConditionIconPicker';

// The GAME tab's CONDITIONS panel under a built-in game (4e2c2; approved mockup
// docs/mockups/builder-conditions.html, 2026-10-09, stage 3): the standard set, and the table's own
// added with a name, icon and description, or removed. No modifiers or rounds, so the game's rules
// don't change. Main admin only, as the server's route is. What it reads and writes is
// sheets/tableConditions.ts.

/** How many standard conditions show before the rest fold away. */
const SHOWN_STANDARD = 4;

const label: React.CSSProperties = { fontSize: '0.65rem', opacity: 0.7, letterSpacing: '1px' };
const why: React.CSSProperties = { fontSize: '0.6rem', opacity: 0.6, margin: 0 };
const btn: React.CSSProperties = { fontSize: '0.65rem' };
const item: React.CSSProperties = { display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', gap: 6, alignItems: 'center', fontSize: '0.65rem', letterSpacing: '1px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: '0.7rem', padding: '3px 5px', boxSizing: 'border-box', width: '100%',
};

export function TableConditionsPanel({ token, system }: { token: string; system: string }) {
  const list = useConditionList(system, token);
  const api = useMemo(() => systemsApi(token), [token]);
  const standard = standardOf(list);
  const own = ownOf(list);
  const [allStandard, setAllStandard] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Send the table's own whole; every screen (this one too) asks for the game's list again. */
  const save = async (entries: Record<string, TableEntry>) => {
    setBusy(true);
    const r = await api.saveTableConditions(system, entries);
    setBusy(false);
    if (!r.ok) { setError(r.error); return false; }
    setError(null);
    window.dispatchEvent(new Event(CONDITIONS_CHANGED_EVENT));
    return true;
  };
  const add = async () => {
    if (!draft || draftProblem(draft)) return;
    if (await save(withAdded(own, draft))) setDraft(null);
  };
  const remove = async (id: string) => {
    if (await save(withRemoved(own, id))) setRemoving(null);
  };

  const shown = allStandard ? standard : standard.slice(0, SHOWN_STANDARD);
  return (
    <section aria-label="Conditions" style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--green)', paddingTop: '6px', marginTop: '2px' }}>
      <label style={label}>CONDITIONS</label>
      <p style={why}>The standard set, plus any the table adds. Reminders only: nothing here changes this game&apos;s numbers.</p>
      {shown.map((c) => (
        <div key={c.id} style={item}>
          <span style={{ color: 'var(--green)' }}><ConditionIcon icon={c.icon} /></span>
          <span title={c.description}>{c.name.toUpperCase()}</span>
          <span style={{ opacity: 0.5, fontSize: '0.55rem' }}>STANDARD</span>
        </div>
      ))}
      {standard.length > SHOWN_STANDARD && (
        <button type="button" aria-expanded={allStandard} onClick={() => setAllStandard(!allStandard)}
          style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--green)', opacity: 0.6, fontFamily: 'monospace', fontSize: '0.6rem' }}>
          {allStandard ? 'FEWER' : `…and ${standard.length - SHOWN_STANDARD} more standard`}
        </button>
      )}
      <ul aria-label="This table's own" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {own.map((c) => (
          <li key={c.id} style={item}>
            <span style={{ color: 'var(--green)' }}><ConditionIcon icon={c.icon} /></span>
            <span title={c.description}>{c.name.toUpperCase()}</span>
            {removing === c.id
              ? <span style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="utility-btn danger-btn" style={btn} disabled={busy} onClick={() => remove(c.id)}>REMOVE</button>
                  <button type="button" className="utility-btn" style={btn} onClick={() => setRemoving(null)}>KEEP</button>
                </span>
              : <button type="button" className="utility-btn danger-btn" style={btn} aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c.id)}>×</button>}
          </li>
        ))}
      </ul>
      {removing && <p style={{ ...why, opacity: 0.85 }}>Tokens that have it stop showing it.</p>}
      {draft
        ? <div role="group" aria-label="A condition of this table's own" style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--dark-green)', padding: 6 }}>
            <input type="text" aria-label="Name" placeholder="Name" maxLength={LIMITS.name} value={draft.name} style={input}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <ConditionIconPicker value={draft.icon} onPick={(icon) => setDraft({ ...draft, icon })} api={api} name={draft.name || 'the new condition'} size={24} />
            <textarea aria-label="Description" placeholder="What it means at the table" rows={2} maxLength={LIMITS.description} value={draft.description}
              style={{ ...input, resize: 'vertical' }} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="utility-btn" style={{ ...btn, flex: 1 }} disabled={busy || !!draftProblem(draft)} onClick={add}>ADD</button>
              <button type="button" className="utility-btn" style={{ ...btn, flex: 1 }} onClick={() => { setDraft(null); setError(null); }}>CANCEL</button>
            </div>
          </div>
        : <button type="button" className="utility-btn" style={btn} disabled={!canAdd(own)} onClick={() => setDraft(EMPTY_DRAFT)}>+ CONDITION</button>}
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.6rem' }}>{error}</span>}
    </section>
  );
}
