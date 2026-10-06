import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { systemsApi, type Definition, type SystemCopies } from '../sheets/systemsApi';
import {
  createAutosave, saveStatus, exitWarning, leaveNeedsAsking, publishBlocked, publishedMessage,
  BUILDER_PAGES, type Autosave, type BuilderPage,
} from '../sheets/builderSession';
import { SYSTEMS_CHANGED_EVENT } from '../sheets/systemsLibrary';

// The system builder (4a2b): it takes over the whole window, with no map. A sidebar down the left
// holds the system's name, its pages, SAVE and PUBLISH, and EXIT TO MAP; the open page fills the
// rest, under a bar naming it and over a status line. Design: docs/mockups/builder-design
// (Main, Exit), approved 2026-09-29, with the saving the user chose on 2026-10-06 (two layers:
// autosave writes the draft, SAVE saves now, PUBLISH goes live; leaving warns only when saving
// failed). What it says is sheets/builderSession.ts.
//
// The pages themselves come in later pieces (SETUP 4a3, WORDS and FEATURES 4b1...); until then
// each says what it will hold. PROBLEMS already lists the draft's real problems.

interface Props {
  token: string;
  systemId: string;
  /** The page it opens on: SETUP for a system just made. */
  startPage?: BuilderPage;
  /** The system the game runs, so PUBLISH can say whether the game now runs the new version. */
  running: string | null;
  /** Back to the map. */
  onExit: () => void;
  /** Back to SYSTEMS.EXE. */
  onMySystems: () => void;
  fetcher?: typeof fetch;
}

/** Above the map and its panels, below the windows (DraggableWindow starts at 2000). */
const Z = 1900;
const mono: React.CSSProperties = { fontFamily: "'Courier New', Courier, monospace" };
const sideBtn = (active = false): React.CSSProperties => ({
  ...mono, minHeight: 32, padding: '4px 12px', textAlign: 'left', cursor: 'pointer', letterSpacing: 1, fontSize: 12,
  background: active ? 'var(--green)' : 'transparent', color: active ? 'var(--black)' : 'var(--green)',
  border: `1px solid ${active ? 'var(--green)' : 'color-mix(in srgb, var(--green) 45%, transparent)'}`, fontWeight: active ? 700 : 400,
});
const toneColor = { quiet: 'var(--text)', warn: 'var(--warning)', bad: 'var(--danger)' } as const;

/** The exit icon from the design: a door with an arrow, flipped to point back to the map. */
const ExitIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
    <g transform="translate(24 0) scale(-1 1)">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
        d="M19.285 12h-8.012m5.237 3.636L20 12l-3.49-3.636M13.455 7V4H4v16h9.455v-3" />
    </g>
  </svg>
);

