import React, { useRef, useState } from 'react';
import type { systemsApi } from '../sheets/systemsApi';
import {
  insideBadges, installPlan, installedMessage, type Badge, type InstallPreview, type InstallAction,
} from '../sheets/systemsLibrary';

// The parts of managing a GM's systems that SYSTEMS.EXE and the builder's MY SYSTEMS page share
// (4a2c2a): NEW, INSTALL, the badges, and their look. What they say is sheets/systemsLibrary.ts.

/** Larger than any system file can be (the server's limit is about half a megabyte). */
export const MAX_FILE_BYTES = 1024 * 1024;

export type Api = ReturnType<typeof systemsApi>;

export const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
export const why: React.CSSProperties = { fontSize: 11, opacity: 0.8, lineHeight: 1.45 };
export const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '5px 9px' };

export const badgeColor: Record<Badge['tone'], string> = {
  run: 'var(--cyan)', plain: 'var(--dark-green)', warn: 'var(--warning)', bad: 'var(--danger)',
};

export function Badges({ badges }: { badges: Badge[] }) {
  return (
    <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', gridColumn: '1 / -1' }}>
      {badges.map((b) => (
        <span
          key={b.text}
          style={{
            fontSize: 9, letterSpacing: 1, padding: '1px 5px', border: `1px solid ${badgeColor[b.tone]}`,
            color: b.tone === 'plain' ? 'var(--green)' : badgeColor[b.tone],
          }}
        >{b.text}</span>
      ))}
    </span>
  );
}

export const field: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px',
};
export const danger: React.CSSProperties = { borderColor: 'var(--danger)', color: 'var(--danger)' };

/** NEW: a system from a name. Example and genre starts come later (4d1, 4d3). */
export function NewPanel({ api, onMade }: { api: Api; onMade: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    const wanted = name.trim();
    if (!wanted || busy) return;
    setBusy(true);
    const r = await api.create(wanted);
    setBusy(false);
    if (!r.ok) { setError(r.error); inputRef.current?.focus(); return; }
    setName('');
    onMade(r.value.id, wanted);
  };

  const starts: [string, string, string, boolean][] = [
    ['blank', 'BLANK', 'A name and nothing else, to build up in the builder.', true],
    ['example', 'A BUILT-IN EXAMPLE', 'Cities Without Number or Shadowrun as data, to change into your own. Coming later.', false],
    ['starter', 'A GENRE STARTER', 'Fantasy, sci-fi, or a narrative one with no numbers. Coming later.', false],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor="systems-new-name" style={small}>NAME</label>
      <input
        id="systems-new-name"
        ref={inputRef}
        type="text"
        maxLength={80}
        placeholder="Vault Knights"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'systems-new-error' : undefined}
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
        style={{ ...field, border: `1px solid ${error ? 'var(--danger)' : 'var(--green)'}` }}
      />
      {error && <span id="systems-new-error" role="alert" style={{ ...why, color: 'var(--danger)' }}>{error}</span>}
      <span style={small}>START FROM</span>
      <div role="radiogroup" aria-label="Start from" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {starts.map(([id, label, what, can]) => (
          <button
            key={id} type="button" role="radio" aria-checked={id === 'blank'} disabled={!can}
            style={{
              display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 8px', padding: '6px 8px', textAlign: 'left',
              fontFamily: 'monospace', fontSize: 11, color: 'var(--green)', cursor: can ? 'pointer' : 'not-allowed', opacity: can ? 1 : 0.45,
              border: `1px solid ${id === 'blank' ? 'var(--green)' : 'var(--dark-green)'}`,
              background: id === 'blank' ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'none',
            }}
          >
            <span aria-hidden style={{ width: 10, height: 10, marginTop: 2, borderRadius: '50%', border: '1px solid var(--green)', background: id === 'blank' ? 'var(--green)' : 'none' }} />
            <span>{label}</span>
            <small style={{ gridColumn: 2, opacity: 0.75 }}>{what}</small>
          </button>
        ))}
      </div>
      <div>
        <button type="button" className="utility-btn active" style={btn} disabled={!name.trim() || busy} onClick={create}>CREATE</button>
      </div>
      <span style={why}>It's made as a draft: nobody plays it until it's published from the builder.</span>
    </div>
  );
}

