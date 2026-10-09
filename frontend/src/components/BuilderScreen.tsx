import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { systemsApi, type Definition, type SystemCopies } from '../sheets/systemsApi';
import { lockControls, suggestedName, LOCKED_MESSAGE } from '../sheets/examples';
import {
  createAutosave, saveStatus, exitWarning, leaveNeedsAsking, publishBlocked, publishedMessage,
  BUILDER_PAGES, type Autosave, type BuilderPage,
} from '../sheets/builderSession';
import { SYSTEMS_CHANGED_EVENT } from '../sheets/systemsLibrary';
import { MySystemsPage } from './MySystemsPage';
import { SetupPage } from './SetupPage';
import { WordsPage } from './WordsPage';
import { FeaturesPage } from './FeaturesPage';
import { StatsRulesPage } from './StatsRulesPage';
import { SheetPage } from './SheetPage';
import { NpcsPage } from './NpcsPage';
import { TryItPage } from './TryItPage';

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
  /** The system open in it; none when the GM has yet to pick one, and MY SYSTEMS is all there is. */
  systemId: string | null;
  /** The page it opens on: SETUP for a system just made, MY SYSTEMS from the GAME tab. */
  startPage?: BuilderPage | 'systems';
  /** The system the game runs, so PUBLISH can say whether the game now runs the new version. */
  running: string | null;
  /** Back to the map. */
  onExit: () => void;
  /** Another system, opened here in its place at a page (MY SYSTEMS), once the open one is saved. */
  onOpenSystem: (id: string, page: BuilderPage) => void;
  /**
   * A built-in example open to look at (4d1b) instead of a system: every page shown, everything
   * locked but TRY IT, nothing saved, and COPY TO CHANGE IT to make it the GM's own.
   */
  example?: string | null;
  /** Look at a built-in example here, from + NEW's LOOK FIRST. */
  onLookAt?: (exampleId: string) => void;
  fetcher?: typeof fetch;
}

/**
 * A page of an example, locked: every control greyed but those that only move around it (tabs,
 * things opening out), so it can be read but not changed (sheets/examples.ts lockControls).
 */
function Locked({ on, children }: { on: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!on || !root) return undefined;
    lockControls(root);
    // Pages draw more as they load and open out, so whatever appears is locked too.
    const watch = new MutationObserver(() => lockControls(root));
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    return () => watch.disconnect();
  }, [on]);
  return <div ref={ref} className={on ? 'builder-locked' : undefined} data-testid={on ? 'locked-page' : undefined}>{children}</div>;
}

/**
 * MY SYSTEMS is the builder's own page for every system: picking, making, copying, sharing and
 * installing them without leaving (MySystemsPage; approved mockup builder-my-systems, 2026-10-06,
 * which retired the SYSTEMS.EXE window).
 */
const MY_SYSTEMS = { id: 'systems' as const, label: 'MY SYSTEMS', what: 'Every system you have made or installed. Pick one to work on it.' };
type Page = BuilderPage | 'systems';

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

/** How wide the rail grows to show the names. */
const RAIL_OPEN = 220;

const badge = (border: string, color?: string): React.CSSProperties => ({
  fontSize: 10, letterSpacing: 1, padding: '1px 5px', border: `1px solid ${border}`, ...(color ? { color } : {}),
});

