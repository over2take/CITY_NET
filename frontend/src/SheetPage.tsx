import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';
import { SheetRenderer } from './components/SheetRenderer';
import { usePlayerSheet, uploadSheetPortrait } from './hooks/usePlayerSheet';
import { THEMES } from './theme/themes';

// Standalone character-sheet tab (?sheet=true). Gives the player a full
// browser tab for their sheet instead of the in-game floating window.
// All sheet behavior lives in usePlayerSheet, shared with the in-game
// window (CharacterSheetWindow) - this file only owns the tab chrome.
//
// Auth handshake: the main app writes { userName, playerToken, theme } to
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
  const [error, setError] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<string | null>(null);
  const [socket, setSocket] = useState<any>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    if (!userName) return;
    const s = io();
    socketRef.current = s;

    const identify = () => {
      if (adminToken) {
        s.emit('identify', { userName, isAdmin: true, token: adminToken });
      } else if (playerToken) {
        s.emit('identify', { userName, playerToken });
      } else {
        s.emit('identify', userName);
      }
      s.emit('requestMySheet');
    };

    s.on('connect', identify);
    s.on('authError', (e: { message: string }) => setError(e.message));
    // No dice tray on this page — delay matches the 5s dice animation in the main app
    s.on('diceRollBroadcast', (roll: { historyString?: string }) => {
      if (roll?.historyString) setTimeout(() => setLastRoll(roll.historyString!), 5000);
    });
    setSocket(s);

    return () => { s.disconnect(); };
  }, [userName, playerToken, adminToken]);

  const { sheet, template, handleFieldChange, allowFumbleShield, hiddenTabs, actions } =
    usePlayerSheet(socket, userName);

  const handlePortraitUpload = useCallback(
    (file: File) => uploadSheetPortrait(adminToken || playerToken, file),
    [adminToken, playerToken],
  );

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
              onRoll={actions.onRoll}
              onDeathSave={actions.onDeathSave}
              onStabilize={actions.onStabilize}
              onCastSpell={actions.onCastSpell}
              onRollAbility={actions.onRollAbility}
              onResistDrain={actions.onResistDrain}
              allowFumbleShield={allowFumbleShield}
              hiddenTabs={hiddenTabs}
            />
          </div>
        ) : (
          <div style={{ fontSize: '0.75rem', opacity: 0.7, padding: '30px 0', letterSpacing: '1px' }}>{message}</div>
        )}
      </div>
    </div>
  );
}
