import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import { SheetRenderer } from './components/SheetRenderer';
import { getTemplate, getMaxPairs, type CharacterSheet } from './sheets';
import { THEMES } from './theme/themes';

// Standalone character-sheet tab (?sheet=true). Gives the player a full
// browser tab for their sheet instead of the in-game floating window.
//
// Auth handshake: the main app writes { userName, playerToken } to
// localStorage under 'sheet_tab_auth' right before window.open; this page
// reads it once and deletes it. Fallback: the remembered userName from a
// simple-mode login. Secure Mode still verifies the token server-side on
// identify - this page can't fake its way in.

const validTheme = (t: unknown): string | null =>
  typeof t === 'string' && t in THEMES ? t : null;

const readAuth = (): { userName: string | null; playerToken: string | null; adminToken: string | null; theme: string } => {
  // Theme: the handshake carries the main app's active theme; fall back to
  // the login-screen pick, then the classic default.
  let fallbackTheme = 'classic';
  try { fallbackTheme = validTheme(localStorage.getItem('citynet_theme')) ?? 'classic'; } catch { /* private mode */ }
  try {
    const raw = localStorage.getItem('sheet_tab_auth');
    if (raw) {
      localStorage.removeItem('sheet_tab_auth');
      const parsed = JSON.parse(raw);
      if (parsed.userName) {
        return {
          userName: parsed.userName,
          playerToken: parsed.playerToken ?? null,
          adminToken: parsed.adminToken ?? null,
          theme: validTheme(parsed.theme) ?? fallbackTheme,
        };
      }
    }
  } catch { /* fall through */ }
  return { userName: localStorage.getItem('userName'), playerToken: null, adminToken: null, theme: fallbackTheme };
};

export default function SheetPage() {
  const [{ userName, playerToken, adminToken, theme }] = useState(readAuth);
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<string | null>(null);
  const [allowFumbleShield, setAllowFumbleShield] = useState(false);
  const socketRef = useRef<any>(null);
  const pendingSaves = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!userName) return;
    const socket = io();
    socketRef.current = socket;

    const identify = () => {
      if (adminToken) {
        socket.emit('identify', { userName, isAdmin: true, token: adminToken });
      } else if (playerToken) {
        socket.emit('identify', { userName, playerToken });
      } else {
        socket.emit('identify', userName);
      }
      socket.emit('requestMySheet');
    };

    socket.on('connect', identify);
    socket.on('authError', (e: { message: string }) => setError(e.message));
    socket.on('sheetData', (data: CharacterSheet) => {
      if (data.username !== userName) return;
      // Don't stomp fields with a pending debounced edit on re-fetch
      setSheet(prev => {
        if (!prev || pendingSaves.current.size === 0) return data;
        const merged = { ...data.data };
        pendingSaves.current.forEach((_t, fieldId) => {
          if (prev.data[fieldId] !== undefined) merged[fieldId] = prev.data[fieldId];
        });
        return { ...data, data: merged };
      });
    });
    socket.on('sheetUpdated', (info: { username: string }) => {
      if (info.username === userName) socket.emit('requestMySheet');
    });
    socket.on('bankUpdate', (info: { username: string }) => {
      // Cash is a linked field mirroring the bank balance
      if (info.username === userName) socket.emit('requestMySheet');
    });
    socket.on('gameSystemChanged', () => socket.emit('requestMySheet'));
    const fetchRules = () => {
      fetch('/api/settings').then(r => r.json()).then((rows) => {
        if (Array.isArray(rows)) {
          setAllowFumbleShield(rows.find((r: any) => r.key === 'luck_negates_fumble')?.value === '1');
        }
      }).catch(() => {});
    };
    fetchRules();
    socket.on('settingsUpdated', fetchRules);
    // No dice tray on this page — delay matches the 5s dice animation in the main app
    socket.on('diceRollBroadcast', (roll: { historyString?: string }) => {
      if (roll?.historyString) setTimeout(() => setLastRoll(roll.historyString!), 5000);
    });

    return () => { socket.disconnect(); };
  }, [userName, playerToken, adminToken]);

  useEffect(() => () => {
    pendingSaves.current.forEach(t => clearTimeout(t));
    pendingSaves.current.clear();
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: string | number) => {
    setSheet(prev => {
      if (!prev) return prev;
      const tmpl = getTemplate(prev.system);
      const pairs = getMaxPairs(tmpl);
      const curField = pairs[fieldId];
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
      socketRef.current?.emit('updateSheetField', { fieldId, value });
    }, 400));
  }, []);

  const template = sheet ? getTemplate(sheet.system) : null;

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
  }, [adminToken, playerToken]);

  const message = !userName
    ? 'NO OPERATOR IDENTITY FOUND — open this page from CHARACTER_SHEET in the main app.'
    : error
      ? `ACCESS DENIED: ${error} — reopen this page from CHARACTER_SHEET in the main app.`
      : 'ACCESSING RECORD...';

  return (
    <div className={`theme-${theme}`} style={{
      minHeight: '100vh', background: 'var(--black, #050805)', color: 'var(--green, #00ff00)',
      fontFamily: 'monospace', display: 'flex', justifyContent: 'center', padding: '20px 16px',
      boxSizing: 'border-box',
    }}>
      <div style={{ width: '100%', maxWidth: '900px', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid var(--green)', paddingBottom: '8px', marginBottom: '4px',
          letterSpacing: '2px', fontSize: '0.8rem',
        }}>
          <span>CHARACTER_SHEET // {(userName ?? 'UNKNOWN').toUpperCase()}</span>
          {template && (
            <span style={{ border: '1px solid var(--green)', padding: '1px 8px', fontSize: '0.65rem' }}>
              {template.name.toUpperCase()}
            </span>
          )}
        </div>
        {lastRoll && (
          <div style={{
            border: '1px solid var(--green)', background: 'rgba(0, 30, 0, 0.5)',
            padding: '4px 10px', marginBottom: '4px', fontSize: '0.7rem', letterSpacing: '1px',
          }}>
            ⌁ {lastRoll}
          </div>
        )}
        {sheet && template ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
            <SheetRenderer
              template={template}
              data={sheet.data}
              portraitUrl={sheet.portrait_url}
              onFieldChange={handleFieldChange}
              onPortraitUpload={(adminToken || playerToken) ? handlePortraitUpload : undefined}
              onRoll={(fieldId, luck, negateFumble) => socketRef.current?.emit('requestSheetRoll', { fieldId, luck, luckNegate: negateFumble })}
              onDeathSave={() => socketRef.current?.emit('requestDeathSave')}
              allowFumbleShield={allowFumbleShield}
            />
          </div>
        ) : (
          <div style={{ fontSize: '0.75rem', opacity: 0.7, padding: '30px 0', letterSpacing: '1px' }}>{message}</div>
        )}
      </div>
    </div>
  );
}
