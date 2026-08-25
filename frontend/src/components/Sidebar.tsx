import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { themeRoot } from '../utils/themeRoot';
import kofiLogo from '../assets/kofi.png';
import { CityDataBaseMenu } from './CityDatabase';
import type { CustomDie, AttackVehicle } from '../types';
import { InitiativeWindow } from '../modules/initiative';
import { InitiativeNavPanel } from '../modules/initiative/components/InitiativeNavPanel';
import { isUserDefinedName, getStructLabel } from '../utils/locationHelpers';
import { CurrencyIcon } from './BankWindows';
import { THEMES } from '../theme/themes';
import type { ThemeName } from '../theme/themes';
import { getTemplate } from '../sheets';
import { CWN_VEHICLE_ROWS, CWN_VEHICLE_WEAPON_ROWS } from '../sheets/templates/cities_without_number';
import { hasVehicles } from '../sheets/vehicleSystems';
import { startUpdate, waitForRestart, currentBootId } from '../utils/updateClient';

// Token defense config for the active game system; default is D&D-style AC
const getTokenDefense = (gameSystem?: string) =>
  getTemplate(gameSystem || 'generic').tokenDefense ?? { editOnToken: true, label: 'AC' };

// ─── CheckUpdateButton ───────────────────────────────────────────────────────

function CheckUpdateButton({ token }: { token: string }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'update-available' | 'updating' | 'up-to-date' | 'error'>('idle');
  const [versionMessage, setVersionMessage] = useState('');
  const check = async () => {
    setStatus('checking');
    setVersionMessage('');
    if (import.meta.env.DEV) {
      await new Promise(r => setTimeout(r, 1000));
      setStatus('update-available');
      setVersionMessage('DEV: Update available: 1.1.9 → 1.2.0');
      return;
    }
    try {
      const res = await fetch('/api/check-update', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        if (data.hasUpdate) {
          setVersionMessage(data.message);
          setStatus('update-available');
        } else {
          setVersionMessage(data.message || "You're up to date");
          setStatus('up-to-date');
          setTimeout(() => setStatus('idle'), 4000);
        }
      } else {
        setStatus('error');
        setVersionMessage('Could not check for updates');
        setTimeout(() => setStatus('idle'), 4000);
      }
    } catch {
      setStatus('error');
      setVersionMessage('Connection failed');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  const applyUpdate = async () => {
    setStatus('updating');
    // Shared with the update modal. This path had its own copy and only the modal's was
    // hardened, so the nav button — the one the upgrade guide tells people to click —
    // still sat on "waiting for server" indefinitely when a stack could not update.
    const { current: originalCurrent } = await fetch('/api/check-update', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).catch(() => ({ current: '' }));

    const bootId = await currentBootId();
    const started = await startUpdate(token);
    if (!started.ok) {
      setStatus('error');
      setVersionMessage(started.command ? `${started.error} ${started.command}` : (started.error ?? 'Update failed'));
      return;
    }

    setVersionMessage('Update in progress — waiting for server...');
    await waitForRestart({
      bootId,
      currentVersion: originalCurrent,
      onRestart: () => { window.location.href = `/?v=${Date.now()}`; },
      onStillWorking: () => setVersionMessage('Still working — pulling images, this can take a few minutes...'),
      onFailed: (error, cmd) => {
        setStatus('error');
        setVersionMessage(cmd ? `${error} ${cmd}` : error);
      },
    });
  };

  const btnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: '0.6rem', opacity: 0.7, letterSpacing: '1px', marginTop: '4px', padding: 0 };

  if (status === 'idle') {
    return (
      <button onClick={check} style={{ ...btnStyle, textDecoration: 'underline' }}>
        Check for update
      </button>
    );
  }

  if (status === 'checking') {
    return <span style={{ ...btnStyle, cursor: 'default' }}>CHECKING...</span>;
  }

  if (status === 'up-to-date') {
    return <span style={{ ...btnStyle, cursor: 'default' }}>{versionMessage}</span>;
  }

  if (status === 'update-available') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
        <span style={{ color: 'var(--green)', fontSize: '0.6rem', opacity: 0.7, letterSpacing: '1px', textAlign: 'center' }}>{versionMessage}</span>
        <button onClick={applyUpdate} style={{ ...btnStyle, marginTop: 0, textDecoration: 'underline' }}>
          UPDATE NOW (DOCKER ONLY)
        </button>
        <a href="https://github.com/over2take/CITY_NET/blob/main/UPGRADE.md" target="_blank" rel="noreferrer" style={{ fontSize: '0.6rem', opacity: 0.5, letterSpacing: '1px', color: 'var(--green)' }}>UPGRADE GUIDE ↗</a>
      </div>
    );
  }

  if (status === 'updating') {
    return <span style={{ ...btnStyle, cursor: 'default' }}>{versionMessage || 'UPDATING...'}</span>;
  }

  // error
  return <span style={{ ...btnStyle, cursor: 'default', color: '#ff4444' }}>{versionMessage}</span>;
}

// ─── NavControlsMenu ─────────────────────────────────────────────────────────

interface NavControlsMenuProps {
  onToggleHelp: (val: boolean) => void;
}

export function NavControlsMenu({ onToggleHelp }: NavControlsMenuProps) {
  return (
    <div className="panel sidebar-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>NAV_CONTROLS</h3>
        <button onClick={() => onToggleHelp(false)} className="close-btn" style={{ position: 'static' }}>◀</button>
      </header>
      <div style={{ fontSize: '0.75rem', lineHeight: '1.6' }}>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>PAN / MOVE VIEW</span><br />LEFT-CLICK + DRAG
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>GIMBALL / ROTATE</span><br />RIGHT-CLICK + DRAG
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>ZOOM IN/OUT</span><br />SCROLL WHEEL — zooms toward cursor<br />MIDDLE-CLICK + DRAG — drag-zoom toward cursor
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>SPOT / PING LOCATION</span><br />Q KEY (Targets Cursor)
        </div>
        <div style={{ opacity: 0.7, fontSize: '0.65rem' }}>* Zoom targets your cursor position</div>
      </div>
    </div>
  );
}

// ─── GeometryMenu ─────────────────────────────────────────────────────────────

interface GeometryMenuProps {
  rhombusState: any;
  setRhombusState: (s: any) => void;
  selectedLocation: any;
  setSelectedLocation: (loc: any) => void;
  refreshLocations: () => void;
  token: string;
  userName: string;
  locations: any[];
  socketRef: React.MutableRefObject<any>;
  syncRhombusToDB: (s: any) => void;
  view: string;
  activeBattleMapData: any;
  measureMode: boolean;
  setMeasureMode: (v: boolean) => void;
  isSheetOpen: boolean;
  setIsSheetOpen: (v: boolean) => void;
  isVehiclesOpen?: boolean;
  setIsVehiclesOpen?: (v: boolean) => void;
  isEnemyVehiclesOpen?: boolean;
  setIsEnemyVehiclesOpen?: (v: boolean) => void;
  gameSystem?: string;
}

