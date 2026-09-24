import React, { useEffect, useRef, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { BuildingPreview } from './BuildingPreview';
import { buildingTypeById, typeLabel } from '../data/buildingTypes';

// A building's info window, drawn as a terminal: folders down the left, the open one's
// text on the right, and the building itself in the corner.
//
// Only for buildings. Player and NPC tokens keep the window they had - they carry a
// portrait, armour class, attacks and a sheet, none of which a building has.
//
// It shows exactly the fields the old window did, read from the same columns. Nothing
// about how a building is stored changes to draw it this way; the photo and the GM's notes
// are additions that sit beside those fields rather than replacing any of them.

export type BuildingTab = 'info' | 'residents' | 'gm';

/** A button along the bottom. The caller decides which apply; the window only lays them out. */
export interface BuildingAction {
  key: string;
  label: React.ReactNode;
  onClick: () => void;
  title?: string;
  /** How loud the button is. Primary is the thing most people came to do. */
  tone?: 'primary' | 'normal' | 'accent';
}

interface Props {
  location: any;
  /** The building's other parts - locations whose parent is this one - for the render. */
  parts?: any[];
  title: string;
  gameSystem: string;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  actions: BuildingAction[];
  /**
   * The main admin, who alone may read the GM's notes. Not merely "signed in as admin": a
   * player the GM granted editing rights holds an admin token too, and the server refuses
   * them the notes, so offering the tab would only show them an error.
   */
  isPrimaryAdmin: boolean;
  /** The admin token, for reading and saving the notes. */
  token: string;
}

const FOLDER_W = 180;

const mono: React.CSSProperties = { fontFamily: 'monospace', letterSpacing: 1 };

export function BuildingWindow({
  location, parts = [], title, gameSystem, pos, setPos, onClose, actions, isPrimaryAdmin, token,
}: Props) {
  const tabs: { id: BuildingTab; label: string }[] = [
    { id: 'info', label: 'INFO' },
    { id: 'residents', label: 'RESIDENTS' },
    ...(isPrimaryAdmin ? [{ id: 'gm' as const, label: 'GM NOTES' }] : []),
  ];
  const [tab, setTab] = useState<BuildingTab>('info');
  // A tab that stops existing (admin signed out) falls back to the first rather than
  // leaving nothing selected.
  const open: BuildingTab = tabs.some((t) => t.id === tab) ? tab : 'info';

  // Opening another building starts at its INFO, not wherever the last one was left.
  useEffect(() => { setTab('info'); }, [location?.id]);

  /** Up and down walk the folders, the way the terminal in the reference does. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // Not while typing notes: arrows move the caret there.
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === open);
    const next = (i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
    setTab(tabs[next].id);
  };

  const type = buildingTypeById(location?.building_type);

  return (
    <DraggableWindow
      title={title}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      className="terminal-window"
      windowStyle={{ width: 660, maxWidth: '96vw' }}
      contentStyle={{ maxHeight: 'none', padding: 12 }}
    >
      <div
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`${title} information`}
        // Left-aligned like a terminal. The shared window content centres its text, which
        // suits a short notice and not a page of prose.
        style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          {/* Left: the building, then the folders. */}
          <div style={{ width: FOLDER_W, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <BuildingPreview location={location} parts={parts} width={FOLDER_W} height={140} />
            <div style={{ ...mono, fontSize: 10, color: 'var(--green)', opacity: 0.8 }}>FOLDERS</div>
            <div role="tablist" aria-orientation="vertical" aria-label="Folders" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tabs.map((t) => {
                const active = t.id === open;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.id)}
                    style={{
                      ...mono, position: 'relative', textAlign: 'left', fontSize: 11,
                      padding: '10px 8px', minHeight: 44, cursor: 'pointer',
                      background: active ? 'color-mix(in srgb, var(--green) 14%, var(--black))' : 'var(--black)',
                      color: 'var(--green)', border: '1px solid var(--green)',
                    }}
                  >
                    {t.label}
                    {/* The lead-in from the open folder to what it holds, as in the reference. */}
                    {active && (
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute', left: '100%', top: '50%', width: 14,
                          borderTop: '1px solid var(--green)',
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: what the open folder holds. */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                ...mono, fontSize: 11, padding: '8px 10px', border: '1px solid var(--green)',
                color: 'var(--green)',
              }}
            >
              {open === 'info' && (
                <>
                  {type ? typeLabel(type.id, gameSystem).toUpperCase() : 'BUILDING'}
                  {location?.district_name ? ` · ${String(location.district_name).toUpperCase()}` : ''}
                </>
              )}
              {open === 'residents' && 'KNOWN RESIDENTS'}
              {open === 'gm' && 'GM ONLY · PLAYERS NEVER SEE THIS'}
            </div>
            <div
              role="tabpanel"
              aria-label={tabs.find((t) => t.id === open)?.label}
              className="cyber-scroll"
              style={{
                ...mono, letterSpacing: 0, fontSize: 12, lineHeight: 1.6, flex: 1,
                minHeight: 260, maxHeight: 320, overflowY: 'auto', padding: '10px 12px',
                border: '1px solid var(--green)', color: 'var(--green)', whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {open === 'info' && (location?.description || 'NO_DATA')}
              {open === 'residents' && (location?.npcs || 'UNKNOWN')}
              {open === 'gm' && <GmNotes locationId={location?.id} token={token} />}
            </div>
          </div>
        </div>

        {actions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`utility-btn ${a.tone === 'primary' ? 'active' : ''}`}
                title={a.title}
                onClick={a.onClick}
                style={{
                  ...mono, fontSize: 11, padding: '6px 12px', flex: '1 1 140px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  ...(a.tone === 'accent' ? { borderColor: 'var(--cyan)', color: 'var(--cyan)' } : {}),
                }}
              >{a.label}</button>
            ))}
          </div>
        )}

        <div style={{ ...mono, fontSize: 10, color: 'var(--green)', opacity: 0.7 }}>
          UP, DOWN: select folder
        </div>
      </div>
    </DraggableWindow>
  );
}

