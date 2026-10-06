import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalWindow, useFolder, type TerminalFolder } from './TerminalWindow';
import { systemsApi } from '../sheets/systemsApi';
import {
  badgesFor, versionLabel, versionFact, originFact, changedFact, deleteBlocked, exportBlocked,
  renamedMessage, duplicatedMessage, deletedMessage, createdMessage, insideBadges, installPlan, installedMessage,
  SYSTEMS_CHANGED_EVENT, type Badge, type LibrarySystem, type InstallPreview, type InstallAction,
} from '../sheets/systemsLibrary';

// SYSTEMS.EXE (4a1): the main admin's own game systems. Opened from one button in the GAME tab's
// TTRPG_SYSTEM section; switching which system the game runs stays in the picker there.
// Approved mockup: docs/mockups/systems-library.html. What it says is sheets/systemsLibrary.ts,
// its requests sheets/systemsApi.ts.
//
// SYSTEMS lists them, with the picked one's facts and RENAME, DUPLICATE, EXPORT and DELETE.
// NEW makes one from a name; INSTALL previews a .citysys file, then installs it as it offers.
// A name refused because it is taken keeps its box open with what was typed and the reason
// under it, so the GM fixes it right there (decided with the user, 2026-10-06). A system already
// here is always offered UPDATE or KEEP BOTH, REPLACE asking first when it was changed here.

type FolderId = 'systems' | 'new' | 'install';
const FOLDERS: TerminalFolder<FolderId>[] = [
  { id: 'systems', label: 'SYSTEMS' },
  { id: 'new', label: 'NEW' },
  { id: 'install', label: 'INSTALL' },
];

/** Larger than any system file can be (the server's limit is about half a megabyte). */
const MAX_FILE_BYTES = 1024 * 1024;

type Api = ReturnType<typeof systemsApi>;

interface Props {
  token: string;
  /** The system the game runs. */
  running: string | null;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  fetcher?: typeof fetch;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 11, opacity: 0.8, lineHeight: 1.45 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '5px 9px' };

const badgeColor: Record<Badge['tone'], string> = {
  run: 'var(--cyan)', plain: 'var(--dark-green)', warn: 'var(--warning)', bad: 'var(--danger)',
};

function Badges({ badges }: { badges: Badge[] }) {
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

const field: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px',
};
const danger: React.CSSProperties = { borderColor: 'var(--danger)', color: 'var(--danger)' };