export function GeometryMenu({ rhombusState, setRhombusState, selectedLocation, setSelectedLocation, refreshLocations, token, userName, locations, socketRef, syncRhombusToDB, view, activeBattleMapData, measureMode, setMeasureMode, isSheetOpen, setIsSheetOpen, isVehiclesOpen, setIsVehiclesOpen, isEnemyVehiclesOpen, setIsEnemyVehiclesOpen, gameSystem }: GeometryMenuProps) {
  const userRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName && (
    view === 'battle_map' && activeBattleMapData
      ? (l.battle_map_id == activeBattleMapData.locationId && l.floor_index == activeBattleMapData.currentFloorIndex)
      : l.battle_map_id == null
  ));
  const isSelectedRhombus = selectedLocation?.shape === 'rhombus';
  const isAdmin = token !== '';
  const isOwner = selectedLocation?.owner === userName;
  const canRemoveSelected = isSelectedRhombus && (isAdmin || isOwner);

  const [acMelee, setAcMelee] = useState('');
  const [acRanged, setAcRanged] = useState('');
  const tokenDefense = getTokenDefense(gameSystem);

  // Any rhombus the player owns on any map — used for AC/settings regardless of current view
  const anyUserRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);

  // Pre-populate AC fields from the player's rhombus (any map)
  React.useEffect(() => {
    if (anyUserRhombus) {
      setAcMelee(anyUserRhombus.melee_ac != null ? String(anyUserRhombus.melee_ac) : '');
      setAcRanged(anyUserRhombus.ranged_ac != null ? String(anyUserRhombus.ranged_ac) : '');
    }
  }, [anyUserRhombus?.id, anyUserRhombus?.melee_ac, anyUserRhombus?.ranged_ac]);

  // Color autosaves (debounced) — name/description come from the character sheet
  const colorSyncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!anyUserRhombus || anyUserRhombus.color === rhombusState.color) return;
    if (colorSyncTimer.current) clearTimeout(colorSyncTimer.current);
    colorSyncTimer.current = setTimeout(() => syncRhombusToDB(rhombusState), 400);
    return () => { if (colorSyncTimer.current) clearTimeout(colorSyncTimer.current); };
  }, [rhombusState.color]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSet = async () => {
    const target = anyUserRhombus;
    if (target) {
      // HP max
      if (rhombusState.hp_max > 0) {
        await fetch(`/api/locations/${target.id}/health`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ action: 'set_max', hp_max: rhombusState.hp_max }),
        });
      }
      // AC - only when the active system edits defense on the token
      if (tokenDefense.editOnToken) {
        const meleeVal = acMelee === '' ? null : parseInt(acMelee, 10);
        const rangedVal = acRanged === '' ? null : parseInt(acRanged, 10);
        await fetch(`/api/locations/${target.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ ...target, melee_ac: meleeVal, ranged_ac: rangedVal }),
        });
      }
      refreshLocations();
    }
  };

  const removeRhombus = async (id: number) => {
    if (socketRef.current) {
      socketRef.current.emit('requestRhombusPurge', { id, owner: userName });
      if (selectedLocation?.id === id) setSelectedLocation(null);
    } else {
      const res = await fetch(`/api/locations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (selectedLocation?.id === id) setSelectedLocation(null);
        refreshLocations();
      }
    }
  };

  const isDefaultColor = rhombusState.color === '#00ff00';

  return (
    <div className="panel sidebar-panel">
      <style>{`@keyframes rainbowHue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }`}</style>
      <header style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>TOKEN_PROTOCOLS</h3>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>

        {/* 1 — Rhombus deploy button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          <button
            className={`rhombus-trigger-btn ${rhombusState.active ? 'active' : ''} ${userRhombus ? 'disabled' : ''}`}
            onClick={() => !userRhombus && setRhombusState((p: any) => ({ ...p, active: !p.active }))}
            disabled={!!userRhombus}
            style={{ color: rhombusState.color }}
          >
            <svg width="60" height="60" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5.219 11.34l5.96-7.925a1.02 1.02 0 0 1 1.642 0l5.96 7.925c.292.388.292.932 0 1.32l-5.96 7.925a1.02 1.02 0 0 1-1.642 0L5.22 12.66a1.1 1.1 0 0 1 0-1.32" />
            </svg>
            <span style={{ fontSize: '0.6rem', marginTop: '10px', display: 'block' }}>
              {userRhombus ? 'TOKEN_PLACED' : (rhombusState.active ? 'CLICK MAP TO PLACE' : 'PLACE_MY_TOKEN')}
            </span>
          </button>
          {rhombusState.active && !userRhombus && (
            <span style={{ fontSize: '0.6rem', opacity: 0.6, letterSpacing: '1px' }}>place user token</span>
          )}
        </div>

        {/* 2 — Color (autosaves; name/description live on the character sheet) */}
        <div style={{ width: '100%' }}>
          <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>TOKEN_COLOR</label>
          <input
            type="color"
            value={rhombusState.color}
            onChange={(e) => setRhombusState({ ...rhombusState, color: e.target.value })}
            style={{
              width: '100%', height: '40px', background: 'none',
              border: '1px solid var(--green)', cursor: 'pointer',
              animation: isDefaultColor ? 'rainbowHue 4s linear infinite' : 'none',
            }}
          />
        </div>

        {/* 3 — Remove */}
        {userRhombus && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(userRhombus.id)} style={{ width: '100%', fontSize: '0.65rem' }}>REMOVE_MY_TOKEN</button>
        )}
        {canRemoveSelected && selectedLocation?.id !== userRhombus?.id && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(selectedLocation.id)} style={{ width: '100%', fontSize: '0.65rem' }}>REMOVE_SELECTED_TOKEN</button>
        )}

        {/* 4 — Character sheet: source of truth for name and description */}
        <button
          className={`upload-btn ${isSheetOpen ? 'active' : ''}`}
          onClick={() => setIsSheetOpen(!isSheetOpen)}
          style={{ width: '100%', fontSize: '0.65rem' }}
        >
          CHARACTER_SHEET
        </button>

        {/* Vehicles are a CWN feature; other systems have no roster to show. */}
        {hasVehicles(gameSystem) && setIsVehiclesOpen && (
          <button
            className={`upload-btn ${isVehiclesOpen ? 'active' : ''}`}
            onClick={() => setIsVehiclesOpen(!isVehiclesOpen)}
            style={{ width: '100%', fontSize: '0.65rem' }}
          >
            VEHICLES
          </button>
        )}

        {/* Enemy vehicles are the GM's, so the way in is too. */}
        {hasVehicles(gameSystem) && isAdmin && setIsEnemyVehiclesOpen && (
          <button
            className={`upload-btn ${isEnemyVehiclesOpen ? 'active' : ''}`}
            onClick={() => setIsEnemyVehiclesOpen(!isEnemyVehiclesOpen)}
            style={{ width: '100%', fontSize: '0.65rem' }}
          >
            ENEMY VEHICLES
          </button>
        )}

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* 5 — Max health */}
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>MAX HEALTH</label>
            <input
              type="number"
              placeholder="100"
              value={rhombusState.hp_max || ''}
              onChange={(e) => setRhombusState({ ...rhombusState, hp_max: parseInt(e.target.value) || 0 })}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 0 }}
            />
          </div>

          {/* 6 — Defense fields. What shows depends on the active game
              system's tokenDefense: D&D-likes edit AC here; systems whose
              armor lives on the sheet (CP:R SP) get a pointer instead. */}
          {tokenDefense.editOnToken ? (
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>ARMOR_CLASS</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', opacity: 0.8, whiteSpace: 'nowrap' }}>MELEE</span>
                <input
                  type="number"
                  min="0"
                  placeholder="10"
                  value={acMelee}
                  onChange={e => setAcMelee(e.target.value)}
                  style={{ width: '48px', marginBottom: 0, textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.65rem', opacity: 0.8, whiteSpace: 'nowrap' }}>RANGED</span>
                <input
                  type="number"
                  min="0"
                  placeholder={acMelee !== '' ? acMelee : '10'}
                  value={acRanged}
                  onChange={e => setAcRanged(e.target.value)}
                  style={{ width: '48px', marginBottom: 0, textAlign: 'center' }}
                />
                <span title="Leave blank to use Melee AC" style={{ cursor: 'help', color: 'var(--green)', fontSize: '12px' }}>?</span>
              </div>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>ARMOR</label>
              <button
                className="upload-btn"
                style={{ width: '100%', fontSize: '0.65rem', padding: '5px' }}
                onClick={() => setIsSheetOpen(true)}
              >
                {tokenDefense.note ?? 'MANAGED ON YOUR CHARACTER_SHEET'}
              </button>
            </div>
          )}

          {/* 7 — SET button (health/armor only — color autosaves, identity
              comes from the character sheet) */}
          <button className="upload-btn" style={{ width: '100%', marginTop: '4px' }} onClick={handleSet}>
            SAVE_STATS
          </button>

        </div>

        <div className="info-box" style={{ fontSize: '0.65rem', opacity: 0.8, lineHeight: '1.6', borderTop: '1px solid var(--dark-green)', paddingTop: '15px', width: '100%' }}>
          <p style={{ color: 'var(--green)', fontWeight: 'bold', marginBottom: '5px' }}>INTERFACE_GUIDE:</p>
          <p>• [CLICK MAP] TO PLACE YOUR TOKEN</p>
          <p>• [CLICK & DRAG] TO REPOSITION</p>
          <p>• [REMOVE TOKEN] TO CLEAR YOUR PLACEMENT</p>
        </div>
      </div>
    </div>
  );
}

