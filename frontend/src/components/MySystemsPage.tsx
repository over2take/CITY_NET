import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badges, NewPanel, InstallPanel, small, why, btn, danger } from './SystemsPanels';
import type { systemsApi } from '../sheets/systemsApi';
import type { BuilderPage } from '../sheets/builderSession';
import {
  badgesFor, versionLabel, lineFacts, NO_DESCRIPTION, deleteBlocked, exportBlocked,
  renamedMessage, duplicatedMessage, deletedMessage, SYSTEMS_CHANGED_EVENT, type LibrarySystem,
} from '../sheets/systemsLibrary';

// The builder's MY SYSTEMS page (4a2c2a): everything SYSTEMS.EXE did, without leaving the builder
// (approved mockup docs/mockups/builder-my-systems.html, 2026-10-06). Three tabs: the systems as
// line items (name, version, description, facts, badges), each opening out in place with OPEN,
// RENAME, DUPLICATE, EXPORT and DELETE; + NEW, which makes one and opens it on SETUP; and
// INSTALL A FILE, which offers OPEN IT once installed. A name refused because it is taken keeps
// its box open with the reason (decided with the user, 2026-10-06).

type Tab = 'list' | 'new' | 'install';

interface Props {
  api: ReturnType<typeof systemsApi>;
  /** The system open in the builder, if any. */
  openId: string | null;
  /** The system the game runs. */
  running: string | null;
  /** Open a system in the builder at a page; the builder saves the one it has first. */
  onOpen: (id: string, page: BuilderPage) => void;
  /** A line for the builder's status bar. */
  say: (text: string, bad?: boolean) => void;
}

const tabStyle = (on: boolean): React.CSSProperties => ({
  background: on ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'none', border: 0,
  borderBottom: `2px solid ${on ? 'var(--green)' : 'transparent'}`, cursor: 'pointer', padding: '7px 14px',
  color: on ? 'var(--green)' : 'color-mix(in srgb, var(--green) 55%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1,
});

