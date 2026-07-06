import React, { useState, useRef } from 'react';
import kofiLogo from '../assets/kofi.png';
import { CityDataBaseMenu } from './CityDatabase';
import { isUserDefinedName, getStructLabel } from '../utils/locationHelpers';
import { CurrencyIcon } from './BankWindows';
import { THEMES } from '../theme/themes';
import type { ThemeName } from '../theme/themes';

// ─── CheckUpdateButton ───────────────────────────────────────────────────────

function CheckUpdateButton({ token }: { token: string }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'update-available' | 'updating' | 'up-to-date' | 'error'>('idle');
  const [versionMessage, setVersionMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const updateCommands = 'docker compose down\ndocker compose pull\ndocker compose up -d';

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
    try {
      await fetch('/api/update', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setVersionMessage('Update applied — reconnecting...');
      setTimeout(() => window.location.reload(), 6000);
    } catch {
      setStatus('error');
      setVersionMessage('Update failed — try manually');
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const copyCommands = () => {
    navigator.clipboard.writeText(updateCommands);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
        <span style={{ color: 'var(--green)', fontSize: '0.6rem', opacity: 0.7, letterSpacing: '1px' }}>{versionMessage}</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={applyUpdate} style={{ ...btnStyle, marginTop: 0, textDecoration: 'underline' }}>
            CLICK TO UPDATE
          </button>
          <button onClick={copyCommands} style={{ ...btnStyle, marginTop: 0, opacity: 0.5 }} title="Copy manual update commands">
            {copied ? '✓ COPIED' : 'COPY'}
          </button>
        </div>
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
}

export function GeometryMenu({ rhombusState, setRhombusState, selectedLocation, setSelectedLocation, refreshLocations, token, userName, locations, socketRef, syncRhombusToDB, view, activeBattleMapData, measureMode, setMeasureMode }: GeometryMenuProps) {
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

  // Any rhombus the player owns on any map — used for AC/settings regardless of current view
  const anyUserRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);

  // Pre-populate AC fields from the player's rhombus (any map)
  React.useEffect(() => {
    if (anyUserRhombus) {
      setAcMelee(anyUserRhombus.melee_ac != null ? String(anyUserRhombus.melee_ac) : '');
      setAcRanged(anyUserRhombus.ranged_ac != null ? String(anyUserRhombus.ranged_ac) : '');
    }
  }, [anyUserRhombus?.id, anyUserRhombus?.melee_ac, anyUserRhombus?.ranged_ac]);

  const handleSet = async () => {
    // Sync name / description / color
    syncRhombusToDB(rhombusState);
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
      // AC
      const meleeVal = acMelee === '' ? null : parseInt(acMelee, 10);
      const rangedVal = acRanged === '' ? null : parseInt(acRanged, 10);
      await fetch(`/api/locations/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...target, melee_ac: meleeVal, ranged_ac: rangedVal }),
      });
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
        <h3 style={{ margin: 0 }}>GEOMETRY_PROTOCOLS</h3>
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
              {userRhombus ? 'RHOMBUS_ACTIVE' : (rhombusState.active ? 'PLACE_ON_MAP' : 'INITIALIZE_RHOMBUS')}
            </span>
          </button>
          {rhombusState.active && !userRhombus && (
            <span style={{ fontSize: '0.6rem', opacity: 0.6, letterSpacing: '1px' }}>place user token</span>
          )}
        </div>

        {userRhombus && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(userRhombus.id)} style={{ width: '100%', fontSize: '0.65rem' }}>PURGE_YOUR_RHOMBUS</button>
        )}
        {canRemoveSelected && selectedLocation?.id !== userRhombus?.id && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(selectedLocation.id)} style={{ width: '100%', fontSize: '0.65rem' }}>REMOVE_SELECTED_RHOMBUS</button>
        )}

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* 2 — Color */}
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>RHOMBUS_CHROMA_SYNC</label>
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

          {/* 3 — Name */}
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>BEACON_NAME</label>
            <input
              placeholder="ID_TAG"
              value={rhombusState.name}
              onChange={(e) => setRhombusState({ ...rhombusState, name: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>

          {/* 4 — Description */}
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>DATA_DESCRIPTION</label>
            <textarea
              placeholder="BEACON_FEED_SUMMARY"
              value={rhombusState.description}
              onChange={(e) => setRhombusState({ ...rhombusState, description: e.target.value })}
              style={{ width: '100%', height: '60px' }}
            />
          </div>

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

          {/* 6 — AC fields (always visible; saved via SET) */}
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

          {/* 7 — SET button */}
          <button className="upload-btn" style={{ width: '100%', marginTop: '4px' }} onClick={handleSet}>
            SET
          </button>

        </div>

        <div className="info-box" style={{ fontSize: '0.65rem', opacity: 0.8, lineHeight: '1.6', borderTop: '1px solid var(--dark-green)', paddingTop: '15px', width: '100%' }}>
          <p style={{ color: 'var(--green)', fontWeight: 'bold', marginBottom: '5px' }}>INTERFACE_GUIDE:</p>
          <p>• [CLICK MAP] TO DEPLOY RHOMBUS</p>
          <p>• [CLICK & DRAG] TO REPOSITION</p>
          <p>• [PURGE] TO RESET DEPLOYMENT</p>
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

// ─── DiceMenu ─────────────────────────────────────────────────────────────────

interface DiceMenuProps {
  userName: string;
  socketRef: React.MutableRefObject<any>;
  rhombusState: any;
  setIsDiceTrayOpen: (v: any) => void;
  setNotification: (msg: string) => void;
  attackPending?: { targetId: number; targetName: string; attackType: 'melee' | 'ranged'; ac: number } | null;
  onCancelAttack?: () => void;
}

export function DiceMenu({ userName, socketRef, rhombusState, setIsDiceTrayOpen, setNotification, attackPending, onCancelAttack }: DiceMenuProps) {
  const diceTypes = [2, 4, 6, 8, 10, 12, 20, 100];
  const [diceCounts, setDiceCounts] = useState<Record<number, number>>({});
  const [workingMod, setWorkingMod] = useState<number>(0);
  const [modifiers, setModifiers] = useState<number[]>([]);

  const totalDice = Object.values(diceCounts).reduce((a, b) => a + b, 0);
  const canRoll = totalDice > 0;

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

  const handleRoll = () => {
    if (!canRoll) {
      setNotification("INVALID_ROLL: SELECT_DICE");
      return;
    }
    const color = rhombusState?.color || '#00ff00';
    if (socketRef.current) {
      socketRef.current.emit('requestDiceRoll', { userName, diceCounts, modifiers, color });
    }
    setDiceCounts({});
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
          <div style={{ color: 'var(--green)', fontSize: '0.75rem', marginBottom: '6px' }}>
            {attackPending.attackType.toUpperCase()} · AC {attackPending.ac} · Roll {attackPending.ac}+ to hit
          </div>
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
          <button className="upload-btn" style={{ flex: 1 }} onClick={() => { setModifiers(p => p.slice(0, -1)); }}>DELETE LAST</button>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginTop: '5px' }}>
          {[3, 2, 1, -1, -2, -3].map(m => (
            <button key={m} className="upload-btn" style={{ flex: 1, padding: '2px', fontSize: '0.75rem' }} onClick={() => setModifiers(p => [...p, m])}>
              {m > 0 ? `+${m}` : m}
            </button>
          ))}
        </div>
        <div style={{ minHeight: '20px', background: 'rgba(0,0,0,0.5)', marginTop: '5px', padding: '5px', fontSize: '0.75rem', wordBreak: 'break-all' }}>
          {modifiers.length > 0 ? modifiers.map(m => m > 0 ? `+${m}` : m).join(' ') : 'No Modifiers'}
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
  attackPending?: { targetId: number; targetName: string; attackType: 'melee' | 'ranged'; ac: number } | null;
  onCancelAttack?: () => void;
  isRadioOpen?: boolean;
  onToggleRadio?: () => void;
  musicPlaying?: boolean;
  currencyIcon?: string;
  currentTheme?: ThemeName;
  onThemeChange?: (theme: ThemeName) => void;
}

export function Sidebar({ activeMenu, setActiveMenu, locations, onSelect, onZoom, selectedLocation, userName, token, onLogout, audioEnabled, setAudioEnabled, masterVolume, setMasterVolume, musicVolume, setMusicVolume, rhombusState, setRhombusState, refreshLocations, socketRef, isChatOpen, setIsChatOpen, hasUnreadChat, syncRhombusToDB, view, activeBattleMapData, isHitPointsOpen, setIsHitPointsOpen, activeUsers, setIsDiceTrayOpen, setNotification, measureMode, setMeasureMode, isBankOpen, setIsBankOpen, attackPending, onCancelAttack, isRadioOpen, onToggleRadio, musicPlaying, currencyIcon, currentTheme, onThemeChange }: SidebarProps) {
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
    <div className={`sidebar ${activeMenu !== 'none' ? 'expanded' : ''}`}>
      <div className="icon-rail">
        <div className="rail-top" style={{ borderBottom: '1px solid var(--dark-green)' }}>
          <button className={`rail-btn system-trigger ${activeMenu === 'system_info' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'system_info' ? 'none' : 'system_info')} title="SYSTEM_INFO">
            <svg width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="system-icon-svg">
              <g fill="none">
                <path fill="currentColor" d="M3.75 18a.75.75 0 0 0-1.5 0zm-1.5-4a.75.75 0 0 0 1.5 0zM7 8.75c.964 0 1.612.002 2.095.067c.461.062.659.169.789.3l1.06-1.062c-.455-.455-1.022-.64-1.65-.725c-.606-.082-1.372-.08-2.294-.08zM11.75 12c0-.922.002-1.688-.08-2.294c-.084-.628-.27-1.195-.726-1.65l-1.06 1.06c.13.13.237.328.3.79c.064.482.066 1.13.066 2.094zM7 7.25c-.922 0-1.688-.002-2.294.08c-.628.084-1.195.27-1.65.725l1.06 1.061c.13-.13.328-.237.79-.3c.482-.064 1.13-.066 2.094-.066zM3.75 12c0-.964.002-1.612.067-2.095c.062-.461.169-.659.3-.789l-1.062-1.06c-.455.455-.64 1.022-.725 1.65c-.082.606-.08 1.372-.08 2.294zm0 10v-4h-1.5v4zm0-8v-2h-1.5v2z" />
                <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M7 22v-6c0-1.886 0-2.828.586-3.414S9.114 12 11 12h2c1.886 0 2.828 0 3.414.586c.472.471.564 1.174.582 2.414M17 22v-2.75m4-11.478c0-1.34 0-2.011-.356-2.525s-.984-.75-2.24-1.22c-2.455-.921-3.682-1.381-4.543-.785C13 3.84 13 5.15 13 7.772V12m8 10V12M4 8V6.5c0-.943 0-1.414.293-1.707S5.057 4.5 6 4.5h2c.943 0 1.414 0 1.707.293S10 5.557 10 6.5V8M7 4V2m15 20H2m8-7h.5m3.5 0h-1.5M10 18h4" />
              </g>
            </svg>
          </button>
        </div>
        <div style={{ padding: '10px 0', display: 'flex', justifyContent: 'center' }}>
          <button className="rail-btn" onClick={onLogout} title="TERMINATE_SESSION">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path fill="currentColor" d="m22.5 5.74l-1 1.73a11 11 0 1 1-11 0l-1-1.73a13 13 0 1 0 13 0" />
              <path fill="currentColor" d="M15 2h2v14h-2z" />
            </svg>
          </button>
        </div>
        <div className="rail-center">
          <button className={`rail-btn ${activeMenu === 'quick_access' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'quick_access' ? 'none' : 'quick_access')} title="QUICK_ACCESS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </button>
          <button className={`rail-btn ${activeMenu === 'nav_controls' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'nav_controls' ? 'none' : 'nav_controls')} title="NAV_CONTROLS">
            <svg width="24" height="24" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="0" strokeLinecap="round" strokeLinejoin="round">
              <path fill="currentColor" d="M208 144h-72V95.19a40 40 0 1 0-16 0V144H48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16M104 56a24 24 0 1 1 24 24a24 24 0 0 1-24-24m104 152H48v-48h160zm-40-96h32a8 8 0 0 1 0 16h-32a8 8 0 0 1 0-16" />
            </svg>
          </button>
          <button className={`rail-btn ${activeMenu === 'geometry_protocols' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'geometry_protocols' ? 'none' : 'geometry_protocols')} title="GEOMETRY_PROTOCOLS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill={rhombusState?.color || 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5.219 11.34l5.96-7.925a1.02 1.02 0 0 1 1.642 0l5.96 7.925c.292.388.292.932 0 1.32l-5.96 7.925a1.02 1.02 0 0 1-1.642 0L5.22 12.66a1.1 1.1 0 0 1 0-1.32" />
            </svg>
          </button>
          <button className={`rail-btn ${isHitPointsOpen ? 'active' : ''}`} onClick={() => setIsHitPointsOpen(!isHitPointsOpen)} title="HIT_POINTS">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <button className={`rail-btn ${activeMenu === 'dice_menu' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'dice_menu' ? 'none' : 'dice_menu')} title="DICE_ROLLER">
            <svg width="24" height="24" viewBox="-5 -10 110 135" fill="currentColor" style={{ transform: 'scale(1.5)' }}>
              <path d="m32.19,44.88s-.07,0-.1,0l-25.59-5.16c-.18-.04-.33-.17-.38-.35-.05-.18,0-.37.13-.5L40.46,4.83c.16-.16.4-.19.59-.08.19.11.3.33.25.55l-8.62,39.19c-.05.23-.26.39-.49.39Zm-24.58-5.96l24.19,4.87L39.96,6.74,7.61,38.91Z" />
              <path d="m32.19,44.88c-.13,0-.25-.05-.35-.14-.13-.12-.18-.3-.14-.47L40.32,5.08c.03-.15.14-.28.28-.35.14-.06.31-.06.45.02l44.72,25.03c.18.1.28.3.25.5s-.17.37-.37.42l-53.34,14.16s-.09.02-.13.02ZM41.16,5.95l-8.3,37.73,51.36-13.63L41.16,5.95Z" />
              <path d="m85.53,30.72c-.08,0-.17-.02-.24-.06L40.57,5.63c-.22-.12-.32-.4-.22-.63.1-.23.36-.36.6-.28l41.45,12.44c.17.05.3.18.34.35l3.26,12.59c.05.19-.02.4-.18.52-.09.07-.2.1-.31.1ZM45.03,6.98l39.72,22.24-2.9-11.19L45.03,6.98Z" />
              <path d="m72.31,87.15c-.14,0-.27-.06-.36-.16L31.83,44.72c-.12-.13-.17-.31-.12-.48.05-.17.18-.3.35-.35l53.34-14.16c.17-.05.35,0,.48.12.13.12.18.3.14.47l-13.22,56.44c-.04.18-.18.32-.36.37-.04.01-.09.02-.13.02Zm-39.18-42.51l38.9,41,12.82-54.72-51.72,13.73Z" />
              <path d="m23.28,88.37c-.15,0-.29-.07-.38-.18-.1-.12-.14-.27-.11-.42l8.91-43.5c.04-.18.17-.33.35-.38.18-.05.37,0,.5.14l40.12,42.28c.14.14.17.35.1.54-.08.18-.25.3-.45.31l-49.03,1.22h-.01Zm9.2-42.96l-8.59,41.94,47.28-1.17-38.69-40.77Z" />
              <path d="m23.28,88.37c-.21,0-.4-.13-.47-.34L6.12,39.38c-.06-.17-.02-.36.1-.49.12-.13.3-.19.47-.16l25.59,5.16c.13.03.24.1.32.21.07.11.1.25.07.38l-8.91,43.5c-.04.22-.23.38-.46.4-.01,0-.02,0-.03,0ZM7.35,39.88l15.81,46.09,8.44-41.21-24.25-4.89Z" />
              <path d="m62.66,95.31s-.06,0-.09,0l-39.37-6.94c-.25-.04-.43-.27-.41-.53.02-.26.23-.46.49-.46l49.03-1.22c.2,0,.4.12.48.32.08.2.02.42-.14.56l-9.66,8.16c-.09.08-.21.12-.32.12Zm-34.36-7.06l34.22,6.03,8.39-7.09-42.61,1.06Z" />
              <path d="m72.31,87.15c-.08,0-.16-.02-.23-.05-.2-.1-.31-.34-.26-.56l13.22-56.44c.05-.23.25-.38.48-.39.2-.04.43.16.49.38l7.87,32.15c.04.16,0,.32-.11.45l-21.09,24.28c-.1.11-.24.17-.38.17Zm13.23-54.79l-12.28,52.44,19.6-22.56-7.32-29.88Z" />
            </svg>
          </button>
          <button className={`rail-btn ${measureMode ? 'active' : ''}`} onClick={() => setMeasureMode(!measureMode)} title="MEASURE_TAPE">
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.96 7.404L16.596 1.04a.5.5 0 0 0-.707 0L1.04 15.889a.5.5 0 0 0 0 .707l6.364 6.364a.5.5 0 0 0 .707 0l3.18-3.18l.002-.002l2.827-2.827h.001v-.002l2.829-2.827v-.001l2.828-2.828l3.182-3.182a.5.5 0 0 0 0-.707m-3.535 2.828l-1.768-1.767l-.007-.007a.5.5 0 0 0-.7.714l1.768 1.767l-2.122 2.122l-3.182-3.182l-.007-.007a.5.5 0 0 0-.7.714l3.182 3.182l-2.121 2.121L12 14.121a.5.5 0 0 0-.707.707l1.767 1.768l-2.12 2.122l-3.183-3.183l-.007-.007a.5.5 0 1 0-.7.714l3.182 3.183l-2.475 2.474l-5.656-5.657L16.242 2.101L21.9 7.758z" />
            </svg>
          </button>
          {isPrimaryAdmin && (
            <button className={`rail-btn ${activeMenu === 'city_data_base' ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === 'city_data_base' ? 'none' : 'city_data_base')} title="CITY_DATA_BASE">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
            </button>
          )}
          <button className={`rail-btn ${isChatOpen ? 'active' : ''} ${hasUnreadChat && !isChatOpen ? 'unread-flash' : ''}`} onClick={() => setIsChatOpen(!isChatOpen)} title="GLOBAL_CHAT">
            <svg width="24" height="24" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="0" strokeLinecap="round" strokeLinejoin="round">
              <path fill="currentColor" d="M122.5 124.88a4 4 0 0 1 0 6.24l-40 32a4 4 0 0 1-5-6.24L113.6 128L77.5 99.12a4 4 0 0 1 5-6.24ZM176 156h-40a4 4 0 0 0 0 8h40a4 4 0 0 0 0-8m52-100v144a12 12 0 0 1-12 12H40a12 12 0 0 1-12-12V56a12 12 0 0 1 12-12h176a12 12 0 0 1 12 12m-8 0a4 4 0 0 0-4-4H40a4 4 0 0 0-4 4v144a4 4 0 0 0 4 4h176a4 4 0 0 0 4-4Z" />
            </svg>
          </button>
          <button className={`rail-btn ${isBankOpen ? 'active' : ''}`} onClick={() => setIsBankOpen(!isBankOpen)} title="CITY_NET // BANK">
            <CurrencyIcon icon={currencyIcon} size={24} />
          </button>
          <button
            className={`rail-btn ${isRadioOpen ? 'active' : ''}`}
            onClick={onToggleRadio}
            title="RADIO_FEED"
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--green)', opacity: 0.6 }}>
                    <path d="M20 2H4c-.55 0-1 .45-1 1v18c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V3c0-.55-.45-1-1-1M5 4h14v8H5zm14 16H5v-6h14z" />
                    <path d="M15 18h3v-2h-3v.5h-3v1h3zm-8-2a1 1 0 1 0 0 2a1 1 0 1 0 0-2" />
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
            <button className={`rail-btn ${!audioEnabled ? 'muted' : ''}`} onClick={() => setAudioEnabled(!audioEnabled)} title={`${audioEnabled ? 'CLICK: MUTE_AUDIO' : 'CLICK: UNMUTE_AUDIO'} // HOVER: MASTER_VOLUME`}>
              {audioEnabled ? (
                <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                  <path fill="currentColor" fillRule="evenodd" d="m403.966 426.944l-33.285-26.63c74.193-81.075 74.193-205.015-.001-286.09l33.285-26.628c86.612 96.712 86.61 242.635.001 339.348M319.58 155.105l-33.324 26.659c39.795 42.568 39.794 108.444.001 151.012l33.324 26.658c52.205-58.22 52.205-146.109-.001-204.329m-85.163-69.772l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                  <path fill="currentColor" fillRule="evenodd" d="m403.375 257.27l59.584 59.584l-30.167 30.166l-59.583-59.583l-59.584 59.583l-30.166-30.166l59.583-59.584l-59.583-59.583l30.166-30.166l59.584 59.583l59.583-59.583l30.167 30.166zM234.417 85.333l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
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
          {activeMenu === 'geometry_protocols' && <GeometryMenu rhombusState={rhombusState} setRhombusState={setRhombusState} selectedLocation={selectedLocation} setSelectedLocation={onSelect} refreshLocations={refreshLocations} token={token} userName={userName} locations={locations} socketRef={socketRef} syncRhombusToDB={syncRhombusToDB} view={view} activeBattleMapData={activeBattleMapData} measureMode={measureMode} setMeasureMode={setMeasureMode} />}
          {activeMenu === 'city_data_base' && <CityDataBaseMenu token={token} emitUpdate={() => {}} />}
          {activeMenu === 'dice_menu' && <DiceMenu userName={userName} socketRef={socketRef} rhombusState={rhombusState} setIsDiceTrayOpen={setIsDiceTrayOpen} setNotification={setNotification} attackPending={attackPending} onCancelAttack={onCancelAttack} />}
        </div>
      </div>
    </div>
  );
}
