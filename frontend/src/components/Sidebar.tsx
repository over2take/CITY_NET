import React, { useState } from 'react';
import { CityDataBaseMenu } from './CityDatabase';
import { isUserDefinedName, getStructLabel } from '../utils/locationHelpers';
import creditsPngIcon from '../assets/Credits.png';

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
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>GIMBALL / ROTATE</span><br />LEFT-CLICK + DRAG
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>PAN / MOVE VIEW</span><br />RIGHT-CLICK + DRAG
        </div>
        <div style={{ marginBottom: '10px', borderBottom: '1px solid var(--dark-green)', paddingBottom: '5px' }}>
          <span style={{ color: 'var(--green)', fontWeight: 'bold' }}>ZOOM IN/OUT</span><br />SCROLL WHEEL
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

  return (
    <div className="panel sidebar-panel">
      <header style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>GEOMETRY_PROTOCOLS</h3>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>

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
            {userRhombus ? 'RHOMBUS_ACTIVE' : (rhombusState.active ? 'SCANNING_MAP...' : 'INITIALIZE_RHOMBUS')}
          </span>
        </button>

        {userRhombus && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(userRhombus.id)} style={{ width: '100%', fontSize: '0.65rem' }}>PURGE_YOUR_RHOMBUS</button>
        )}

        {canRemoveSelected && selectedLocation?.id !== userRhombus?.id && (
          <button className="upload-btn danger-btn" onClick={() => removeRhombus(selectedLocation.id)} style={{ width: '100%', fontSize: '0.65rem' }}>REMOVE_SELECTED_RHOMBUS</button>
        )}

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>BEACON_NAME</label>
            <input
              placeholder="ID_TAG"
              value={rhombusState.name}
              onChange={(e) => {
                const ns = { ...rhombusState, name: e.target.value };
                setRhombusState(ns);
                syncRhombusToDB(ns);
              }}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>DATA_DESCRIPTION</label>
            <textarea
              placeholder="BEACON_FEED_SUMMARY"
              value={rhombusState.description}
              onChange={(e) => {
                const ns = { ...rhombusState, description: e.target.value };
                setRhombusState(ns);
                syncRhombusToDB(ns);
              }}
              style={{ width: '100%', height: '60px' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>MAX HEALTH</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="number"
                placeholder="0"
                value={rhombusState.hp_max || ''}
                onChange={(e) => setRhombusState({ ...rhombusState, hp_max: parseInt(e.target.value) || 0 })}
                style={{ flex: 1, boxSizing: 'border-box', marginBottom: 0 }}
              />
              <button
                className="upload-btn"
                style={{ fontSize: '0.65rem', padding: '0 15px', minWidth: 'auto', margin: 0, height: 'auto' }}
                onClick={async () => {
                  const anyUserRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
                  if (anyUserRhombus) {
                    await fetch(`/api/locations/${anyUserRhombus.id}/health`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                      body: JSON.stringify({ action: 'set_max', hp_max: rhombusState.hp_max })
                    });
                    refreshLocations();
                  }
                  syncRhombusToDB({ ...rhombusState, hp_max: rhombusState.hp_max });
                }}
              >
                SET
              </button>
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '5px' }}>RHOMBUS_CHROMA_SYNC</label>
            <input
              type="color"
              value={rhombusState.color}
              onChange={(e) => {
                const ns = { ...rhombusState, color: e.target.value };
                setRhombusState(ns);
                syncRhombusToDB(ns);
              }}
              style={{ width: '100%', height: '40px', background: 'none', border: '1px solid var(--green)', cursor: 'pointer' }}
            />
          </div>
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
}

export function SystemInfoMenu({ userName, token }: SystemInfoMenuProps) {
  return (
    <div className="panel sidebar-panel">
      <header style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0, textShadow: 'var(--glow)' }}>CITY_NET</h1>
        <div style={{ fontSize: '0.65rem', opacity: 0.7, letterSpacing: '2px', marginTop: '2px' }}>NAV_OS_v1.0.4</div>
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
}