// ─── SystemInfoMenu ───────────────────────────────────────────────────────────

interface SystemInfoMenuProps {
  userName: string;
  token: string;
  currentTheme?: ThemeName;
  onThemeChange?: (theme: ThemeName) => void;
}

export function SystemInfoMenu({ userName, token, currentTheme, onThemeChange }: SystemInfoMenuProps) {
  let isPrimaryAdmin = false;
  if (token) { try { isPrimaryAdmin = !JSON.parse(atob(token.split('.')[1])).isTemporary; } catch { } }

  return (
    <div className="panel sidebar-panel">
      <header style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0, textShadow: 'var(--glow)' }}>CITY_NET</h1>
        <div style={{ fontSize: '0.65rem', opacity: 0.7, letterSpacing: '2px', marginTop: '2px' }}>NAV_OS_v{__APP_VERSION__}</div>
        {isPrimaryAdmin && <CheckUpdateButton token={token} />}
        <a href="https://github.com/over2take/CITY_NET/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer" style={{ fontSize: '0.6rem', opacity: 0.5, letterSpacing: '1px', marginTop: '2px', color: 'var(--green)' }}>CHANGELOG ↗</a>
      </header>
      <div style={{ fontSize: '0.8rem', lineHeight: '1.8', borderTop: '1px solid var(--dark-green)', paddingTop: '15px' }}>
        <div style={{ marginBottom: '10px' }}>
          <span style={{ opacity: 0.6 }}>OPERATOR_ID:</span><br />
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>{userName}</span>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <span style={{ opacity: 0.6 }}>ACCESS_LEVEL:</span><br />
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>{token ? 'ADMIN_PRIVILEGES' : 'UNPRIVILEGED_USER'}</span>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <span style={{ opacity: 0.6 }}>THEME:</span><br />
          {onThemeChange && currentTheme ? (
            <select 
              value={currentTheme}
              onChange={(e) => onThemeChange(e.target.value as ThemeName)}
              style={{ background: 'transparent', color: 'var(--green)', border: '1px solid var(--green)', padding: '2px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {(Object.keys(THEMES) as ThemeName[]).map(key => (
                <option key={key} value={key} style={{ background: 'var(--black)' }}>
                  {THEMES[key].name}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ color: 'var(--green)' }}>{THEMES[currentTheme || 'classic']?.name || 'Classic'}</span>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '15px', fontSize: '0.7rem' }}>
          <span style={{ opacity: 0.6 }}>LICENSE:</span><br />
          <span style={{ color: 'var(--green)' }}>AGPL-3.0 — open source</span><br />
          <a href="https://github.com/over2take/CITY_NET" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', opacity: 0.7, fontSize: '0.65rem', letterSpacing: '1px' }}>
            SOURCE_CODE ↗
          </a>
        </div>
        <div style={{ borderTop: '1px solid var(--dark-green)', paddingTop: '15px', marginTop: '15px', textAlign: 'center' }}>
          <div style={{ opacity: 0.6, fontSize: '0.65rem', letterSpacing: '1px', marginBottom: '8px' }}>SUPPORT THE CREATOR: Over2Take</div>
          <a href="https://ko-fi.com/over2take" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
            <img src={kofiLogo} alt="Support on Ko-fi" style={{ height: '32px', filter: 'brightness(0) saturate(100%) invert(62%) sepia(98%) saturate(400%) hue-rotate(90deg) brightness(0.9)', opacity: 0.85, transition: 'opacity 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
            />
          </a>
          <div style={{ marginTop: '6px' }}>
            <a href="https://ko-fi.com/over2take" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', opacity: 0.7, fontSize: '0.6rem', letterSpacing: '1px' }}>
              ko-fi.com/over2take ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sheet attack panel (CP:R + CWN) ─────────────────────────────────────────
// Sheet-driven attacks resolve in one server round-trip: pick one of your
// sheet's weapon rows and fire; the server rolls everything against stored
// data. Per-system extras: CP:R adds the aimed shot (−8, head, x2 through
// armor) and declared LUCK; CWN is weapon-only (trauma/shock resolve
// server-side per the house rules) but adds the mounts on its sheet vehicles,
// which fire through the same server path as a carried weapon.
const ATTACK_PANEL_CONFIG = {
  cyberpunk_red: {
    dmgExample: '3d6',
    meleeSkills: ['melee_weapon', 'brawling', 'martial_arts'],
    hasAimed: true,
    hasLuck: true,
    vehicles: null,
  },
  cities_without_number: {
    dmgExample: '1d8+1',
    meleeSkills: ['stab', 'punch'],
    hasAimed: false,
    hasLuck: false,
    // Counts come from the template rather than being repeated here: listing
    // fewer than the sheet declares makes the last vehicles' mounts unfireable
    // with nothing to show for it.
    vehicles: { rows: CWN_VEHICLE_ROWS, weaponRows: CWN_VEHICLE_WEAPON_ROWS },
  },
  shadowrun_6e: {
    dmgExample: '3P',
    meleeSkills: ['close_combat'],
    hasAimed: false,
    hasLuck: false,
    vehicles: null,
  },
} as const;

/** Systems whose attacks resolve from sheet weapon rows (one ATTACK button,
 *  weapon picked in the dice menu). Adding a config entry above lights up
 *  the whole flow - no scattered system checks to update. */
export const hasSheetCombat = (system: string | undefined): system is keyof typeof ATTACK_PANEL_CONFIG =>
  !!system && system in ATTACK_PANEL_CONFIG;

/** One firable thing: a weapon row on the sheet, or a mount on one of its
 *  vehicles. A mount carries the vehicle it belongs to; the server reads the
 *  mount's fields through the same code path either way. */
type WeaponChoice = {
  key: string;
  index: number;
  vehicleIndex?: number;
  /** A mount on the vehicle you are riding in — the row lives on its owner's sheet, so
   *  the server resolves it from your declared ride rather than from an index. */
  rideMount?: boolean;
  /** Driving into something. Not an attack: no skill, no to-hit, so it leaves the panel
   *  by its own event and the ordinary attack controls do not apply to it. */
  ram?: boolean;
  vehicleName?: string;
  name: string;
  dmg: string;
  skill: string;
};

/** A row is firable only with both DMG and SKILL set — the same bar the server
 *  applies, so an incomplete row is left out rather than offered and refused. */
const readWeapon = (data: any, prefix: string) => {
  const dmg = String(data?.[`${prefix}_dmg`] ?? '').trim();
  const skill = String(data?.[`${prefix}_skill`] ?? '');
  if (!dmg || !skill) return null;
  return { name: String(data?.[`${prefix}_name`] ?? '').trim(), dmg, skill };
};

export function SheetAttackPanel({ system, userName, socketRef, targetId, rhombusState, setIsDiceTrayOpen }: {
  system: keyof typeof ATTACK_PANEL_CONFIG;
  userName: string;
  socketRef: React.MutableRefObject<any>;
  targetId: number;
  rhombusState: any;
  setIsDiceTrayOpen: (v: any) => void;
}) {
  const cfg = ATTACK_PANEL_CONFIG[system];
  // `key` rather than `index`, because a mount is identified by the pair
  // (vehicle, mount) and the index alone stopped being unique.
  const [weapons, setWeapons] = useState<WeaponChoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [aimed, setAimed] = useState(false);
  const [luckAvailable, setLuckAvailable] = useState(0);
  const [luckSpend, setLuckSpend] = useState(0);
  const [luckNegate, setLuckNegate] = useState(false);
  const [allowFumbleShield, setAllowFumbleShield] = useState(false);

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    const onSheetData = (sheet: any) => {
      if (!sheet || sheet.username !== userName) return;
      const rows: WeaponChoice[] = [];
      for (let i = 1; i <= 4; i++) {
        const row = readWeapon(sheet.data, `weapon${i}`);
        if (row) rows.push({ key: String(i), index: i, name: row.name || `WEAPON ${i}`, dmg: row.dmg, skill: row.skill });
      }
      // The mounts of someone else's car, sent down by the server because a gunner
      // cannot see the sheet they live on.
      if (cfg.vehicles && sheet.ride) {
        for (const m of sheet.ride.mounts ?? []) {
          rows.push({
            key: `r:${m.index}`, index: m.index, rideMount: true,
            vehicleName: String(sheet.ride.vehicleName ?? '').trim() || 'THEIR VEHICLE',
            name: String(m.name ?? '').trim() || `MOUNT ${m.index}`,
            dmg: String(m.dmg ?? ''), skill: String(m.skill ?? ''),
          });
        }
      }
      // Ramming is the driver's weapon, and only the driver's — the server decides that
      // from the seat, this only decides whether to offer it.
      if (sheet.driving) {
        rows.push({
          key: 'ram', index: 0, ram: true,
          vehicleName: String(sheet.driving.name ?? '').trim() || 'YOUR VEHICLE',
          name: 'RAM', dmg: '6d6', skill: '',
        });
      }
      // Mounts come after the carried weapons and are labelled with their
      // vehicle, since firing a turret is a different act from drawing a gun.
      if (cfg.vehicles) {
        for (let v = 1; v <= cfg.vehicles.rows; v++) {
          const vehicleName = String(sheet.data?.[`vehicle${v}_name`] ?? '').trim() || `VEHICLE ${v}`;
          for (let w = 1; w <= cfg.vehicles.weaponRows; w++) {
            const row = readWeapon(sheet.data, `vehicle${v}_weapon${w}`);
            if (row) rows.push({ key: `v${v}:${w}`, index: w, vehicleIndex: v, vehicleName, name: row.name || `MOUNT ${w}`, dmg: row.dmg, skill: row.skill });
          }
        }
      }
      setWeapons(rows);
      setSelected(prev => (prev !== null && rows.some(r => r.key === prev)) ? prev : (rows[0]?.key ?? null));
      if (cfg.hasLuck) {
        const luck = Number(sheet.data?.luck) || 0;
        setLuckAvailable(luck);
        setLuckSpend(prev => Math.min(prev, luck));
      }
    };
    s.on('sheetData', onSheetData);
    s.emit('requestMySheet');
    if (cfg.hasLuck) {
      fetch('/api/settings').then(r => r.json()).then((rows) => {
        if (Array.isArray(rows)) {
          setAllowFumbleShield(rows.find((r: any) => r.key === 'luck_negates_fumble')?.value === '1');
        }
      }).catch(() => {});
    }
    return () => { s.off('sheetData', onSheetData); };
  }, [userName, system]); // eslint-disable-line react-hooks/exhaustive-deps

  const fire = () => {
    if (selected === null) return;
    const choice = weapons.find(w => w.key === selected);
    if (!choice) return;
    if (choice.ram) {
      // Both vehicles take it and everyone aboard both is injured, so this is resolved
      // whole by the server rather than run through the attack path.
      socketRef.current?.emit('ramVehicle', { targetId });
      setIsDiceTrayOpen(true);
      return;
    }
    socketRef.current?.emit('sheetAttack', {
      targetId,
      weaponIndex: choice.index,
      ...(choice.vehicleIndex ? { vehicleIndex: choice.vehicleIndex } : {}),
      ...(choice.rideMount ? { rideMount: true } : {}),
      ...(cfg.hasAimed ? { aimed } : {}),
      ...(cfg.hasLuck ? {
        luck: luckSpend > 0 ? luckSpend : undefined,
        luckNegate: luckNegate || undefined,
      } : {}),
      color: rhombusState?.color || '#00ff00',
    });
    setLuckSpend(0);
    setLuckNegate(false);
    setIsDiceTrayOpen(true);
  };

  if (weapons.length === 0) {
    return (
      <div style={{ color: '#888', fontSize: '0.7rem', marginBottom: '6px' }}>
        NO USABLE WEAPONS — set NAME, DMG (e.g. {cfg.dmgExample}) and SKILL on your CHARACTER_SHEET weapons rows.
      </div>
    );
  }
  const chosen = weapons.find(w => w.key === selected);
  // A ram is melee — you drive into the thing. It carries no skill, so it would otherwise
  // fall through this check and be labelled as a shot.
  const isMelee = !!chosen?.ram || (cfg.meleeSkills as readonly string[]).includes(chosen?.skill ?? '');
  // A ram has no to-hit roll, so nothing that modifies one belongs on screen for it.
  const isRam = !!chosen?.ram;
  return (
    <div style={{ marginBottom: '6px' }}>
      <select
        aria-label="Weapon"
        value={selected ?? ''}
        onChange={(e) => setSelected(e.target.value)}
        style={{ width: '100%', background: 'rgba(0,10,0,0.7)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px', marginBottom: '5px' }}
      >
        {weapons.map(w => (
          <option key={w.key} value={w.key}>
            {w.vehicleName ? `${w.vehicleName.toUpperCase()} · ` : ''}{w.name.toUpperCase()} · {w.dmg}
            {w.skill ? ` · ${w.skill.replace(/_/g, ' ').toUpperCase()}` : ''}
          </option>
        ))}
      </select>
      {cfg.hasAimed && !isRam && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--green)', marginBottom: '6px', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={aimed} onChange={(e) => setAimed(e.target.checked)} />
          AIMED SHOT (−8 · HEAD · x2 DMG THROUGH ARMOR)
        </label>
      )}
      {cfg.hasLuck && !isRam && luckAvailable > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: luckSpend > 0 ? 'var(--vehicle)' : 'var(--green)', marginBottom: '6px', userSelect: 'none' }} title="Declared before the roll: adds a flat bonus and negates a natural-1 fumble">
          LUCK
          <select
            aria-label="Spend LUCK"
            value={luckSpend}
            onChange={(e) => setLuckSpend(Number(e.target.value))}
            style={{ background: 'rgba(0,10,0,0.7)', color: 'inherit', border: '1px solid currentColor', fontFamily: 'inherit', fontSize: '0.7rem', padding: '1px 3px' }}
          >
            {Array.from({ length: luckAvailable + 1 }, (_, n) => (
              <option key={n} value={n}>{n === 0 ? 'NONE' : `+${n}`}</option>
            ))}
          </select>
          {allowFumbleShield && (
            <span title="Burn 1 more LUCK: a natural 1 is not a critical fumble (no bonus)" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.6rem' }}>
              <input type="checkbox" checked={luckNegate} onChange={(e) => setLuckNegate(e.target.checked)} disabled={luckAvailable < 1} />
              SHIELD NAT-1 (+1 LUCK)
            </span>
          )}
        </label>
      )}
      <button className="upload-btn" style={{ width: '100%', padding: '6px', backgroundColor: '#cc2200', color: '#fff', fontWeight: 'bold' }} onClick={fire}>
        {isMelee ? (system === 'cities_without_number' ? 'STRIKE' : 'SWING') : 'FIRE'}
      </button>
    </div>
  );
}

