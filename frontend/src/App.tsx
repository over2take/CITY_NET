import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, CameraControls, PerspectiveCamera, Grid, TransformControls, Bvh, Html, OrthographicCamera } from '@react-three/drei';
import { BattleMapManager } from './BattleMapManager';
import { BattleMapScene } from './BattleMapScene';
import { HealthBar } from './HealthBar';
import PingEffect from './PingEffect';
import { io } from 'socket.io-client';
import * as THREE from 'three';
import type {
  Location, District, Road, BattleMap, SavedMap,
  ActiveUser, ChatMessage, PrivateMessage, BankData, DiceRoll,
  BattleMapSessionData, BattleMapPosition, AnimState,
  ViewMode, SidebarMenu, CameraTarget, ConfirmDialog,
  RhombusState, MeasurementData, GlobalSettings, PendingRequest,
} from './types';
import rhombusIcon from './assets/rhombus.svg';
import { useMapData } from './hooks/useMapData';
import { useSocket } from './hooks/useSocket';
import { StatusLogDisplay, StatusBarText } from './components/StatusDisplay';
import { CursorPingListener } from './components/CursorPing';
import { DraggableWindow } from './components/DraggableWindow';
import { HitPointsMenu, HealthReviewWindow } from './components/HitPoints';
import { SecureLogin } from './components/SecureLogin';
import { MeasurementTool, MeasurementVisualizer } from './components/MeasurementTool';
import { CityDataBaseMenu } from './components/CityDatabase';
import { AdminBankWindow, AdminPayWindow, BankWindow, formatBankValue } from './components/BankWindows';
import { ChatWindow } from './components/ChatWindow';
import { Sidebar, NavControlsMenu, GeometryMenu, SystemInfoMenu, DiceMenu, QuickAccessMenu } from './components/Sidebar';
import { DiceTrayWindow, DotMatrixScoreboard, DiceScene } from './components/DiceTray';
import { EnemyRhombus, FriendlyRhombus, PlayerRhombus, OverlapChecker } from './components/Rhombuses';
import terminalIcon from './assets/terminal-thin.svg';
import eyeIcon from './assets/oui--eye.svg';
import eyeClosedIcon from './assets/oui--eye-closed.svg';
import creditsIcon from './assets/Credits.svg';
import creditsPngIcon from './assets/Credits.png';
import './App.css';


import { ZONE_TYPE_NAMES, isUserDefinedName, getStructLabel } from './utils/locationHelpers';
import { renderBaseGeometry } from './utils/threeHelpers';
import { mergeRhombusHealthFromLocation, resolveDeployHealth } from './utils/rhombusHelpers';
import { Building, InstancedBuildings, generateThemedBuildingsForPlot } from './components/Buildings';
import { DistrictInteractions, WaterBody, WaterBodies, Roads, GhostTraffic } from './components/MapElements';
import { GlobalCameraCapture, CursorPivotControls, CameraController } from './components/Camera';
import { AdminPanel } from './components/AdminPanel';
import { SpectatorCameraRig, AdminCameraBroadcaster, computeBroadcastFraming } from './components/Streamer';
import { DEFAULT_DIRECTOR_STATE } from './types';
import type { DirectorState } from './types';

// Streamer mode: ?streamer=true loads a read-only spectator client for OBS capture.
// World state arrives through the normal socket/REST pipeline; all admin/player UI is skipped.
const IS_SPECTATOR = new URLSearchParams(window.location.search).has('streamer');