export function DiceMenu({ userName, socketRef, rhombusState, setIsDiceTrayOpen, setNotification }: DiceMenuProps) {
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
        {!!loc.isFavorite && <span style={{ color: '#ff7b00', marginRight: '5px' }}>★</span>}
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
              <span style={{ width: '20px', display: 'inline-block' }}>{showStarred ? '▼' : '▶'}</span>★ PRIORITY_NODES ({starred.length})
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
  setActiveMenu: (v: string) => void;
  locations: any[];
  onSelect: (loc: any) => void;
  onZoom: (target: any) => void;
  selectedLocation: any;
  userName: string;
  token: string;
  onLogout: () => void;
  audioEnabled: boolean;
  setAudioEnabled: (v: boolean) => void;
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
}

export function Sidebar({ activeMenu, setActiveMenu, locations, onSelect, onZoom, selectedLocation, userName, token, onLogout, audioEnabled, setAudioEnabled, rhombusState, setRhombusState, refreshLocations, socketRef, isChatOpen, setIsChatOpen, hasUnreadChat, syncRhombusToDB, view, activeBattleMapData, isHitPointsOpen, setIsHitPointsOpen, activeUsers, setIsDiceTrayOpen, setNotification, measureMode, setMeasureMode, isBankOpen, setIsBankOpen }: SidebarProps) {
  const userRhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName && (
    view === 'battle_map' && activeBattleMapData
      ? (l.battle_map_id == activeBattleMapData.locationId && l.floor_index == activeBattleMapData.currentFloorIndex)
      : l.battle_map_id == null
  ));
  const isSelectedRhombus = selectedLocation?.shape === 'rhombus' || selectedLocation?.shape === 'enemy_rhombus' || selectedLocation?.shape === 'friendly_rhombus';
  const targetRhombus = isSelectedRhombus ? selectedLocation : userRhombus;

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
            <div style={{ width: '24px', height: '24px', backgroundColor: 'currentColor', WebkitMaskImage: `url(${creditsPngIcon})`, WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskImage: `url(${creditsPngIcon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />
          </button>
        </div>
        <div className="rail-bottom" style={{ paddingBottom: '20px', display: 'flex', justifyContent: 'center' }}>
          <button className={`rail-btn ${!audioEnabled ? 'muted' : ''}`} onClick={() => setAudioEnabled(!audioEnabled)} title={audioEnabled ? "MUTE_AUDIO" : "UNMUTE_AUDIO"}>
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
      <div className="menu-container">
        <div className="menu-content">
          {activeMenu === 'system_info' && <SystemInfoMenu userName={userName} token={token} />}
          {activeMenu === 'quick_access' && <QuickAccessMenu locations={locations} onSelect={onSelect} onZoom={onZoom} selectedLocation={selectedLocation} isOpen={true} setIsOpen={() => setActiveMenu('none')} view={view} activeUsers={activeUsers} />}
          {activeMenu === 'nav_controls' && <NavControlsMenu onToggleHelp={() => setActiveMenu('none')} />}
          {activeMenu === 'geometry_protocols' && <GeometryMenu rhombusState={rhombusState} setRhombusState={setRhombusState} selectedLocation={selectedLocation} setSelectedLocation={onSelect} refreshLocations={refreshLocations} token={token} userName={userName} locations={locations} socketRef={socketRef} syncRhombusToDB={syncRhombusToDB} view={view} activeBattleMapData={activeBattleMapData} measureMode={measureMode} setMeasureMode={setMeasureMode} />}
          {activeMenu === 'city_data_base' && <CityDataBaseMenu token={token} emitUpdate={() => {}} />}
          {activeMenu === 'dice_menu' && <DiceMenu userName={userName} socketRef={socketRef} rhombusState={rhombusState} setIsDiceTrayOpen={setIsDiceTrayOpen} setNotification={setNotification} />}
        </div>
      </div>
    </div>
  );
}