/** INSTALL: a .citysys file, previewed first, then installed the way the GM picks. */
export function InstallPanel({ api, onInstalled }: { api: Api; onInstalled: (id: string, message: string) => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<InstallAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const read = async (chosen: File | undefined) => {
    if (!chosen) return;
    setPreview(null);
    setConfirming(null);
    setError(null);
    if (chosen.size > MAX_FILE_BYTES) { setFile(null); setError(`${chosen.name} is over 1 MB, too large to be a system file.`); return; }
    const text = await chosen.text();
    setFile({ name: chosen.name, text });
    setBusy(true);
    const r = await api.preview(text);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.value);
  };

  const install = async (action: InstallAction) => {
    if (!file || !preview || busy) return;
    setBusy(true);
    const r = await api.install(file.text, action.mode, action.replaceChanges === true);
    setBusy(false);
    setConfirming(null);
    if (!r.ok) { setError(r.error); return; }
    const message = installedMessage(r.value, action.mode, preview.manifest.version);
    setFile(null);
    setPreview(null);
    onInstalled(r.value.id, message);
  };

  const plan = preview ? installPlan(preview) : null;
  const m = preview?.manifest;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); read(e.dataTransfer.files[0]); }}
        style={{
          border: `1px dashed var(--green)`, padding: '24px 12px', textAlign: 'center', fontSize: 11, letterSpacing: 1, cursor: 'pointer',
          background: dragging ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'none',
        }}
      >
        {file ? `${file.name} · CHOOSE ANOTHER FILE` : 'CHOOSE A .CITYSYS FILE, OR DROP ONE HERE'}
        <input
          type="file"
          accept=".citysys,.json,application/json"
          aria-label="System file"
          style={{ display: 'none' }}
          onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }}
        />
      </label>
      {busy && !preview && <span style={small}>READING…</span>}
      {error && <span role="alert" style={{ ...why, color: 'var(--danger)' }}>{error}</span>}

      {preview && m && plan && <>
        <div data-testid="install-cover" style={{ border: '1px solid var(--green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 'bold', letterSpacing: 1 }}>
            <span style={{ overflowWrap: 'anywhere' }}>{preview.name.toUpperCase()}</span><span>v{m.version}</span>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '3px 12px', margin: 0, fontSize: 11 }}>
            {m.author && <><dt style={{ opacity: 0.6 }}>AUTHOR</dt><dd style={{ margin: 0 }}>{m.author}</dd></>}
            {m.license && <><dt style={{ opacity: 0.6 }}>LICENSE</dt><dd style={{ margin: 0 }}>{m.license}</dd></>}
            {m.builder && <><dt style={{ opacity: 0.6 }}>MADE WITH</dt><dd style={{ margin: 0 }}>CITY_NET {m.builder}</dd></>}
          </dl>
          {insideBadges(preview.inside).length > 0 && <>
            <span style={small}>INSIDE</span>
            <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {insideBadges(preview.inside).map((b) => (
                <span key={b} style={{ fontSize: 9, letterSpacing: 1, padding: '1px 5px', border: '1px solid var(--dark-green)' }}>{b}</span>
              ))}
            </span>
          </>}
          {preview.problems.length > 0 && <>
            <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>
              {preview.problems.length} PROBLEM{preview.problems.length === 1 ? '' : 'S'}
            </span>
            <ul style={{ margin: 0, paddingLeft: '1.2em', color: 'var(--warning)', fontSize: 11 }}>
              {preview.problems.map((p, i) => <li key={i}>{p.where}: {p.message}</li>)}
            </ul>
          </>}
        </div>

        {plan.notices.map((n) => (
          <div key={n.text} style={{ ...why, borderLeft: `3px solid ${n.tone === 'good' ? 'var(--cyan)' : 'var(--warning)'}`, padding: '4px 8px' }}>{n.text}</div>
        ))}

        {confirming ? (
          <div role="alertdialog" aria-label={confirming.label} style={{ border: '1px solid var(--danger)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--danger)' }}>
            <b>{confirming.label}?</b>
            <span style={{ ...why, color: 'var(--green)' }}>{confirming.confirm}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="utility-btn" style={{ ...btn, ...danger }} disabled={busy} onClick={() => install(confirming)}>{confirming.label}</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setConfirming(null)}>CANCEL</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {plan.actions.map((a) => (
              <button
                key={a.mode}
                type="button"
                className={`utility-btn ${a.primary ? 'active' : ''}`}
                style={{ ...btn, ...(a.confirm ? danger : {}) }}
                disabled={!!a.blocked || busy}
                title={a.blocked ?? `Installs as ${a.installsAs}`}
                onClick={() => (a.confirm ? setConfirming(a) : install(a))}
              >{a.label}</button>
            ))}
          </div>
        )}
        {plan.actions.filter((a) => a.blocked).map((a) => <span key={a.mode} style={why}>{a.label}: {a.blocked}.</span>)}
      </>}
    </div>
  );
}
