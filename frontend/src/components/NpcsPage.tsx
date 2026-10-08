import React, { useEffect, useMemo, useState } from 'react';
import type { Definition, systemsApi, TriedTier } from '../sheets/systemsApi';
import type { CustomRenderField, CustomRenderSheet } from '../sheets/customTemplates';
import {
  tierList, withNewTier, withTierLabel, withTierBox, withTierValue, boxText, withTierMoved, withoutTier,
  settableFields, blockFields, boxErrors, triedText, LIMITS, ownBlock, withOwnBlock, asBlockDraft, fromBlockDraft,
} from '../sheets/npcs';
import { NameBox, blankProblem, SheetPage } from './SheetPage';

// The builder's NPCS page (4b4c): how a system's NPCs are written down (STAT BLOCK, 4b4d) and the
// ready-made ones GENERATE_SHEET offers (TIERS). Approved mockup docs/mockups/builder-npcs.html
// (2026-10-07): a tier is a difficulty, GENERATE_SHEET asks for a tier and a level, and each box is
// a number, a formula reading @level, or dice, worked out by the server; TRY IT rolls a sample.
// What it reads and writes is sheets/npcs.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For the character sheet a tier's fields come from, and for TRY IT. */
  api?: ReturnType<typeof systemsApi>;
}

/** How long after the last change a tier is tried again, to show its mistakes. */
export const TRY_DELAY_MS = 400;

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const mini: React.CSSProperties = { fontFamily: 'monospace', fontSize: 10, padding: '0 5px', lineHeight: '16px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const th: React.CSSProperties = { textAlign: 'left', ...small, fontWeight: 'normal', padding: '6px 8px' };
const td: React.CSSProperties = { padding: '4px 8px', borderTop: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)', verticalAlign: 'middle' };
const tabStyle = (on: boolean): React.CSSProperties => ({
  background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', border: 0, borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`,
  color: on ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '7px 14px', cursor: 'pointer',
});
const bad = (message?: string): React.CSSProperties => (message ? { borderColor: 'var(--danger)' } : {});

/**
 * A box that takes a number, a formula or dice, with what is wrong with it under it. It keeps what
 * is typed: "10 " is stored as the number 10, and the space must still be there for "10 + @level".
 */
function Box({ aria, value, error, placeholder, width, onChange }: { aria: string; value: string; error?: string; placeholder?: string; width?: number | string; onChange: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <>
      <input type="text" aria-label={aria} value={text} placeholder={placeholder} maxLength={LIMITS.text} aria-invalid={error ? true : undefined}
        style={{ ...input, width: width ?? '100%', ...bad(error) }} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} />
      {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span>}
    </>
  );
}