function App() {
  const controlsRef = useRef<any>(null);
  const { locations, setLocations, districts, setDistricts, roads, setRoads, waterBodies, setWaterBodies, fetchLocations, fetchDistricts, fetchRoads, fetchWaterBodies, fetchAll } = useMapData();
  const [editingDistrict, setEditingDistrict] = useState<District | null>(null);
  const [overlapIds, setOverlapIds] = useState<number[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [showBattleMapManager, setShowBattleMapManager] = useState(false);
  const [tempBattleMapScale, setTempBattleMapScale] = useState<number | string | null>(null);
  const [tempCityMapScale, setTempCityMapScale] = useState<number | string | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({});
  const fetchGlobalSettings = async () => {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            const data = await res.json();
            const settingsObj: any = {};
            if (Array.isArray(data)) {
                data.forEach(item => { settingsObj[item.key] = item.value; });
            }
            setGlobalSettings(settingsObj);
        }
    } catch(e) {}
  };
  useEffect(() => {
      fetchGlobalSettings();
  }, []);
  const [currentLocBattleMaps, setCurrentLocBattleMaps] = useState<BattleMap[]>([]);
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [showZoomComplete, setShowZoomComplete] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState('');
  
  let isPrimaryAdmin = false;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      isPrimaryAdmin = !payload.isTemporary;
    } catch (e) { }
  }

  const [secureModeEnabled, setSecureModeEnabled] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [pendingRegistrations, setPendingRegistrations] = useState<{ username: string; created_at: string }[]>([]);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [pendingResets, setPendingResets] = useState<{ username: string; requestId: string }[]>([]);
  const [view, setView] = useState<ViewMode>('list');
  const [editId, setEditId] = useState<number | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [userName, setUserName] = useState<string>('');
  const [tempUserName, setTempUserName] = useState('');
  const [currentController, setCurrentController] = useState<string>('');
  const [activeSidebarMenu, setActiveSidebarMenu] = useState<SidebarMenu>('none');
  const [isDiceTrayOpen, setIsDiceTrayOpen] = useState(false);

  const [isHitPointsOpen, setIsHitPointsOpen] = useState(false);
  const [hitPointsPos, setHitPointsPos] = useState(() => ({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 150 }));

  const [reviewHealthOwner, setReviewHealthOwner] = useState<string | null>(null);
  const [reviewHealthPos, setReviewHealthPos] = useState(() => ({ x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 100 }));

  const [infoPanelPos, setInfoPanelPos] = useState(() => ({ x: window.innerWidth / 2 - 175, y: window.innerHeight / 2 - 200 }));
  const [diceTrayPos, setDiceTrayPos] = useState(() => ({ x: window.innerWidth / 2 - 240, y: window.innerHeight / 2 - 250 }));
  
  // Prevent HitPointsMenu and InfoWindow from overlapping when opened
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isHitPointsOpen && selectedLocation) {
        const dx = Math.abs(hitPointsPos.x - infoPanelPos.x);
        const dy = Math.abs(hitPointsPos.y - infoPanelPos.y);
        if (dx < 320 && dy < 300) {
            let newX = infoPanelPos.x + 320;
            if (newX + 300 > window.innerWidth) newX = Math.max(0, infoPanelPos.x - 320);
            setHitPointsPos({ x: newX, y: infoPanelPos.y });
        }
    }
  }, [isHitPointsOpen, selectedLocation]);

  const [chatPos, setChatPos] = useState(() => ({ x: window.innerWidth / 2 - 300, y: window.innerHeight / 2 - 200 }));
  const [bankPos, setBankPos] = useState(() => ({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150 }));
  const [adminBankPlayer, setAdminBankPlayer] = useState<string | null>(null);
  const [adminBankPos, setAdminBankPos] = useState(() => ({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 100 }));
  const [isAdminPayOpen, setIsAdminPayOpen] = useState(false);
  const [adminPayPos, setAdminPayPos] = useState(() => ({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 150 }));
  useEffect(() => {
    const handleClear = () => { (window as any).hasUnsavedChanges = false; };
    window.addEventListener('clearUnsavedChanges', handleClear);
    return () => window.removeEventListener('clearUnsavedChanges', handleClear);
  }, []);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [isBankOpen, setIsBankOpen] = useState(false);
  const [bankData, setBankData] = useState<{ balance: number, debt: number, firstPayDone?: boolean, highRollerDone?: boolean }>({ balance: 0, debt: 0 });
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Load notification preference from the user's rhombus data
  useEffect(() => {
    if (!userName || !locations.length) return;
    const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
    if (existing) {
        setNotificationsEnabled(existing.notifications_enabled !== 0);
    }
  }, [userName, locations.length]);

  useEffect(() => {
    if (isChatOpen) setHasUnreadChat(false);
  }, [isChatOpen]);

  const [notification, setNotification] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(() => { const saved = localStorage.getItem('audioEnabled'); return saved !== null ? JSON.parse(saved) : true; });
  const [masterVolume, setMasterVolume] = useState(() => { const saved = localStorage.getItem('masterVolume'); return saved !== null ? parseFloat(saved) : 0.5; });
  const [isBatchSelecting, setIsBatchSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [districtSelection, setDistrictSelection] = useState<number[]>([]);
  const [districtConfig, setDistrictConfig] = useState({ name: '', color: '#00ff00' });
  const [joinSelection, setJoinSelection] = useState<number[]>([]);
  const [selectedClassification, setSelectedClassification] = useState<string>('');
  const [roadSelectionBounds, setRoadSelectionBounds] = useState<{ min: THREE.Vector3, max: THREE.Vector3 } | null>(null);
  const [roadTrail, setRoadTrail] = useState<THREE.Vector3[][]>([]);
  const [waterTrail, setWaterTrail] = useState<THREE.Vector3[]>([]);
  const [roadDrawMode, setRoadDrawMode] = useState<'free' | 'straight'>('free');
  const [snapToGrid, setSnapToGrid] = useState(false);
    const [snapRotation, setSnapRotation] = useState(false);
  const [drawingRoadWidth, setDrawingRoadWidth] = useState(2.4);
  const [citySectionType, setCitySectionType] = useState<'MIXED' | 'CORPO' | 'URBAN' | 'SLUMS' | 'INDUSTRIAL'>('MIXED');
  const [genExcludeRoads, setGenExcludeRoads] = useState(false);
  const [rhombusState, setRhombusState] = useState(() => {
    const savedColor = localStorage.getItem('rhombusColor') || '#00ff00';
    const savedHpMax = parseInt(localStorage.getItem('rhombusHpMax') || '100', 10);
    const savedHpCurrent = parseInt(localStorage.getItem('rhombusHpCurrent') || '100', 10);
    const savedHpTemp = parseInt(localStorage.getItem('rhombusHpTemp') || '0', 10);
    return { active: false, color: savedColor, name: '', description: '', hp_max: savedHpMax, hp_current: savedHpCurrent, hp_temp: savedHpTemp };
  });

  // Load player configuration from the database when locations are fetched
  useEffect(() => {
    if (!userName || !locations.length) return;
    const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
    if (existing) {
        // DO NOT set active: true here. That should only happen when the user clicks 'DEPLOY'
        setRhombusState(prev => ({ ...prev, ...mergeRhombusHealthFromLocation(existing, prev) }));
    }
  }, [userName, locations.length]);

  // Sync player configuration to DB whenever they change it in the sidebar
  const syncRhombusToDB = async (newState: any) => {
    const existingList = locations.filter((l: any) => l.shape === 'rhombus' && l.owner === userName);
    for (const existing of existingList) {
        await fetch(`/api/locations/${existing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ ...existing, name: newState.name, description: newState.description, color: newState.color })
        });
    }
  };

  useEffect(() => {
    localStorage.setItem('rhombusColor', rhombusState.color);
    if (rhombusState.hp_max > 0) {
      localStorage.setItem('rhombusHpMax', rhombusState.hp_max.toString());
      localStorage.setItem('rhombusHpCurrent', (rhombusState.hp_current || rhombusState.hp_max).toString());
      localStorage.setItem('rhombusHpTemp', (rhombusState.hp_temp || 0).toString());
    }
  }, [rhombusState.color, rhombusState.hp_max, rhombusState.hp_current, rhombusState.hp_temp]);

  const groupedLocations = useMemo(() => {
    const groups: any = {};
    locations.forEach(loc => {
      const pid = loc.parent_id || 'root';
      if (!groups[pid]) groups[pid] = [];
      groups[pid].push(loc);
    });
    return groups;
  }, [locations]);

  const toggleSelection = (id: number) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); };

  const fetchCurrentLocBattleMaps = useCallback(() => {
    if (selectedLocation && selectedLocation.shape !== 'rhombus' && selectedLocation.shape !== 'enemy_rhombus') {
      fetch(`/api/locations/${selectedLocation.id}/battle_maps`)
        .then(res => res.json())
        .then(data => setCurrentLocBattleMaps(Array.isArray(data) ? data : []))
        .catch(() => setCurrentLocBattleMaps([]));
    }
  }, [selectedLocation?.id]);

  useEffect(() => {
    if (selectedLocation && selectedLocation.shape !== 'rhombus' && selectedLocation.shape !== 'enemy_rhombus') {
      fetchCurrentLocBattleMaps();
    } else {
      setCurrentLocBattleMaps([]);
    }
  }, [selectedLocation?.id]);

  const enterBattleMap = (locId: number) => {
    if (currentLocBattleMaps.length === 0) return;
    
    let targetFloor = 0;
    const userInMap = activeUsers.find((u: any) => u.isAdmin && u.currentBattleMapId && Number(u.currentBattleMapId) === Number(locId)) || activeUsers.find((u: any) => u.currentBattleMapId && Number(u.currentBattleMapId) === Number(locId));
    if (userInMap && userInMap.currentFloorIndex !== undefined) {
      targetFloor = Number(userInMap.currentFloorIndex);
    }

    if (userName && socketRef.current) {
        const userLoc = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
        if (userLoc) {
            socketRef.current.emit('requestInstantRhombusPurge', { id: userLoc.id, owner: userName });
        }
        setRhombusState((prev: any) => ({ ...prev, active: false }));
    }

    setActiveBattleMapData({ locationId: locId, maps: currentLocBattleMaps, currentFloorIndex: targetFloor });
    setView('battle_map');
    setSelectedLocation(null);
    if (socketRef.current) socketRef.current.emit('battle_map_enter', { locationId: locId, floorIndex: targetFloor });
  };

  const handleSaveDefault = () => {
    if (!socketRef.current || !activeBattleMapData) return;
    const positions: any[] = [];
    
    locations.forEach((l: any) => {
        if (l.shape === 'enemy_rhombus' && Number(l.battle_map_id) === Number(activeBattleMapData.locationId) && Number(l.floor_index) === Number(activeBattleMapData.currentFloorIndex)) {
            positions.push({ id: l.id, x: l.x, z: l.z, isEnemy: true, isFriendly: false });
        } else if (l.shape === 'friendly_rhombus' && Number(l.battle_map_id) === Number(activeBattleMapData.locationId) && Number(l.floor_index) === Number(activeBattleMapData.currentFloorIndex)) {
            positions.push({ id: l.id, x: l.x, z: l.z, isEnemy: false, isFriendly: true });
        }
    });
    
    Object.keys(battleMapPositions).forEach(userName => {
        const pos = battleMapPositions[userName];
        positions.push({ userName, x: pos.x, z: pos.z, isEnemy: false, isFriendly: false });
    });
    
    socketRef.current.emit('save_battle_map_default', { locationId: activeBattleMapData.locationId, floorIndex: activeBattleMapData.currentFloorIndex, positions });
    setNotification('DEFAULT_STATE_SAVED');
  };

  const handleLoadDefault = () => {
      if (!socketRef.current || !activeBattleMapData) return;
      socketRef.current.emit('load_battle_map_default', { locationId: activeBattleMapData.locationId, floorIndex: activeBattleMapData.currentFloorIndex });
      setNotification('LOADING_DEFAULT_STATE...');
  };

  const exitBattleMap = async () => {
    if (userName && token) {
        const battleMapRhombuses = locations.filter((l: any) => l.shape === 'rhombus' && l.owner === userName && l.battle_map_id != null);
        for (const r of battleMapRhombuses) {
            try { await fetch(`/api/locations/${r.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); } catch (e) {}
        }
        if (battleMapRhombuses.length > 0) fetchLocations();
    }
    
    setActiveBattleMapData(null);
    setView('list'); // or previous view
    setBattleMapPositions({});
    if (socketRef.current) socketRef.current.emit('battle_map_leave');
  };

  const handleBuildingClick = (loc: any) => {
    if (measureMode) return;
    if (isCopyingSize) {
        const rootId = loc.parent_id || loc.id;
        
        // If the clicked building IS the one currently being edited, read from live Three.js bounding box
        // so we capture the stretched (unsaved) size, not the stale database values.
        const isCurrentlyEdited = targetObject && (editData as any).id && ((editData as any).id === rootId || (editData as any).id === loc.id);
        
        let totalW: number, totalH: number, totalD: number;
        
        if (isCurrentlyEdited && targetObject) {
            // Compute bounding box of the live Three.js object (respects current scale)
            const box = new THREE.Box3().setFromObject(targetObject);
            const size = new THREE.Vector3();
            box.getSize(size);
            totalW = size.x;
            totalH = size.y;
            totalD = size.z;
        } else {
            // Read from database locations[] array (for saved buildings)
            const allParts = locations.filter((l: any) => l.id === rootId || l.parent_id === rootId);
            
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            
            const rootLoc = locations.find((l: any) => l.id === rootId) || loc;
            const rootAngle = rootLoc.rotation || 0;
            const cosA = Math.cos(-rootAngle);
            const sinA = Math.sin(-rootAngle);
            
            allParts.forEach((p: any) => {
                const dx = p.x - rootLoc.x;
                const dz = p.z - rootLoc.z;
                const localX = dx * cosA - dz * sinA;
                const localZ = dx * sinA + dz * cosA;
                
                const hW = p.width / 2;
                const hH = p.height;
                const hD = p.depth / 2;
                
                if (localX - hW < minX) minX = localX - hW;
                if (localX + hW > maxX) maxX = localX + hW;
                if (p.y < minY) minY = p.y;
                if (p.y + hH > maxY) maxY = p.y + hH;
                if (localZ - hD < minZ) minZ = localZ - hD;
                if (localZ + hD > maxZ) maxZ = localZ + hD;
            });
            
            totalW = maxX - minX;
            totalH = maxY - minY;
            totalD = maxZ - minZ;
        }
        
        // Guard against degenerate sizes
        if (!isFinite(totalW) || totalW <= 0) totalW = editData.width || 8;
        if (!isFinite(totalH) || totalH <= 0) totalH = editData.height || 16;
        if (!isFinite(totalD) || totalD <= 0) totalD = editData.depth || 8;

        if (editId && targetObject) {
            // EXISTING building: compute its current bounding box, then scale targetObject
            // so the building visually stretches to match the copied size.
            const editingParts = locations.filter((l: any) => l.id === editId || l.parent_id === editId);
            let curMinX = Infinity, curMaxX = -Infinity;
            let curMinY = Infinity, curMaxY = -Infinity;
            let curMinZ = Infinity, curMaxZ = -Infinity;
            const editRoot = locations.find((l: any) => l.id === editId);
            const eAngle = editRoot ? (editRoot.rotation || 0) : 0;
            const eCos = Math.cos(-eAngle);
            const eSin = Math.sin(-eAngle);
            editingParts.forEach((p: any) => {
                const dx = p.x - (editRoot?.x || 0);
                const dz = p.z - (editRoot?.z || 0);
                const lX = dx * eCos - dz * eSin;
                const lZ = dx * eSin + dz * eCos;
                if (lX - p.width/2 < curMinX) curMinX = lX - p.width/2;
                if (lX + p.width/2 > curMaxX) curMaxX = lX + p.width/2;
                if (p.y < curMinY) curMinY = p.y;
                if (p.y + p.height > curMaxY) curMaxY = p.y + p.height;
                if (lZ - p.depth/2 < curMinZ) curMinZ = lZ - p.depth/2;
                if (lZ + p.depth/2 > curMaxZ) curMaxZ = lZ + p.depth/2;
            });
            const curW = curMaxX - curMinX;
            const curH = curMaxY - curMinY;
            const curD = curMaxZ - curMinZ;
            // Apply scale ratio to the THREE.js group so the building stretches to match
            const scaleX = (curW > 0) ? totalW / curW : 1;
            const scaleY = (curH > 0) ? totalH / curH : 1;
            const scaleZ = (curD > 0) ? totalD / curD : 1;
            targetObject.scale.set(scaleX, scaleY, scaleZ);
            setEditData({ ...editData, baseWidth: curW, baseHeight: curH, baseDepth: curD });
        } else {
            // NEW building: update editData dimensions and reset scale
            setEditData({ ...editData, baseWidth: totalW, baseHeight: totalH, baseDepth: totalD, width: totalW, height: totalH, depth: totalD });
            if (targetObject) targetObject.scale.set(1, 1, 1);
            
            // If a generation type is already selected, regenerate at the new size (keep same type, cycle style)
            if (editorGenType) {
                const raw: any[] = [];
                let zoneVal = 0.5;
                if (editorGenType === 'CORPO') zoneVal = 0.9;
                else if (editorGenType === 'URBAN') zoneVal = 0.5;
                else if (editorGenType === 'SLUMS') zoneVal = 0.1;
                else if (editorGenType === 'INDUSTRIAL') zoneVal = -0.1;
                else if (editorGenType === 'LANDMARK') zoneVal = 1.5;
                else if (editorGenType === 'MARKETS') zoneVal = 2.0;
                else if (editorGenType === 'CUSTOM') zoneVal = 3.0;
                const baseMaxStyle = editorGenType === 'CORPO' ? 11 : editorGenType === 'URBAN' ? 10 : editorGenType === 'INDUSTRIAL' ? 10 : editorGenType === 'SLUMS' ? 1 : editorGenType === 'LANDMARK' ? 13 : editorGenType === 'MARKETS' ? 5 : 0;
                const customPoolSize = locations.filter((b: any) => b.classification === editorGenType && !b.parent_id).length;
                const maxStyle = baseMaxStyle + customPoolSize;
                if (maxStyle === 0) return;
                const currentStyle = editorStyleIndex % maxStyle;
                generateThemedBuildingsForPlot(0, 0, totalW, totalD, zoneVal, () => false, () => '', {}, raw, locations, undefined, totalH, currentStyle);
                setEditorStyleIndex(editorStyleIndex + 1);
                for (let i = 0; i < raw.length; i++) {
                    if (!raw[i].name) raw[i].name = editorGenType + '_';
                    if (editData.color) raw[i].color = editData.color;
                }
                setEditorGenParts(raw);
            }
        }
        
        setIsCopyingSize(false);
        return;
    }
    if (view === 'editor' || view === 'generator') return;
    if (isBatchSelecting) {
      toggleSelection(loc.id);
    } else if (view === 'district') {
      setDistrictSelection(prev => prev.includes(loc.id) ? prev.filter(i => i !== loc.id) : [...prev, loc.id]);
    } else if (view === 'join') {
        const getAllDescendants = (id) => {
          let ids = [id];
          const childrenList = locations.filter(l => l.parent_id === id);
          childrenList.forEach(c => {
            ids = ids.concat(getAllDescendants(c.id));
          });
          return ids;
        };
        const locIds = getAllDescendants(loc.id);

        setJoinSelection(prev => {
          const isSelected = prev.includes(loc.id);
          const next = isSelected 
             ? prev.filter(i => !locIds.includes(i))
             : Array.from(new Set([...prev, ...locIds]));

          if (next.length === locIds.length && !isSelected) {
            setSelectedClassification(loc.classification || '');
          } else if (next.length === 0) {
            setSelectedClassification('');
          }
          return next;
        });
      } else if (loc.shape === 'rhombus' && loc.owner !== userName && !token) {
        // Non-admin player clicking another player's token â€” open read-only health review
        setReviewHealthOwner(prev => prev === loc.owner ? null : loc.owner);
        setReviewHealthPos({ x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 100 });
      } else {
        setSelectedLocation(prev => prev?.id === loc.id ? null : loc);
      }
  };

  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Streamer mode: on the admin this is the source of truth (edited via director
  // panel / BROADCAST_THIS); on the spectator it's received via directorUpdate.
  const [directorState, setDirectorState] = useState<DirectorState>(DEFAULT_DIRECTOR_STATE);
  const [spectatorCount, setSpectatorCount] = useState(0);

  // Spectator boot path: no login, no chime, straight to the map.
  useEffect(() => {
    if (IS_SPECTATOR) {
      setUserName('SPECTATOR');
      setIsLoggedIn(true);
    }
  }, []);

  const {
    socketRef, tokenRef, userNameRef, wasGrantedForEditRef,
    activeUsers, chatMessages, setChatMessages,
    activePings, battleMapPositions, setBattleMapPositions,
    activeBattleMapData, setActiveBattleMapData,
    pendingRequests, setPendingRequests,
    isSomeoneEditing, setIsSomeoneEditing,
    isEditModalOpen, setIsEditModalOpen,
    activeEditLocation, setActiveEditLocation,
    emit,
  } = useSocket({
    userName, token, playerToken, isLoggedIn, isSpectator: IS_SPECTATOR,
    notificationsEnabled, isChatOpen,
    onFetchAll: fetchAll,
    onFetchGlobalSettings: fetchGlobalSettings,
    onFetchLocations: fetchLocations,
    onFetchRoads: fetchRoads,
    onFetchDistricts: fetchDistricts,
    onFetchWaterBodies: fetchWaterBodies,
    onFetchBattleMaps: fetchCurrentLocBattleMaps,
    onBankUpdate: (balance, debt, firstPayDone, highRollerDone) => setBankData({ balance, debt, firstPayDone, highRollerDone }),
    onBalancePaid: (balance, debt, firstPayDone, highRollerDone) => { setBankData({ balance, debt, firstPayDone, highRollerDone }); setIsBankOpen(true); },
    onNotification: setNotification,
    onHasUnreadChat: setHasUnreadChat,
    onTokenUpdate: setToken,
    onIsAdminUpdate: setIsAdmin,
    onRegistrationPending: (username) => {
      setPendingRegistrations(prev => prev.find(p => p.username === username) ? prev : [...prev, { username, created_at: new Date().toISOString() }]);
    },
    onRegistrationUpdated: (username) => {
      setPendingRegistrations(prev => {
        const next = prev.filter(p => p.username !== username);
        if (next.length === 0) setShowPendingPanel(false);
        return next;
      });
    },
    onPasswordResetRequested: (username, requestId) => {
      setPendingResets(prev => prev.find(r => r.requestId === requestId) ? prev : [...prev, { username, requestId }]);
    },
    onPasswordResetResolved: (_username, _action) => {
      // resolved entries are removed by the approve/deny handlers below
    },
    onDirectorUpdate: (state) => { if (IS_SPECTATOR) setDirectorState(state); },
    onSpectatorCount: setSpectatorCount,
  });

  // Admin-side director mutations: update local state and push to spectators.
  const updateDirector = useCallback((partial: Partial<DirectorState>) => {
    setDirectorState(prev => {
      const next = { ...prev, ...partial };
      socketRef.current?.emit('directorUpdate', next);
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLoggedIn) fetchAll();
  }, [isLoggedIn]);

  useEffect(() => {
    setTempBattleMapScale(null);
  }, [activeBattleMapData?.locationId, activeBattleMapData?.currentFloorIndex]);

  const toggleNotifications = () => {
    const nextState = !notificationsEnabled;
    setNotificationsEnabled(nextState);
    emit('updateNotifications', { userName, enabled: nextState });
  };

  // High-performance render list split
  const renderLists = useMemo(() => {
    const roots = groupedLocations['root'] || [];
    const simple: any[] = [];
    const interactive: any[] = [];

    roots.forEach((loc: any) => {
      if (loc.shape === 'rhombus' || loc.shape === 'enemy_rhombus' || loc.shape === 'friendly_rhombus') return;

      const children = groupedLocations[loc.id] || [];
      const isSelected = !isBatchSelecting && view !== 'district' && view !== 'join' && selectedLocation?.id === loc.id;
      const isBatchSelected = selectedIds.includes(loc.id) || districtSelection.includes(loc.id) || joinSelection.includes(loc.id);
      const isOverlapped = overlapIds.includes(loc.id) || children.some((c: any) => overlapIds.includes(c.id));
      const isBattleActive = activeUsers && activeUsers.some((user: any) => user.currentBattleMapId && Number(user.currentBattleMapId) === Number(loc.id));

      if (!isSelected && !isBatchSelected && !isOverlapped && !isBattleActive) {
        const pushSimple = (p: any) => {
          simple.push({
            id: p.id, shape: p.shape, polyCount: p.polyCount,
            x: p.x, y: p.y, z: p.z,
            width: p.width, height: p.height, depth: p.depth,
            color: p.color, rotation: p.rotation, rotation_x: p.rotation_x, rotation_z: p.rotation_z,
            district_color: p.district_color, isFavorite: p.isFavorite, isDanger: p.isDanger,
            name: p.name, description: p.description, npcs: p.npcs,
            rootLoc: loc,
          });
        };
        pushSimple(loc);
        children.forEach((c: any) => pushSimple(c));
      } else {
        interactive.push({ loc, children, isSelected, isBatchSelected, isOverlapped });
      }
    });
    return { simple, interactive };
  }, [groupedLocations, isBatchSelecting, view, selectedLocation, selectedIds, districtSelection, joinSelection, overlapIds, activeUsers]);

  const startupPlayed = useRef(false);

  useEffect(() => {
    localStorage.setItem('masterVolume', String(masterVolume));
    (window as any).masterVolume = masterVolume;
  }, [masterVolume]);

  useEffect(() => {
    localStorage.setItem('audioEnabled', JSON.stringify(audioEnabled));
    const loopSound = new Audio('/Loop_seamless_fixed.mp3');
    loopSound.loop = true; loopSound.volume = 0.01 * ((window as any).masterVolume ?? 0.5);
    const playAudio = async () => { if (audioEnabled) { try { await loopSound.play(); } catch (e) {} } };
    if (!audioEnabled) loopSound.pause();
    document.addEventListener('click', playAudio, { once: true });
    return () => { document.removeEventListener('click', playAudio); loopSound.pause(); };
  }, [audioEnabled, masterVolume]);

  const [isGeneratingMap, setIsGeneratingMap] = useState(false);

  const [transformMode, setTransformMode] = useState<'translate' | 'scale'>('translate');
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    const handleGlobalPointerUp = () => { setIsDragging(false); };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, []);
  const [editData, setEditData] = useState({ name: '', description: '', npcs: '', x: 0, y: 0, z: 0, width: 8, height: 16, depth: 8, baseWidth: 8, baseHeight: 16, baseDepth: 8, shape: 'box', color: '#00ff00', isFavorite: false, isDanger: false, owner: '', polyCount: 5 });
  const [editorGenParts, setEditorGenParts] = useState<any[]>([]);
  const [editorGenType, setEditorGenType] = useState<string>('');
  const [editorStyleIndex, setEditorStyleIndex] = useState(0);
  const [isCopyingSize, setIsCopyingSize] = useState(false);
  const [isPlantingTrees, setIsPlantingTrees] = useState(false);
  const [isDeployingEnemy, setIsDeployingEnemy] = useState(false);
  const [isDeployingFriendly, setIsDeployingFriendly] = useState(false);
  const [treeBatchSize, setTreeBatchSize] = useState(5);
  const [blockBuildings, setBlockBuildings] = useState<any[]>([]);

  const handleTreePlantClick = async (e: any) => {
      if (!isPlantingTrees || !isAdmin) return;
      e.stopPropagation();
      
      const cx = e.point.x;
      const cz = e.point.z;
      
      const root = {
          name: 'PARK',
          description: 'Holographic Forest Cluster',
          x: cx, y: 0, z: cz,
          width: 1.0, depth: 1.0, height: 0.1,
          color: '#1a5925', shape: 'none', polyCount: 5
      };
      
      const res = await fetch('/api/locations', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
          body: JSON.stringify(root) 
      });
      
      if (res.ok) {
          const result = await res.json();
          const rootId = result.data[0].id;
          
          const trees: any[] = [];
          const placedPoints: {x: number, z: number}[] = [];
          const minSpread = 2.5;
          const maxSpread = Math.max(3, treeBatchSize * 1.5);
          
          for (let i = 0; i < treeBatchSize; i++) {
              let px = cx;
              let pz = cz;
              
              if (treeBatchSize > 1) {
                  let attempts = 0;
                  while (attempts < 50) {
                      const r = Math.sqrt(Math.random()) * maxSpread;
                      const theta = Math.random() * Math.PI * 2;
                      px = cx + r * Math.cos(theta);
                      pz = cz + r * Math.sin(theta);
                      
                      const isFarEnough = placedPoints.every(p => Math.sqrt((p.x - px)**2 + (p.z - pz)**2) > minSpread);
                      if (isFarEnough) break;
                      attempts++;
                  }
              }
              
              placedPoints.push({x: px, z: pz});
              
              const trunkHFixed = 1.5;
              const canopyWFixed = 1.2;
              
              trees.push({
                  name: 'HOLOTREE_TRUNK', x: px, y: 0.1, z: pz, 
                  width: 0.15, depth: 0.15, height: trunkHFixed, 
                  color: '#00ff66', shape: 'cylinder', parent_id: Number(rootId), polyCount: 5
              });
              
              trees.push({
                  name: 'HOLOTREE_CANOPY', x: px, y: 0.1 + trunkHFixed, z: pz, 
                  width: canopyWFixed, depth: canopyWFixed, height: canopyWFixed, 
                  color: '#00ff66', shape: 'sphere', parent_id: Number(rootId), polyCount: 5
              });
          }
          
          await fetch('/api/locations', { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
              body: JSON.stringify(trees) 
          });
      }
  };
  const [targetObject, setTargetObject] = useState<any>(null);
  const genGroupRef = useRef<any>(null);
  const editMeshRef = useRef<any>(null);
  useEffect(() => {
    const savedName = localStorage.getItem('userName');
    if (savedName) { setUserName(savedName); setTempUserName(savedName); }
    fetch('/api/player/secure-mode').then(r => r.json()).then(d => setSecureModeEnabled(d.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userName || !isLoggedIn) return;
    const interval = setInterval(() => { fetch('/api/control').then(res => res.json()).then(data => setCurrentController(data.controller)).catch(err => console.error(err)); }, 2000);
    return () => clearInterval(interval);
  }, [userName, isLoggedIn]);

  useEffect(() => { if (view !== 'generator') setTargetObject(null); if (view !== 'editor') { setEditorGenParts([]); setEditorGenType(''); setIsCopyingSize(false); } }, [view]);

  const handleWaterDrawn = async (points: THREE.Vector3[]) => {
      try {
          const res = await fetch('/api/water', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ points })
          });
          if (res.ok) {
              fetchWaterBodies();
          } else {
              console.error("Failed to save water body");
          }
      } catch (err) {
          console.error("Error saving water body:", err);
      }
  };

  const batchDelete = async () => {
    if (selectedIds.length === 0) return;
    const res = await fetch('/api/locations/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { 
        fetchLocations(); 
        setSelectedIds([]); 
        setIsBatchSelecting(false); 
        // Force-deactivate Rhombus deployment state to prevent moving Admin character on next click
        setRhombusState((p: any) => ({ ...p, active: false }));
    }
  };

  useEffect(() => { if (isEditModalOpen && activeEditLocation) setEditData({ ...activeEditLocation, description: activeEditLocation.description ?? '', npcs: activeEditLocation.npcs ?? '', owner: activeEditLocation.owner ?? '', baseWidth: activeEditLocation.width, baseHeight: activeEditLocation.height, baseDepth: activeEditLocation.depth, polyCount: activeEditLocation.polyCount || 5, isFavorite: !!activeEditLocation.isFavorite, isDanger: !!activeEditLocation.isDanger }); }, [isEditModalOpen, activeEditLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) });
    const data = await res.json();
    if (data.token) {
      setToken(data.token); setIsAdmin(true); setShowAdminPanel(true);
      fetch('/api/player/admin/players/pending', { headers: { Authorization: `Bearer ${data.token}` } })
        .then(r => r.json()).then(rows => setPendingRegistrations(rows)).catch(() => {});
    } else { setNotification("LOGIN_FAILED"); }
  };

  const startBootSequence = (name = tempUserName, token?: string) => {
    if (!name.trim()) return;
    localStorage.setItem('userName', name);
    setUserName(name);
    setIsLoggedIn(true);
    if (socketRef.current) socketRef.current.emit('identify', token ? { userName: name, playerToken: token } : name);
    if (audioEnabled) { const s = new Audio('/StartUp.mp3'); s.volume = 0.20 * ((window as any).masterVolume ?? 0.5); s.play().catch(() => {}); }
  };

  const handleApprovePlayer = async (username: string) => {
    await fetch(`/api/player/admin/players/${username}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  };

  const handleDenyPlayer = async (username: string) => {
    await fetch(`/api/player/admin/players/${username}/deny`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  };

  const handleSendMessage = (text: string, senderOverride?: string) => {
    if (socketRef.current) {
        socketRef.current.emit('sendMessage', { sender: senderOverride || userName, text });
    }
  };

  const handleGrantAccess = (targetUser: string) => {
    if (socketRef.current && token) {
      socketRef.current.emit('grantElevatedAccess', { adminToken: token, targetUser });
    }
  };

  const handleRevokeAccess = (targetUser: string) => {
    if (socketRef.current && token) {
      socketRef.current.emit('revokeElevatedAccess', { adminToken: token, targetUser });
    }
  };

  const handleApproveReset = async (requestId: string) => {
    await fetch(`/api/player/admin/reset-request/${requestId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    setPendingResets(prev => prev.filter(r => r.requestId !== requestId));
  };

  const handleDenyReset = async (requestId: string) => {
    await fetch(`/api/player/admin/reset-request/${requestId}/deny`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    setPendingResets(prev => prev.filter(r => r.requestId !== requestId));
  };

  const handleLogout = () => {
    // 1. Immediately close all UI elements for a clean fade-out
    setIsChatOpen(false);
    setIsDiceTrayOpen(false);
    setIsHitPointsOpen(false);
    setReviewHealthOwner(null);
    setActiveSidebarMenu('none');
    setSelectedLocation(null);
    setTargetObject(null);
    setIsEditModalOpen(false);
    setIsBatchSelecting(false);
    setSelectedIds([]);
    setDistrictSelection([]);
    setJoinSelection([]);
    setRoadSelectionBounds(null);
    setRoadTrail([]);
    setCameraTarget(null);
    setShowAdminPanel(false);
    setIsBankOpen(false);
    setIsAdminPayOpen(false);
    setAdminBankPlayer(null);
    
    // Reset Rhombus state but keep color for next login preference
    setRhombusState((p: any) => ({ ...p, active: false }));

    if (socketRef.current && userName) {
        socketRef.current.emit('requestRhombusPurge', { owner: userName });
    }
    
    setNotification("TERMINATING_SESSION...");
    
    // 2. Wait for animation to finish before unmounting map
    setTimeout(() => {
        if (socketRef.current) socketRef.current.disconnect();
        setToken('');
        setIsAdmin(false);
        setIsLoggedIn(false);
        setNotification(null);
    }, 2500);
  };

  const cleanupEditModal = () => {
      setIsEditModalOpen(false);
      if (socketRef.current) socketRef.current.emit('editingFinished');
      if (wasGrantedForEditRef.current) {
          if (socketRef.current) socketRef.current.emit('surrenderAccess', { token });
          setToken('');
          setIsAdmin(false);
          wasGrantedForEditRef.current = false;
      }
  };

  return (
    <div className="crt-container">
      <div className="scanlines"></div>
      {!isLoggedIn && !IS_SPECTATOR && (
        <SecureLogin
          secureModeEnabled={secureModeEnabled}
          audioEnabled={audioEnabled}
          onToggleAudio={() => setAudioEnabled(a => !a)}
          onSimpleLogin={(name) => startBootSequence(name)}
          onSecureLogin={(name, pToken) => { setPlayerToken(pToken); startBootSequence(name, pToken); }}
          onAdminLogin={(name, adminToken) => { setToken(adminToken); setIsAdmin(true); setShowAdminPanel(true); startBootSequence(name); }}
          onPendingsFetched={setPendingRegistrations}
          StatusLogDisplay={StatusLogDisplay}
        />
      )}
      {isLoggedIn && (
        <>
          {!IS_SPECTATOR && <div className="ui-overlay">
      {showBattleMapManager && (selectedLocation || activeEditLocation || editId) && (
        <BattleMapManager locationId={selectedLocation ? selectedLocation.id : (activeEditLocation ? activeEditLocation.id : (editId as number))} token={token} onClose={() => setShowBattleMapManager(false)} onMapsChanged={fetchCurrentLocBattleMaps} />
      )}
      {view === 'battle_map' && activeBattleMapData && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 2000 }}>
          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'auto' }}>
            <h2 style={{ margin: 0, textShadow: '0 0 10px #00ff00', fontSize: '2em' }}>{activeBattleMapData.maps[activeBattleMapData.currentFloorIndex]?.designation?.toUpperCase() || 'UNKNOWN FLOOR'}</h2>
            <button onClick={exitBattleMap} style={{ padding: '10px 30px', marginTop: '10px', backgroundColor: '#ff0000', color: 'white', border: '1px solid #ff0000', cursor: 'pointer', fontWeight: 'bold' }}>EXIT</button>
          </div>
          {isAdmin && isPrimaryAdmin && (
            <div style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '10px', pointerEvents: 'auto' }}>
              {activeBattleMapData.maps.map((m: any, idx: number) => {
                let lbl = m.designation;
                if (lbl === 'Lobby') lbl = 'Lby';
                else if (lbl === 'Penthouse') lbl = 'PH';
                else if (lbl.startsWith('Level ')) lbl = 'L' + lbl.split(' ')[1];
                
                return (
                  <button key={m.id} 
                    style={{ padding: '15px', backgroundColor: activeBattleMapData.currentFloorIndex === idx ? '#00ff00' : '#222', color: activeBattleMapData.currentFloorIndex === idx ? '#000' : '#00ff00', border: '1px solid #00ff00', cursor: 'pointer', fontWeight: 'bold' }}
                    onClick={() => {
                      setActiveBattleMapData((p: any) => ({ ...p, currentFloorIndex: idx }));
                      if (socketRef.current) socketRef.current.emit('admin_force_floor_change', { locationId: activeBattleMapData.locationId, floorIndex: idx });
                    }}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
            {notification && <div className="modal-overlay" onClick={() => setNotification(null)} style={{cursor: 'pointer'}}><div className="panel" style={{color: '#ff0000', borderColor: '#ff0000'}}><h2 style={{fontSize: '2rem'}}>{notification}</h2></div></div>}
            {isEditModalOpen && activeEditLocation && (
              <div className="modal-overlay"><div className="panel"><h2>EDIT_DATA_POINT</h2><form onSubmit={async (e) => { e.preventDefault(); const res = await fetch(`/api/locations/${activeEditLocation.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(editData) }); if (res.ok) { setNotification("DATA_POINT_UPDATED"); cleanupEditModal(); } }} style={{display: 'flex', flexDirection: 'column', gap: '10px'}}><label>NAME</label><input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} style={{width: '100%'}} /><div style={{display: 'flex', gap: '10px', width: '100%'}}><div style={{flex: 1}}><label>DESCRIPTION</label><textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} style={{width: '100%', height: '100px'}} /></div><div style={{flex: 1}}><label>RESIDENTS</label><textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} style={{width: '100%', height: '100px'}} /></div></div><div style={{display: 'flex', gap: '10px', marginTop: '10px'}}><button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></button><button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button></div>{isAdmin && isPrimaryAdmin && editData.shape !== 'enemy_rhombus' && <button type="button" className="upload-btn" style={{backgroundColor: '#5500ff'}} onClick={() => setShowBattleMapManager(true)}>BATTLE MAPS</button>}<button type="submit" className="upload-btn">SAVE</button><button type="button" className="utility-btn" onClick={() => { cleanupEditModal(); }}>CLOSE</button></form></div></div>
            )}
            <Sidebar
              activeMenu={activeSidebarMenu}
              setActiveMenu={setActiveSidebarMenu}
              locations={locations}
              isBankOpen={isBankOpen}
              setIsBankOpen={setIsBankOpen}
              onSelect={setSelectedLocation}
              onZoom={setCameraTarget}
              selectedLocation={selectedLocation}
              userName={userName}
              token={token}
              onLogout={handleLogout}
              audioEnabled={audioEnabled}
              setAudioEnabled={setAudioEnabled}
              masterVolume={masterVolume}
              setMasterVolume={setMasterVolume}
              rhombusState={rhombusState}
              setRhombusState={setRhombusState}
              refreshLocations={fetchLocations}
              socketRef={socketRef}
              isChatOpen={isChatOpen}
              setIsChatOpen={setIsChatOpen}
              hasUnreadChat={hasUnreadChat}
              syncRhombusToDB={syncRhombusToDB}
              view={view}
              activeBattleMapData={activeBattleMapData}
              isHitPointsOpen={isHitPointsOpen}
              setIsHitPointsOpen={setIsHitPointsOpen}
              activeUsers={activeUsers}
              setIsDiceTrayOpen={setIsDiceTrayOpen}
              setNotification={setNotification}
              measureMode={measureMode}
              setMeasureMode={setMeasureMode}
              />
            <header style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                <div></div>

                {cameraTarget && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_ACTION: ZOOM TO POI IN PROGRESS `}<span style={{ width: '10px', display: 'inline-block' }}>{['|', '/', '-', '\\'][Math.floor(Date.now() / 150) % 4]}</span></div>}
                {showZoomComplete && !cameraTarget && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_STATUS: ZOOM COMPLETE`}</div>}
                {view === 'city_gen' && !roadSelectionBounds && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_PROMPT: LEFT-CLICK + DRAG TO SELECT GENERATION AREA`}</div>}
                {view === 'draw_roads' && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '20px', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 'bold', textShadow: 'var(--glow)', padding: '5px 15px', background: 'rgba(0, 20, 0, 0.4)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300 }}>{`SYSTEM_PROMPT: HOLD LEFT-CLICK + DRAG TO DRAW PATH`}</div>}
                {measureMode && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: view === 'battle_map' ? '140px' : '20px', color: '#ff4444', fontSize: '0.8rem', fontWeight: 'bold', textShadow: '0 0 5px #ff0000', padding: '5px 15px', background: 'rgba(20, 0, 0, 0.6)', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 300, border: '1px solid #ff4444' }}>{`SYSTEM_ALERT: MAP CAMERA LOCKED // MEASUREMENT ACTIVE`}</div>}
                <div style={{display: 'flex', gap: '10px'}}>
                  {token && <button className={`admin-toggle ${pendingRequests.length > 0 && !showAdminPanel ? 'unread-flash' : ''}`} onClick={() => setShowAdminPanel(!showAdminPanel)}>{showAdminPanel ? 'HIDE_DASHBOARD' : 'SHOW_DASHBOARD'}</button>}
                  {token && pendingRegistrations.length > 0 && (
                    <button className={`admin-toggle unread-flash`} onClick={() => setShowPendingPanel(p => !p)}>
                      PENDING_APPROVALS [{pendingRegistrations.length}]
                    </button>
                  )}
                  {(!secureModeEnabled || token) && <button className="admin-toggle" onClick={() => !token && setIsAdmin(!isAdmin)}>{token ? 'ADMIN_MODE' : (isAdmin ? 'CANCEL' : 'ADMIN_LOGIN')}</button>}
                </div>
              </div>
            </header>
            {isAdmin && !token && <div className="panel admin-login"><form onSubmit={handleLogin}><input placeholder="USERNAME" onChange={e => setLoginForm({...loginForm, username: e.target.value})} /><input type="password" placeholder="PASSWORD" onChange={e => setLoginForm({...loginForm, password: e.target.value})} /><button type="submit">ACCESS_SYSTEM</button></form></div>}
            {token && showPendingPanel && (
              <div className="panel" style={{ position: 'absolute', top: '60px', right: '10px', zIndex: 500, minWidth: '280px', maxHeight: '400px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', letterSpacing: '3px', marginBottom: '10px', borderBottom: '1px solid var(--green)', paddingBottom: '6px' }}>
                  <span>PENDING_APPROVALS</span>
                  <button className="admin-toggle" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => setShowPendingPanel(false)}>×</button>
                </div>
                {pendingRegistrations.length === 0
                  ? <div style={{ fontSize: '0.65rem', opacity: 0.5 }}>No pending registrations</div>
                  : pendingRegistrations.map(p => (
                    <div key={p.username} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(0,255,0,0.1)' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem' }}>{p.username}</div>
                        <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>{new Date(p.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="upload-btn" style={{ fontSize: '0.65rem', padding: '4px 8px' }} onClick={() => handleApprovePlayer(p.username)}>APPROVE</button>
                        <button className="utility-btn" style={{ fontSize: '0.65rem', padding: '4px 8px', color: '#ff3333', borderColor: '#ff3333' }} onClick={() => handleDenyPlayer(p.username)}>DENY</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
            {token && pendingResets.map((r, i) => (
              <div key={r.requestId} className="panel" style={{ position: 'absolute', top: `${70 + i * 120}px`, right: '10px', zIndex: 501, minWidth: '280px', border: '1px solid #ffaa00' }}>
                <div style={{ fontSize: '0.65rem', letterSpacing: '3px', marginBottom: '8px', color: '#ffaa00' }}>PASSWORD_RESET_REQUESTED</div>
                <div style={{ fontSize: '0.8rem', marginBottom: '10px' }}>{r.username}</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="upload-btn" style={{ flex: 1, fontSize: '0.65rem', padding: '4px 8px' }} onClick={() => handleApproveReset(r.requestId)}>APPROVE</button>
                  <button className="utility-btn" style={{ flex: 1, fontSize: '0.65rem', padding: '4px 8px', color: '#ff3333', borderColor: '#ff3333' }} onClick={() => handleDenyReset(r.requestId)}>DENY</button>
                </div>
              </div>
            ))}
            {token && showAdminPanel && (
              <AdminPanel
                isAdmin={isAdmin}
                setIsAdminPayOpen={setIsAdminPayOpen}
                isPrimaryAdmin={isPrimaryAdmin}
                setShowBattleMapManager={setShowBattleMapManager}
                isPlantingTrees={isPlantingTrees} setIsPlantingTrees={setIsPlantingTrees}
                  treeBatchSize={treeBatchSize} setTreeBatchSize={setTreeBatchSize}
                  isDeployingEnemy={isDeployingEnemy} setIsDeployingEnemy={setIsDeployingEnemy}
                  isDeployingFriendly={isDeployingFriendly} setIsDeployingFriendly={setIsDeployingFriendly}
                  handleSaveDefault={handleSaveDefault} handleLoadDefault={handleLoadDefault}
                  socketRef={socketRef}
                token={token}
                userName={userName}
                controlsRef={controlsRef}
                onLogout={() => { setToken(''); setIsAdmin(false); setShowAdminPanel(false); }}
                tempCityMapScale={tempCityMapScale}
                setTempCityMapScale={setTempCityMapScale}
                globalSettings={globalSettings}
                fetchGlobalSettings={fetchGlobalSettings}
                tempBattleMapScale={tempBattleMapScale}
                setTempBattleMapScale={setTempBattleMapScale}
                activeBattleMapData={activeBattleMapData}
                refreshLocations={fetchLocations}
                refreshRoads={fetchRoads}
                districts={districts}
                fetchDistricts={fetchDistricts}
                editingDistrict={editingDistrict}
                setEditingDistrict={setEditingDistrict}
                locations={locations} 
                roads={roads} 
                editData={editData} 
                setEditData={setEditData} 
                editId={editId} 
                setEditId={setEditId} 
                transformMode={transformMode} 
                setTransformMode={setTransformMode} 
                targetObject={targetObject} 
                blockBuildings={blockBuildings} 
                setBlockBuildings={setBlockBuildings} 
                selectedLocation={selectedLocation} 
                setSelectedLocation={setSelectedLocation} 
                setTargetObject={setTargetObject} 
                view={view} 
                setView={setView} 
                pendingRequests={pendingRequests} 
                setPendingRequests={setPendingRequests} 
                isBatchSelecting={isBatchSelecting} 
                setIsBatchSelecting={setIsBatchSelecting} 
                selectedIds={selectedIds} 
                setSelectedIds={setSelectedIds}
                toggleSelection={toggleSelection} 
                batchDelete={batchDelete} 
                districtSelection={districtSelection} 
                setDistrictSelection={setDistrictSelection} 
                districtConfig={districtConfig} 
                setDistrictConfig={setDistrictConfig} 
                joinSelection={joinSelection} 
                setJoinSelection={setJoinSelection} 
                selectedClassification={selectedClassification}
                setSelectedClassification={setSelectedClassification} 
                roadSelectionBounds={roadSelectionBounds} 
                setRoadSelectionBounds={setRoadSelectionBounds} 
                roadTrail={roadTrail} 
                setRoadTrail={setRoadTrail} 
                waterTrail={waterTrail}
                setWaterTrail={setWaterTrail}
                fetchWaterBodies={fetchWaterBodies}
                roadDrawMode={roadDrawMode} 
                setRoadDrawMode={setRoadDrawMode} 
                snapToGrid={snapToGrid} 
                  setSnapToGrid={setSnapToGrid}
                  snapRotation={snapRotation}
                  setSnapRotation={setSnapRotation}
                drawingRoadWidth={drawingRoadWidth}
                setDrawingRoadWidth={setDrawingRoadWidth}
                isGeneratingMap={isGeneratingMap}
                setIsGeneratingMap={setIsGeneratingMap}
                citySectionType={citySectionType}
                setCitySectionType={setCitySectionType}
                genExcludeRoads={genExcludeRoads}
                setGenExcludeRoads={setGenExcludeRoads}
                setRhombusState={setRhombusState}
                setActiveSidebarMenu={setActiveSidebarMenu}
                editorGenParts={editorGenParts}
                setEditorGenParts={setEditorGenParts}
                editorGenType={editorGenType}
                setEditorGenType={setEditorGenType}
                editorStyleIndex={editorStyleIndex}
                setEditorStyleIndex={setEditorStyleIndex}
                isCopyingSize={isCopyingSize}
                setIsCopyingSize={setIsCopyingSize}
                secureModeEnabled={secureModeEnabled}
                />
            )}
            {adminBankPlayer && (
              <AdminBankWindow
                  pos={adminBankPos}
                  setPos={setAdminBankPos}
                  onClose={() => setAdminBankPlayer(null)}
                  targetUser={adminBankPlayer}
                  socket={socketRef.current}
                  token={token}
              />
            )}
            {isAdminPayOpen && (
              <AdminPayWindow
                  pos={adminPayPos}
                  setPos={setAdminPayPos}
                  onClose={() => setIsAdminPayOpen(false)}
                  socket={socketRef.current}
                  token={token}
                  activeUsers={activeUsers}
              />
            )}
            <BankWindow
                pos={bankPos}
                setPos={setBankPos}
                onClose={() => setIsBankOpen(false)}
                bankData={bankData}
                socket={socketRef.current}
                userName={userName}
                isBankOpen={isBankOpen}
                firstPayDone={bankData.firstPayDone}
                highRollerDone={bankData.highRollerDone}
                audioEnabled={audioEnabled}
                soundVolumes={{
                  cashregister: parseFloat(globalSettings?.bank_vol_cashregister ?? '1'),
                  debtpaid: parseFloat(globalSettings?.bank_vol_debtpaid ?? '1'),
                  highroller: parseFloat(globalSettings?.bank_vol_highroller ?? '1'),
                  firstpay: parseFloat(globalSettings?.bank_vol_firstpay ?? '1'),
                  overdraft: parseFloat(globalSettings?.bank_vol_overdraft ?? '1'),
                }}
            />
              <ChatWindow 
                  pos={chatPos} 
                  setPos={setChatPos} 
                  onClose={() => setIsChatOpen(false)} 
                  messages={chatMessages} 
                  activeUsers={activeUsers} 
                  userName={userName}
                  onSendMessage={handleSendMessage}
                  notificationsEnabled={notificationsEnabled}
                  onToggleNotifications={toggleNotifications}
                  isPrimaryAdmin={isPrimaryAdmin}
                  onGrantAccess={handleGrantAccess}
                  onRevokeAccess={handleRevokeAccess}
                  onOpenPlayerInfo={(targetUserName) => {
                    const rhombus = locations.find((l: any) => l.shape === 'rhombus' && l.owner === targetUserName);
                    if (rhombus) {
                      setSelectedLocation(rhombus);
                    } else {
                      const isOnline = activeUsers.some((u: any) => u.userName === targetUserName);
                      setSelectedLocation({ id: -1, shape: 'rhombus', owner: targetUserName, name: targetUserName, description: isOnline ? 'OPERATOR_ONLINE — beacon not yet deployed' : 'OPERATOR_OFFLINE — no beacon on map', x: 0, y: 0, z: 0, width: 0, height: 0, depth: 0 } as any);
                    }
                  }}
                  socket={socketRef.current}
                  token={token}
                  isChatOpen={isChatOpen}
              />
            {isHitPointsOpen && (
              <HitPointsMenu 
                targetRhombus={(() => {
                  if (selectedLocation && selectedLocation.id !== -1) {
                    return locations.find((l: any) => l.id === selectedLocation.id) ?? null;
                  }
                  if (selectedLocation?.owner) {
                    return locations.find((l: any) => l.shape === 'rhombus' && l.owner === selectedLocation.owner) ?? null;
                  }
                  return locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName) ?? null;
                })()}
                token={token} 
                refreshLocations={fetchLocations}
                pos={hitPointsPos}
                setPos={setHitPointsPos}
                onClose={() => setIsHitPointsOpen(false)}
              />
            )}
            {reviewHealthOwner && (() => {
              const reviewLoc = locations.find((l: any) => l.shape === 'rhombus' && l.owner === reviewHealthOwner)
                ?? (selectedLocation?.owner === reviewHealthOwner ? selectedLocation : null);
              return reviewLoc ? (
                <HealthReviewWindow
                  location={reviewLoc}
                  pos={reviewHealthPos}
                  setPos={setReviewHealthPos}
                  onClose={() => setReviewHealthOwner(null)}
                />
              ) : null;
            })()}
            {isDiceTrayOpen && (
                <DiceTrayWindow
                    pos={diceTrayPos} 
                    setPos={setDiceTrayPos} 
                    onClose={() => setIsDiceTrayOpen(false)}
                    socketRef={socketRef}
                />
            )}
            {(() => {
              const isRhombus = selectedLocation?.shape === 'rhombus' || selectedLocation?.shape === 'enemy_rhombus' || selectedLocation?.shape === 'friendly_rhombus';
              const isPlayerRhombus = selectedLocation?.shape === 'rhombus';
              const isOwner = selectedLocation?.owner === userName;
              const isAdmin = token !== '';
              const canManage = isRhombus && (isAdmin || (isPlayerRhombus && isOwner));
              
              // Show window if not admin OR if it's a rhombus that needs management OR just to view info
              if (selectedLocation && (!token || !showAdminPanel || canManage)) {
                return (
                  <DraggableWindow 
                    title={isUserDefinedName(selectedLocation.name) ? selectedLocation.name : (selectedLocation.shape === 'enemy_rhombus' ? 'HOSTILE_NODE' : (selectedLocation.shape === 'friendly_rhombus' ? 'FRIENDLY_NPC' : (selectedLocation.shape === 'rhombus' ? 'TACTICAL_BEACON' : getStructLabel(selectedLocation))))}
                    pos={infoPanelPos} 
                    setPos={setInfoPanelPos} 
                    onClose={() => setSelectedLocation(null)}
                  >
                    <div className="content">
                      {isRhombus ? (
                        <>
                          <p><strong>ID_TAG:</strong> {selectedLocation.name || (selectedLocation.shape === 'enemy_rhombus' ? 'UNKNOWN_HOSTILE' : (selectedLocation.shape === 'friendly_rhombus' ? 'UNKNOWN_FRIENDLY' : 'UNTAGGED'))}</p>
                          <p><strong>DATA_DESCRIPTION:</strong> {selectedLocation.description || 'NO_DATA'}</p>
                        </>
                      ) : (
                        <>
                          {selectedLocation.district_name && <p><strong>DISTRICT:</strong> {selectedLocation.district_name}</p>}
                          <p><strong>DESCRIPTION:</strong> {selectedLocation.description || 'NO_DATA'}</p>
                          <p><strong>RESIDENTS:</strong> {selectedLocation.npcs || 'UNKNOWN'}</p>
                        </>
                      )}
                    </div>
                    <button className="upload-btn" style={{marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', backgroundColor: 'var(--blue)', color: '#fff'}} onClick={() => {
                        if (socketRef.current) {
                            let pingX = selectedLocation.x;
                            let pingY = (selectedLocation.y || 0) + (selectedLocation.height / 2);
                            let pingZ = selectedLocation.z;
                            
                            if (targetObject) {
                                const box = new THREE.Box3().setFromObject(targetObject);
                                const center = new THREE.Vector3();
                                box.getCenter(center);
                                pingX = center.x;
                                pingY = center.y;
                                pingZ = center.z;
                            }
                            
                            const size = Math.max(selectedLocation.width, selectedLocation.height, selectedLocation.depth);
                            socketRef.current.emit('ping_location', {
                                x: pingX,
                                y: pingY,
                                z: pingZ,
                                color: rhombusState.color || '#00ccff',
                                size: size,
                                battle_map_id: view === 'battle_map' && activeBattleMapData ? activeBattleMapData.locationId : null,
                                floor_index: view === 'battle_map' && activeBattleMapData && activeBattleMapData.currentFloorIndex !== undefined ? activeBattleMapData.currentFloorIndex : null
                            });
                        }
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>
                        </svg>
                        BROADCAST PING
                    </button>
                    {isAdmin && (
                      <button className="upload-btn" style={{marginTop: '10px', backgroundColor: '#ff00aa', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}} title="Point the stream camera at this object" onClick={() => {
                          updateDirector({ cameraMode: 'director', target: computeBroadcastFraming(selectedLocation) });
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                        </svg>
                        BROADCAST_THIS
                      </button>
                    )}
                    {isAdmin && isPlayerRhombus && (
                      <button className="upload-btn" style={{marginTop: '10px', backgroundColor: '#00ff66', color: '#000'}} onClick={() => {
                          setAdminBankPlayer(selectedLocation.owner);
                      }}>VIEW_BANK</button>
                    )}
                    {canManage && (
                      <button className="upload-btn danger-btn" style={{marginTop: '10px'}} onClick={async () => {
                        const res = await fetch(`/api/locations/${selectedLocation.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                        if (res.ok) { setSelectedLocation(null); fetchLocations(); }
                      }}>PURGE_DATA_POINT</button>
                    )}
                    {isAdmin && (selectedLocation.shape === 'enemy_rhombus' || selectedLocation.shape === 'friendly_rhombus') && (
                      <button className="upload-btn" style={{marginTop: '10px'}} onClick={() => { setIsEditModalOpen(true); setActiveEditLocation(selectedLocation); setEditData({ ...selectedLocation, name: selectedLocation.name || '', description: selectedLocation.description || '', npcs: selectedLocation.npcs || '', owner: selectedLocation.owner || '', baseWidth: selectedLocation.width, baseHeight: selectedLocation.height, baseDepth: selectedLocation.depth, isFavorite: !!selectedLocation.isFavorite, isDanger: !!selectedLocation.isDanger }); }}>EDIT_DATA_POINT</button>
                    )}
                    {isRhombus && !isAdmin && !isOwner && (
                        <button className="upload-btn" style={{marginTop: '10px', backgroundColor: 'var(--dark-green)', color: 'var(--green)', border: '1px solid var(--green)'}} onClick={() => {
                            setReviewHealthOwner(selectedLocation.owner);
                            setReviewHealthPos({ x: infoPanelPos.x + 320 > window.innerWidth - 300 ? Math.max(0, infoPanelPos.x - 320) : infoPanelPos.x + 320, y: infoPanelPos.y });
                        }}>CHECK_HEALTH</button>
                    )}
                    {isRhombus && (isAdmin || (isPlayerRhombus && selectedLocation.owner === userName)) && (
                        <button className="upload-btn" style={{marginTop: '10px', backgroundColor: 'var(--green)', color: '#000'}} onClick={async () => {
                            let newX = infoPanelPos.x + 320;
                            if (newX + 300 > window.innerWidth) newX = Math.max(0, infoPanelPos.x - 320);
                            setHitPointsPos({ x: newX, y: infoPanelPos.y });
                            // If no real rhombus exists yet (synthetic location), create a default one
                            if (selectedLocation.id === -1 && selectedLocation.owner) {
                                const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === selectedLocation.owner);
                                if (!existing) {
                                    await fetch('/api/locations', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                        body: JSON.stringify({ name: selectedLocation.owner, description: '', shape: 'rhombus', owner: selectedLocation.owner, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 100, hp_max: 100, hp_temp: 0, battle_map_id: -1, floor_index: -1 })
                                    });
                                    await fetchLocations();
                                }
                            }
                            setIsHitPointsOpen(true);
                        }}>UPDATE_HEALTH</button>
                    )}
                    {isAdmin && isPrimaryAdmin && !isRhombus && (
      <></>
  )}
  {currentLocBattleMaps.length > 0 && (
      <button className="upload-btn" style={{backgroundColor: '#ff00ff', color: 'white'}} onClick={() => enterBattleMap(selectedLocation.id)}>ENTER BATTLE MAP</button>
  )}
  {!token && !isRhombus && <button className="upload-btn" onClick={() => { if (isSomeoneEditing) { setNotification("ANOTHER_USER_ACCESSING_DATA_POINTS"); } else { socketRef.current?.emit('requestEditing', { userId: userName, userName, locationId: selectedLocation.id, locationName: selectedLocation.name }); setNotification("REQUEST_SENT_TO_ADMIN"); } }}>REQUEST_EDITING_RIGHTS</button>}
                  </DraggableWindow>
                );
              }
              return null;
            })()}
            <div className="bottom-bar"><p>{token ? 'EDITOR_ACTIVE // USE GIZMO TO MANIPULATE DATA_POINT' : <StatusBarText />}</p></div>
          </div>}
          <Canvas shadows frameloop="always" onPointerDown={() => { if (!rhombusState.active) setActiveSidebarMenu('none'); }}>
            <CursorPingListener socket={socketRef.current} view={view} activeBattleMapData={activeBattleMapData} pingColor={rhombusState.color || '#00ccff'} />
            <MeasurementTool measureMode={measureMode} socket={socketRef.current} view={view} activeBattleMapData={activeBattleMapData} mapScaleMultiplier={view === 'battle_map' ? (() => {
                const loc = locations.find((l:any) => l.id === activeBattleMapData?.locationId);
                if (!loc) return 5;
                let scaleData: any = loc.map_scale_multiplier;
                let finalScale = 5;
                if (typeof scaleData === 'string' && scaleData.startsWith('[')) {
                    try {
                        const arr = JSON.parse(scaleData);
                        const idx = activeBattleMapData?.currentFloorIndex || 0;
                        if (arr[idx] !== undefined && arr[idx] !== null) finalScale = arr[idx];
                        else finalScale = arr[0] || 5;
                    } catch(e) {}
                } else {
                    finalScale = parseFloat(scaleData) || 5;
                }
                return finalScale;
            })() : (globalSettings?.map_scale_multiplier || 5)} color={rhombusState.color || '#00ff00'} userName={userName} />
            <MeasurementVisualizer socket={socketRef.current} view={view} activeBattleMapData={activeBattleMapData} userName={userName} />
            {view === 'battle_map' ? (
              activeBattleMapData && activeBattleMapData.maps[activeBattleMapData.currentFloorIndex] && (
                <BattleMapScene 
                  measureMode={measureMode}
                  mapUrl={activeBattleMapData.maps[activeBattleMapData.currentFloorIndex].image_url} 
                  onMapClick={(pos: any) => {
                    if (isDeployingEnemy && userName) {
                      const newRhombus = {
                          name: 'NEW ENEMY',
                          description: '',
                          x: pos.x, y: 0.1, z: pos.z,
                          width: 4, height: 4, depth: 4,
                          shape: 'enemy_rhombus',
                          color: '#ff0000',
                          owner: userName,
                          isDanger: false,
                          isFavorite: false,
                          npcs: '',
                          battle_map_id: activeBattleMapData?.locationId || null,
                          floor_index: activeBattleMapData?.currentFloorIndex !== undefined ? activeBattleMapData.currentFloorIndex : null
                      };
                      fetch('/api/locations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify(newRhombus)
                      }).then(() => {
                          fetchLocations();
                          setIsDeployingEnemy(false);
                      });
                    } else if (isDeployingFriendly && userName) {
                      const newRhombus = {
                          name: 'NEW FRIENDLY',
                          description: '',
                          x: pos.x, y: 0.1, z: pos.z,
                          width: 4, height: 4, depth: 4,
                          shape: 'friendly_rhombus',
                          color: '#00ccff',
                          owner: userName,
                          isDanger: false,
                          isFavorite: false,
                          npcs: '',
                          battle_map_id: activeBattleMapData?.locationId || null,
                          floor_index: activeBattleMapData?.currentFloorIndex !== undefined ? activeBattleMapData.currentFloorIndex : null
                      };
                      fetch('/api/locations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify(newRhombus)
                      }).then(() => {
                          fetchLocations();
                          setIsDeployingFriendly(false);
                      });
                    } else if (rhombusState?.active && userName) {
                      const existing = locations.find((l: any) => l.shape === 'rhombus' && l.owner === userName);
                      const newRhombus = {
                          name: rhombusState.name || '',
                          description: rhombusState.description || '',
                          x: pos.x, y: 0.1, z: pos.z,
                          width: 3.75, height: 3.75, depth: 3.75,
                          shape: 'rhombus',
                          color: rhombusState.color,
                          owner: userName,
                          ...resolveDeployHealth(existing, rhombusState),
                          battle_map_id: activeBattleMapData?.locationId || null,
                          floor_index: activeBattleMapData?.currentFloorIndex !== undefined ? activeBattleMapData.currentFloorIndex : null
                      };
                      if (existing) {
                          fetch(`/api/locations/${existing.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(newRhombus)
                          }).then(() => {
                              fetchLocations();
                              setRhombusState((prev: any) => ({ ...prev, active: false }));
                          });
                      } else {
                          fetch('/api/locations', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(newRhombus)
                          }).then(() => {
                              fetchLocations();
                              setRhombusState((prev: any) => ({ ...prev, active: false }));
                          });
                      }
                    }
                  }}
                />
              )
            ) : (
              <>
                <PerspectiveCamera makeDefault position={[0, 200, 250]} />
            <CameraControls ref={controlsRef} makeDefault enabled={!isDragging && !measureMode && !IS_SPECTATOR} dollyToCursor={true} mouseButtons={{ left: 2, right: 1, middle: 16, wheel: 16 }} />
            {IS_SPECTATOR && <SpectatorCameraRig socket={socketRef.current} controlsRef={controlsRef} directorState={directorState} />}
            {!IS_SPECTATOR && token !== '' && <AdminCameraBroadcaster socket={socketRef.current} controlsRef={controlsRef} enabled={directorState.cameraMode === 'mirror' && spectatorCount > 0} />}
            <OverlapChecker locations={locations} setOverlapIds={setOverlapIds} />
            <GlobalCameraCapture />
            <CursorPivotControls />
            <color attach="background" args={['#000000']} />
            {/* @ts-ignore */}
            {isPlantingTrees && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} onPointerDown={handleTreePlantClick}>
                    <planeGeometry args={[10000, 10000]} />
                    <meshBasicMaterial visible={false} />
                </mesh>
            )}
            <Grid raycast={() => null} infiniteGrid fadeDistance={750} fadeStrength={1.5} cellSize={1} cellThickness={0.7} sectionSize={10} sectionThickness={1.2} sectionColor="#006600" cellColor="#003300" />
            {token !== '' && (
              <group position={[0, 0.01, 0]}>
                {/* Center Lines (Blue) */}
                <mesh position={[0, 0, 0]} raycast={() => null}>
                  <boxGeometry args={[0.2, 0.01, 2000]} />
                  <meshBasicMaterial color="#0044ff" transparent opacity={0.6} />
                </mesh>
                <mesh position={[0, 0, 0]} raycast={() => null}>
                  <boxGeometry args={[2000, 0.01, 0.2]} />
                  <meshBasicMaterial color="#0044ff" transparent opacity={0.6} />
                </mesh>

                {/* Bifurcating Lines (White) */}
                <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 4, 0]} raycast={() => null}>
                  <boxGeometry args={[0.1, 0.01, 2000]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={0.4} />
                </mesh>
                <mesh position={[0, 0, 0]} rotation={[0, -Math.PI / 4, 0]} raycast={() => null}>
                  <boxGeometry args={[0.1, 0.01, 2000]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={0.4} />
                </mesh>
              </group>
            )}
            <CameraController target={cameraTarget} onComplete={() => { setCameraTarget(null); setShowZoomComplete(true); setTimeout(() => setShowZoomComplete(false), 3000); }} />
            <Roads roads={roads} />
            <WaterBodies waterBodies={waterBodies} />
            <GhostTraffic roads={roads} />
            <DistrictInteractions view={view} locations={locations} onSelectionChange={(data: any) => { if (view === 'city_gen') { setRoadSelectionBounds(data); } else if (view === 'district') { setDistrictSelection(prev => [...new Set([...prev, ...data])]); } else if (isBatchSelecting) { setSelectedIds(prev => [...new Set([...prev, ...data])]); } }} roadTrail={roadTrail} setRoadTrail={setRoadTrail} waterTrail={waterTrail} setWaterTrail={setWaterTrail} onWaterDrawEnd={handleWaterDrawn} roadDrawMode={roadDrawMode} snapToGrid={snapToGrid} drawingRoadWidth={drawingRoadWidth} isBatchSelecting={isBatchSelecting} setSelectedIds={setSelectedIds} rhombusState={rhombusState} setRhombusState={setRhombusState} userName={userName} refreshLocations={fetchLocations} token={token} />
            {roadSelectionBounds && view === 'city_gen' && (
              <mesh position={[(roadSelectionBounds.min.x + roadSelectionBounds.max.x) / 2, 0.02, (roadSelectionBounds.min.z + roadSelectionBounds.max.z) / 2]}>
                <boxGeometry args={[Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x), 0.05, Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z)]} />
                <meshBasicMaterial color="#00ff66" wireframe transparent opacity={0.3} />
              </mesh>
            )}
<InstancedBuildings buildings={renderLists.simple} onSelect={handleBuildingClick} isDragging={isDragging} />
            {renderLists.interactive.map(({ loc, children, isSelected, isBatchSelected, isOverlapped }: any) => (
              <Building key={loc.id} location={loc} children={children} onClick={() => handleBuildingClick(loc)} isSelected={isSelected} isBatchSelected={isBatchSelected} isOverlapped={isOverlapped} setTargetObject={setTargetObject} editMeshRef={editMeshRef} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} isDragging={isDragging} socket={socketRef.current} activeUsers={activeUsers} />
            ))}
            </>
            )}
            {/* Ping Effects */}
            {activePings.filter(ping => {
                const currentBattleMapId = view === 'battle_map' && activeBattleMapData ? activeBattleMapData.locationId : null;
                const currentFloorIndex = view === 'battle_map' && activeBattleMapData && activeBattleMapData.currentFloorIndex !== undefined ? activeBattleMapData.currentFloorIndex : null;
                // Strict comparison to ensure null === null or 1 === 1
                return Number(ping.battle_map_id) === Number(currentBattleMapId) && Number(ping.floor_index) === Number(currentFloorIndex);
            }).map(ping => (
                <PingEffect key={ping.id} position={[ping.x, ping.y !== undefined ? ping.y : 0.5, ping.z]} color={ping.color} size={ping.size ?? 1} />
            ))}
            
            {/* Dedicated Player Rhombus Rendering */}
            {locations.filter(l => l.shape === 'rhombus' && (
                (view === 'battle_map' && activeBattleMapData && Number(l.battle_map_id) === Number(activeBattleMapData.locationId) && Number(l.floor_index) === Number(activeBattleMapData.currentFloorIndex)) ||
                (view !== 'battle_map' && l.battle_map_id == null)
            )).map(loc => (
              <PlayerRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} userName={userName} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socketRef.current} activeUsers={activeUsers} roads={roads} isBattleMap={view === 'battle_map'} measureMode={measureMode} />
            ))}
            {/* Dedicated Enemy Rhombus Rendering */}
            {locations.filter(l => l.shape === 'enemy_rhombus' && (
                (view === 'battle_map' && activeBattleMapData && Number(l.battle_map_id) === Number(activeBattleMapData.locationId) && Number(l.floor_index) === Number(activeBattleMapData.currentFloorIndex)) ||
                (view !== 'battle_map' && l.battle_map_id == null)
            )).map(loc => (
              <EnemyRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socketRef.current} roads={roads} isBattleMap={view === 'battle_map'} measureMode={measureMode} />
            ))}
            {/* Dedicated Friendly NPC Rendering */}
            {locations.filter(l => l.shape === 'friendly_rhombus' && (
                (view === 'battle_map' && activeBattleMapData && Number(l.battle_map_id) === Number(activeBattleMapData.locationId) && Number(l.floor_index) === Number(activeBattleMapData.currentFloorIndex)) ||
                (view !== 'battle_map' && l.battle_map_id == null)
            )).map(loc => (
              <FriendlyRhombus key={loc.id} location={loc} onClick={() => handleBuildingClick(loc)} isSelected={selectedLocation?.id === loc.id} setTargetObject={setTargetObject} token={token} refreshLocations={fetchLocations} setIsDragging={setIsDragging} socket={socketRef.current} roads={roads} isBattleMap={view === 'battle_map'} measureMode={measureMode} />
            ))}
            {token && view === 'editor' && !editId && (
              <group ref={(group) => { if (group && targetObject !== group) { setTargetObject(group); editMeshRef.current = group; } }} position={[editData.x, editData.y, editData.z]}>
                {editorGenParts.length > 0 ? (
                  <>
                    {editorGenType === 'SLUMS' && (
                      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <circleGeometry args={[Math.max(editData.width, editData.depth) * 0.8, 32]} />
                        <meshBasicMaterial color="#00ff00" transparent opacity={0.3} wireframe />
                      </mesh>
                    )}
                    {editorGenParts.map((b, i) => {
                      const renderGenGeometry = () => { switch (b.shape) { case 'none': return <boxGeometry args={[0.001, 0.001, 0.001]} />; case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 5]} />; case 'sphere': return <sphereGeometry args={[0.5, 6, 6]} />; case 'pyramid': return <cylinderGeometry args={[0, 0.5, 1, 4]} />; default: return <boxGeometry args={[1, 1, 1]} />; } };
                      return (
                        <mesh key={i} userData={{ id: b.id }} position={[b.x, b.y + (b.height / 2), b.z]} scale={[b.width, b.height, b.depth]} rotation={new THREE.Euler(b.rotation_x || 0, b.rotation || 0, b.rotation_z || 0, 'YXZ')}>
                          {renderGenGeometry()}
                          <meshBasicMaterial color={b.color || "#00ff00"} wireframe />
                        </mesh>
                      );
                    })}
                  </>
                ) : editData.shape === 'enemy_rhombus' ? (
                  <mesh position={[0, editData.height / 4, 0]} scale={[editData.width, editData.height, editData.depth]}>
                    <octahedronGeometry args={[0.5]} />
                    <meshBasicMaterial color="#ff0000" wireframe />
                  </mesh>
                ) : editData.shape === 'friendly_rhombus' ? (
                  <mesh position={[0, editData.height / 4, 0]} scale={[editData.width, editData.height, editData.depth]}>
                    <coneGeometry args={[0.5, 0.8, 4]} />
                    <meshBasicMaterial color="#00ccff" wireframe />
                  </mesh>
                ) : (
                  <mesh position={[0, editData.height / 2, 0]} scale={[editData.width, editData.height, editData.depth]}>
                    {renderBaseGeometry(editData.shape, editData.polyCount || 5)}
                    <meshBasicMaterial color="#00ff00" wireframe />
                  </mesh>
                )}
              </group>
            )}
            {/* @ts-ignore */}
            {token && (view === 'editor' || view === 'generator') && targetObject && <TransformControls object={targetObject} mode={view === 'generator' ? 'translate' : transformMode} translationSnap={snapToGrid ? 1 : null} rotationSnap={snapRotation ? Math.PI / 18 : null} onDraggingChanged={(e: any) => setIsDragging(e.value)} />}
            {token && view === 'generator' && (
              <group ref={(group) => { 
                  if (group) {
                      if (targetObject && !targetObject.isObject3D) {
                          group.position.copy(targetObject.position);
                      }
                      genGroupRef.current = group; 
                      if (targetObject !== group) setTargetObject(group); 
                  }
              }}>
                  {blockBuildings.length > 0 ? (
                    blockBuildings.map((b, i) => {
                      const renderGenGeometry = () => { switch (b.shape) { case 'none': return <boxGeometry args={[0.001, 0.001, 0.001]} />; case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 5]} />; case 'sphere': return <sphereGeometry args={[0.5, 6, 6]} />; default: return <boxGeometry args={[1, 1, 1]} />; } };
                      return ( <mesh key={i} position={[b.x, b.y + (b.height / 2), b.z]} scale={[b.width, b.height, b.depth]}>{renderGenGeometry()}<meshBasicMaterial color="#ff00ff" wireframe /></mesh> );
                    })
                  ) : ( <mesh position={[0, 0, 0]}><boxGeometry args={[2, 4, 2]} /><meshBasicMaterial color="#ffff00" wireframe /></mesh> )}
                </group>
            )}
            <ambientLight intensity={0.5} />
          </Canvas>
        </>
      )}
    </div>
  );
}

export default App;





