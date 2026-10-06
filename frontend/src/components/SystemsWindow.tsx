import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalWindow, useFolder, type TerminalFolder } from './TerminalWindow';
import { systemsApi } from '../sheets/systemsApi';
import {
  badgesFor, versionLabel, versionFact, originFact, changedFact, deleteBlocked, exportBlocked,
  renamedMessage, duplicatedMessage, deletedMessage, SYSTEMS_CHANGED_EVENT,
  type Badge, type LibrarySystem,
} from '../sheets/systemsLibrary';

// SYSTEMS.EXE (4a1): the main admin's own game systems. Opened from one button in the GAME tab's
// TTRPG_SYSTEM section; switching which system the game runs stays in the picker there.
// Approved mockup: docs/mockups/systems-library.html. What it says is sheets/systemsLibrary.ts,
// its requests sheets/systemsApi.ts.
//
// SYSTEMS lists them, with the picked one's facts and RENAME, DUPLICATE, EXPORT and DELETE.
// A rename refused because the name is taken keeps the box open with what was typed and the
// reason under it, so the GM fixes it right there (decided with the user, 2026-10-06).

type FolderId = 'systems';
const FOLDERS: TerminalFolder<FolderId>[] = [{ id: 'systems', label: 'SYSTEMS' }];

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

  return (
    <TerminalWindow
      title={`SYSTEMS.EXE · ${system ? system.name.toUpperCase() : 'LIBRARY'}`}
      label="Your game systems"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      folders={FOLDERS}
      open={folder}
      onOpen={setFolder}
      panelMode="controls"
      width={620}
      header={<span style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>YOUR SYSTEMS{systems ? ` · ${systems.length}` : ''}</span><span>MAIN ADMIN ONLY</span>
      </span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
        {loadError && <span role="alert" style={{ ...why, color: 'var(--danger)' }}>{loadError}</span>}
        {!systems && !loadError && <span style={small}>LOADING…</span>}
        {systems && systems.length === 0 && <span style={why}>No systems of your own yet.</span>}
        {list}
        {detail}
        <div role="status" style={{ minHeight: '1.2em', fontSize: 11, color: status?.bad ? 'var(--danger)' : 'var(--cyan)' }}>
          {status?.text ?? ''}
        </div>
      </div>
    </TerminalWindow>
  );
}