/** A tier's starting value for one field, by the field's kind. */
function StartsWith({ field, value, error, onChange }: { field: CustomRenderField; value: string; error?: string; onChange: (text: string) => void }) {
  const aria = `${field.label} starts with`;
  if (field.type === 'select') {
    return (
      <select aria-label={aria} value={value} style={input} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (field.type === 'number') return <Box aria={aria} value={value} error={error} placeholder="—" onChange={onChange} />;
  return <input type="text" aria-label={aria} value={value} placeholder="—" maxLength={LIMITS.text} style={input} onChange={(e) => onChange(e.target.value)} />;
}

function TiersTab({ definition, edit, api, characterSheet }: Props & { characterSheet: CustomRenderSheet | null }) {
  const tiers = tierList(definition);
  const [openId, setOpenId] = useState<string | null>(tiers[0]?.id ?? null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [level, setLevel] = useState(3);
  const [tried, setTried] = useState<TriedTier | null>(null);
  const [shown, setShown] = useState<TriedTier | null>(null);
  const open = tiers.find((t) => t.id === openId) ?? null;
  const fields = settableFields(definition, characterSheet);

  // The open tier tried again a moment after each change, for its mistakes; ROLL shows the result.
  useEffect(() => {
    if (!api || !open) { setTried(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      api.tryTier(definition, open.id, level).then((r) => { if (live && r.ok) setTried(r.value); });
    }, TRY_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition, open?.id, level]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = boxErrors(tried);
  const pick = (id: string | null) => { setOpenId(id); setConfirm(null); setShown(null); };
  const roll = async () => {
    if (!api || !open) return;
    const r = await api.tryTier(definition, open.id, level);
    if (r.ok) { setTried(r.value); setShown(r.value); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ ...why, margin: 0, maxWidth: '84ch' }}>
        Ready-made NPCs by difficulty. On an NPC token with no sheet, the GM picks a tier and a level in ID.EXE and presses GENERATE_SHEET. Each box is worked out and rolled for that level: the token gets the HP and defense, and the stat block starts with the rest. Every number can still be changed afterwards.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ border: '1px solid var(--dark-green)' }}>
          <table aria-label="Tiers" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th scope="col" style={th}>TIER</th><th scope="col" style={th}>HP</th><th scope="col" style={th}>DEFENSE</th><th scope="col" style={th} /></tr></thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={t.id} data-testid={`tier-${t.id}`} style={t.id === openId ? { background: 'color-mix(in srgb, var(--green) 10%, transparent)' } : undefined}>
                  <td style={td}>
                    <button type="button" aria-current={t.id === openId || undefined} aria-label={`${t.label} tier`}
                      style={{ background: 'none', border: 0, color: 'var(--green)', font: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                      onClick={() => pick(t.id)}>{t.label}</button>
                    {i === 0 && <span style={{ marginLeft: 6, fontSize: 9, letterSpacing: 1, border: '1px solid var(--cyan)', color: 'var(--cyan)', padding: '0 4px' }}>DEFAULT</span>}
                  </td>
                  <td style={{ ...td, opacity: 0.7 }}>{boxText(t.hp) || '—'}</td>
                  <td style={{ ...td, opacity: 0.7 }}>{boxText(t.defense) || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" className="utility-btn" style={mini} aria-label={`Move ${t.label} up`} disabled={i === 0} onClick={() => edit(withTierMoved(definition, t.id, -1))}>▲</button>
                    <button type="button" className="utility-btn" style={mini} aria-label={`Move ${t.label} down`} disabled={i === tiers.length - 1} onClick={() => edit(withTierMoved(definition, t.id, 1))}>▼</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '6px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="utility-btn" style={btn} disabled={tiers.length >= LIMITS.tiers}
              onClick={() => {
                const next = withNewTier(definition, blockFields(definition, characterSheet));
                edit(next);
                pick(tierList(next).at(-1)!.id);
              }}>+ TIER</button>
            <span style={why}>{tiers.length} of {LIMITS.tiers}</span>
          </div>
          {tiers.length === 0 && <p style={{ ...why, padding: '0 8px' }}>No tiers: GENERATE_SHEET makes an empty stat block and keeps the token&apos;s own HP and defense.</p>}
        </div>

        {open ? (
          <section aria-label={`${open.label} settings`} style={{ border: '1px solid var(--dark-green)', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <label style={label}><span style={small}>NAME</span>
                <NameBox value={open.label} aria="Tier name" max={LIMITS.label} problem={blankProblem('tier')}
                  onChange={(text) => edit(withTierLabel(definition, open.id, text))} />
              </label>
              <label style={{ ...label, width: 170 }}><span style={small}>HP</span>
                <Box key={`${open.id}-hp`} aria="HP" value={boxText(open.hp)} error={errors.hp} placeholder="the token's own" onChange={(text) => edit(withTierBox(definition, open.id, 'hp', text))} />
              </label>
              <label style={{ ...label, width: 190 }}><span style={small}>DEFENSE</span>
                <Box key={`${open.id}-defense`} aria="Defense" value={boxText(open.defense)} error={errors.defense} placeholder="the token's own" onChange={(text) => edit(withTierBox(definition, open.id, 'defense', text))} />
              </label>
              <span style={{ flex: 1 }} />
              {confirm === open.id ? (
                <span role="group" aria-label={`Remove ${open.label}`} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={why}>Remove {open.label}? NPCs made from it keep their sheets.</span>
                  <button type="button" className="utility-btn" style={{ ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    onClick={() => { const next = withoutTier(definition, open.id); edit(next); pick(tierList(next)[0]?.id ?? null); }}>REMOVE {open.label}</button>
                  <button type="button" className="utility-btn" style={btn} onClick={() => setConfirm(null)}>KEEP IT</button>
                </span>
              ) : <button type="button" className="utility-btn" style={btn} onClick={() => setConfirm(open.id)}>REMOVE TIER</button>}
            </div>
            <span style={small}>STARTS WITH <span style={{ letterSpacing: 0, opacity: 0.8 }}>· a number, a formula (10 + @level), or dice (3d6, @level d8) · blank leaves it empty</span></span>
            {fields.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                {fields.map((f) => (
                  <label key={f.id} style={label}>
                    <span style={small}>{f.label.toUpperCase()}</span>
                    <StartsWith key={`${open.id}-${f.id}`} field={f} value={boxText(open.values?.[f.id])} error={errors.values[f.id]} onChange={(text) => edit(withTierValue(definition, open.id, f, text))} />
                  </label>
                ))}
              </div>
            ) : <p style={{ ...why, margin: 0 }}>{characterSheet ? 'The stat block has no fields a tier can fill in.' : 'LOADING…'}</p>}

            <div role="group" aria-label="Try it" style={{ borderTop: '1px solid var(--dark-green)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <span style={{ ...small, alignSelf: 'center' }}>TRY IT</span>
                <label style={label}><span style={small}>LEVEL</span>
                  <input type="number" aria-label="Level" min={0} max={99} value={level} style={{ ...input, width: 64 }}
                    onChange={(e) => { if (e.target.value.trim() !== '') setLevel(Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)))); }} />
                </label>
                <button type="button" className="utility-btn" style={{ ...btn, background: 'var(--green)', color: 'var(--black)' }} disabled={!api} onClick={roll}>ROLL A {open.label}</button>
                <span style={why}>Rolls a sample here; nothing is made or saved.</span>
              </div>
              {shown && (
                <div data-testid="tried" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '6px 12px' }}>
                  {[['HP', shown.hp], ['DEFENSE', shown.defense], ...fields.filter((f) => shown.values[f.id]).map((f) => [f.label.toUpperCase(), shown.values[f.id]] as const)].map(([name, box]) => {
                    const t = triedText(box as TriedTier['hp']);
                    return (
                      <div key={name as string} style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={small}>{name as string}</span>
                        <span style={{ color: 'var(--green)', borderBottom: '1px solid var(--dark-green)' }}>
                          {t.value}{t.dice && <span style={{ opacity: 0.6, fontSize: 11 }}> {t.dice}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        ) : (
          <p style={{ ...why, margin: 0 }}>{tiers.length ? 'Pick a tier.' : '+ TIER makes the first one.'}</p>
        )}
      </div>
    </div>
  );
}

const card = (on: boolean): React.CSSProperties => ({
  border: `1px solid ${on ? 'var(--green)' : 'var(--dark-green)'}`, background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none',
  padding: '10px 12px', cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit', display: 'flex', flexDirection: 'column', gap: 4,
});

/**
 * How NPCs are written down (4b4d): the character sheet, or a stat block of their own, a copy of
 * the character sheet edited with the CHARACTER SHEET designer (decided with the user: one designer
 * for both), which shows it as only the GM ever sees it.
 */
function BlockTab({ definition, edit, api, characterSheet }: Props & { characterSheet: CustomRenderSheet | null }) {
  const own = ownBlock(definition);
  // The same object until the definition changes, so the designer asks the server only then.
  const draft = useMemo(() => asBlockDraft(definition), [definition]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ ...why, margin: 0, maxWidth: '84ch' }}>What the GM fills in for an NPC. Players never see it; they see the token&apos;s card (name, description, portrait).</p>
      <div role="group" aria-label="NPC stat block" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 900 }}>
        <button type="button" style={card(!own)} aria-pressed={!own} disabled
          title={own ? 'Use BACK TO THE CHARACTER SHEET below, which asks first.' : undefined}>
          <b style={{ color: 'var(--green)', letterSpacing: 1 }}>SAME AS THE CHARACTER SHEET</b>
          <span style={why}>NPCs are written down exactly like player characters, and any change to the character sheet reaches them too.</span>
        </button>
        <button type="button" style={card(!!own)} aria-pressed={!!own} disabled={!!own || !characterSheet}
          onClick={() => { if (characterSheet) edit(withOwnBlock(definition, characterSheet)); }}>
          <b style={{ color: 'var(--green)', letterSpacing: 1 }}>A STAT BLOCK OF THEIR OWN</b>
          <span style={why}>Usually shorter: just what a fight needs. Starts as a copy of the character sheet; take off what NPCs don&apos;t need.</span>
        </button>
      </div>
      {own && (
        <SheetPage forNpcs definition={draft} edit={(next) => edit(fromBlockDraft(definition, next))} api={api} />
      )}
    </div>
  );
}

export function NpcsPage({ definition, edit, api }: Props) {
  const [tab, setTab] = useState<'block' | 'tiers'>('tiers');
  const [characterSheet, setCharacterSheet] = useState<CustomRenderSheet | null>(null);

  // The character sheet as drawn: the fields a tier fills in when NPCs use it.
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewSheet(definition).then((r) => { if (live && r.ok) setCharacterSheet(r.value.sheet); });
    }, characterSheet ? TRY_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="npcs-page" style={{ maxWidth: 1100 }}>
      <div role="tablist" aria-label="NPCs" style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)', marginBottom: 14 }}>
        {([['block', 'STAT BLOCK'], ['tiers', 'TIERS']] as const).map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{name}</button>
        ))}
      </div>
      {tab === 'tiers'
        ? <TiersTab definition={definition} edit={edit} api={api} characterSheet={characterSheet} />
        : <BlockTab definition={definition} edit={edit} api={api} characterSheet={characterSheet} />}
    </div>
  );
}
