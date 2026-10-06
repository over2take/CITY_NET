import React, { useEffect, useRef, useState } from 'react';
import type { systemsApi, Definition } from '../sheets/systemsApi';
import { renamedMessage, SYSTEMS_CHANGED_EVENT } from '../sheets/systemsLibrary';
import {
  HEALTH_MODELS, ADVANCEMENT, DISTANCE, COMMON_DICE, MAX_DICE, LIST_LIMITS, defaultHealth, idFor, setupOf, withCover, withCore,
  toggleAdvancement, toggleDie, addDie, healthLayout, tokenNote, type Health, type HealthModel, type Named, type HarmLevel,
} from '../sheets/setup';

// The builder's SETUP page (4a3b): the core rules questions a new system opens on, five on one page,
// each saved as it is answered (approved mockup docs/mockups/builder-setup.html, 2026-10-06). The
// name can be changed here as well as from MY SYSTEMS, refused the same way when another system
// has it. A wizard instead of one page only if users find this too much (the user, same day).
// What it reads and writes is sheets/setup.ts; every change goes through the builder's `edit`,
// which autosaves it.

interface Props {
  api: ReturnType<typeof systemsApi>;
  systemId: string;
  definition: Definition;
  /** A changed definition: shown at once, saved once editing pauses. */
  edit: (next: Definition) => void;
  /** A line for the builder's status bar. */
  say: (text: string, bad?: boolean) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px', minWidth: 0,
};
const pick = (on: boolean): React.CSSProperties => ({
  border: `1px solid ${on ? 'var(--green)' : 'var(--dark-green)'}`, background: on ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'none',
  color: 'var(--green)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
});

function Question({ n, title, ask, children }: { n: number; title: string; ask: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`setup-q${n}`} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: '4px 12px' }}>
      <span aria-hidden style={{ gridRow: 'span 3', width: 24, height: 24, border: '1px solid var(--green)', color: 'var(--green)', display: 'grid', placeItems: 'center', fontSize: 11 }}>{n}</span>
      <h2 id={`setup-q${n}`} style={{ margin: 0, fontSize: 13, letterSpacing: 1, color: 'var(--green)' }}>{title}</h2>
      <p style={{ ...why, margin: 0, maxWidth: '70ch' }}>{ask}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>{children}</div>
    </section>
  );
}

/** An editable list of named entries (tracks, damage types, harm levels, locations). */
function NamedList<T extends Named>({ what, items, limits, onChange, make, extra }: {
  what: string; items: T[]; limits: readonly [number, number]; onChange: (items: T[]) => void;
  make: (label: string, id: string) => T; extra?: (item: T, set: (item: T) => void) => React.ReactNode;
}) {
  const [min, max] = limits;
  const set = (i: number, item: T) => onChange(items.map((x, j) => (j === i ? item : x)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((item, i) => (
        <div key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" aria-label={`${what} ${i + 1}`} maxLength={20} value={item.label} style={{ ...input, flex: '1 1 140px' }}
            onChange={(e) => set(i, { ...item, label: e.target.value })} />
          {extra?.(item, (next) => set(i, next))}
          {min !== max && (
            <button type="button" className="utility-btn" style={btn} aria-label={`Remove ${item.label || `${what} ${i + 1}`}`}
              disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          )}
        </div>
      ))}
      {min !== max && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="utility-btn" style={btn} disabled={items.length >= max}
            onClick={() => onChange([...items, make('NEW', idFor(`new ${what}`, items.map((x) => x.id)))])}>+ ADD</button>
          <span style={why}>{min} to {max}.</span>
        </div>
      )}
    </div>
  );
}