// ─── DiceMenu ─────────────────────────────────────────────────────────────────

interface DiceMenuProps {
  userName: string;
  token?: string;
  customDice?: CustomDie[];
  onOpenCustomDieBuilder?: (die?: CustomDie) => void;
  onDeleteCustomDie?: (id: number | string) => void;
  socketRef: React.MutableRefObject<any>;
  rhombusState: any;
  setIsDiceTrayOpen: (v: any) => void;
  setNotification: (msg: string) => void;
  attackPending?: { targetId: number; targetName: string; attackType: 'melee' | 'ranged'; ac: number; vehicle?: AttackVehicle | null } | null;
  onCancelAttack?: () => void;
  gameSystem?: string;
}

export function DiceMenu({ userName, token, socketRef, rhombusState, setIsDiceTrayOpen, setNotification, attackPending, onCancelAttack, gameSystem, customDice = [], onOpenCustomDieBuilder, onDeleteCustomDie }: DiceMenuProps) {
  const isAdmin = !!token;
  const defenseLabel = getTokenDefense(gameSystem).label;
  const diceTypes = [2, 4, 6, 8, 10, 12, 20, 100];
  const [diceCounts, setDiceCounts] = useState<Record<number, number>>({});
  const [customCounts, setCustomCounts] = useState<Record<string, number>>({});
  const [workingMod, setWorkingMod] = useState<number>(0);
  const [modifiers, setModifiers] = useState<number[]>([]);

  const totalDice = Object.values(diceCounts).reduce((a, b) => a + b, 0);
  const totalCustomDice = Object.values(customCounts).reduce((a, b) => a + b, 0);
  const canRoll = totalDice > 0 || totalCustomDice > 0;

  const handleAddDice = (sides: number) => {
    setDiceCounts(prev => ({ ...prev, [sides]: (prev[sides] || 0) + 1 }));
  };

  const handleSubDice = (sides: number) => {
    setDiceCounts(prev => {
      const current = prev[sides] || 0;
      if (current <= 0) return prev;
      return { ...prev, [sides]: current - 1 };
    });
  };

  const handleAddCustom = (id: number | string) => {
    setCustomCounts(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const handleSubCustom = (id: number | string) => {
    setCustomCounts(prev => {
      const current = prev[id] || 0;
      if (current <= 0) return prev;
      return { ...prev, [id]: current - 1 };
    });
  };

  const handleRoll = () => {
    if (!canRoll) {
      setNotification("INVALID_ROLL: SELECT_DICE");
      return;
    }
    const color = rhombusState?.color || '#00ff00';
    if (socketRef.current) {
      if (totalDice > 0) {
        socketRef.current.emit('requestDiceRoll', { userName, diceCounts, modifiers, color });
      }
      for (const [id, count] of Object.entries(customCounts)) {
        if (count <= 0) continue;
        // Object keys are strings, so recover the die's real id (number for GM
        // dice, `builtin:` string for system dice). The server resolves the
        // definition itself; only the id travels.
        const die = customDice.find(d => String(d.id) === id);
        if (!die) continue;
        socketRef.current.emit('requestCustomDiceRoll', { userName, dieId: die.id, count, color });
      }
    }
    setDiceCounts({});
    setCustomCounts({});
    setModifiers([]);
    setIsDiceTrayOpen(true);
  };

  return (
    <div className="panel sidebar-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexShrink: 0 }}>
        <h3 style={{ margin: 0 }}>DICE_ROLLER</h3>
      </header>

      {attackPending && (
        <div style={{ marginBottom: '10px', padding: '8px 10px', border: '1px solid #cc2200', background: 'rgba(30,0,0,0.7)', flexShrink: 0 }}>
          <div style={{ color: '#ff4444', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', letterSpacing: '1px' }}>
            ATTACK ROLL — vs {attackPending.targetName}
          </div>
          {attackPending.vehicle && (
            // Shown before the shot, not after: an attacker who cannot see the car has
            // no way to know why their damage vanished.
            <div style={{ color: 'var(--vehicle)', fontSize: '0.7rem', marginBottom: '6px', letterSpacing: '0.5px' }}>
              TARGET IN VEHICLE — {attackPending.vehicle.name.toUpperCase()} ·{' '}
              {attackPending.vehicle.moving ? 'MOVING' : 'STATIONARY'} · AC {attackPending.vehicle.ac} · AR{' '}
              {attackPending.vehicle.armorRating} · {attackPending.vehicle.hp}/{attackPending.vehicle.hpMax} HP
              {(attackPending.vehicle.occupants?.length ?? 0) > 1 && (
                <div style={{ marginTop: '2px' }}>
                  ABOARD: {attackPending.vehicle.occupants!.join(', ').toUpperCase()}
                </div>
              )}
              <div style={{ color: '#888', marginTop: '2px' }}>
                DAMAGE HITS THE VEHICLE UNTIL IT IS DESTROYED
              </div>
            </div>
          )}
          <div style={{ color: 'var(--green)', fontSize: '0.75rem', marginBottom: '6px' }}>
            {hasSheetCombat(gameSystem)
              ? 'PICK A WEAPON — TO-HIT, DAMAGE & ARMOR RESOLVE AUTOMATICALLY'
              : isAdmin
                ? `${attackPending.attackType.toUpperCase()} · ${defenseLabel} ${attackPending.ac} · Roll ${attackPending.ac}+ to hit`
                : attackPending.attackType.toUpperCase()}
          </div>
          {hasSheetCombat(gameSystem) && (
            <SheetAttackPanel
              system={gameSystem}
              userName={userName}
              socketRef={socketRef}
              targetId={attackPending.targetId}
              rhombusState={rhombusState}
              setIsDiceTrayOpen={setIsDiceTrayOpen}
            />
          )}
          <button className="upload-btn" style={{ width: '100%', padding: '5px', fontSize: '0.75rem', backgroundColor: 'transparent', color: '#888', border: '1px solid #444' }} onClick={() => { socketRef.current?.emit('cancelAttack'); onCancelAttack?.(); }}>
            CANCEL ATTACK
          </button>
        </div>
      )}

      <div style={{ flex: '0 1 auto', overflowY: 'auto', marginBottom: '10px', paddingRight: '5px' }}>
        {diceTypes.map(sides => (
          <div key={sides} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,10,0,0.5)', padding: '5px 10px', marginBottom: '5px', borderRadius: '4px', border: '1px solid var(--dark-green)' }}>
            <span style={{ fontWeight: 'bold', color: 'var(--cyan)', width: '40px' }}>d{sides}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button className="upload-btn" style={{ minWidth: '30px', padding: '0 5px' }} onClick={() => handleSubDice(sides)}>-</button>
              <span style={{ width: '20px', textAlign: 'center' }}>{diceCounts[sides] || 0}</span>
              <button className="upload-btn" style={{ minWidth: '30px', padding: '0 5px' }} onClick={() => handleAddDice(sides)}>+</button>
            </div>
          </div>
        ))}

        {/* Custom dice */}
        {customDice.length > 0 && (
          <div style={{ borderTop: '1px solid #1a3a1a', marginTop: '6px', paddingTop: '6px' }}>
            {customDice.map(die => (
              <div key={die.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,10,0,0.5)', padding: '5px 10px', marginBottom: '5px', borderRadius: '4px', border: '1px solid #1a4a2a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <span style={{ fontWeight: 'bold', color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{die.name}</span>
                  {isAdmin && !die.locked && (
                    <>
                      <button
                        onClick={() => onOpenCustomDieBuilder?.(die)}
                        style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 2px', fontSize: '0.8rem', lineHeight: 1, flexShrink: 0 }}
                        title="Edit die"
                      >⚙</button>
                      <button
                        onClick={() => onDeleteCustomDie?.(die.id)}
                        style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: '0 2px', fontSize: '0.7rem', lineHeight: 1, flexShrink: 0 }}
                        title="Delete die"
                      >✕</button>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button className="upload-btn" style={{ minWidth: '30px', padding: '0 5px' }} onClick={() => handleSubCustom(die.id)}>-</button>
                  <span style={{ width: '20px', textAlign: 'center' }}>{customCounts[die.id] || 0}</span>
                  <button className="upload-btn" style={{ minWidth: '30px', padding: '0 5px' }} onClick={() => handleAddCustom(die.id)}>+</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <button
            className="upload-btn"
            style={{ width: '100%', marginTop: '6px', fontSize: '0.75rem', padding: '6px', borderStyle: 'dashed', color: 'var(--green)', background: 'transparent' }}
            onClick={() => onOpenCustomDieBuilder?.()}
          >
            + CUSTOM_DIE.EXE
          </button>
        )}
      </div>

      <div style={{ borderTop: '2px solid var(--dark-green)', paddingTop: '10px', marginBottom: '10px', flexShrink: 0 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--green)', marginBottom: '5px' }}>MODIFIERS</div>
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '5px' }}>
          <button className="upload-btn" style={{ flex: 1, padding: '5px' }} onClick={() => setWorkingMod(p => p - 1)}>-</button>
          <span style={{ flex: 2, textAlign: 'center', fontSize: '1.2rem', fontWeight: 'bold' }}>{workingMod > 0 ? `+${workingMod}` : workingMod}</span>
          <button className="upload-btn" style={{ flex: 1, padding: '5px' }} onClick={() => setWorkingMod(p => p + 1)}>+</button>
        </div>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button className="upload-btn" style={{ flex: 1 }} onClick={() => { if (workingMod !== 0) { setModifiers(p => [...p, workingMod]); setWorkingMod(0); } }}>ADD</button>
          <button className="upload-btn" style={{ flex: 1 }} onClick={() => { setModifiers(p => p.slice(0, -1)); }}>REMOVE LAST</button>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginTop: '5px' }}>
          {[3, 2, 1, -1, -2, -3].map(m => (
            <button key={m} className="upload-btn" style={{ flex: 1, padding: '2px', fontSize: '0.75rem' }} onClick={() => setModifiers(p => [...p, m])}>
              {m > 0 ? `+${m}` : m}
            </button>
          ))}
        </div>
        <div style={{ minHeight: '20px', background: 'rgba(0,0,0,0.5)', marginTop: '5px', padding: '5px', fontSize: '0.75rem', wordBreak: 'break-all' }}>
          {modifiers.length > 0 ? modifiers.map(m => m > 0 ? `+${m}` : m).join(' ') : 'NO MODIFIERS'}
        </div>
      </div>

      <button className="upload-btn" style={{ flexShrink: 0, padding: '15px', fontSize: '1.2rem', background: canRoll ? 'var(--green)' : 'var(--dark-green)', color: 'var(--black)', width: '100%', marginBottom: '10px' }} onClick={handleRoll}>
        ROLL DICE
      </button>

      <button className="upload-btn" style={{ flexShrink: 0, padding: '10px', fontSize: '0.8rem', width: '100%' }} onClick={() => setIsDiceTrayOpen((prev: any) => !prev)}>
        DICE_TRAY.exe
      </button>
    </div>
  );
}

// ─── QuickAccessMenu ──────────────────────────────────────────────────────────

interface QuickAccessMenuProps {
  locations: any[];
  onSelect: (loc: any) => void;
  onZoom: (target: { pos: [number, number, number]; size: number }) => void;
  selectedLocation: any;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  view: string;
  activeUsers: any[];
}

export function QuickAccessMenu({ locations, onSelect, onZoom, selectedLocation, isOpen, setIsOpen, view, activeUsers }: QuickAccessMenuProps) {
  const [showDanger, setShowDanger] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [showDistricts, setShowDistricts] = useState(false);
  const [showOthers, setShowOthers] = useState(false);

  const filteredLocations = locations.filter((l: any) => {
    if (l.shape === 'enemy_rhombus' || l.battle_map_id != null) return false;
    if (l.shape === 'rhombus' && !activeUsers?.some((u: any) => u.userName === l.owner)) return false;
    return true;
  });

  const districts: any = {};
  filteredLocations.forEach((loc: any) => {
    if (loc.district_name) {
      if (!districts[loc.district_name]) districts[loc.district_name] = { color: loc.district_color || '#00ff00', locations: [], center: [0, 0, 0], size: 0 };
      const isDefined = isUserDefinedName(loc.name) || (loc.description && loc.description.trim() !== "");
      if (isDefined && !loc.isDanger && !loc.isFavorite) districts[loc.district_name].locations.push(loc);
    }
  });
  Object.keys(districts).forEach(name => {
    const members = filteredLocations.filter((l: any) => l.district_name === name);
    if (members.length > 0) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
      members.forEach((l: any) => { minX = Math.min(minX, l.x - l.width / 2); maxX = Math.max(maxX, l.x + l.width / 2); minZ = Math.min(minZ, l.z - l.depth / 2); maxZ = Math.max(maxZ, l.z + l.depth / 2); minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y + l.height); });
      districts[name].center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
      districts[name].size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    }
  });

  const definedLocations = filteredLocations.filter((l: any) => !l.parent_id && (isUserDefinedName(l.name) || (l.description && l.description.trim() !== "")));
  const danger = definedLocations.filter((l: any) => l.isDanger);
  const starred = definedLocations.filter((l: any) => l.isFavorite);
  const others = definedLocations.filter((l: any) => !l.isDanger && !l.isFavorite && !l.district_name);

  const ListItem = ({ loc }: any) => (
    <div className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => onSelect(loc)} style={{ cursor: 'pointer', paddingLeft: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {!!loc.isDanger && <span style={{ color: '#ff0000', marginRight: '5px' }}>!</span>}
        {!!loc.isFavorite && <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="#ff7b00" style={{marginRight:'5px',verticalAlign:'middle',flexShrink:0}}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>}
        {isUserDefinedName(loc.name) ? loc.name : getStructLabel(loc)}
      </span>
      {view !== 'battle_map' && (
        <button className="utility-btn" onClick={(e) => { e.stopPropagation(); onZoom({ pos: [loc.x, (loc.y || 0) + (loc.height || 2) / 2, loc.z], size: Math.max(loc.width || 2, loc.height || 2, loc.depth || 2) }); }} style={{ padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer', marginLeft: '5px' }}>◎</button>
      )}
    </div>
  );

  return (
    <div className="panel quick-access-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>QUICK_ACCESS</h3>
        <button onClick={() => setIsOpen(false)} className="close-btn" style={{ position: 'static' }}>◀</button>
      </header>
      <button
        className="utility-btn"
        style={{ width: '100%', marginBottom: '10px' }}
        onClick={() => onZoom({ pos: [0, 0, 0], size: 80 })}
      >⌂ RETURN_TO_ORIGIN</button>
      <div className="location-list" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        {danger.length > 0 && (
          <>
            <h4 className="category-header danger-text" onClick={() => setShowDanger(!showDanger)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '20px', display: 'inline-block' }}>{showDanger ? '▼' : '▶'}</span>!! CRITICAL_SITES ({danger.length})
            </h4>
            {showDanger && danger.map((loc: any) => <ListItem key={loc.id} loc={loc} />)}
          </>
        )}
        {starred.length > 0 && (
          <>
            <h4 className="category-header starred-text" onClick={() => setShowStarred(!showStarred)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '20px', display: 'inline-block' }}>{showStarred ? '▼' : '▶'}</span><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{marginRight:'5px',verticalAlign:'middle'}}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg> PRIORITY_NODES ({starred.length})
            </h4>
            {showStarred && starred.map((loc: any) => <ListItem key={loc.id} loc={loc} />)}
          </>
        )}
        {Object.keys(districts).length > 0 && (
          <>
            <h4 className="category-header" onClick={() => setShowDistricts(!showDistricts)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '20px', display: 'inline-block' }}>{showDistricts ? '▼' : '▶'}</span>DISTRICT_ZONES
            </h4>
            {showDistricts && Object.entries(districts).map(([name, data]: any) => (
              <div key={name} style={{ marginBottom: '10px' }}>
                <div style={{ color: data.color, fontSize: '0.65rem', fontWeight: 'bold', paddingLeft: '20px', marginBottom: '5px', borderLeft: `2px solid ${data.color}`, marginLeft: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{name.toUpperCase()}</span>
                  {view !== 'battle_map' && (
                    <button className="utility-btn" onClick={(e) => { e.stopPropagation(); onZoom({ pos: data.center, size: data.size }); }} style={{ padding: '4px 10px', fontSize: '0.7rem', cursor: 'pointer', color: data.color, borderColor: data.color }}>◎</button>
                  )}
                </div>
                {data.locations.length > 0 ? data.locations.map((loc: any) => <ListItem key={loc.id} loc={loc} />) : <div style={{ fontSize: '0.6rem', opacity: 0.5, paddingLeft: '35px' }}>NO_DEFINED_DATA</div>}
              </div>
            ))}
          </>
        )}
        {others.length > 0 && (
          <>
            <h4 className="category-header" onClick={() => setShowOthers(!showOthers)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <span style={{ width: '20px', display: 'inline-block' }}>{showOthers ? '▼' : '▶'}</span>DEFINED_STRUCTURES ({others.length})
            </h4>
            {showOthers && others.map((loc: any) => <ListItem key={loc.id} loc={loc} />)}
          </>
        )}
        {definedLocations.length === 0 && Object.keys(districts).length === 0 && (
          <p style={{ fontSize: '0.7rem', opacity: 0.5 }}>NO_DEFINED_DATA_POINTS</p>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  activeMenu: string;
  setActiveMenu: (v: any) => void;
  locations: any[];
  onSelect: (loc: any) => void;
  onZoom: (target: any) => void;
  selectedLocation: any;
  userName: string;
  token: string;
  onLogout: () => void;
  audioEnabled: boolean;
  setAudioEnabled: (v: boolean) => void;
  masterVolume: number;
  setMasterVolume: (v: number) => void;
  musicVolume: number;
  setMusicVolume: (v: number) => void;
  rhombusState: any;
  setRhombusState: (s: any) => void;
  refreshLocations: () => void;
  socketRef: React.MutableRefObject<any>;
  isChatOpen: boolean;
  setIsChatOpen: (v: boolean) => void;
  hasUnreadChat: boolean;
  syncRhombusToDB: (s: any) => void;
  view: string;
  activeBattleMapData: any;
  isHitPointsOpen: boolean;
  setIsHitPointsOpen: (v: boolean) => void;
  activeUsers: any[];
  setIsDiceTrayOpen: (v: any) => void;
  setNotification: (msg: string) => void;
  measureMode: boolean;
  setMeasureMode: (v: boolean) => void;
  isBankOpen: boolean;
  setIsBankOpen: (v: boolean) => void;
  isSheetOpen: boolean;
  setIsSheetOpen: (v: boolean) => void;
  isVehiclesOpen?: boolean;
  setIsVehiclesOpen?: (v: boolean) => void;
  isEnemyVehiclesOpen?: boolean;
  setIsEnemyVehiclesOpen?: (v: boolean) => void;
  gameSystem?: string;
  attackPending?: { targetId: number; targetName: string; attackType: 'melee' | 'ranged'; ac: number } | null;
  onCancelAttack?: () => void;
  isRadioOpen?: boolean;
  onToggleRadio?: () => void;
  musicPlaying?: boolean;
  currencyIcon?: string;
  isInitiativeOpen?: boolean;
  onToggleInitiative?: () => void;
  initiativeActive?: boolean;
  initiativeNeedsRoll?: boolean;
  onRollEnemies?: () => void;
  onRollFriendlies?: () => void;
  activeCombats?: import('../modules/initiative/hooks/useInitiative').ActiveCombat[];
  onListCombats?: () => void;
  onJumpToScene?: (sceneKey: string) => void;
  currentTheme?: ThemeName;
  onThemeChange?: (theme: ThemeName) => void;
  customDice?: CustomDie[];
  onOpenCustomDieBuilder?: (die?: CustomDie) => void;
  onDeleteCustomDie?: (id: number | string) => void;
}

export function Sidebar({ activeMenu, setActiveMenu, locations, onSelect, onZoom, selectedLocation, userName, token, onLogout, audioEnabled, setAudioEnabled, masterVolume, setMasterVolume, musicVolume, setMusicVolume, rhombusState, setRhombusState, refreshLocations, socketRef, isChatOpen, setIsChatOpen, hasUnreadChat, syncRhombusToDB, view, activeBattleMapData, isHitPointsOpen, setIsHitPointsOpen, activeUsers, setIsDiceTrayOpen, setNotification, measureMode, setMeasureMode, isBankOpen, setIsBankOpen, isSheetOpen, setIsSheetOpen, isVehiclesOpen, setIsVehiclesOpen, gameSystem, attackPending, onCancelAttack, isRadioOpen, onToggleRadio, musicPlaying, currencyIcon, currentTheme, onThemeChange, isInitiativeOpen, onToggleInitiative, initiativeActive, initiativeNeedsRoll, onRollEnemies, onRollFriendlies, activeCombats, onListCombats, onJumpToScene, customDice, onOpenCustomDieBuilder, onDeleteCustomDie }: SidebarProps) {
  /** The rail label under the pointer, positioned from the button it belongs to. */
  const [railTip, setRailTip] = useState<{ label: string; x: number; y: number } | null>(null);
  const userRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName && (
    view === 'battle_map' && activeBattleMapData
      ? (l.battle_map_id == activeBattleMapData.locationId && l.floor_index == activeBattleMapData.currentFloorIndex)
      : l.battle_map_id == null
  ));
  const isSelectedRhombus = selectedLocation?.shape === 'rhombus' || selectedLocation?.shape === 'enemy_rhombus' || selectedLocation?.shape === 'friendly_rhombus';
  const targetRhombus = isSelectedRhombus ? selectedLocation : userRhombus;

  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const volumeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVolumeEnter = () => { if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current); setShowVolumeSlider(true); };
  const handleVolumeLeave = () => { volumeHideTimer.current = setTimeout(() => setShowVolumeSlider(false), 300); };

  let isPrimaryAdmin = false;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      isPrimaryAdmin = !payload.isTemporary;
    } catch (e) { }
  }

  return (
    <>
    {railTip && createPortal(
      <div className="rail-tip" style={{ left: railTip.x, top: railTip.y }}>{railTip.label}</div>,
      // The themed container, not the body: the themes are variables set by a class on
      // `.crt-container`, and anything mounted outside it renders in Classic green
      // whatever the rest of the app is wearing. See utils/themeRoot.
      themeRoot(),
    )}
    <div className={`sidebar ${activeMenu !== 'none' ? 'expanded' : ''}`}>
      {/* One listener for the whole rail rather than handlers on fourteen buttons: the
          label a button wants is on the button, and the rail reads it on the way past. */}
      <div
        className="icon-rail"
        onMouseOver={(e) => {
          const btn = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
          if (!btn) return;
          const r = btn.getBoundingClientRect();
          setRailTip({ label: btn.dataset.tip || '', x: r.right + 8, y: r.top + r.height / 2 });
        }}
        onMouseOut={(e) => {
          // Leaving for a child of the same button is not leaving the button.
          const to = e.relatedTarget as HTMLElement | null;
          if (to && to.closest?.('[data-tip]')) return;
          setRailTip(null);
        }}
      >
        <div className="rail-top" style={{ borderBottom: '1px solid var(--dark-green)' }}>
          <button className={`rail-btn system-trigger ${activeMenu === 'system_info' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'system_info' ? 'none' : 'system_info')} aria-label="SYSTEM_INFO" data-tip="SYSTEM_INFO">
            <svg width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="system-icon-svg">
              <path d="M3 21h18" />
              <path d="M5 21V9h4v12" />
              <path d="M9 21V4h6v17" />
              <path d="M15 21V11h4v10" />
              <path d="M12 7h.01M12 10h.01M12 13h.01M12 16h.01M7 12h.01M7 15h.01M17 14h.01M17 17h.01" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '10px 0', display: 'flex', justifyContent: 'center' }}>
          <button className="rail-btn" onClick={onLogout} aria-label="TERMINATE_SESSION" data-tip="TERMINATE_SESSION">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>
        </div>
        <div className="rail-center">
          <button className={`rail-btn ${activeMenu === 'quick_access' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'quick_access' ? 'none' : 'quick_access')} aria-label="QUICK_ACCESS" data-tip="QUICK_ACCESS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </button>
          <button className={`rail-btn ${activeMenu === 'nav_controls' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'nav_controls' ? 'none' : 'nav_controls')} aria-label="NAV_CONTROLS" data-tip="NAV_CONTROLS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="6" r="3" />
              <line x1="12" y1="9" x2="12" y2="14" />
              <rect x="4" y="14" width="16" height="6" rx="2" />
              <path d="M16.5 17h.01" />
            </svg>
          </button>
          <button className={`rail-btn ${activeMenu === 'geometry_protocols' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'geometry_protocols' ? 'none' : 'geometry_protocols')} aria-label="TOKEN_PROTOCOLS" data-tip="TOKEN_PROTOCOLS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill={rhombusState?.color || 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5.219 11.34l5.96-7.925a1.02 1.02 0 0 1 1.642 0l5.96 7.925c.292.388.292.932 0 1.32l-5.96 7.925a1.02 1.02 0 0 1-1.642 0L5.22 12.66a1.1 1.1 0 0 1 0-1.32" />
            </svg>
          </button>
          <button className={`rail-btn ${isHitPointsOpen ? 'active' : ''}`} onClick={() => setIsHitPointsOpen(!isHitPointsOpen)} aria-label="HIT_POINTS" data-tip="HIT_POINTS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <button className={`rail-btn ${activeMenu === 'dice_menu' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'dice_menu' ? 'none' : 'dice_menu')} aria-label="DICE_ROLLER" data-tip="DICE_ROLLER">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 20.5 7 20.5 17 12 22 3.5 17 3.5 7" />
              <polygon points="12 8 16.6 15.2 7.4 15.2" />
              <line x1="12" y1="2" x2="12" y2="8" />
              <line x1="12" y1="8" x2="3.5" y2="7" />
              <line x1="12" y1="8" x2="20.5" y2="7" />
              <line x1="3.5" y1="7" x2="7.4" y2="15.2" />
              <line x1="20.5" y1="7" x2="16.6" y2="15.2" />
              <line x1="3.5" y1="17" x2="7.4" y2="15.2" />
              <line x1="20.5" y1="17" x2="16.6" y2="15.2" />
              <line x1="12" y1="22" x2="7.4" y2="15.2" />
              <line x1="12" y1="22" x2="16.6" y2="15.2" />
            </svg>
          </button>
          <button className={`rail-btn ${measureMode ? 'active' : ''}`} onClick={() => setMeasureMode(!measureMode)} aria-label="MEASURE_TAPE" data-tip="MEASURE_TAPE">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z" />
              <path d="m14.5 12.5 2-2" />
              <path d="m11.5 9.5 2-2" />
              <path d="m8.5 6.5 2-2" />
              <path d="m17.5 15.5 2-2" />
            </svg>
          </button>
          {isPrimaryAdmin && (
            <button className={`rail-btn ${activeMenu === 'city_data_base' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'city_data_base' ? 'none' : 'city_data_base')} aria-label="CITY_DATA_BASE" data-tip="CITY_DATA_BASE">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
            </button>
          )}
          <button className={`rail-btn ${isChatOpen ? 'active' : ''} ${hasUnreadChat && !isChatOpen ? 'unread-flash' : ''}`} onClick={() => setIsChatOpen(!isChatOpen)} aria-label="GLOBAL_CHAT" data-tip="GLOBAL_CHAT">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <polyline points="7 9 10 12 7 15" />
              <line x1="12" y1="15" x2="16" y2="15" />
            </svg>
          </button>
          <button className={`rail-btn ${isBankOpen ? 'active' : ''}`} onClick={() => setIsBankOpen(!isBankOpen)} aria-label="CITY_NET // BANK" data-tip="CITY_NET // BANK">
            <CurrencyIcon icon={currencyIcon} size={24} />
          </button>
          <button
            className={`rail-btn ${isRadioOpen ? 'active' : ''}`}
            onClick={onToggleRadio}
            aria-label="RADIO_FEED" data-tip="RADIO_FEED"
            style={{ position: 'relative' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            {musicPlaying && (
              <span style={{
                position: 'absolute', top: '2px', right: '2px',
                width: '7px', height: '7px', borderRadius: '50%',
                background: 'var(--green)', display: 'block',
              }} />
            )}
          </button>
          {(token || initiativeActive) && (
            <button
              className={`rail-btn ${activeMenu === 'initiative_tracker' || isInitiativeOpen ? 'active' : ''} ${initiativeNeedsRoll && !isInitiativeOpen && activeMenu !== 'initiative_tracker' ? 'initiative-needs-roll' : ''}`}
              onClick={token
                ? () => { setActiveMenu(activeMenu === 'initiative_tracker' ? 'none' : 'initiative_tracker'); if (activeMenu !== 'initiative_tracker') onListCombats?.(); }
                : onToggleInitiative}
              aria-label="INITIATIVE_TRACKER" data-tip="INITIATIVE_TRACKER"
              style={{ position: 'relative' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2 2" />
                <path d="M9 2h6" />
                <path d="M12 2v2" />
                <path d="M19.07 4.93l-1.41 1.41" />
              </svg>
            </button>
          )}
        </div>
        <div className="rail-bottom" style={{ paddingBottom: '20px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} onMouseEnter={handleVolumeEnter} onMouseLeave={handleVolumeLeave}>
            {showVolumeSlider && (
              <div style={{ position: 'absolute', bottom: '0', left: '100%', background: '#0a0a0a', border: '1px solid var(--green)', padding: '8px 8px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', marginLeft: '6px', zIndex: 1000 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.5rem', letterSpacing: '1px', color: 'var(--green)', whiteSpace: 'nowrap' }}>{Math.round(masterVolume * 100)}%</span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={masterVolume}
                    onChange={e => setMasterVolume(parseFloat(e.target.value))}
                    className="vol-slider"
                  />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--green)', opacity: 0.6 }}>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.5rem', letterSpacing: '1px', color: 'var(--green)', whiteSpace: 'nowrap' }}>{Math.round(musicVolume * 100)}%</span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={musicVolume}
                    onChange={e => setMusicVolume(parseFloat(e.target.value))}
                    className="vol-slider"
                  />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--green)', opacity: 0.6 }}>
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              </div>
            )}
            <button className={`rail-btn ${!audioEnabled ? 'muted' : ''}`} onClick={() => setAudioEnabled(!audioEnabled)} aria-label={`${audioEnabled ? 'CLICK: MUTE_AUDIO' : 'CLICK: UNMUTE_AUDIO'} // HOVER: AUDIO_MIXER`} data-tip={`${audioEnabled ? 'CLICK: MUTE_AUDIO' : 'CLICK: UNMUTE_AUDIO'} // HOVER: AUDIO_MIXER`}>
              {audioEnabled ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
      <div className="menu-container">
        <div className="menu-content">
          {activeMenu === 'system_info' && <SystemInfoMenu userName={userName} token={token} currentTheme={currentTheme} onThemeChange={onThemeChange} />}
          {activeMenu === 'quick_access' && <QuickAccessMenu locations={locations} onSelect={onSelect} onZoom={onZoom} selectedLocation={selectedLocation} isOpen={true} setIsOpen={() => setActiveMenu('none')} view={view} activeUsers={activeUsers} />}
          {activeMenu === 'nav_controls' && <NavControlsMenu onToggleHelp={() => setActiveMenu('none')} />}
          {activeMenu === 'geometry_protocols' && <GeometryMenu rhombusState={rhombusState} setRhombusState={setRhombusState} selectedLocation={selectedLocation} setSelectedLocation={onSelect} refreshLocations={refreshLocations} token={token} userName={userName} locations={locations} socketRef={socketRef} syncRhombusToDB={syncRhombusToDB} view={view} activeBattleMapData={activeBattleMapData} measureMode={measureMode} setMeasureMode={setMeasureMode} isSheetOpen={isSheetOpen} setIsSheetOpen={setIsSheetOpen} isVehiclesOpen={isVehiclesOpen} setIsVehiclesOpen={setIsVehiclesOpen} gameSystem={gameSystem} />}
          {activeMenu === 'city_data_base' && <CityDataBaseMenu token={token} emitUpdate={() => {}} />}
          {activeMenu === 'dice_menu' && <DiceMenu userName={userName} token={token} socketRef={socketRef} rhombusState={rhombusState} setIsDiceTrayOpen={setIsDiceTrayOpen} setNotification={setNotification} attackPending={attackPending} onCancelAttack={onCancelAttack} gameSystem={gameSystem} customDice={customDice} onOpenCustomDieBuilder={onOpenCustomDieBuilder} onDeleteCustomDie={onDeleteCustomDie} />}
          {activeMenu === 'initiative_tracker' && (
            <InitiativeNavPanel
              initiativeActive={!!initiativeActive}
              activeCombats={activeCombats || []}
              locations={locations}
              onRollEnemies={onRollEnemies}
              onRollFriendlies={onRollFriendlies}
              onToggleTracker={onToggleInitiative}
              onJumpToScene={onJumpToScene}
              onClose={() => setActiveMenu('none')}
            />
          )}
        </div>
      </div>
    </div>
    </>
  );
}
