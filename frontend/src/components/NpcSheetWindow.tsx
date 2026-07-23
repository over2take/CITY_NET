import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ALL_HEADSHOTS } from '../headshots';
import ReactDOM from 'react-dom';
import { DraggableWindow } from './DraggableWindow';
import { SheetRenderer } from './SheetRenderer';
import { ImportSheetDialog } from './ImportSheetDialog';
import { getTemplate, getMaxPairs, hiddenTabsFor, type CharacterSheet } from '../sheets';

// Admin view/edit of an NPC or player sheet. Unlike the player window
// (socket-based, self-only), this goes through the admin REST routes:
// NPC mode:    GET/PUT /api/sheets/npcs/:id
// player mode: GET/PUT /api/sheets/user/:username (set playerUsername)

interface NpcSheetWindowProps {
  token: string;
  /** NPC mode: sheet id in the NPC library. Ignored when playerUsername is set. */
  npcId: number;
  npcLabel: string;
  /** Player mode: view/edit this player's active-system sheet instead. */
  playerUsername?: string;
  /** Stock headshot pool for the HEADSHOTS picker (defaults to all pools). */
  headshots?: string[];
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  /** When provided, the window re-fetches on dataUpdated so linked token HP
   *  stays live (attacks, HIT_POINTS edits). */
  socket?: any;
  /** When provided, a ROLL INIT button appears in the title bar. */
  onRollInitiative?: (portraitUrl: string | undefined) => void;
}

