import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// The building photo and the GM's notes, in the admin edit view.
//
// Beside the building's other properties because that is where a GM sets a building up -
// and because, with the admin panel open, the building's own window is not shown at all.
//
// **Nothing here saves on its own.** Choosing a photo, removing one or typing notes only
// stages the change; UPDATE_DATA_POINT saves it along with everything else in the form, by
// calling `commit()` once the building itself has saved. One form, one save - a GM who
// typed notes and pressed UPDATE should not find out later that the notes had a button of
// their own.
//
// They still go to their own routes: the building save rewrites the location row and knows
// nothing of either, and the notes must never travel in the location data.
//
// Main admin only, which the caller decides. A player granted editing rights also sees the
// edit view, and the server refuses them both of these.

/** What a photo may be. Kept in step with PHOTO_EXT in backend/buildings/photoTypes.js. */
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.avif';

export interface BuildingExtrasHandle {
  /**
   * Save whatever was staged. Resolves to the problems, empty when everything saved.
   * Nothing staged means nothing sent.
   */
  commit: () => Promise<string[]>;
}

interface Props {
  /** Null for a building not saved yet, which has nowhere to hang either. */
  locationId: number | null;
  token: string;
  photoUrl?: string | null;
}

const label: React.CSSProperties = { display: 'block', marginBottom: 5 };
const small: React.CSSProperties = { fontSize: '0.7rem', padding: '4px 10px' };
const hint: React.CSSProperties = { fontSize: '0.65rem', opacity: 0.8, marginTop: 4 };

/** What a server not yet restarted onto these routes answers: a 200 with nothing in it. */
const STALE = 'If the backend was just updated, restart it.';

export const BuildingExtrasEditor = forwardRef<BuildingExtrasHandle, Props>(function BuildingExtrasEditor(
  { locationId, token, photoUrl },
  ref,
) {
  /** A photo chosen but not yet uploaded, and the local preview of it. */
  const [pending, setPending] = useState<{ file: File; preview: string } | null>(null);
  /** The current photo marked for removal. */
  const [removing, setRemoving] = useState(false);
  const [notes, setNotes] = useState('');
  /** What the server holds. Null until loaded - and while null, the notes are never sent. */
  const [savedNotes, setSavedNotes] = useState<string | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A different building, or the same one reloaded, starts clean.
  useEffect(() => { setPending(null); setRemoving(false); }, [photoUrl, locationId]);
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.preview); }, [pending]);

  // Fetched rather than handed in: the notes are never part of the location data the panel
  // already holds.
  useEffect(() => {
    setNotes(''); setSavedNotes(null); setLoadProblem(null);
    if (locationId == null) return;
    let live = true;
    fetch(`/api/locations/${locationId}/gm-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setLoadProblem(body.error || 'Could not load the notes.'); return; }
        // An old server answers with the app's page: a 200 that would read as "no notes",
        // and saving over that would wipe the real ones.
        if (typeof body.notes !== 'string') { setLoadProblem(`The server did not answer for the notes. ${STALE}`); return; }
        setNotes(body.notes); setSavedNotes(body.notes);
      })
      .catch(() => { if (live) setLoadProblem('Could not load the notes.'); });
    return () => { live = false; };
  }, [locationId, token]);

  useImperativeHandle(ref, () => ({
    commit: async () => {
      if (locationId == null) return [];
      const problems: string[] = [];
      const auth = { Authorization: `Bearer ${token}` };

      if (pending) {
        try {
          const form = new FormData();
          form.append('photo', pending.file);
          const r = await fetch(`/api/locations/${locationId}/photo`, { method: 'POST', headers: auth, body: form });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) problems.push(body.error || 'The photo was not saved.');
          // A 200 is not proof: see STALE.
          else if (typeof body.photo_url !== 'string') problems.push(`The server did not take the photo. ${STALE}`);
        } catch {
          problems.push('The photo was not saved.');
        }
      } else if (removing) {
        try {
          const r = await fetch(`/api/locations/${locationId}/photo`, { method: 'DELETE', headers: auth });
          if (!r.ok) problems.push((await r.json().catch(() => ({}))).error || 'The photo was not removed.');
        } catch {
          problems.push('The photo was not removed.');
        }
      }

      if (savedNotes !== null && notes !== savedNotes) {
        try {
          const r = await fetch(`/api/locations/${locationId}/gm-notes`, {
            method: 'PUT',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes }),
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) problems.push(body.error || 'The GM notes were not saved.');
          else if (typeof body.notes !== 'string') problems.push(`The server did not take the GM notes. ${STALE}`);
          else setSavedNotes(body.notes);
        } catch {
          problems.push('The GM notes were not saved.');
        }
      }
      return problems;
    },
  }), [locationId, token, pending, removing, notes, savedNotes]);

  if (locationId == null) {
    return (
      <div style={{ marginTop: 10, fontSize: '0.7rem', opacity: 0.8 }}>
        Save the building first to give it a photo or GM notes.
      </div>
    );
  }

  const shown = pending ? pending.preview : (!removing && photoUrl) || null;
  const photoHint = pending
    ? 'Uploads when you press UPDATE_DATA_POINT.'
    : removing
      ? 'Removed when you press UPDATE_DATA_POINT.'
      : 'Everyone sees it in the building window, in place of the 3D view.';
  const notesDirty = savedNotes !== null && notes !== savedNotes;

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={label}>BUILDING PHOTO</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          {shown && (
            <img
              src={shown}
              alt="Building photo"
              style={{ width: 64, height: 48, objectFit: 'cover', border: '1px solid var(--green)' }}
            />
          )}
          <input
            ref={fileRef}
            type="file"
            accept={PHOTO_ACCEPT}
            aria-label="Building photo file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setPending({ file: f, preview: URL.createObjectURL(f) }); setRemoving(false); }
              e.target.value = '';
            }}
          />
          <button type="button" className="utility-btn" onClick={() => fileRef.current?.click()} style={small}>
            {shown ? 'REPLACE PHOTO' : 'UPLOAD PHOTO'}
          </button>
          {(pending || (photoUrl && !removing)) && (
            <button
              type="button"
              className="utility-btn"
              onClick={() => { if (pending) setPending(null); else setRemoving(true); }}
              style={small}
            >{pending ? 'UNDO' : 'REMOVE'}</button>
          )}
          {removing && !pending && (
            <button type="button" className="utility-btn" onClick={() => setRemoving(false)} style={small}>KEEP</button>
          )}
        </div>
        <div style={hint}>{photoHint}</div>
      </div>

      <div>
        <label style={label} htmlFor="gm-notes-box">GM NOTES</label>
        <textarea
          id="gm-notes-box"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          // Unloaded notes cannot be edited: saving over notes that never arrived would
          // wipe the real ones.
          disabled={savedNotes === null}
          placeholder="Only you see these."
          style={{ width: '100%', height: 90, boxSizing: 'border-box' }}
        />
        <div style={hint}>
          {loadProblem ?? (notesDirty ? 'Saves when you press UPDATE_DATA_POINT.' : 'Players never see these.')}
        </div>
      </div>
    </div>
  );
});
