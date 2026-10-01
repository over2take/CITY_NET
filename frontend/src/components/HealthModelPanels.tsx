import React, { useState } from 'react';
import type { Location } from '../types';
import type { HealthView } from '../hooks/useHealthView';
import { bandOf, harmBand, type HealthBand } from './healthBands';
import { asLabel, todaysWords, type WordLookup } from '../sheets/words';

// The HEALTH folder under a custom system's health model, as in the approved mockup
// (docs/mockups/health-windows.html). HitPoints.tsx keeps everything around it - the heart
// monitor, the injury map, STIM_HEAL for CWN - and the built-in systems and a custom one-pool
// system never come here. What each model does is the server's (systemBuilder/health.js);
// this only asks and shows.

/** Send a health action; resolves with whether it worked and what the server said. */
export type SendHealth = (action: string, extra?: Record<string, unknown>) => Promise<{ ok: boolean; body: any }>;

/** The monitor's band: from the token's HP, except harm, which has no pool and reads its worst level. */
export const monitorBandFor = (view: HealthView, target: Pick<Location, 'hp_current' | 'hp_max'>): HealthBand => (view.model === 'harm'
  ? harmBand(view.worst ?? -1, view.levels?.length ?? view.levelCount ?? 0, !!view.out)
  : bandOf(target.hp_current ?? 0, target.hp_max ?? 0));

const label: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '2px', opacity: 0.75 };
const readout: React.CSSProperties = { fontSize: '2rem', color: 'var(--green)', textShadow: 'var(--glow)', fontWeight: 'bold', textAlign: 'center' };
const word: React.CSSProperties = { textAlign: 'center', fontSize: '0.72rem', letterSpacing: '2px' };