/** The chosen model's own settings. */
function HealthSettings({ health, onChange }: { health: Health; onChange: (h: Health) => void }) {
  const labelField = (value: string | undefined, fallback: string, title: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={small}>{title}</span>
      <input type="text" maxLength={20} value={value ?? ''} placeholder={fallback} style={input}
        onChange={(e) => {
          const next = { ...health, label: e.target.value } as Health & { label?: string };
          if (!e.target.value.trim()) delete next.label;
          onChange(next);
        }} />
    </label>
  );
  switch (health.model) {
    case 'pool': return labelField(health.label, 'HP', 'WHAT IT\'S CALLED');
    case 'tracks': {
      const [a, b] = health.tracks;
      const track = (i: 0 | 1, t: Named, title: string) => (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px' }}>
          <span style={small}>{title}</span>
          <input type="text" maxLength={20} value={t.label} style={input}
            onChange={(e) => onChange({ ...health, tracks: health.tracks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
        </label>
      );
      return <>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{track(0, a, 'FIRST TRACK (ON THE TOKEN)')}{track(1, b, 'SECOND TRACK')}</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', ...why }}>
          <input type="checkbox" checked={!!health.overflow} onChange={(e) => onChange({ ...health, overflow: e.target.checked })} />
          Damage past a full second track spills into the first
        </label>
      </>;
    }
    case 'typed': return <>
      {labelField(health.label, 'HEALTH', 'THE TRACK')}
      <span style={small}>DAMAGE TYPES, LIGHTEST FIRST</span>
      <NamedList what="damage type" items={health.types} limits={LIST_LIMITS.types} make={(label, id) => ({ id, label })}
        onChange={(types) => onChange({ ...health, types })} />
    </>;
    case 'harm': return <>
      <span style={small}>LEVELS, LEAST FIRST</span>
      <NamedList<HarmLevel> what="level" items={health.levels} limits={LIST_LIMITS.levels} make={(label, id) => ({ id, label, slots: 1 })}
        onChange={(levels) => onChange({ ...health, levels })}
        extra={(level, set) => <>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={small}>SLOTS</span>
            <input type="number" min={1} max={4} value={level.slots} style={{ ...input, width: 56 }} aria-label={`${level.label} slots`}
              onChange={(e) => set({ ...level, slots: Math.max(1, Math.min(4, Math.round(Number(e.target.value)) || 1)) })} /></label>
          <input type="text" maxLength={40} value={level.penalty ?? ''} placeholder="Penalty" style={{ ...input, width: 120 }} aria-label={`${level.label} penalty`}
            onChange={(e) => {
              const { penalty: _old, ...rest } = level;
              set(e.target.value ? { ...rest, penalty: e.target.value } : rest);
            }} />
        </>} />
    </>;
    case 'wounds': return (
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={small}>OUT AFTER</span>
          <input type="number" min={1} max={10} value={health.count} style={{ ...input, width: 60 }} aria-label="Wounds before out"
            onChange={(e) => onChange({ ...health, count: Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)) })} />
          <span style={why}>wounds</span></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={small}>EACH WOUND</span>
          <input type="number" min={-5} max={0} value={health.penalty ?? 0} style={{ ...input, width: 60 }} aria-label="Penalty per wound"
            onChange={(e) => onChange({ ...health, penalty: Math.max(-5, Math.min(0, Math.round(Number(e.target.value)) || 0)) })} />
          <span style={why}>to rolls</span></label>
      </div>
    );
    case 'locations': return <>
      {labelField(health.label, 'HP', 'THE POOL')}
      <span style={small}>LOCATIONS</span>
      <NamedList what="location" items={health.locations} limits={LIST_LIMITS.locations} make={(label, id) => ({ id, label })}
        onChange={(locations) => onChange({ ...health, locations })} />
    </>;
    default: return <p style={{ ...why, margin: 0 }}>Nothing to set.</p>;
  }
}

/** The starter sheet's HEALTH section for the chosen model, and what the token shows. */
function Preview({ health }: { health: Health }) {
  const { sections } = healthLayout(health);
  return (
    <div data-testid="setup-preview" style={{ border: '1px dashed color-mix(in srgb, var(--green) 55%, transparent)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={small}>THE STARTER SHEET GETS</span>
      {sections.map((s) => (
        <div key={s.id} style={{ border: '1px solid var(--green)' }}>
          <div style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', padding: '3px 8px', fontSize: 10, letterSpacing: 2, color: 'var(--green)', borderBottom: '1px solid var(--green)' }}>{s.label}</div>
          <div style={{ padding: 8, display: 'grid', gridTemplateColumns: s.layout === 'grid' ? '1fr 1fr' : '1fr', gap: '6px 10px' }}>
            {s.fields.map((f) => (
              <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.7 }}>{f.label}</span>
                <span style={{ borderBottom: '1px solid var(--dark-green)', minHeight: 16 }} />
                {f.hint && <span style={{ fontSize: 10, opacity: 0.6 }}>{f.hint}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p style={{ ...why, margin: 0 }}>{tokenNote(health)}</p>
    </div>
  );
}

export function SetupPage({ api, systemId, definition, edit, say }: Props) {
  const answers = setupOf(definition);
  const [nameText, setNameText] = useState(definition.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [dieText, setDieText] = useState('');
  const [dieError, setDieError] = useState<string | null>(null);
  const [characters, setCharacters] = useState(0);
  // Each model's settings as last left, so trying another model and coming back loses nothing.
  const kept = useRef<Partial<Record<HealthModel, Health>>>({ [answers.health.model]: answers.health });
  const nameRef = useRef<HTMLInputElement>(null);

  // How many characters play it, for the warning under the health question.
  useEffect(() => {
    let live = true;
    api.list().then((r) => { if (live && r.ok) setCharacters(r.value.find((s) => s.id === systemId)?.characterCount ?? 0); });
    return () => { live = false; };
  }, [api, systemId]);

  const core = (patch: Record<string, unknown>) => edit(withCore(definition, patch));
  const setHealth = (h: Health) => { kept.current[h.model] = h; core({ health: h }); };

  const rename = async () => {
    const wanted = nameText.trim();
    if (!wanted || wanted === definition.name || renaming) return;
    setRenaming(true);
    const r = await api.rename(systemId, wanted);
    setRenaming(false);
    if (!r.ok) { setNameError(r.error); nameRef.current?.focus(); return; }
    // The draft on the server has it now; the builder's copy must too, or the next save undoes it.
    edit({ ...definition, name: r.value.name });
    setNameText(r.value.name);
    say(renamedMessage(r.value.name));
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
  };

  const addTyped = () => {
    const r = addDie(answers.dice, dieText);
    if ('error' in r) { setDieError(r.error); return; }
    core({ dice: r.dice });
    setDieText('');
  };

  const model = HEALTH_MODELS.find((m) => m.id === answers.health.model)!;

  return (
    <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Question n={1} title="WHAT IS IT?" ask="What players see when they pick a system, and what MY SYSTEMS shows under its name.">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={small}>NAME</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input ref={nameRef} type="text" maxLength={80} value={nameText} aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'setup-name-error' : undefined}
              style={{ ...input, flex: 1, borderColor: nameError ? 'var(--danger)' : 'var(--green)' }}
              onChange={(e) => { setNameText(e.target.value); setNameError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } }} />
            <button type="button" className="utility-btn" style={btn} onClick={rename}
              disabled={!nameText.trim() || nameText.trim() === definition.name || renaming}>RENAME</button>
          </span>
        </label>
        {nameError && <span id="setup-name-error" role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1 }}>{nameError}</span>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={small}>DESCRIPTION</span>
          <textarea maxLength={2000} rows={3} value={answers.description} style={{ ...input, resize: 'vertical' }}
            placeholder="Low fantasy around one village fire. Wounds instead of HP, coin counted in copper."
            onChange={(e) => edit(withCover(definition, 'description', e.target.value))} />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span style={small}>AUTHOR</span>
            <input type="text" maxLength={80} value={answers.author} style={input} onChange={(e) => edit(withCover(definition, 'author', e.target.value))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span style={small}>LICENSE</span>
            <input type="text" maxLength={200} value={answers.license} placeholder="CC BY 4.0, or leave blank" style={input}
              onChange={(e) => edit(withCover(definition, 'license', e.target.value))} />
          </label>
        </div>
      </Question>

      <Question n={2} title="HOW DO CHARACTERS GET HURT?" ask="The health model. It decides the HEALTH section every character sheet starts with, and what the token's health monitor shows.">
        <div role="radiogroup" aria-label="Health model" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6 }}>
          {HEALTH_MODELS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === answers.health.model}
              style={{ ...pick(m.id === answers.health.model), display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', fontSize: 12 }}
              onClick={() => { if (m.id !== answers.health.model) setHealth(kept.current[m.id] ?? defaultHealth(m.id)); }}>
              <b style={{ letterSpacing: 1 }}>{m.label.toUpperCase()}</b>
              <small style={{ fontSize: 11, opacity: 0.8, letterSpacing: 0, color: 'var(--text)' }}>{m.worksLike}. {m.examples}.</small>
            </button>
          ))}
        </div>
        {characters > 0 && (
          <div style={{ ...why, opacity: 1, borderLeft: '3px solid var(--warning)', padding: '4px 8px' }}>
            {characters} character{characters === 1 ? ' plays' : 's play'} {definition.name}. Changing how they get hurt changes their sheets once you publish; the numbers already on them are kept.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'start' }}>
          <div style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={small}>{model.label.toUpperCase()}</span>
            <HealthSettings health={answers.health} onChange={setHealth} />
          </div>
          <Preview health={answers.health} />
        </div>
      </Question>

      <Question n={3} title="HOW DO CHARACTERS GROW?" ask="Pick any that apply, or none for a game where characters don't advance.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ADVANCEMENT.map((a) => (
            <button key={a.id} type="button" aria-pressed={answers.advancement.includes(a.id)} style={pick(answers.advancement.includes(a.id))}
              onClick={() => core({ advancement: toggleAdvancement(answers.advancement, a.id) })}>
              {a.label.toUpperCase()}
              <small style={{ display: 'block', fontSize: 11, opacity: 0.75, letterSpacing: 0, marginTop: 2, color: 'var(--text)' }}>{a.examples}</small>
            </button>
          ))}
        </div>
        <span style={why}>
          {answers.advancement.length
            ? `Chosen: ${answers.advancement.map((id) => ADVANCEMENT.find((a) => a.id === id)?.label).join(', ')}.`
            : 'None: characters don\'t advance.'}
        </span>
      </Question>

      <Question n={4} title="WHICH DICE DOES IT ROLL MOST?" ask="Offered first whenever you add a roll. Any die can still be rolled.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[...COMMON_DICE, ...answers.dice.filter((d) => !COMMON_DICE.includes(d))].map((d) => (
            <button key={d} type="button" aria-pressed={answers.dice.includes(d)} style={pick(answers.dice.includes(d))}
              disabled={!answers.dice.includes(d) && answers.dice.length >= MAX_DICE}
              onClick={() => core({ dice: toggleDie(answers.dice, d) })}>{d}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" aria-label="Another die" placeholder="Another: d7, 3d8" value={dieText} style={{ ...input, width: 150 }}
            aria-invalid={dieError ? true : undefined}
            onChange={(e) => { setDieText(e.target.value); setDieError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} />
          <button type="button" className="utility-btn" style={btn} disabled={!dieText.trim()} onClick={addTyped}>ADD</button>
          <span style={why}>{answers.dice.length} of {MAX_DICE}.</span>
        </div>
        {dieError && <span role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1 }}>{dieError}</span>}
      </Question>

      <Question n={5} title="HOW IS DISTANCE MEASURED?" ask="What the map's ruler reads in. Every map keeps its own scale.">
        <div role="radiogroup" aria-label="Distance" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DISTANCE.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={answers.distance === d.id} style={pick(answers.distance === d.id)}
              onClick={() => core({ distance: d.id })}>
              {d.id.toUpperCase()}
              <small style={{ display: 'block', fontSize: 11, opacity: 0.75, letterSpacing: 0, marginTop: 2, color: 'var(--text)' }}>{d.what}</small>
            </button>
          ))}
        </div>
      </Question>
    </div>
  );
}
