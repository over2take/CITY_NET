import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Definition, systemsApi, TriedHealth, TriedTier } from '../sheets/systemsApi';
import { templateFromRender, type CustomRender, type CustomRenderSheet } from '../sheets/customTemplates';
import { formulaList } from '../sheets/statsRules';
import { fieldsOn } from '../sheets/sheetDesigner';
import { tierList, settableFields, triedText } from '../sheets/npcs';
import {
  sampleCharacter, withTyped, withCharacterAsData, differsFromSample, withCharacterAsSample,
  startingToken, asLocation, withMax, type Character, type PretendToken,
} from '../sheets/tryIt';
import { SheetRenderer } from './SheetRenderer';
import { HeartMonitor } from './HitPoints';
import { ModelHealthEditor, ModelHealthDescription, NoHealthNotice, monitorBandFor, type SendHealth } from './HealthModelPanels';
import type { HealthView } from '../hooks/useHealthView';

// The builder's TRY IT page (4c3; approved mockup docs/mockups/builder-try-it.html, 2026-10-08):
// the draft as a player would meet it, unsaved changes included. A made-up character on the
// draft's own sheet, its formulas worked out by the server from what is typed; its health on a
// pretend token through the game's own rules, in the HEALTH folder's own panels; and an NPC made
// from a tier at a level. Nothing is saved, except SAVE AS THE SAMPLE CHARACTER, which writes the
// typed stats back to STATS & RULES. The logic is sheets/tryIt.ts.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  api?: ReturnType<typeof systemsApi>;
}

/** How long after the last keystroke formulas are worked out again. */
export const TRY_IT_DELAY_MS = 400;

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', boxSizing: 'border-box', minWidth: 0,
};
const box: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 };

/** One-pool health, as the built-in HEALTH folder offers it: DAMAGE, HEAL, temp HP and the maximum. */
function PoolPanel({ token, send }: { token: PretendToken; send: SendHealth }) {
  const [amount, setAmount] = useState(5);
  const [max, setMaxText] = useState(String(token.max));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: '1.6rem', color: 'var(--green)', fontWeight: 'bold', textAlign: 'center' }}>
        {token.current} / {token.max}{token.temp > 0 && <span style={{ fontSize: 12, opacity: 0.7 }}> +{token.temp} TEMP</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="number" aria-label="Amount" min={1} value={amount} style={{ ...input, width: 64 }} onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)} />
        <button type="button" className="upload-btn danger-btn" style={{ width: 'auto', margin: 0 }} onClick={() => { void send('damage', { amount }); }}>DAMAGE</button>
        <button type="button" className="upload-btn" style={{ width: 'auto', margin: 0 }} onClick={() => { void send('heal', { amount }); }}>HEAL</button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={small}>MAX</span>
        <input type="number" aria-label="Max HP" min={0} value={max} style={{ ...input, width: 64 }} onChange={(e) => setMaxText(e.target.value)} />
        <button type="button" className="utility-btn" style={btn} onClick={() => { void send('set_max', { hp_max: Number(max) }); }}>SET</button>
      </div>
    </div>
  );
}