/** A placeholder icon: stand-ins until the builder's own are drawn. */
const icon = (...paths: string[]) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths.map((d) => <path key={d} d={d} />)}
  </svg>
);
const Icons: Record<BuilderPage | 'builder' | 'systems' | 'save' | 'publish', React.ReactNode> = {
  builder: icon('M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'),
  systems: icon('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  setup: icon('M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'),
  words: icon('M4 7V4h16v3', 'M9 20h6', 'M12 4v16'),
  features: icon('M8 5h8a7 7 0 0 1 0 14H8A7 7 0 0 1 8 5z', 'M16 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'),
  rules: icon('M18 7V4H6l6 8-6 8h12v-3'),
  sheet: icon('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'),
  npcs: icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'),
  try: icon('M5 3l14 9-14 9z'),
  problems: icon('M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'),
  save: icon('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'),
  publish: icon('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'),
};

/**
 * One button on the rail, the map's .rail-btn: its icon centered in the narrow rail, its name
 * beside it, seen once the rail is wide.
 */
function RailButton({ icon: glyph, label, onClick, title, active, disabled, count, big, aria }: {
  icon: React.ReactNode; label: string; onClick: () => void; title?: string; active?: boolean;
  disabled?: boolean; count?: number; big?: boolean; aria?: string;
}) {
  return (
    <button
      type="button"
      className={`rail-btn ${active ? 'active' : ''}`}
      aria-label={aria ?? label}
      aria-current={active ? 'page' : undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 'auto', flexShrink: 0, position: 'relative', justifyContent: 'flex-start', gap: 10, padding: 0,
        margin: '0 calc((var(--rail-width) - var(--rail-btn-size)) / 2)', overflow: 'hidden', whiteSpace: 'nowrap',
        ...(big ? { height: 'calc(var(--rail-btn-size) + 6px)' } : {}),
      }}
    >
      <span className={big ? 'system-icon-svg' : undefined} style={{ width: 'var(--rail-btn-size)', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
        {glyph}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, paddingRight: 10 }}>{label}</span>
      {count !== undefined && (
        <span aria-hidden style={{
          position: 'absolute', top: 2, left: 'calc(var(--rail-btn-size) - 16px)', minWidth: 14, padding: '0 3px', boxSizing: 'border-box',
          fontSize: 9, lineHeight: '14px', borderRadius: 7, background: 'var(--danger)', color: 'var(--black)', textAlign: 'center',
        }}>{count}</span>
      )}
    </button>
  );
}

