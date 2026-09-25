import React, { useEffect, useRef, useState } from 'react';
import { TerminalWindow, useFolder, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { BuildingPreview } from './BuildingPreview';
import { buildingTypeById, typeLabel } from '../data/buildingTypes';

// A building's info window, drawn as a terminal: folders down the left, the open one's
// text on the right, and the building itself in the corner.
//
// Only for buildings. Player and NPC tokens keep the window they had - they carry a
// portrait, armor class, attacks and a sheet, none of which a building has.
//
// It shows exactly the fields the old window did, read from the same columns. Nothing
// about how a building is stored changes to draw it this way; the photo and the GM's notes
// are additions that sit beside those fields rather than replacing any of them.

export type BuildingTab = 'info' | 'residents' | 'gm';

/** A button along the bottom. The caller decides which apply; the window only lays them out. */
export type BuildingAction = TerminalAction;

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

export function BuildingWindow({
  location, parts = [], title, gameSystem, pos, setPos, onClose, actions, isPrimaryAdmin, token,
}: Props) {
  const folders: TerminalFolder<BuildingTab>[] = [
    { id: 'info', label: 'INFO' },
    { id: 'residents', label: 'RESIDENTS' },
    ...(isPrimaryAdmin ? [{ id: 'gm' as const, label: 'GM NOTES' }] : []),
  ];
  // Opening another building starts at its INFO, not wherever the last one was left.
  const [open, setOpen] = useFolder(folders, location?.id);

  const type = buildingTypeById(location?.building_type);

  return (
    <TerminalWindow
      title={title}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      preview={<BuildingPreview location={location} parts={parts} width={180} height={140} />}
      folders={folders}
      open={open}
      onOpen={setOpen}
      actions={actions}
      header={(
        <>
          {open === 'info' && (
            <>
              {type ? typeLabel(type.id, gameSystem).toUpperCase() : 'BUILDING'}
              {location?.district_name ? ` · ${String(location.district_name).toUpperCase()}` : ''}
            </>
          )}
          {open === 'residents' && 'KNOWN RESIDENTS'}
          {open === 'gm' && 'GM ONLY · PLAYERS NEVER SEE THIS'}
        </>
      )}
    >
      {open === 'info' && (location?.description || 'NO_DATA')}
      {open === 'residents' && (location?.npcs || 'UNKNOWN')}
      {open === 'gm' && <GmNotes locationId={location?.id} token={token} />}
    </TerminalWindow>
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