/** NEW: a system from a name. Example and genre starts come later (4d1, 4d3). */
function NewPanel({ api, onMade }: { api: Api; onMade: (id: string, name: string) => void }) {
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
function InstallPanel({ api, onInstalled }: { api: Api; onInstalled: (id: string, message: string) => void }) {
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

export function SystemsWindow({ token, running, pos, setPos, onClose, fetcher }: Props) {
  const api = useMemo(() => systemsApi(token, fetcher), [token, fetcher]);
  const [folder, setFolder] = useFolder(FOLDERS, null);
  const [systems, setSystems] = useState<LibrarySystem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ text: string; error: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  /** The list, picking `pick` (or keeping the pick, or the first) once it arrives. */
  const load = useCallback(async (pick?: string | null) => {
    const r = await api.list();
    if (!r.ok) { setLoadError(r.error); return; }
    setLoadError(null);
    setSystems(r.value);
    setPicked((was) => {
      const want = pick !== undefined ? pick : was;
      return r.value.some((s) => s.id === want) ? want : (r.value[0]?.id ?? null);
    });
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const system = systems?.find((s) => s.id === picked) ?? null;

  // The author lives in the definition, so it is read for the picked system alone.
  useEffect(() => {
    setAuthor(null);
    if (!picked) return;
    let live = true;
    api.get(picked).then((r) => { if (live && r.ok) setAuthor(r.value.draft?.author?.trim() || null); });
    return () => { live = false; };
  }, [api, picked]);

  const pick = (id: string) => {
    setPicked(id);
    setRenaming(null);
    setConfirmDelete(false);
    setStatus(null);
  };

  /** After a change: the list again, and the picker beside this window told. */
  const changed = async (pickAfter?: string | null) => {
    await load(pickAfter);
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
  };

  const saveRename = async () => {
    if (!system || !renaming || !renaming.text.trim() || busy) return;
    setBusy(true);
    const r = await api.rename(system.id, renaming.text);
    setBusy(false);
    if (!r.ok) {
      // Stays open, holding what was typed, with the reason beside it.
      setRenaming({ text: renaming.text, error: r.error });
      renameRef.current?.focus();
      return;
    }
    setRenaming(null);
    setStatus({ text: renamedMessage(r.value.name) });
    await changed();
  };

  const duplicate = async () => {
    if (!system || busy) return;
    setBusy(true);
    const r = await api.duplicate(system.id);
    setBusy(false);
    if (!r.ok) { setStatus({ text: r.error, bad: true }); return; }
    await changed(r.value.id);
    setRenaming(null);
    setConfirmDelete(false);
    setStatus({ text: duplicatedMessage(r.value.name) });
  };

  const exportFile = async () => {
    if (!system || busy) return;
    setBusy(true);
    const r = await api.exportFile(system.id);
    setBusy(false);
    if (!r.ok) { setStatus({ text: r.error, bad: true }); return; }
    const url = URL.createObjectURL(new Blob([r.value.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = r.value.fileName;
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ text: `Downloading ${r.value.fileName} (v${system.version}).` });
  };

  const remove = async () => {
    if (!system || busy) return;
    setBusy(true);
    const r = await api.remove(system.id);
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) { setStatus({ text: r.error, bad: true }); return; }
    setStatus({ text: deletedMessage(system.name) });
    await changed(null);
  };

  const openFolder = (id: FolderId) => {
    setFolder(id);
    setStatus(null);
    setRenaming(null);
    setConfirmDelete(false);
  };

  /** Made in NEW: shown picked in SYSTEMS. The builder opens it from here once it exists (4a2). */
  const made = async (id: string, name: string) => {
    await changed(id);
    setFolder('systems');
    setStatus({ text: createdMessage(name) });
  };

  /** Installed: the line says what happened, and the list behind it has it. */
  const installed = async (id: string, message: string) => {
    await changed(id);
    setStatus({ text: message });
  };

  const deleteWhy = system ? deleteBlocked(system, running) : null;
  const exportWhy = system ? exportBlocked(system) : null;

  const list = systems && (
    <div role="group" aria-label="Your systems" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--dark-green)' }}>
      {systems.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={s.id === picked}
          onClick={() => pick(s.id)}
          style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '2px 10px', padding: '7px 9px',
            border: 0, borderBottom: '1px solid var(--dark-green)', textAlign: 'left', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: 12, color: 'var(--green)',
            background: s.id === picked ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'none',
            boxShadow: s.id === picked ? 'inset 3px 0 0 var(--green)' : 'none',
          }}
        >
          <span style={{ fontWeight: 'bold', letterSpacing: 1, overflowWrap: 'anywhere' }}>{s.name.toUpperCase()}</span>
          <span style={{ opacity: 0.7 }}>{versionLabel(s)}</span>
          <Badges badges={badgesFor(s, running)} />
        </button>
      ))}
    </div>
  );

  const detail = system && (
    <div style={{ border: '1px solid var(--dark-green)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '3px 12px', margin: 0, fontSize: 11 }}>
        <dt style={{ opacity: 0.6 }}>NAME</dt><dd style={{ margin: 0 }}>{system.name}</dd>
        <dt style={{ opacity: 0.6 }}>VERSION</dt><dd style={{ margin: 0 }}>{versionFact(system)}</dd>
        {author && <><dt style={{ opacity: 0.6 }}>AUTHOR</dt><dd style={{ margin: 0 }}>{author}</dd></>}
        <dt style={{ opacity: 0.6 }}>CHANGED</dt><dd style={{ margin: 0 }}>{changedFact(system.updatedAt)}</dd>
        <dt style={{ opacity: 0.6 }}>FROM</dt><dd style={{ margin: 0 }}>{originFact(system)}</dd>
      </dl>

      {renaming && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={renameRef}
              type="text"
              aria-label="New name"
              aria-invalid={renaming.error ? true : undefined}
              aria-describedby={renaming.error ? 'systems-rename-error' : undefined}
              autoFocus
              maxLength={80}
              value={renaming.text}
              onChange={(e) => setRenaming({ text: e.target.value, error: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
                if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
              }}
              style={{
                flex: 1, minWidth: 0, background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12,
                padding: '5px 7px', border: `1px solid ${renaming.error ? 'var(--danger)' : 'var(--green)'}`,
              }}
            />
            <button type="button" className="utility-btn active" style={btn} disabled={!renaming.text.trim() || busy} onClick={saveRename}>SAVE</button>
            <button type="button" className="utility-btn" style={btn} onClick={() => setRenaming(null)}>CANCEL</button>
          </div>
          {renaming.error
            ? <span id="systems-rename-error" role="alert" style={{ ...why, color: 'var(--danger)' }}>{renaming.error}</span>
            : <span style={why}>The new name shows everywhere at once: this list, the game-system picker and the running game.</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button" className="utility-btn" style={btn} disabled={!!renaming || busy}
          onClick={() => { setRenaming({ text: system.name, error: null }); setConfirmDelete(false); setStatus(null); }}
        >RENAME</button>
        <button type="button" className="utility-btn" style={btn} disabled={busy} onClick={duplicate}>DUPLICATE</button>
        <button
          type="button" className="utility-btn" style={btn} disabled={!!exportWhy || busy}
          title={exportWhy ?? 'Download it as a .citysys file'} onClick={exportFile}
        >EXPORT .CITYSYS</button>
        <button
          type="button" className="utility-btn" style={{ ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' }}
          disabled={!!deleteWhy || busy} title={deleteWhy ?? 'Hide it; installing its file brings it back'}
          onClick={() => { setConfirmDelete(true); setRenaming(null); }}
        >DELETE</button>
      </div>
      {deleteWhy && <span style={why}>DELETE: {deleteWhy}</span>}
      {exportWhy && <span style={why}>EXPORT: {exportWhy}</span>}

      {confirmDelete && (
        <div role="alertdialog" aria-label={`Delete ${system.name}`} style={{ border: '1px solid var(--danger)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--danger)' }}>
          <b>DELETE {system.name.toUpperCase()}?</b>
          <span style={{ ...why, color: 'var(--green)' }}>
            It leaves every list and can't be run. Its characters, banks and token health are kept: installing its file again brings all of it back.
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="utility-btn" style={{ ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' }} disabled={busy} onClick={remove}>DELETE</button>
            <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmDelete(false)}>KEEP IT</button>
          </div>
        </div>
      )}
    </div>
  );

  const header = {
    systems: <span style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>YOUR SYSTEMS{systems ? ` · ${systems.length}` : ''}</span><span>MAIN ADMIN ONLY</span>
    </span>,
    new: 'NEW SYSTEM',
    install: 'INSTALL A .CITYSYS FILE',
  }[folder];

  return (
    <TerminalWindow
      title={`SYSTEMS.EXE · ${folder === 'systems' && system ? system.name.toUpperCase() : 'LIBRARY'}`}
      label="Your game systems"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      folders={FOLDERS}
      open={folder}
      onOpen={openFolder}
      panelMode="controls"
      width={620}
      header={header}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        {folder === 'systems' && <>
          {loadError && <span role="alert" style={{ ...why, color: 'var(--danger)' }}>{loadError}</span>}
          {!systems && !loadError && <span style={small}>LOADING…</span>}
          {systems && systems.length === 0 && <span style={why}>No systems of your own yet. Make one in NEW, or install a file in INSTALL.</span>}
          {list}
          {detail}
        </>}
        {folder === 'new' && <NewPanel api={api} onMade={made} />}
        {folder === 'install' && <InstallPanel api={api} onInstalled={installed} />}
        {/* Always there, so a screen reader hears each new line; with nothing to say it takes
            no room, gap included, so what is above it sits centered in the panel. */}
        <div role="status" style={{ fontSize: 11, color: status?.bad ? 'var(--danger)' : 'var(--cyan)', ...(status ? {} : { marginTop: -10 }) }}>
          {status?.text ?? ''}
        </div>
      </div>
    </TerminalWindow>
  );
}
