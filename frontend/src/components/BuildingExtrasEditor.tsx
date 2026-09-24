import React, { useEffect, useRef, useState } from 'react';

// The building photo and the GM's notes, in the admin edit view.
//
// Beside the building's other properties because that is where a GM sets a building up -
// and because, with the admin panel open, the building's own window is not shown at all.
// Both save straight away on their own buttons rather than riding on UPDATE_DATA_POINT:
// that save rewrites the whole location row and knows nothing of either.
//
// Main admin only, which the caller decides. A player granted editing rights also sees the
// edit view, and the server refuses them both of these.

/** What a photo may be. Kept in step with PHOTO_EXT in backend/routes/buildingDetails.js. */
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.avif';

interface Props {
  /** Null for a building not saved yet, which has nowhere to hang either. */
  locationId: number | null;
  token: string;
  photoUrl?: string | null;
}

const label: React.CSSProperties = { display: 'block', marginBottom: 5 };
const small: React.CSSProperties = { fontSize: '0.7rem', padding: '4px 10px' };

export function BuildingExtrasEditor({ locationId, token, photoUrl }: Props) {
  const [photo, setPhoto] = useState<string | null>(photoUrl ?? null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [savedNotes, setSavedNotes] = useState<string | null>(null);
  const [notesMsg, setNotesMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setPhoto(photoUrl ?? null); setPhotoMsg(null); }, [photoUrl, locationId]);

  // The notes are fetched rather than handed in: they are never part of the location data
  // the panel already holds.
  useEffect(() => {
    setNotes(''); setSavedNotes(null); setNotesMsg(null);
    if (locationId == null) return;
    let live = true;
    fetch(`/api/locations/${locationId}/gm-notes`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setNotesMsg(body.error || 'Could not load the notes.'); return; }
        // An old server answers with the app's page: a 200 that would read as "no notes".
        if (typeof body.notes !== 'string') {
          setNotesMsg('The server did not answer for the notes. If it was just updated, restart the backend.');
          return;
        }
        setNotes(body.notes); setSavedNotes(body.notes);
      })
      .catch(() => { if (live) setNotesMsg('Could not load the notes.'); });
    return () => { live = false; };
  }, [locationId, token]);

  if (locationId == null) {
    return (
      <div style={{ marginTop: 10, fontSize: '0.7rem', opacity: 0.8 }}>
        Save the building first to give it a photo or GM notes.
      </div>
    );
  }

  const upload = async (file: File) => {
    setBusy(true); setPhotoMsg(null);
    try {
      const form = new FormData();
      form.append('photo', file);
      const r = await fetch(`/api/locations/${locationId}/photo`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setPhotoMsg(body.error || 'The photo was not saved.'); return; }
      // A 200 is not proof. A server running code from before this route existed answers
      // any unknown address with the app's own page, which is a 200 with no photo in it -
      // and this used to call that saved.
      if (typeof body.photo_url !== 'string') {
        setPhotoMsg('The server did not take the photo. If it was just updated, restart the backend.');
        return;
      }
      setPhoto(body.photo_url);
      setPhotoMsg('PHOTO SAVED');
    } catch {
      setPhotoMsg('The photo was not saved.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    setBusy(true); setPhotoMsg(null);
    try {
      const r = await fetch(`/api/locations/${locationId}/photo`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setPhotoMsg(body.error || 'The photo was not removed.'); return; }
      setPhoto(null);
      setPhotoMsg('PHOTO REMOVED');
    } catch {
      setPhotoMsg('The photo was not removed.');
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    setBusy(true); setNotesMsg(null);
    try {
      const r = await fetch(`/api/locations/${locationId}/gm-notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notes }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setNotesMsg(body.error || 'The notes were not saved.'); return; }
      // Same check as the photo: an old server's 200 carries no notes back.
      if (typeof body.notes !== 'string') {
        setNotesMsg('The server did not take the notes. If it was just updated, restart the backend.');
        return;
      }
      setSavedNotes(String(body.notes ?? ''));
      setNotesMsg('NOTES SAVED');
    } catch {
      setNotesMsg('The notes were not saved.');
    } finally {
      setBusy(false);
    }
  };

  const dirty = savedNotes !== null && notes !== savedNotes;

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={label}>BUILDING PHOTO</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          {photo && (
            <img
              src={photo}
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
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
          <button type="button" className="utility-btn" disabled={busy} onClick={() => fileRef.current?.click()} style={small}>
            {photo ? 'REPLACE PHOTO' : 'UPLOAD PHOTO'}
          </button>
          {photo && (
            <button type="button" className="utility-btn" disabled={busy} onClick={removePhoto} style={small}>
              REMOVE
            </button>
          )}
        </div>
        <div style={{ fontSize: '0.65rem', opacity: 0.8, marginTop: 4 }}>
          {photoMsg ?? 'Everyone sees it in the building window, in place of the 3D view.'}
        </div>
      </div>

      <div>
        <label style={label} htmlFor="gm-notes-box">GM NOTES</label>
        <textarea
          id="gm-notes-box"
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setNotesMsg(null); }}
          placeholder="Only you see these."
          style={{ width: '100%', height: 90, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
          <button type="button" className="utility-btn" disabled={busy || !dirty} onClick={saveNotes} style={small}>
            SAVE NOTES
          </button>
          <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>
            {notesMsg ?? (dirty ? 'UNSAVED' : 'Players never see these.')}
          </span>
        </div>
      </div>
    </div>
  );
}