function Picker({ name, items, picked, onPick }: { name: string; items: { id: string; label: string }[]; picked: string; onPick: (id: string) => void }) {
  return (
    <div role="group" aria-label={name} style={{ display: 'flex', border: '1px solid var(--green)' }}>
      {items.map((it, i) => (
        <button key={it.id} type="button" aria-pressed={it.id === picked} onClick={() => onPick(it.id)}
          style={{
            flex: 1, border: 0, borderRight: i < items.length - 1 ? '1px solid var(--dark-green)' : 0, padding: '6px 4px',
            fontSize: '0.68rem', letterSpacing: '1px', cursor: 'pointer',
            background: it.id === picked ? 'var(--green)' : 'var(--black)', color: it.id === picked ? 'var(--black)' : 'var(--green)',
            fontWeight: it.id === picked ? 'bold' : 'normal',
          }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Meter({ fill, full, heavy }: { fill: number; full?: boolean; heavy?: number }) {
  return (
    <div style={{ height: '9px', border: `1px solid ${full ? 'var(--danger)' : 'var(--cyan)'}`, borderRadius: '2px', overflow: 'hidden', display: 'flex', background: 'color-mix(in srgb, var(--cyan) 10%, transparent)' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%`, background: 'var(--cyan)', transition: 'width 0.3s ease' }} />
      {heavy !== undefined && <div data-testid="heavy-fill" style={{ width: `${Math.max(0, Math.min(1, heavy)) * 100}%`, background: 'var(--danger)', transition: 'width 0.3s ease' }} />}
    </div>
  );
}

function SetRow({ name, value, onSet }: { name: string; value: number; onSet: (n: number) => void }) {
  const [n, setN] = useState(0);
  return (
    <div>
      <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>{name}</label>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input type="number" placeholder={String(value)} aria-label={name} value={n || ''} onChange={(e) => setN(parseInt(e.target.value, 10) || 0)} style={{ flex: 1, minWidth: 0 }} />
        <button className="upload-btn" type="button" style={{ width: 'auto', flexShrink: 0, margin: 0, padding: '0 15px' }} onClick={() => onSet(n)}>SET</button>
      </div>
    </div>
  );
}

/**
 * The editing half of the HEALTH folder for a custom model: pickers, the model's own readout,
 * the buttons, and a line saying what happened. `gm` shows the maximum's SET row, as the
 * built-in panel shows MAX_HP only to the GM.
 */
export function ModelHealthEditor({ view, target, send, gm, words = todaysWords }: {
  view: HealthView; target: Location; send: SendHealth; gm: boolean;
  /** The running system's words (sheets/words.ts); today's text when not given. */
  words?: WordLookup;
}) {
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string>(() => (view.model === 'tracks' ? view.tracks?.[0]?.id
    : view.model === 'typed' ? view.types?.[0]?.id
      : view.model === 'harm' ? view.levels?.[0]?.id
        : '') ?? '');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const say = (text: string, bad = false) => setMessage({ text, bad });
  const run = async (action: string, extra: Record<string, unknown>, onOk: (body: any) => string) => {
    const res = await send(action, extra);
    if (!res.ok) return say(res.body?.error || 'Could not change health', true);
    const text = onOk(res.body || {});
    return text ? say(text, !!res.body?.out) : setMessage(null);
  };
  const cur = target.hp_current ?? 0;
  const max = target.hp_max ?? 0;
  const status = <div role="status" style={{ minHeight: '1.2em', fontSize: '0.68rem', letterSpacing: '1px', color: message?.bad ? 'var(--danger)' : 'var(--cyan)' }}>{message?.text ?? ''}</div>;
  const amountInput = (
    <input type="number" placeholder="0" aria-label="Amount" value={amount || ''} onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)} style={{ width: '100%', boxSizing: 'border-box' }} />
  );
  const buttons = (onHeal: () => void, onDamage: () => void, damageLabel = 'DAMAGE') => (
    <div style={{ display: 'flex', gap: '10px' }}>
      <button className="upload-btn" type="button" onClick={onHeal} style={{ flex: 1 }}>HEAL</button>
      <button className="upload-btn danger-btn" type="button" onClick={onDamage} style={{ flex: 1 }}>{damageLabel}</button>
    </div>
  );

  if (view.model === 'tracks' && view.tracks && view.second) {
    const [first, second] = view.tracks;
    const s = view.second;
    const secondFull = (s.max ?? 0) > 0 && (s.current ?? 0) >= (s.max ?? 0);
    const act = (kind: 'heal' | 'damage') => run(kind, { amount, track: picked }, (b) => (b.overflow ? `${second.label} FULL · ${b.overflow} SPILLED INTO ${first.label}` : ''));
    return (
      <>
        <div style={readout}>{cur} / {max}<div style={label}>{first.label}</div></div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', letterSpacing: '1px' }}>
            <span>{second.label}</span><span>{s.current ?? 0} / {s.max ?? 0}{view.overflow ? ` · OVERFLOW → ${first.label}` : ''}</span>
          </div>
          <Meter fill={(s.max ?? 0) > 0 ? (s.current ?? 0) / (s.max ?? 1) : 0} full={secondFull} />
        </div>
        <Picker name="Track" items={view.tracks} picked={picked} onPick={setPicked} />
        {status}
        {amountInput}
        {buttons(() => act('heal'), () => act('damage'))}
        {gm && (
          <SetRow name={`MAX ${picked === second.id ? second.label : first.label}`} value={picked === second.id ? s.max ?? 0 : max}
            onSet={(n) => run('set_max', picked === second.id ? { track: second.id, amount: n } : { hp_max: n }, () => '')} />
        )}
      </>
    );
  }

  if (view.model === 'typed' && view.types) {
    const types = view.types;
    const boxes = view.boxes ?? max;
    // Heaviest first, then lighter, then clear: / for the lightest, X for the heaviest.
    const glyphs: { glyph: string; kind: number }[] = [];
    types.map((_, i) => i).reverse().forEach((i) => { for (let n = 0; n < types[i].marks; n += 1) glyphs.push({ glyph: i === types.length - 1 ? 'X' : i === 0 ? '/' : '\\', kind: i }); });
    while (glyphs.length < boxes) glyphs.push({ glyph: '', kind: -1 });
    const act = (kind: 'heal' | 'damage') => run(kind, { amount, type: picked }, (b) => (b.out ? 'EVERY BOX TAKEN · OUT OF ACTION'
      : b.turned ? `TRACK FULL · ${b.turned} BOX${b.turned > 1 ? 'ES' : ''} TURNED HEAVIER` : ''));
    return (
      <>
        <div aria-label="Health boxes" role="img" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center' }}>
          {glyphs.slice(0, boxes).map((g, i) => {
            const heavy = g.kind === types.length - 1;
            const color = g.kind < 0 ? 'var(--green)' : heavy ? 'var(--danger)' : 'var(--warning)';
            return <span key={i} style={{ width: 20, height: 20, border: `1px solid ${color}`, color, display: 'grid', placeItems: 'center', fontWeight: 'bold', fontSize: '0.8rem' }}>{g.glyph}</span>;
          })}
        </div>
        <div style={word}>{Math.max(0, boxes - types.reduce((a, t) => a + t.marks, 0))} OF {boxes} BOXES CLEAR</div>
        <Picker name="Damage type" items={types} picked={picked} onPick={setPicked} />
        {status}
        {amountInput}
        {buttons(() => act('heal'), () => act('damage'))}
        {gm && <SetRow name="BOXES" value={boxes} onSet={(n) => run('set_max', { hp_max: n }, () => '')} />}
      </>
    );
  }

  if (view.model === 'harm' && view.levels) {
    const levels = view.levels;
    const labelOf = (id: string) => levels.find((l) => l.id === id)?.label ?? id;
    const take = () => run('damage', { level: picked, note }, (b) => {
      setNote('');
      if (b.out) return `NO ROOM PAST ${levels[levels.length - 1].label} · OUT OF ACTION`;
      return b.placed && b.placed !== picked ? `${labelOf(picked)} FULL · MOVED UP TO ${labelOf(b.placed)}` : '';
    });
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {levels.map((l) => (
            <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr)', gap: '6px' }}>
              <div style={{ fontSize: '0.62rem', letterSpacing: '1px', paddingTop: '5px' }}>{l.label}<div style={{ opacity: 0.6, fontSize: '0.56rem' }}>{l.penalty}</div></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                {l.slots.map((text, i) => (
                  <div key={i} style={{ display: 'flex', minHeight: '24px', alignItems: 'center', border: `1px solid ${text ? 'var(--green)' : 'var(--dark-green)'}` }}>
                    <span style={{ flex: 1, padding: '3px 6px', fontSize: '0.72rem', minWidth: 0, overflowWrap: 'anywhere', opacity: text ? 1 : 0.35 }}>{text || '—'}</span>
                    {text && (
                      <button type="button" aria-label={`Clear ${text}`} onClick={() => run('heal', { level: l.id, slot: i + 1 }, () => '')}
                        style={{ border: 0, borderLeft: '1px solid var(--dark-green)', color: 'var(--danger)', background: 'var(--black)', cursor: 'pointer', padding: '0 7px', alignSelf: 'stretch' }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Picker name="Harm level" items={levels} picked={picked} onPick={setPicked} />
        <input type="text" maxLength={60} placeholder="What happened (e.g. broken arm)" aria-label="Harm note" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
        {status}
        <button className="upload-btn danger-btn" type="button" onClick={take}>TAKE HARM</button>
      </>
    );
  }

  if (view.model === 'wounds') {
    const act = (kind: 'heal' | 'damage') => run(kind, { amount }, (b) => (b.out ? 'OUT OF WOUNDS · INCAPACITATED' : ''));
    return (
      <>
        <div aria-label="Wounds left" role="img" style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          {Array.from({ length: max }, (_, i) => (
            <span key={i} style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${i >= cur ? 'var(--danger)' : 'var(--green)'}`, background: i >= cur ? 'var(--danger)' : 'transparent' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={word}>{cur} OF {max} WOUNDS LEFT</span>
          <span style={{ border: '1px solid var(--warning)', color: 'var(--warning)', fontSize: '0.68rem', letterSpacing: '1px', padding: '2px 8px' }}>PENALTY {view.penalty ?? 0}</span>
        </div>
        {status}
        {amountInput}
        {buttons(() => act('heal'), () => act('damage'), 'TAKE WOUND')}
        {gm && <SetRow name="WOUNDS" value={max} onSet={(n) => run('set_max', { hp_max: n }, () => '')} />}
      </>
    );
  }

  if (view.model === 'locations' && view.locations) {
    const act = (kind: 'heal' | 'damage') => run(kind, { amount, ...(picked ? { location: picked } : {}), ...(note ? { note } : {}) }, () => { setNote(''); return ''; });
    return (
      <>
        <div style={readout}>{cur} / {max}<div style={label}>{words('hp', 'short', 'HP').toUpperCase()}</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px' }}>
          {view.locations.map((l) => (
            <div key={l.id} style={{ border: `1px solid ${l.note ? 'var(--danger)' : 'var(--dark-green)'}`, color: l.note ? 'var(--danger)' : 'var(--green)', padding: '4px 6px', fontSize: '0.64rem', letterSpacing: '1px', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{l.label}</span>
                {l.note && <button type="button" aria-label={`Clear ${l.label}`} onClick={() => run('heal', { location: l.id, amount: 0 }, () => '')} style={{ background: 'none', border: 0, color: 'var(--danger)', cursor: 'pointer', padding: 0 }}>×</button>}
              </div>
              {l.note && <div style={{ color: 'var(--text)', letterSpacing: 0, fontSize: '0.66rem', overflowWrap: 'anywhere' }}>{l.note}</div>}
            </div>
          ))}
        </div>
        <select aria-label="Where it hit" value={picked} onChange={(e) => setPicked(e.target.value)} style={{ width: '100%' }}>
          <option value="">ANYWHERE</option>
          {view.locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <input type="text" maxLength={60} placeholder="Note for the location (optional)" aria-label="Location note" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
        {status}
        {amountInput}
        {buttons(() => act('heal'), () => act('damage'))}
        {gm && <SetRow name={`MAX_${asLabel(words('hp', 'plural', 'HP'))}`} value={max} onSet={(n) => run('set_max', { hp_max: n }, () => '')} />}
      </>
    );
  }

  return null;
}

/**
 * What another player sees of a custom model, under the heart monitor: never a number or a
 * note. A second track as a fill, damage as light against heavy, the worst harm's name,
 * WOUNDED, which locations are hurt.
 */
export function ModelHealthDescription({ view, target }: { view: HealthView; target: Pick<Location, 'hp_current' | 'hp_max'> }) {
  if (view.model === 'tracks' && view.second && view.tracks) {
    const s = view.second;
    const fill = s.fill ?? ((s.max ?? 0) > 0 ? (s.current ?? 0) / (s.max ?? 1) : 0);
    const full = s.full ?? ((s.max ?? 0) > 0 && (s.current ?? 0) >= (s.max ?? 0));
    return (
      <div data-testid="second-track">
        <div style={{ fontSize: '9px', fontFamily: 'monospace', letterSpacing: '1px', color: full ? 'var(--danger)' : 'var(--cyan)', marginBottom: '2px' }}>
          {s.label}{full ? (view.overflow ? ` — FULL · OVERFLOW → ${view.tracks[0].label}` : ' — FULL') : ''}
        </div>
        <Meter fill={fill} full={full} />
      </div>
    );
  }
  if (view.model === 'typed') {
    const boxes = view.boxes ?? 0;
    const marks = view.types?.map((t) => t.marks) ?? [];
    const light = view.light ?? (boxes > 0 ? marks.slice(0, -1).reduce((a, b) => a + b, 0) / boxes : 0);
    const heavy = view.heavy ?? (boxes > 0 ? (marks[marks.length - 1] ?? 0) / boxes : 0);
    return (
      <div data-testid="damage-split">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', letterSpacing: '1px' }}>
          <span>DAMAGE TAKEN</span><span style={{ opacity: 0.7 }}>LIGHT · <span style={{ color: 'var(--danger)' }}>HEAVY</span></span>
        </div>
        <Meter fill={light} heavy={heavy} />
      </div>
    );
  }
  if (view.model === 'harm') {
    const worst = view.worstLabel !== undefined ? view.worstLabel : (view.worst ?? -1) >= 0 ? view.levels?.[view.worst as number]?.label ?? null : null;
    const band = monitorBandFor(view, target);
    return <div style={{ ...word, color: band === 'steady' ? 'var(--green)' : band === 'fast' ? 'var(--warning)' : 'var(--danger)' }}>{view.out ? 'OUT OF ACTION' : worst ? `${worst} HARM` : 'UNHARMED'}</div>;
  }
  if (view.model === 'wounds') {
    const state = view.state ?? ((target.hp_current ?? 0) <= 0 ? 'incapacitated' : (target.hp_current ?? 0) < (target.hp_max ?? 0) ? 'wounded' : 'unhurt');
    return <div style={{ ...word, color: state === 'unhurt' ? 'var(--green)' : 'var(--danger)' }}>{state.toUpperCase()}</div>;
  }
  if (view.model === 'locations' && view.locations) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px' }}>
        {view.locations.map((l) => {
          const hit = l.hit ?? !!l.note;
          return <div key={l.id} data-hit={hit ? 'yes' : 'no'} style={{ border: `1px solid ${hit ? 'var(--danger)' : 'var(--dark-green)'}`, color: hit ? 'var(--danger)' : 'var(--green)', padding: '4px 6px', fontSize: '0.64rem', letterSpacing: '1px' }}>{l.label}</div>;
        })}
      </div>
    );
  }
  return null;
}

/** For a system that tracks harm as conditions: in place of the monitor and the buttons. */
export function NoHealthNotice({ editing }: { editing: boolean }) {
  return (
    <div style={{ border: '1px dashed var(--dark-green)', padding: '14px 10px', textAlign: 'center', fontSize: '0.72rem', lineHeight: 1.5 }}>
      {editing ? 'THIS SYSTEM TRACKS HARM AS CONDITIONS, NOT HEALTH.' : 'NO HEALTH TRACKED.'}
      <div style={{ opacity: 0.7 }}>{editing ? 'Conditions arrive with the builder\'s conditions piece.' : 'Their conditions will show here.'}</div>
    </div>
  );
}