/**
 * The GM's notes: read, and edited in place.
 *
 * Fetched when the tab opens rather than carried with the building, because they are not
 * carried with the building - they never leave the server except through a request that
 * checks for the main admin.
 */
function GmNotes({ locationId, token }: { locationId: number | undefined; token: string }) {
  const [notes, setNotes] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Guards against a slow answer for the last building landing on this one. */
  const asked = useRef<number | undefined>(undefined);

  useEffect(() => {
    setNotes(null); setDraft(null); setError(null);
    if (locationId === undefined) return;
    asked.current = locationId;
    fetch(`/api/locations/${locationId}/gm-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (asked.current !== locationId) return;
        if (!r.ok) { setError(body.error || 'Could not load the notes.'); return; }
        setNotes(String(body.notes ?? ''));
      })
      .catch(() => { if (asked.current === locationId) setError('Could not load the notes.'); });
  }, [locationId, token]);

  const save = async () => {
    if (draft === null || locationId === undefined) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/locations/${locationId}/gm-notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notes: draft }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.error || 'The notes were not saved.'); return; }
      setNotes(String(body.notes ?? ''));
      setDraft(null);
    } catch {
      setError('The notes were not saved.');
    } finally {
      setSaving(false);
    }
  };

  const small: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '3px 10px' };

  if (error && notes === null) return <span style={{ color: 'var(--danger)' }}>{error}</span>;
  if (notes === null) return <span style={{ opacity: 0.7 }}>LOADING…</span>;

  if (draft !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        <textarea
          aria-label="GM notes"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          style={{
            fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5, minHeight: 200, width: '100%',
            resize: 'vertical', background: 'var(--black)', color: 'var(--green)',
            border: '1px solid var(--dark-green)', padding: 6, boxSizing: 'border-box',
          }}
        />
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="utility-btn" disabled={saving} onClick={save} style={small}>
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
          <button type="button" className="utility-btn" disabled={saving} onClick={() => { setDraft(null); setError(null); }} style={small}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>{notes || <span style={{ opacity: 0.7 }}>NO NOTES YET</span>}</div>
      <div>
        <button type="button" className="utility-btn" onClick={() => setDraft(notes)} style={small}>
          EDIT NOTES
        </button>
      </div>
    </div>
  );
}