export function MySystemsPage({ api, openId, running, onOpen, say }: Props) {
  const [tab, setTab] = useState<Tab>('list');
  const [systems, setSystems] = useState<LibrarySystem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(openId);
  const [renaming, setRenaming] = useState<{ text: string; error: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<{ id: string; message: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api.list();
    if (!r.ok) { setLoadError(r.error); return; }
    setLoadError(null);
    setSystems(r.value);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  /** After a change: the list again, and the game-system picker told. */
  const changed = async () => {
    await load();
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
  };

  const pick = (id: string) => {
    setPicked(id === picked ? null : id);
    setRenaming(null);
    setConfirmDelete(false);
  };

  const run = async <T,>(work: () => Promise<T>) => {
    if (busy) return undefined;
    setBusy(true);
    try { return await work(); } finally { setBusy(false); }
  };

  const saveRename = (s: LibrarySystem) => run(async () => {
    if (!renaming || !renaming.text.trim()) return;
    const r = await api.rename(s.id, renaming.text);
    if (!r.ok) {
      setRenaming({ text: renaming.text, error: r.error });
      renameRef.current?.focus();
      return;
    }
    setRenaming(null);
    say(renamedMessage(r.value.name));
    await changed();
  });

  const duplicate = (s: LibrarySystem) => run(async () => {
    const r = await api.duplicate(s.id);
    if (!r.ok) { say(r.error, true); return; }
    say(duplicatedMessage(r.value.name));
    setPicked(r.value.id);
    setRenaming(null);
    await changed();
  });

  const exportFile = (s: LibrarySystem) => run(async () => {
    const r = await api.exportFile(s.id);
    if (!r.ok) { say(r.error, true); return; }
    const url = URL.createObjectURL(new Blob([r.value.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = r.value.fileName;
    a.click();
    URL.revokeObjectURL(url);
    say(`Downloading ${r.value.fileName} (v${s.version}).`);
  });

  const remove = (s: LibrarySystem) => run(async () => {
    const r = await api.remove(s.id);
    setConfirmDelete(false);
    if (!r.ok) { say(r.error, true); return; }
    say(deletedMessage(s.name));
    setPicked(null);
    await changed();
  });

  const openOut = (s: LibrarySystem) => {
    const isOpen = s.id === openId;
    const deleteWhy = deleteBlocked(s, running, openId);
    const exportWhy = exportBlocked(s);
    return (
      <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {renaming && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                ref={renameRef}
                type="text"
                aria-label="New name"
                aria-invalid={renaming.error ? true : undefined}
                aria-describedby={renaming.error ? 'my-systems-rename-error' : undefined}
                autoFocus
                maxLength={80}
                value={renaming.text}
                onChange={(e) => setRenaming({ text: e.target.value, error: null })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveRename(s); }
                  if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); }
                }}
                style={{
                  flex: 1, minWidth: 0, background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12,
                  padding: '5px 7px', border: `1px solid ${renaming.error ? 'var(--danger)' : 'var(--green)'}`,
                }}
              />
              <button type="button" className="utility-btn active" style={btn} disabled={!renaming.text.trim() || busy} onClick={() => saveRename(s)}>SAVE</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setRenaming(null)}>CANCEL</button>
            </div>
            {renaming.error
              ? <span id="my-systems-rename-error" role="alert" style={{ ...why, color: 'var(--danger)' }}>{renaming.error}</span>
              : <span style={why}>The new name shows everywhere at once: this list, the game-system picker and the running game.</span>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {isOpen
            ? <span style={{ ...small, color: 'var(--cyan)', opacity: 1 }}>OPEN NOW IN THE BUILDER</span>
            : <button type="button" className="utility-btn active" style={btn} disabled={busy} onClick={() => onOpen(s.id, 'setup')}>OPEN</button>}
          <button type="button" className="utility-btn" style={btn} disabled={!!renaming || busy}
            onClick={() => { setRenaming({ text: s.name, error: null }); setConfirmDelete(false); }}>RENAME</button>
          <button type="button" className="utility-btn" style={btn} disabled={busy} onClick={() => duplicate(s)}>DUPLICATE</button>
          <button type="button" className="utility-btn" style={btn} disabled={!!exportWhy || busy}
            title={exportWhy ?? 'Download it as a .citysys file'} onClick={() => exportFile(s)}>EXPORT .CITYSYS</button>
          <button type="button" className="utility-btn" style={{ ...btn, ...danger }} disabled={!!deleteWhy || busy}
            title={deleteWhy ?? 'Hide it; installing its file brings it back'}
            onClick={() => { setConfirmDelete(true); setRenaming(null); }}>DELETE</button>
        </div>
        {!isOpen && openId && <span style={why}>OPEN saves the one you have open first.</span>}
        {deleteWhy && <span style={why}>DELETE: {deleteWhy}</span>}
        {exportWhy && <span style={why}>EXPORT: {exportWhy}</span>}
        {confirmDelete && (
          <div role="alertdialog" aria-label={`Delete ${s.name}`} style={{ border: '1px solid var(--danger)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--danger)' }}>
            <b>DELETE {s.name.toUpperCase()}?</b>
            <span style={{ ...why, color: 'var(--green)' }}>
              It leaves every list and can't be run. Its characters, banks and token health are kept: installing its file again brings all of it back.
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="utility-btn" style={{ ...btn, ...danger }} disabled={busy} onClick={() => remove(s)}>DELETE</button>
              <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmDelete(false)}>KEEP IT</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const tabs: [Tab, string][] = [['list', `YOUR SYSTEMS${systems ? ` · ${systems.length}` : ''}`], ['new', '+ NEW'], ['install', 'INSTALL A FILE']];

  return (
    <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div role="tablist" aria-label="My systems" style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)' }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={tabStyle(tab === id)}
            onClick={() => { setTab(id); setInstalled(null); }}>{label}</button>
        ))}
      </div>

      {tab === 'list' && <>
        {loadError && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{loadError}</p>}
        {!systems && !loadError && <p style={{ ...small, margin: 0 }}>LOADING…</p>}
        {systems && systems.length === 0 && <p style={{ ...why, margin: 0 }}>No systems of your own yet. Make one in + NEW, or install a file.</p>}
        {systems && systems.length > 0 && (
          <div role="group" aria-label="Your systems" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--dark-green)' }}>
            {systems.map((s) => {
              const isPicked = s.id === picked;
              return (
                <div key={s.id} data-testid={`system-${s.id}`} style={{
                  borderBottom: '1px solid var(--dark-green)',
                  background: isPicked ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'none',
                  boxShadow: isPicked ? 'inset 3px 0 0 var(--green)' : 'none',
                }}>
                  <button
                    type="button"
                    aria-expanded={isPicked}
                    onClick={() => pick(s.id)}
                    style={{
                      width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '5px 14px', padding: '11px 14px',
                      border: 0, background: 'none', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12, textAlign: 'left', cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: 13, overflowWrap: 'anywhere' }}>{s.name.toUpperCase()}</span>
                    <span style={s.id === openId ? { color: 'var(--cyan)', fontSize: 10, letterSpacing: 1 } : { opacity: 0.7 }}>
                      {s.id === openId ? 'OPEN NOW' : versionLabel(s)}
                    </span>
                    <span style={{ gridColumn: '1 / -1', fontSize: 12, lineHeight: 1.45, color: 'var(--text)', opacity: s.description ? 0.9 : 0.55, fontStyle: s.description ? 'normal' : 'italic', maxWidth: '72ch' }}>
                      {s.description || NO_DESCRIPTION}
                    </span>
                    <span style={{ gridColumn: '1 / -1', fontSize: 10, letterSpacing: 1, opacity: 0.65, display: 'flex', gap: '6px 14px', flexWrap: 'wrap' }}>
                      {lineFacts(s).map((f) => <span key={f}>{f}</span>)}
                    </span>
                    <Badges badges={badgesFor(s, running)} />
                  </button>
                  {isPicked && openOut(s)}
                </div>
              );
            })}
          </div>
        )}
      </>}

      {tab === 'new' && <NewPanel api={api} onMade={(id) => { window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT)); onOpen(id, 'setup'); }} />}

      {tab === 'install' && <>
        {installed && (
          <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--cyan)', fontSize: 12 }}>{installed.message}</span>
            <button type="button" className="utility-btn active" style={btn} onClick={() => onOpen(installed.id, 'setup')}>OPEN IT</button>
          </div>
        )}
        <InstallPanel api={api} onInstalled={async (id, message) => { setInstalled({ id, message }); await changed(); }} />
      </>}
    </div>
  );
}