export function TryItPage({ definition, edit, api }: Props) {
  const [character, setCharacter] = useState<Character>(() => sampleCharacter(definition));
  const [values, setValues] = useState<Record<string, number>>({});
  const [problems, setProblems] = useState<{ where: string; message: string }[]>([]);
  const [sheet, setSheet] = useState<CustomRenderSheet | null>(null);
  const [token, setToken] = useState<PretendToken>(() => startingToken(definition));
  const [healthSheet, setHealthSheet] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<TriedHealth | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [tier, setTier] = useState('');
  const [level, setLevel] = useState(3);
  const [npc, setNpc] = useState<TriedTier | null>(null);
  const [npcError, setNpcError] = useState<string | null>(null);
  const first = useRef(true);

  // The sheet as the server draws it, and the formulas from what is typed: at once the first time,
  // then a moment after the last change. A late answer never replaces a newer one.
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewSheet(definition).then((r) => { if (live && r.ok) setSheet(r.value.sheet); });
      api.previewValues(withCharacterAsData(definition, character)).then((r) => {
        if (live && r.ok) { setValues(r.value.values); setProblems(r.value.problems); }
      });
    }, first.current ? 0 : TRY_IT_DELAY_MS);
    first.current = false;
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition, character]);

  // The HEALTH folder's views of the pretend token, before anything is done to it.
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    api.tryHealth(definition, { token, sheet: healthSheet }).then((r) => { if (live && r.ok) setHealth(r.value); });
    return () => { live = false; };
  }, [api, definition]); // eslint-disable-line react-hooks/exhaustive-deps

  const send: SendHealth = async (action, extra = {}) => {
    const refuse = (error: string) => { setHealthError(error); return { ok: false, body: { error } }; };
    if (!api) return refuse('No server to try it on');
    // The token's own maximum is set outside the model's rules, as the health route sets it for
    // every system; only a second track's maximum goes through them.
    const ownMax = action === 'set_max' && typeof extra.hp_max === 'number';
    const r = ownMax
      ? await api.tryHealth(definition, { token: withMax(token, extra.hp_max as number), sheet: healthSheet })
      : await api.tryHealth(definition, { token, sheet: healthSheet, action: { kind: action, ...extra } });
    if (!r.ok) return refuse(r.error);
    const tried = r.value;
    if (tried.result && !tried.result.ok) return refuse(tried.result.error);
    setHealthError(null);
    setToken(tried.token);
    setHealthSheet(tried.sheet);
    setHealth(tried);
    const amount = typeof extra.amount === 'number' ? ` ${extra.amount}` : '';
    setLog((l) => [...l, ownMax ? `MAX → ${tried.token.max}`
      : `${action.toUpperCase()}${amount} → ${tried.token.current}/${tried.token.max}${tried.token.current <= 0 ? ' — DOWN' : ''}`].slice(-8));
    return { ok: true, body: tried.result ?? {} };
  };

  const reset = () => {
    setCharacter(sampleCharacter(definition));
    const fresh = startingToken(definition);
    setToken(fresh);
    setHealthSheet({});
    setLog([]);
    setHealthError(null);
    if (api) api.tryHealth(definition, { token: fresh, sheet: {} }).then((r) => { if (r.ok) setHealth(r.value); });
  };

  const template = useMemo(() => (sheet ? templateFromRender({
    id: 'sys_0000000000000000', name: definition.name, derived: formulaList(definition).map((f) => f.id), sheet,
  } as unknown as CustomRender) : null), [sheet, definition]);
  const data = { ...character, ...values, hp: token.current, hp_max: token.max, ...healthSheet };
  const fields = sheet ? fieldsOn(sheet) : [];
  const tiers = tierList(definition);
  const pickedTier = tiers.some((t) => t.id === tier) ? tier : tiers[0]?.id ?? '';
  const model = health?.model ?? null;
  const fullView = health ? ({ location_id: -1, ...health.full } as unknown as HealthView) : null;
  const othersView = health ? ({ location_id: -1, ...health.others } as unknown as HealthView) : null;
  const location = asLocation(token) as never;

  const makeNpc = async () => {
    if (!api || !pickedTier) return;
    const r = await api.tryTier(definition, pickedTier, level);
    if (r.ok) { setNpc(r.value); setNpcError(null); } else setNpcError(r.error);
  };
  const npcNumbers = settableFields(definition, sheet).filter((f) => f.type === 'number' && npc?.values[f.id]);

  return (
    <div data-testid="try-it-page" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1200 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', border: '1px solid var(--dark-green)' }}>
        <span style={{ ...small, opacity: 1 }}>THE DRAFT AS IT STANDS</span>
        <span style={why}>Unsaved changes included. What you type here isn&apos;t saved.</span>
        <span style={{ flex: 1 }} />
        {differsFromSample(definition, character) && (
          <button type="button" className="utility-btn" style={btn} onClick={() => edit(withCharacterAsSample(definition, character))}>SAVE AS THE SAMPLE CHARACTER</button>
        )}
        <button type="button" className="utility-btn" style={btn} onClick={reset}>RESET TO THE SAMPLE</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 14, alignItems: 'start' }}>
        <section aria-label="Made-up character" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {template ? (
            <div style={{ border: '1px solid var(--dark-green)' }}>
              <SheetRenderer template={template} data={data as never}
                onFieldChange={(id, value) => {
                  const field = fields.find((f) => f.id === id);
                  if (field) setCharacter((c) => withTyped(c, field, value));
                }} />
            </div>
          ) : <p style={why}>{api ? 'LOADING…' : 'No sheet without the server.'}</p>}
          {problems.length > 0 && (
            <ul role="alert" style={{ margin: 0, paddingLeft: '1.2em', color: 'var(--warning)', fontSize: 12 }}>
              {problems.slice(0, 5).map((p, i) => <li key={i}><b>{p.where}</b>: {p.message}</li>)}
            </ul>
          )}
          <p style={{ ...why, margin: 0, fontSize: 11 }}>Type to try it: formulas from STATS &amp; RULES work themselves out a moment later, by the game&apos;s own engine.</p>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section aria-label="Health" style={box}>
            <span style={small}>HEALTH{model ? ` · ${model.toUpperCase()}` : ''}</span>
            {!health || !fullView ? <p style={why}>{api ? 'LOADING…' : 'No health without the server.'}</p>
              : model === 'none' ? <NoHealthNotice editing />
                : model === 'pool'
                  ? <PoolPanel token={token} send={send} />
                  : <ModelHealthEditor view={fullView} target={location} send={send} gm />}
            {healthError && model === 'pool' && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, margin: 0 }}>{healthError}</p>}
            {health && othersView && model !== 'none' && (
              <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={small}>WHAT OTHERS SEE</span>
                <HeartMonitor band={monitorBandFor(othersView, location)} />
                <ModelHealthDescription view={othersView} target={location} />
              </div>
            )}
            {log.length > 0 && (
              <div data-testid="health-log" style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--dark-green)', paddingTop: 6 }}>
                {log.map((l, i) => <span key={i}>{l}</span>)}
              </div>
            )}
          </section>

          <section aria-label="An NPC to fight" style={box}>
            <span style={small}>AN NPC TO FIGHT</span>
            {tiers.length === 0 ? <p style={{ ...why, margin: 0 }}>No tiers yet: make one in NPCS.</p> : (
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select aria-label="Tier" value={pickedTier} style={input} onChange={(e) => setTier(e.target.value)}>
                    {tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <span style={small}>LEVEL</span>
                  <input type="number" aria-label="NPC level" min={0} max={99} value={level} style={{ ...input, width: 56 }}
                    onChange={(e) => { if (e.target.value.trim() !== '') setLevel(Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)))); }} />
                  <button type="button" className="utility-btn" style={{ ...btn, background: 'var(--green)', color: 'var(--black)' }} disabled={!api} onClick={makeNpc}>
                    {npc ? 'ROLL AGAIN' : 'MAKE AN NPC'}
                  </button>
                </div>
                {npcError && <p role="alert" style={{ color: 'var(--danger)', fontSize: 11, margin: 0 }}>{npcError}</p>}
                {npc ? (
                  <div data-testid="npc" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }}>
                    {[['HP', npc.hp], ['DEFENSE', npc.defense], ...npcNumbers.map((f) => [f.label.toUpperCase(), npc.values[f.id]] as const)].map(([name, b]) => {
                      const t = triedText(b as TriedTier['hp']);
                      return (
                        <div key={name as string} style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={small}>{name as string}</span>
                          <span style={{ color: 'var(--green)' }}>{t.value}{t.dice && <span style={{ opacity: 0.6, fontSize: 10 }}> {t.dice}</span>}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <p style={{ ...why, margin: 0 }}>As GENERATE_SHEET would make it, rolled for the level.</p>}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