export function BuilderScreen({ token, systemId, startPage = 'setup', running, onExit, onMySystems, fetcher }: Props) {
  const api = useMemo(() => systemsApi(token, fetcher), [token, fetcher]);
  const [system, setSystem] = useState<SystemCopies | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<BuilderPage>(startPage);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [exitError, setExitError] = useState<{ error: string; then: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const autosave = useRef<Autosave<Definition> | null>(null);

  const load = useCallback(async () => {
    const r = await api.get(systemId);
    if (!r.ok) { setLoadError(r.error); return null; }
    setSystem(r.value);
    return r.value;
  }, [api, systemId]);

  useEffect(() => {
    let live = true;
    load().then((sys) => {
      if (!live || !sys) return;
      autosave.current = createAutosave<Definition>({
        save: async (definition) => {
          const r = await api.saveDraft(systemId, definition);
          return r.ok ? { ok: true, problems: r.value.problems } : { ok: false, error: r.error };
        },
        onChange: redraw,
        initialProblems: sys.problems,
      });
      redraw();
    });
    return () => { live = false; autosave.current?.dispose(); };
  }, [api, load, systemId]);

  // Closing or reloading the tab asks first while anything is unsaved.
  useEffect(() => {
    const ask = (e: BeforeUnloadEvent) => {
      if (autosave.current && leaveNeedsAsking(autosave.current.state)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, []);

  const state = autosave.current?.state ?? null;
  const problems = autosave.current?.problems ?? system?.problems ?? [];
  const name = system?.draft?.name || system?.name || '';

  /** Save, then leave; if saving fails, say so and let the GM choose. */
  const leave = async (then: () => void) => {
    if (!autosave.current || await autosave.current.flush()) { then(); return; }
    const s = autosave.current.state;
    setExitError({ error: s.kind === 'failed' ? s.error : 'Could not reach the server.', then });
  };

  const save = async () => {
    if (!autosave.current || busy) return;
    setBusy(true);
    await autosave.current.flush();
    setBusy(false);
    setStatus(null);
  };

  const publish = async () => {
    if (!autosave.current || busy) return;
    setBusy(true);
    const saved = await autosave.current.flush();
    if (!saved) { setBusy(false); return; }
    const blocked = publishBlocked(autosave.current.problems);
    if (blocked) { setBusy(false); setPage('problems'); setStatus({ text: blocked, bad: true }); return; }
    const r = await api.publish(systemId);
    setBusy(false);
    if (!r.ok) {
      if (r.problems) setPage('problems');
      setStatus({ text: r.error, bad: true });
      return;
    }
    setStatus({ text: publishedMessage(r.value.version, running === systemId) });
    await load();
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
  };

  const current = BUILDER_PAGES.find((p) => p.id === page)!;
  const saveLine = state ? saveStatus(state) : null;

  return (
    <div
      role="main"
      aria-label="System builder"
      data-testid="builder-screen"
      style={{ position: 'fixed', inset: 0, zIndex: Z, display: 'flex', background: 'var(--black)', color: 'var(--text)', ...mono }}
    >
      {/* The sidebar */}
      <nav aria-label="Builder" style={{
        width: 232, flexShrink: 0, boxSizing: 'border-box', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 6,
        background: 'var(--black)', borderRight: '1px solid var(--green)', boxShadow: '0 0 12px color-mix(in srgb, var(--green) 35%, transparent)',
        overflowY: 'auto',
      }}>
        <div style={{ fontSize: 10, letterSpacing: 2, opacity: 0.7 }}>SYSTEM_BUILDER.EXE</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)', letterSpacing: 1, lineHeight: '19px', overflowWrap: 'anywhere' }}>
          {name.toUpperCase() || '…'}
        </div>
        {system && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, fontSize: 10, letterSpacing: 1 }}>
            {system.published
              ? <span style={{ padding: '1px 5px', border: '1px solid color-mix(in srgb, var(--green) 50%, transparent)' }}>PUBLISHED v{system.version}</span>
              : <span style={{ padding: '1px 5px', border: '1px solid var(--warning)', color: 'var(--warning)' }}>NEVER PUBLISHED</span>}
            {problems.length > 0 && (
              <span style={{ padding: '1px 5px', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
                {problems.length} PROBLEM{problems.length === 1 ? '' : 'S'}
              </span>
            )}
          </div>
        )}
        <button type="button" style={sideBtn()} onClick={() => leave(onMySystems)}>MY SYSTEMS</button>
        <div style={{ marginTop: 10, fontSize: 10, letterSpacing: 2, opacity: 0.6 }}>PAGES</div>
        {BUILDER_PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={p.id === page ? 'page' : undefined}
            title={p.what}
            onClick={() => { setPage(p.id); setStatus(null); }}
            style={{ ...sideBtn(p.id === page), display: 'flex', justifyContent: 'space-between', gap: 8 }}
          >
            <span>{p.label}</span>
            {p.id === 'problems' && <span style={{ opacity: 0.8 }}>{problems.length}</span>}
          </button>
        ))}
        <span style={{ flexGrow: 1, minHeight: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          <button type="button" disabled={!autosave.current || busy} onClick={save}
            style={{ ...sideBtn(), textAlign: 'center', borderColor: 'var(--green)' }}>SAVE</button>
          <button type="button" disabled={!autosave.current || busy} onClick={publish}
            title={publishBlocked(problems) ?? 'Make this the version the game runs'}
            style={{ ...sideBtn(), textAlign: 'center', borderColor: 'var(--cyan)', color: 'var(--cyan)' }}>PUBLISH</button>
        </div>
        <button type="button" aria-label="Exit the builder and go back to the map" onClick={() => leave(onExit)}
          style={{ ...sideBtn(), minHeight: 40, display: 'flex', alignItems: 'center', gap: 10, letterSpacing: 2, borderColor: 'var(--green)' }}>
          <ExitIcon /><span>EXIT TO MAP</span>
        </button>
      </nav>

      {/* The open page */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{
          height: 48, flexShrink: 0, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid var(--green)', boxShadow: '0 0 10px color-mix(in srgb, var(--green) 30%, transparent)', fontSize: 12,
        }}>
          <h1 style={{ margin: 0, color: 'var(--green)', fontSize: 14, letterSpacing: 1 }}>{current.label}</h1>
          <span style={{ opacity: 0.6 }}>{current.what}</span>
        </header>

        <section aria-label={current.label} className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, fontSize: 13, lineHeight: 1.5 }}>
          {loadError && <p role="alert" style={{ color: 'var(--danger)' }}>{loadError}</p>}
          {!system && !loadError && <p style={{ opacity: 0.7 }}>LOADING…</p>}
          {system && page === 'problems' && (problems.length === 0
            ? <p style={{ color: 'var(--green)' }}>No problems. It can be published.</p>
            : (
              <ul style={{ margin: 0, paddingLeft: '1.2em', color: 'var(--warning)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {problems.map((p, i) => <li key={i}><b>{p.where}</b>: {p.message}</li>)}
              </ul>
            ))}
          {system && page !== 'problems' && (
            <div style={{ maxWidth: '60ch', border: '1px dashed color-mix(in srgb, var(--green) 45%, transparent)', padding: '16px 18px' }}>
              <p style={{ margin: '0 0 6px', color: 'var(--green)', letterSpacing: 1 }}>{current.label}</p>
              <p style={{ margin: 0, opacity: 0.8 }}>{current.what} This page arrives in a coming update.</p>
            </div>
          )}
        </section>

        <footer style={{
          height: 28, flexShrink: 0, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 20,
          borderTop: '1px solid color-mix(in srgb, var(--green) 50%, transparent)', fontSize: 11,
        }}>
          <span style={{ color: problems.length ? 'var(--warning)' : 'var(--green)' }}>PROBLEMS: {problems.length}</span>
          <span role="status" style={{ color: status?.bad ? 'var(--danger)' : 'var(--cyan)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status?.text ?? ''}
          </span>
          <span style={{ flexGrow: 1 }} />
          {saveLine && <span data-testid="save-status" style={{ color: toneColor[saveLine.tone] }}>{saveLine.text}</span>}
        </footer>
      </div>

      {exitError && (() => {
        const w = exitWarning(name, exitError.error);
        return (
          <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--black) 80%, transparent)', display: 'grid', placeItems: 'center' }}>
            <div role="dialog" aria-labelledby="builder-exit-title" style={{
              width: 480, maxWidth: '92vw', boxSizing: 'border-box', background: 'var(--black)', border: '1px solid var(--green)',
              boxShadow: '0 0 24px color-mix(in srgb, var(--green) 45%, transparent)',
            }}>
              <div style={{ height: 30, padding: '0 12px', display: 'flex', alignItems: 'center', background: 'var(--green)', color: 'var(--black)' }}>
                <b id="builder-exit-title" style={{ fontSize: 12, letterSpacing: 1 }}>{w.title}</b>
              </div>
              <div style={{ padding: '20px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: '19px' }}>
                <div>{w.text}</div>
                <div style={{ opacity: 0.8 }}>{w.hint}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button type="button" style={{ ...sideBtn(), height: 34 }} onClick={() => setExitError(null)}>STAY</button>
                  <span style={{ flexGrow: 1 }} />
                  <button type="button" style={{ ...sideBtn(), height: 34, borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    onClick={() => { const then = exitError.then; setExitError(null); then(); }}>EXIT WITHOUT SAVING</button>
                  <button type="button" style={{ ...sideBtn(true), height: 34 }}
                    onClick={() => { const then = exitError.then; setExitError(null); leave(then); }}>TRY AGAIN</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
