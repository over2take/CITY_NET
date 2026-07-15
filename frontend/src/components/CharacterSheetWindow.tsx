import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { DraggableWindow } from './DraggableWindow';
import { SheetRenderer } from './SheetRenderer';
import { ImportSheetDialog } from './ImportSheetDialog';
import { getTemplate, getMaxPairs, type CharacterSheet } from '../sheets';

// The player's own character sheet. Identity is the socket's registered
// user - the server only ever returns / edits the caller's own sheet.

interface CharacterSheetWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  userName: string;
  playerToken?: string | null;
  adminToken?: string;
  /** Open the window that owns a linked field (HIT_POINTS / BANK). */
  onOpenLink?: (source: 'token_hp' | 'token_hp_max' | 'bank_balance' | 'token_ac') => void;
  /** Called when the player rolls from the sheet - App opens the dice tray
   *  so the result is visible. */
  onRolled?: () => void;
}

export function CharacterSheetWindow({ pos, setPos, onClose, socket, userName, playerToken, adminToken, onOpenLink, onRolled }: CharacterSheetWindowProps) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [allowFumbleShield, setAllowFumbleShield] = useState(false);
  const [cwnDeluxe, setCwnDeluxe] = useState(false);
  const [importPos, setImportPos] = useState({ x: pos.x + 60, y: pos.y + 60 });
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!socket) return;
    const onSheetData = (data: CharacterSheet) => {
      if (data.username !== userName) return;
      // A re-fetch must not stomp fields the player is mid-typing (debounce
      // still pending) - keep the local value for those, take the rest.
      setSheet(prev => {
        if (!prev || pendingSaves.current.size === 0) return data;
        const merged = { ...data.data };
        pendingSaves.current.forEach((_t, fieldId) => {
          if (prev.data[fieldId] !== undefined) merged[fieldId] = prev.data[fieldId];
        });
        return { ...data, data: merged };
      });
    };
    const onSheetUpdated = (info: { username: string }) => {
      // Re-sync when the admin edits this sheet or token HP changes
      if (info.username === userName) socket.emit('requestMySheet');
    };
    const onBankUpdate = (info: { username: string }) => {
      // Cash is a linked field mirroring the bank balance
      if (info.username === userName) socket.emit('requestMySheet');
    };
    // House rules: read once, refresh when the admin applies
    const fetchRules = () => {
      fetch('/api/settings').then(r => r.json()).then((rows) => {
        if (Array.isArray(rows)) {
          setAllowFumbleShield(rows.find((r: any) => r.key === 'luck_negates_fumble')?.value === '1');
          setCwnDeluxe(rows.find((r: any) => r.key === 'cwn_deluxe')?.value === '1');
        }
      }).catch(() => {});
    };
    fetchRules();
    socket.on('sheetData', onSheetData);
    socket.on('sheetUpdated', onSheetUpdated);
    socket.on('bankUpdate', onBankUpdate);
    socket.on('settingsUpdated', fetchRules);
    socket.emit('requestMySheet');
    return () => {
      socket.off('sheetData', onSheetData);
      socket.off('sheetUpdated', onSheetUpdated);
      socket.off('bankUpdate', onBankUpdate);
      socket.off('settingsUpdated', fetchRules);
    };
  }, [socket, userName]);

  // Cancel outstanding debounce timers on unmount
  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    setSheet(prev => {
      if (!prev) return prev;
      const template = getTemplate(prev.system);
      const pairs = getMaxPairs(template);
      const curField = pairs[fieldId]; // non-null when fieldId is a max field
      const data = { ...prev.data, [fieldId]: value };
      if (curField !== undefined && data[curField] !== undefined) {
        const newMax = Number(value);
        if (Number(data[curField]) > newMax) data[curField] = newMax;
      }
      return { ...prev, data };
    });
    const timers = pendingSaves.current;
    const existing = timers.get(fieldId);
    if (existing) clearTimeout(existing);
    timers.set(fieldId, setTimeout(() => {
      timers.delete(fieldId);
      socket?.emit('updateSheetField', { fieldId, value });
    }, 400));
  }, [socket]);

  const handlePortraitUpload = useCallback(async (file: File) => {
    const authToken = adminToken || playerToken;
    if (!authToken) return;
    const form = new FormData();
    form.append('portrait', file);
    await fetch('/api/sheets/portrait', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });
    // Server emits sheetUpdated → socket listener re-fetches sheet with new portrait_url
  }, [adminToken, playerToken]);

  const template = sheet ? getTemplate(sheet.system) : null;

  return (
    <>
    <DraggableWindow
      title={`CHARACTER_SHEET // ${userName.toUpperCase()}`}
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
          {template && (
            <span style={{ border: '1px solid var(--green)', padding: '0 6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
              {template.name.toUpperCase()}
            </span>
          )}
          <button
            title="Open in new tab"
            aria-label="Open in new tab"
            className="win95-close-btn"
            style={{ fontSize: '11px' }}
            onClick={() => {
              // Handshake for the standalone tab: it reads and deletes this key
              try {
                localStorage.setItem('sheet_tab_auth', JSON.stringify({
                  userName,
                  playerToken: playerToken ?? null,
                  adminToken: adminToken || null,
                }));
              } catch { /* ignore */ }
              window.open('/?sheet=true', '_blank');
            }}
          >
            ⧉
          </button>
        </span>
      }
      windowStyle={{
        width: '520px', height: '74vh',
        minWidth: '360px', maxWidth: '520px', minHeight: '320px', maxHeight: '92vh',
        resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
      contentStyle={{ flex: 1, minHeight: 0, maxHeight: 'none', display: 'flex', flexDirection: 'column', padding: '4px 10px 0' }}
    >
      {sheet && template ? (
        <SheetRenderer
          template={template}
          data={sheet.data}
          portraitUrl={sheet.portrait_url}
          onFieldChange={handleFieldChange}
          onPortraitUpload={(adminToken || playerToken) ? handlePortraitUpload : undefined}
          onOpenLink={onOpenLink}
          onRoll={(fieldId, luck, negateFumble) => {
            socket?.emit('requestSheetRoll', { fieldId, luck, luckNegate: negateFumble });
            onRolled?.();
          }}
          onDeathSave={() => {
            socket?.emit('requestDeathSave');
            onRolled?.();
          }}
          onStabilize={() => {
            socket?.emit('requestStabilize', { targetUsername: userName });
            onRolled?.();
          }}
          onCastSpell={(index) => {
            socket?.emit('castSpell', { index });
            onRolled?.();
          }}
          allowFumbleShield={allowFumbleShield}
          hiddenTabs={sheet.system === 'cities_without_number' && !cwnDeluxe ? ['DELUXE'] : undefined}
        />
      ) : (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px' }}>ACCESSING RECORD...</div>
      )}
    </DraggableWindow>
    {isImportOpen && ReactDOM.createPortal(
      <ImportSheetDialog
        pos={importPos}
        setPos={setImportPos}
        onClose={() => setIsImportOpen(false)}
        onApply={(fields) => {
          socket?.emit('importSheetFields', { fields });
        }}
      />,
      document.body
    )}
    </>
  );
}