export function BuilderScreen({ token, systemId, startPage = 'setup', running, onExit, onOpenSystem, example = null, onLookAt, fetcher }: Props) {
  const api = useMemo(() => systemsApi(token, fetcher), [token, fetcher]);
  const [system, setSystem] = useState<SystemCopies | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const looking = !systemId && !!example;
  // With no system open, MY SYSTEMS is the only page there is.
  const [page, setPage] = useState<Page>(systemId || looking ? startPage : 'systems');
  const [copy, setCopy] = useState<{ name: string; error: string | null; busy: boolean }>({ name: '', error: null, busy: false });
  /** Whether the one looked at is a genre starter (4d3b) rather than a built-in game. */
  const [starter, setStarter] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [exitError, setExitError] = useState<{ error: string; then: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const autosave = useRef<Autosave<Definition> | null>(null);
  /** The draft as the pages edit it; the server's copy catches up as autosave saves it. */
  const [definition, setDefinition] = useState<Definition | null>(null);

  const load = useCallback(async () => {
    if (!systemId) return null;
    const r = await api.get(systemId);
    if (!r.ok) { setLoadError(r.error); return null; }
    setSystem(r.value);
    return r.value;
  }, [api, systemId]);

  useEffect(() => {
    let live = true;
    load().then((sys) => {
      if (!live || !sys || !systemId) return;
      autosave.current = createAutosave<Definition>({
        save: async (definition) => {
          const r = await api.saveDraft(systemId, definition);
          return r.ok ? { ok: true, problems: r.value.problems } : { ok: false, error: r.error };
        },
        onChange: redraw,
        initialProblems: sys.problems,
      });
      setDefinition(sys.draft);
    });
    return () => { live = false; autosave.current?.dispose(); };
  }, [api, load, systemId]);

  // An example to look at: its definition, with nothing to save it to.
  useEffect(() => {
    if (!looking || !example) return undefined;
    let live = true;
    api.example(example).then((r) => {
      if (!live) return;
      if (r.ok) { setDefinition(r.value.definition); setStarter(r.value.kind === 'starter'); } else setLoadError(r.error);
    });
    return () => { live = false; };
  }, [api, looking, example]);

  /** A page changed the system: shown at once, saved once editing pauses (builderSession). */
  const edit = (next: Definition) => {
    // Nothing on a locked page can call this, but an example never changes whatever does.
    if (looking) { setStatus({ text: LOCKED_MESSAGE, bad: true }); return; }
    setDefinition(next);
    autosave.current?.edit(next);
  };

  /** COPY TO CHANGE IT: the example as a new system of the GM's own, opened on SETUP. */
  const copyExample = async () => {
    const wanted = copy.name.trim();
    if (!example || copy.busy) return;
    if (!wanted) { setCopy({ ...copy, error: 'Give the copy a name.' }); return; }
    setCopy({ ...copy, busy: true, error: null });
    const r = await api.createFromExample(wanted, example);
    if (!r.ok) { setCopy({ ...copy, busy: false, error: r.error }); return; }
    window.dispatchEvent(new Event(SYSTEMS_CHANGED_EVENT));
    onOpenSystem(r.value.id, 'setup');
  };

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
  const name = definition?.name || system?.name || '';

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
    const r = await api.publish(systemId!);
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

  const current = page === 'systems' ? MY_SYSTEMS : BUILDER_PAGES.find((p) => p.id === page)!;
  const saveLine = state ? saveStatus(state) : null;
  /** Whether the pages have something to show: an open system's draft, or an example. */
  const ready = !!definition && (looking || !!system);

  return (
    <div
      role="main"
      aria-label="System builder"
      data-testid="builder-screen"
      style={{ position: 'fixed', inset: 0, zIndex: Z, display: 'flex', background: 'var(--black)', color: 'var(--text)', ...mono }}
    >
      {/* The sidebar: the map's icon rail (App.css .icon-rail, .rail-*), widening over the page
          to show each name while the pointer or keyboard focus is in it. */}
      <nav
        aria-label="Builder"
        data-expanded={railOpen}
        className="icon-rail"
        onMouseEnter={() => setRailOpen(true)}
        onMouseLeave={() => setRailOpen(false)}
        onFocus={() => setRailOpen(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRailOpen(false); }}
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 1, overflowX: 'hidden', overflowY: 'auto',
          width: railOpen ? RAIL_OPEN : undefined, transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="rail-top" style={{ alignItems: 'stretch' }}>
          <RailButton icon={Icons.builder} label="SYSTEM_BUILDER" big onClick={() => setPage(systemId || looking ? 'setup' : 'systems')} />
        </div>
        <div style={{ padding: '10px 0' }}>
          <RailButton icon={<ExitIcon />} label="EXIT TO MAP" aria="Exit the builder and go back to the map" onClick={() => leave(onExit)} />
        </div>
        <div className="rail-center" style={{ alignItems: 'stretch' }}>
          <RailButton icon={Icons.systems} label="MY SYSTEMS" title={MY_SYSTEMS.what} active={page === 'systems'}
            onClick={() => { setPage('systems'); setStatus(null); }} />
          {BUILDER_PAGES.map((p) => (
            <RailButton
              key={p.id}
              icon={Icons[p.id]}
              label={p.label}
              title={systemId || looking ? p.what : 'Open a system first, in MY SYSTEMS.'}
              disabled={!systemId && !looking}
              active={p.id === page}
              count={p.id === 'problems' && problems.length > 0 ? problems.length : undefined}
              onClick={() => { setPage(p.id); setStatus(null); }}
            />
          ))}
        </div>
        <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--dark-green)' }}>
          <RailButton icon={Icons.save} label="SAVE" disabled={!autosave.current || busy} onClick={save} />
          <RailButton icon={Icons.publish} label="PUBLISH" disabled={!autosave.current || busy} onClick={publish}
            title={publishBlocked(problems) ?? 'Make this the version the game runs'} />
        </div>
      </nav>

      {/* The open page, beside the rail at its narrow width: the wide rail lies over it. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', marginLeft: 'var(--rail-width)' }}>
        <header style={{
          height: 48, flexShrink: 0, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid var(--green)', boxShadow: '0 0 10px color-mix(in srgb, var(--green) 30%, transparent)', fontSize: 12,
          minWidth: 0,
        }}>
          <span data-testid="builder-system" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <b style={{ color: 'var(--green)', letterSpacing: 1 }}>{systemId || looking ? (name.toUpperCase() || '…') : 'NO SYSTEM OPEN'}</b>
            {looking && <span style={badge('var(--cyan)', 'var(--cyan)')}>{starter ? 'STARTER' : 'EXAMPLE'} · READ ONLY</span>}
            {system && (system.published
              ? <span style={badge('color-mix(in srgb, var(--green) 50%, transparent)')}>PUBLISHED v{system.version}</span>
              : <span style={badge('var(--warning)', 'var(--warning)')}>NEVER PUBLISHED</span>)}
            {problems.length > 0 && (
              <span style={badge('var(--danger)', 'var(--danger)')}>{problems.length} PROBLEM{problems.length === 1 ? '' : 'S'}</span>
            )}
          </span>
          <span aria-hidden style={{ opacity: 0.4 }}>/</span>
          <h1 style={{ margin: 0, color: 'var(--green)', fontSize: 14, letterSpacing: 1, flexShrink: 0 }}>{current.label}</h1>
          <span style={{ opacity: 0.6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.what}</span>
        </header>

        <section aria-label={current.label} className="cyber-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, fontSize: 13, lineHeight: 1.5 }}>
          {loadError && <p role="alert" style={{ color: 'var(--danger)' }}>{loadError}</p>}
          {(systemId ? !system : looking && !definition) && !loadError && <p style={{ opacity: 0.7 }}>LOADING…</p>}
          {page === 'systems' && (systemId === null || system) && (
            <MySystemsPage
              api={api}
              openId={systemId}
              running={running}
              onOpen={(id, at) => leave(() => onOpenSystem(id, at))}
              say={(text, bad) => setStatus({ text, bad })}
              onLook={onLookAt ? (id) => leave(() => onLookAt(id)) : undefined}
              startTab={looking ? 'new' : undefined}
            />
          )}
          {looking && ready && page !== 'systems' && (
            <div role="region" aria-label="Example" style={{ border: '1px solid var(--cyan)', padding: '10px 12px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 900 }}>
              <span style={{ color: 'var(--cyan)', fontSize: 10, letterSpacing: 2 }}>{starter ? 'A GENRE STARTER' : 'A BUILT-IN EXAMPLE'}</span>
              <span style={{ fontSize: 12, lineHeight: 1.45 }}>
                Look around and try it. Nothing here can be changed. To make it your own, copy it under a name of yours: the copy opens on SETUP.
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text" aria-label="Name for the copy" maxLength={80} autoComplete="off" value={copy.name}
                  placeholder={suggestedName(definition!.name)}
                  aria-invalid={copy.error ? true : undefined}
                  onChange={(e) => setCopy({ ...copy, name: e.target.value, error: null })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); copyExample(); } }}
                  style={{
                    ...mono, flex: 1, minWidth: 0, maxWidth: 320, background: 'var(--black)', color: 'var(--green)', fontSize: 12, padding: '5px 7px',
                    border: `1px solid ${copy.error ? 'var(--danger)' : 'var(--green)'}`,
                  }}
                />
                <button type="button" className="utility-btn active" style={{ ...mono, fontSize: 11, letterSpacing: 1, padding: '5px 9px' }} disabled={copy.busy} onClick={copyExample}>
                  COPY TO CHANGE IT
                </button>
                <button type="button" className="utility-btn" style={{ ...mono, fontSize: 11, letterSpacing: 1, padding: '5px 9px' }} onClick={() => { setPage('systems'); setStatus(null); }}>
                  BACK TO + NEW
                </button>
              </div>
              {copy.error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{copy.error}</span>}
            </div>
          )}
          <Locked key={page} on={looking && page !== 'try'}>
            {ready && page === 'problems' && (problems.length === 0
              ? <p style={{ color: 'var(--green)' }}>No problems. It can be published.</p>
              : (
                <ul style={{ margin: 0, paddingLeft: '1.2em', color: 'var(--warning)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {problems.map((p, i) => <li key={i}><b>{p.where}</b>: {p.message}</li>)}
                </ul>
              ))}
            {ready && page === 'setup' && (
              <SetupPage api={api} systemId={systemId ?? ''} definition={definition!} edit={edit} say={(text, bad) => setStatus({ text, bad })} />
            )}
            {ready && page === 'words' && <WordsPage definition={definition!} edit={edit} />}
            {ready && page === 'features' && <FeaturesPage definition={definition!} edit={edit} api={api} />}
            {ready && page === 'rules' && <StatsRulesPage definition={definition!} edit={edit} api={api} />}
            {ready && page === 'sheet' && <SheetPage definition={definition!} edit={edit} api={api} />}
            {ready && page === 'npcs' && <NpcsPage definition={definition!} edit={edit} api={api} />}
            {ready && page === 'try' && <TryItPage definition={definition!} edit={looking ? undefined : edit} api={api} />}
          </Locked>
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