export function NpcSheetWindow({ token, npcId, npcLabel, playerUsername, headshots = ALL_HEADSHOTS, pos, setPos, onClose, socket, onRollInitiative }: NpcSheetWindowProps) {
  const apiPath = playerUsername
    ? `/api/sheets/user/${encodeURIComponent(playerUsername)}`
    : `/api/sheets/npcs/${npcId}`;
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPos, setImportPos] = useState({ x: pos.x + 60, y: pos.y + 60 });
  const [reloadKey, setReloadKey] = useState(0);
  const [ruleSettings, setRuleSettings] = useState<{ key: string; value: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // House rules gate sheet tabs (CWN DELUXE); refresh when the admin applies
  useEffect(() => {
    const fetchRules = () => {
      fetch('/api/settings').then(r => r.json()).then((rows) => {
        if (Array.isArray(rows)) setRuleSettings(rows);
      }).catch(() => {});
    };
    fetchRules();
    if (socket) {
      socket.on('settingsUpdated', fetchRules);
      return () => socket.off('settingsUpdated', fetchRules);
    }
  }, [socket]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch(apiPath, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (!res.ok) return setError(playerUsername ? 'NO_SHEET_FOR_THIS_PLAYER_ON_THE_ACTIVE_SYSTEM' : 'NPC_RECORD_NOT_FOUND');
      const fresh: CharacterSheet = await res.json();
      // Don't stomp fields with a pending debounced edit
      setSheet(prev => {
        if (!prev || pendingSaves.current.size === 0) return fresh;
        const merged = { ...fresh.data };
        pendingSaves.current.forEach((_t, fieldId) => {
          if (prev.data[fieldId] !== undefined) merged[fieldId] = prev.data[fieldId];
        });
        return { ...fresh, data: merged };
      });
    };
    load();
    if (socket) {
      // Token HP is linked - re-fetch when locations change (attacks, HIT_POINTS)
      socket.on('dataUpdated', load);
      // Player sheets also change through the player's own socket edits
      const onSheetUpdated = (info: { username: string }) => {
        if (playerUsername && info.username === playerUsername) load();
      };
      socket.on('sheetUpdated', onSheetUpdated);
      return () => {
        cancelled = true;
        socket.off('dataUpdated', load);
        socket.off('sheetUpdated', onSheetUpdated);
      };
    }
    return () => { cancelled = true; };
  }, [npcId, playerUsername, token, socket, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel outstanding debounce timers on unmount
  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const saveFields = useCallback(async (fields: Record<string, string | number>) => {
    await fetch(apiPath, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  }, [apiPath, token]);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    let clampedCur: { fieldId: string; value: number } | null = null;
    setSheet(prev => {
      if (!prev) return prev;
      const template = getTemplate(prev.system);
      const pairs = getMaxPairs(template);
      const curField = pairs[fieldId]; // non-null when fieldId is a max field
      const data = { ...prev.data, [fieldId]: value };
      if (curField !== undefined && data[curField] !== undefined) {
        const newMax = Number(value);
        if (Number(data[curField]) > newMax) {
          data[curField] = newMax;
          clampedCur = { fieldId: curField, value: newMax };
        }
      }
      return { ...prev, data };
    });
    const timers = pendingSaves.current;
    const existing = timers.get(fieldId);
    if (existing) clearTimeout(existing);
    timers.set(fieldId, setTimeout(() => {
      timers.delete(fieldId);
      const fields: Record<string, string | number> = { [fieldId]: value };
      if (clampedCur) fields[clampedCur.fieldId] = clampedCur.value;
      saveFields(fields);
    }, 400));
  }, [saveFields]);

  const handlePortraitUpload = useCallback(async (file: File) => {
    const form = new FormData();
    form.append('portrait', file);
    const res = await fetch(playerUsername ? `/api/sheets/portrait?username=${encodeURIComponent(playerUsername)}` : `/api/sheets/portrait?npc_id=${npcId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (res.ok) {
      const { portrait_url } = await res.json();
      setSheet(prev => (prev ? { ...prev, portrait_url } : prev));
    }
  }, [npcId, playerUsername, token]);

  const handleSetStockPortrait = useCallback(async (url: string) => {
    const res = await fetch(`/api/sheets/portrait-url`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(playerUsername ? { username: playerUsername, url } : { npc_id: npcId, url }),
    });
    if (res.ok) {
      setSheet(prev => (prev ? { ...prev, portrait_url: url } : prev));
    }
  }, [npcId, playerUsername, token]);

  // portrait_shadow_filter: 1 = shadow-silhouette the portrait (hides reused
  // stock art); the TV effect itself is always on. Default off.
  const shadowFilter = Number(sheet?.data?.portrait_shadow_filter ?? 0) !== 0;
  const handleTogglePortraitShadow = useCallback(() => {
    handleFieldChange('portrait_shadow_filter', shadowFilter ? 0 : 1);
  }, [handleFieldChange, shadowFilter]);

  const template = sheet ? getTemplate(sheet.system) : null;

  return (
    <>
    <DraggableWindow
      title={playerUsername ? `CHARACTER_SHEET // ${playerUsername.toUpperCase()} [ADMIN]` : `NPC_SHEET // ${npcLabel.toUpperCase()}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      titleControls={
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            title="Import from PDF / JSON / text"
            className="win95-close-btn"
            style={{ fontSize: '9px', width: 'auto', padding: '0 5px' }}
            onClick={() => setIsImportOpen(true)}
          >
            IMPORT
          </button>
          {onRollInitiative && !playerUsername && (
            <button
              title="Roll 1d20 and add to initiative (appended to bottom)"
              className="win95-close-btn"
              style={{ fontSize: '9px', width: 'auto', padding: '0 5px' }}
              onClick={() => onRollInitiative(sheet?.portrait_url ?? undefined)}
            >
              ROLL INIT
            </button>
          )}
          {!playerUsername && (
            <button
              title="Choose a stock NPC headshot"
              className="win95-close-btn"
              style={{ fontSize: '9px', width: 'auto', padding: '0 5px', background: pickerOpen ? 'rgba(0,255,0,0.12)' : undefined }}
              onClick={() => {
                if (!pickerOpen && sheet?.portrait_url) {
                  const idx = headshots.indexOf(sheet.portrait_url);
                  if (idx !== -1) setPickerIndex(idx);
                }
                setPickerOpen(o => !o);
              }}
            >
              HEADSHOTS
            </button>
          )}
          {template && (
            <span style={{ border: '1px solid var(--green)', padding: '0 6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
              {template.name.toUpperCase()}
            </span>
          )}
        </span>
      }
      windowStyle={{
        width: '520px', height: '74vh',
        minWidth: '360px', maxWidth: '520px', minHeight: '320px', maxHeight: '92vh',
        resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
      contentStyle={{ flex: 1, minHeight: 0, maxHeight: 'none', display: 'flex', flexDirection: 'column', padding: '4px 10px 0' }}
    >
      {pickerOpen && !playerUsername && (
        <div style={{
          borderBottom: '1px solid var(--green)', marginBottom: '6px', paddingBottom: '8px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <button
            onClick={() => setPickerIndex(i => (i - 1 + headshots.length) % headshots.length)}
            style={{ background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer', padding: '2px 8px', fontSize: '1rem', lineHeight: 1 }}
          >{'<'}</button>
          <img
            src={headshots[pickerIndex]}
            alt=""
            style={{ width: 72, height: 72, objectFit: 'cover', border: '1px solid var(--green)', display: 'block' }}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--green)', letterSpacing: '1px', opacity: 0.7 }}>
              {pickerIndex + 1} / {headshots.length}
            </span>
            <button
              onClick={() => { handleSetStockPortrait(headshots[pickerIndex]); setPickerOpen(false); }}
              style={{ background: 'rgba(0,255,0,0.08)', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer', padding: '4px 10px', fontSize: '0.65rem', letterSpacing: '1px', fontWeight: 600 }}
            >
              USE THIS
            </button>
          </div>
          <button
            onClick={() => setPickerIndex(i => (i + 1) % headshots.length)}
            style={{ background: 'none', border: '1px solid var(--green)', color: 'var(--green)', cursor: 'pointer', padding: '2px 8px', fontSize: '1rem', lineHeight: 1 }}
          >{'>'}</button>
        </div>
      )}
      {sheet && template ? (
        <SheetRenderer
          template={template}
          data={sheet.data}
          portraitUrl={sheet.portrait_url}
          onFieldChange={handleFieldChange}
          onPortraitUpload={handlePortraitUpload}
          portraitShadow={shadowFilter}
          onTogglePortraitShadow={handleTogglePortraitShadow}
          hiddenTabs={hiddenTabsFor(sheet.system, ruleSettings)}
        />
      ) : (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px' }}>
          {error ?? 'ACCESSING RECORD...'}
        </div>
      )}
    </DraggableWindow>
    {isImportOpen && ReactDOM.createPortal(
      <ImportSheetDialog
        pos={importPos}
        setPos={setImportPos}
        onClose={() => setIsImportOpen(false)}
        onApply={async (fields) => {
          await saveFields(fields);
          setReloadKey(k => k + 1);
        }}
      />,
      document.body
    )}
    </>
  );
}
