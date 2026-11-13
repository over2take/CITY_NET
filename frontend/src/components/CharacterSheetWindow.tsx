import React, { useState, useCallback } from 'react';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { useRecoveryOpen } from '../hooks/useRecoveryOpen';
import ReactDOM from 'react-dom';
import { DraggableWindow } from './DraggableWindow';
import { SheetRenderer } from './SheetRenderer';
import { ImportSheetDialog } from './ImportSheetDialog';
import { usePlayerSheet, uploadSheetPortrait } from '../hooks/usePlayerSheet';
import { VehicleBadgeButton } from './VehicleBadgeButton';
import type { SheetLinkSource } from '../sheets';
import { canImport } from '../sheets/importable';
import { flowState, withCreationLocks } from '../sheets/newCharacterFlow';
import { themeRoot } from '../utils/themeRoot';

// The player's own character sheet (in-game floating window). Identity is
// the socket's registered user - the server only ever returns / edits the
// caller's own sheet. All sheet behavior lives in usePlayerSheet, shared
// with the standalone tab (SheetPage).

interface CharacterSheetWindowProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  socket: any;
  userName: string;
  playerToken?: string | null;
  adminToken?: string;
  /** Open the window that owns a linked field (HIT_POINTS / BANK). */
  onOpenLink?: (source: SheetLinkSource) => void;
  /** Called when the player rolls from the sheet - App opens the dice tray
   *  so the result is visible. */
  onRolled?: () => void;
  /** Open the shared seating window from the VEHICLES section header. */
  onOpenVehicles?: () => void;
  /** Active theme name - handed to the standalone tab so it matches. */
  currentTheme?: string;
  /** Opens NEW_CHARACTER.EXE where they left it (7c2), from the line a sheet being made shows. */
  onContinueCreating?: () => void;
  /** Opens LEVEL_UP.EXE (7d3a), from LEVEL UP READY. */
  onOpenLevelUp?: () => void;
}

export function CharacterSheetWindow({ pos, setPos, onClose, socket, userName, playerToken, adminToken, onOpenLink, onRolled, onOpenVehicles, currentTheme, onContinueCreating, onOpenLevelUp }: CharacterSheetWindowProps) {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPos, setImportPos] = useState({ x: pos.x + 60, y: pos.y + 60 });
  const { sheet, template, handleFieldChange, handleFieldsChange, allowFumbleShield, xpRate, encumbranceEnforced, hiddenTabs, actions } =
    usePlayerSheet(socket, userName, { onRolled });
  // Why the server last said no to a pick, a level or a use (7a3b1), under the CHOICES block.
  const refused = useChoicesRefused(socket);
  const recoveryOpen = useRecoveryOpen(socket);

  const handlePortraitUpload = useCallback(
    (file: File) => uploadSheetPortrait(adminToken || playerToken, file),
    [adminToken, playerToken],
  );

  return (
    <>
    <DraggableWindow
      title={`SHEET.EXE · ${userName.toUpperCase()}`}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      titleControls={
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Where you are, not what you own — the seating window is the shared record,
              and this is the same fact on your own sheet, with the way out. */}
          <VehicleBadgeButton
            vehicle={sheet?.inVehicle}
            occupant={userName}
            userName={userName}
            onDisembark={(occupant) => socket?.emit('seatOut', { occupant })}
            compact
          />
          {/* A built-in game with an importer, or a custom system with SHEET IMPORT on (4h2c). */}
          {canImport(sheet?.system) && <button
            title="Import from PDF / JSON / text"
            className="win95-close-btn"
            style={{ fontSize: '9px', width: 'auto', padding: '0 5px' }}
            onClick={() => setIsImportOpen(true)}
          >
            IMPORT
          </button>}
          {template && (
            <span style={{ border: '1px solid currentColor', padding: '0 6px', fontSize: '0.6rem', letterSpacing: '1px' }}>
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
                  theme: currentTheme ?? null,
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
      {onContinueCreating && flowState(template, sheet?.data) !== 'none' && (
        <button type="button" onClick={onContinueCreating}
          style={{ background: 'none', border: '1px solid var(--warning)', color: 'var(--warning)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 8px', margin: '4px 0', flexShrink: 0 }}>
          CREATING · CONTINUE
        </button>
      )}
      {sheet && template ? (
        <SheetRenderer
          template={withCreationLocks(template, sheet.data)}
          data={sheet.data}
          portraitUrl={sheet.portrait_url}
          onFieldChange={handleFieldChange}
          onFieldsChange={handleFieldsChange}
          gm={!!adminToken}
          onSectionAction={(id) => { if (id === 'vehicles') onOpenVehicles?.(); }}
          onPortraitUpload={(adminToken || playerToken) ? handlePortraitUpload : undefined}
          onOpenLink={onOpenLink}
          onRoll={actions.onRoll}
          onDeathSave={actions.onDeathSave}
          onStabilize={actions.onStabilize}
          onCastSpell={actions.onCastSpell}
          onRollAbility={actions.onRollAbility}
          onLevelUp={onOpenLevelUp}
          onResistDrain={actions.onResistDrain}
          allowFumbleShield={allowFumbleShield}
          xpRate={xpRate}
          encumbranceEnforced={encumbranceEnforced}
          hiddenTabs={hiddenTabs}
          onChoices={(action) => socket?.emit('choicesAction', action)}
          choicesRefused={refused}
          onLevel={(action) => socket?.emit('levelAction', action)}
          onItem={(action) => socket?.emit('itemAction', action)}
          onSpend={(action) => socket?.emit('spendAction', action)}
          onRecoverySpend={(pool, count) => socket?.emit('recoverySpend', { pool, count })}
          onRestTake={(rest) => socket?.emit('restTake', { rest })}
          recoveryOpen={recoveryOpen}
        />
      ) : (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, padding: '10px' }}>ACCESSING RECORD...</div>
      )}
    </DraggableWindow>
    {isImportOpen && ReactDOM.createPortal(
      <ImportSheetDialog
        gameSystem={sheet?.system}
        currentData={sheet?.data}
        pos={importPos}
        setPos={setImportPos}
        onClose={() => setIsImportOpen(false)}
        onApply={(fields, opts) => {
          socket?.emit('importSheetFields', {
            fields, replace: opts?.replace, cyberware: opts?.cyberware, picks: opts?.picks,
          });
        }}
      />,
      // Inside the theme, so IMPORT.EXE takes the theme's colors rather than Classic's.
      themeRoot(),
    )}
    </>
  );
}
