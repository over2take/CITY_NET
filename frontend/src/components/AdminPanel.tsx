import React, { useState, useEffect } from 'react';
import { BUILDING_TYPES, shopsAvailable } from '../data/buildingTypes';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { isUserDefinedName, getStructLabel } from '../utils/locationHelpers';
import { consolidateRoads } from '../utils/roadHelpers';
import { generateThemedBuildingsForPlot } from './Buildings';
import { generateCity, SpatialGrid, seededRng, seedFrom, countGeneratedInRegion, type SectionType, type OverpassDensity, type LayoutType, type WaterType, type RoundaboutDensity } from '../cityGen';

/** Street layouts offered in the generator, with what each one reads as. */
const LAYOUT_OPTIONS: { value: LayoutType; label: string }[] = [
  { value: 'BSP', label: 'ORGANIC — IRREGULAR BLOCKS (DEFAULT)' },
  { value: 'GRID', label: 'GRID — PLANNED, SQUARE BLOCKS' },
  { value: 'SUPERBLOCK', label: 'SUPERBLOCK — TOWER IN PARK' },
  { value: 'RING', label: 'RING — BELTWAYS AND SPOKES' },
  { value: 'VORONOI', label: 'ORGANIC_CELLS — GREW, NOT PLANNED' },
  { value: 'PERIMETER', label: 'DOWNTOWN — DENSE BLOCKS, STREET WALL' },
];

/**
 * Water to generate. NONE is the default and the off switch — the selector doubles as
 * the disable, rather than a checkbox that could disagree with it.
 */
const WATER_OPTIONS: { value: WaterType; label: string }[] = [
  { value: 'NONE', label: 'NONE — DRAW YOUR OWN (DEFAULT)' },
  { value: 'RIVER', label: 'RIVER — DIVIDES THE CITY, BRIDGES IT' },
  { value: 'COAST', label: 'COAST — WATERFRONT ON ONE EDGE' },
  { value: 'LAKE', label: 'LAKE — AN OBSTACLE INSIDE IT' },
];
import type { BankSoundKey } from './BankWindows';
import { playCashRegister, playWompWomp, playCalibration, playProudFanfare, playHighRollerSound } from './BankWindows';
import { SignEditor, type SignData } from '../modules/signs';
import { BUILTIN_FONTS, type RemoteFont } from '../utils/fontLoader';

// ─── Custom Signs view ───────────────────────────────────────────────────────

import { PNG_EXPORT_PRESETS, DEFAULT_PNG_EXPORT_WIDTH } from '../utils/mapExportBounds';
import { RECORD_DURATIONS, MAX_RECORD_SECONDS } from '../hooks/useMapExport';
import { parseGrant, describeGrant } from '../utils/tokenControl';


// ─────────────────────────────────────────────────────────────────────────────

function BattleAdminPanel({
  token, isDeployingEnemy, setIsDeployingEnemy, isDeployingFriendly, setIsDeployingFriendly,
  tempBattleMapScale, setTempBattleMapScale, activeBattleMapData, locations, refreshLocations,
  handleSaveDefault, handleLoadDefault, setIsAdminPayOpen, secureModeEnabled, onLogout,
  globalSettings, fetchGlobalSettings, onOpenNpcLibrary, activeUsers,
}: any) {
  const [tab, setTab] = useState<'battle_map' | 'game'>('battle_map');

  const resolvedBattleMapScale = (() => {
    if (tempBattleMapScale !== null) return tempBattleMapScale;
    const loc = locations.find((l: any) => l.id === activeBattleMapData?.locationId);
    if (!loc) return 5;
    const idx = activeBattleMapData?.currentFloorIndex || 0;
    if (typeof loc.map_scale_multiplier === 'string' && loc.map_scale_multiplier.startsWith('[')) {
      try {
        const arr = JSON.parse(loc.map_scale_multiplier);
        return arr[idx] ?? 5;
      } catch { return 5; }
    }
    return parseFloat(loc.map_scale_multiplier) || 5;
  })();

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 4px', fontSize: '0.65rem', letterSpacing: '1px',
    background: active ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'transparent',
    color: active ? 'var(--green)' : 'color-mix(in srgb, var(--green) 50%, transparent)',
    border: 'none', borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
    cursor: 'pointer',
  });

  return (
    <div className="panel admin-panel" style={{ width: '300px', maxHeight: '90vh', overflowY: 'auto', pointerEvents: 'auto' }}>
      <h3 style={{ textShadow: 'var(--glow)', margin: '0 0 10px 0' }}>BATTLE ADMIN</h3>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--dark-green)', marginBottom: '12px' }}>
        <button style={tabStyle(tab === 'battle_map')} onClick={() => setTab('battle_map')}>BATTLE MAP</button>
        <button style={tabStyle(tab === 'game')} onClick={() => setTab('game')}>GAME</button>
      </div>

      {tab === 'battle_map' && <>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button className={`upload-btn deploy-btn${isDeployingEnemy ? ' deploying-enemy' : ''}`} onClick={() => { setIsDeployingEnemy(!isDeployingEnemy); setIsDeployingFriendly(false); }} style={{ flex: 1 }}>{isDeployingEnemy ? 'STOP_PLACING' : 'ADD_ENEMY'}</button>
          <button className={`upload-btn deploy-btn${isDeployingFriendly ? ' deploying-friendly' : ''}`} onClick={() => { setIsDeployingFriendly(!isDeployingFriendly); setIsDeployingEnemy(false); }} style={{ flex: 1 }}>{isDeployingFriendly ? 'STOP_PLACING' : 'ADD_FRIENDLY'}</button>
        </div>
        <div style={{ marginBottom: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px' }}>
          <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>
            MAP SCALE (FT/UNIT): {resolvedBattleMapScale}
          </label>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            <input type="range" min="0.1" max="50" step="0.1"
              value={resolvedBattleMapScale}
              onChange={(e) => setTempBattleMapScale(e.target.value)} style={{ flex: 1 }} />
            <input type="number" step="0.1"
              value={resolvedBattleMapScale}
              onChange={(e) => setTempBattleMapScale(e.target.value)} style={{ width: '60px', backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '5px' }} />
            <button className="utility-btn" onClick={() => {
              if (tempBattleMapScale === null) return;
              const loc = locations.find((l: any) => l.id === activeBattleMapData.locationId);
              if (loc) {
                let currentArr: any[] = [];
                if (typeof loc.map_scale_multiplier === 'string' && loc.map_scale_multiplier.startsWith('[')) {
                  try { currentArr = JSON.parse(loc.map_scale_multiplier); } catch (e) {}
                } else {
                  currentArr = [parseFloat(loc.map_scale_multiplier) || 5];
                }
                const idx = activeBattleMapData?.currentFloorIndex || 0;
                const parsedScale = parseFloat(tempBattleMapScale.toString());
                currentArr[idx] = !isNaN(parsedScale) ? parsedScale : 5;
                fetch(`/api/locations/${loc.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({ ...loc, map_scale_multiplier: JSON.stringify(currentArr) }),
                }).then(() => { setTempBattleMapScale(null); refreshLocations(); });
              }
            }}>APPLY</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px', borderBottom: '1px solid var(--green)', paddingBottom: '10px' }}>
          <button className="map-save-btn" onClick={handleSaveDefault}>SAVE_DEFAULT</button>
          <button className="map-load-btn" onClick={handleLoadDefault}>LOAD_DEFAULT</button>
        </div>
        <button className="utility-btn" onClick={() => setIsAdminPayOpen(true)} style={{ width: '100%', marginBottom: '10px' }}>PAY_PLAYERS</button>
        {!secureModeEnabled && <button className="utility-btn danger-btn" onClick={() => { onLogout(); }} style={{ width: '100%' }}>EXIT_ADMIN_MODE</button>}
      </>}

      {tab === 'game' && <>
        <TTRPGSystemPanel token={token} onOpenNpcLibrary={onOpenNpcLibrary} activeUsers={activeUsers} />
        <div style={{ marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px' }}>
          <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>CURRENCY_ICON</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['credits', '$', '£', '€', '🪙'] as const).map(opt => (
              <button
                key={opt}
                className={`utility-btn ${(globalSettings?.currency_icon || 'credits') === opt ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: opt === 'credits' ? '0.6rem' : '1rem' }}
                onClick={() => {
                  fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ key: 'currency_icon', value: opt }),
                  }).then(() => fetchGlobalSettings());
                }}
              >
                {opt === 'credits' ? 'DEFAULT' : opt}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setIsAdminPayOpen(true)} className="utility-btn" style={{ width: '100%', marginTop: '10px' }}>PAY_PLAYERS</button>
        <BankSoundsPanel token={token} globalSettings={globalSettings} fetchGlobalSettings={fetchGlobalSettings} />
      </>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function AdminPanel({
  socketRef, token, onLogout, refreshLocations, refreshRoads, locations, roads, editData, setEditData, editId, setEditId,
  transformMode, setTransformMode, targetObject, blockBuildings, setBlockBuildings, selectedLocation,
  setSelectedLocation, setTargetObject, isChatOpen, setIsChatOpen, controlsRef, view, setView, pendingRequests, setPendingRequests,
  isBatchSelecting, setIsBatchSelecting, selectedIds, setSelectedIds, toggleSelection, batchDelete,
  districtSelection, setDistrictSelection, districtConfig, setDistrictConfig,
  districts, fetchDistricts, editingDistrict, setEditingDistrict,
  assigningDistrict, setAssigningDistrict,
  hoveredStructureId, setHoveredStructureId,
  joinSelection, setJoinSelection, selectedClassification, setSelectedClassification, roadSelectionBounds, setRoadSelectionBounds,
  roadTrail, setRoadTrail, waterTrail, setWaterTrail, fetchWaterBodies, roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid, snapRotation, setSnapRotation,
  drawingRoadWidth, setDrawingRoadWidth, isGeneratingMap, setIsGeneratingMap, citySectionType, setCitySectionType,
  roadLayerMode, setRoadLayerMode, overpassHeight, setOverpassHeight, overpassRampLength, setOverpassRampLength,
  overpassSplitRamps, setOverpassSplitRamps, overpassRampLengthStart, setOverpassRampLengthStart, overpassRampLengthEnd, setOverpassRampLengthEnd,
  refreshOverpasses, overpasses, waterBodies,
  renderSidewalks, setRenderSidewalks,
  renderSignage, setRenderSignage,
  signageDensity, setSignageDensity,
  onRoadEraseModeChange,
  genExcludeRoads, setGenExcludeRoads, setRhombusState, setActiveSidebarMenu,
  editorGenParts, setEditorGenParts, editorGenType, setEditorGenType, editorStyleIndex, setEditorStyleIndex,
  isCopyingSize, setIsCopyingSize, isAdmin, isPrimaryAdmin, setShowBattleMapManager,
  isPlantingTrees, setIsPlantingTrees, treeBatchSize, setTreeBatchSize, userName,
    isDeployingEnemy, setIsDeployingEnemy, isDeployingFriendly, setIsDeployingFriendly, handleSaveDefault, handleLoadDefault,
    tempCityMapScale, setTempCityMapScale, globalSettings, fetchGlobalSettings, tempBattleMapScale, setTempBattleMapScale, activeBattleMapData, setIsAdminPayOpen,
    secureModeEnabled, currentLocBattleMaps, enterBattleMap,
    signs, fetchSigns, remoteFonts, setRemoteFonts, isPlacingSign, setIsPlacingSign, pendingSignPos, setPendingSignPos, selectedSignId, setSelectedSignId, signTransformMode, setSignTransformMode, signTransformActive, setSignTransformActive, handleUpdateSign, signMesh,
    activeUsers, onGrantAccess, onRevokeAccess, onOpenNpcLibrary, onToggleHidden,
    onExportPng, onStartRecording, onStopRecording, isRecording, isExporting, recordSecondsLeft,
    cityGenDrawMode, setCityGenDrawMode, genBoundaryTrail, setGenBoundaryTrail,
    cityLayout, setCityLayout, citySeed, setCitySeed, lastCitySeed, setLastCitySeed, cityWater, setCityWater, cityParkPonds, setCityParkPonds, cityRoundabouts, setCityRoundabouts,
  }: any) {
  if (view === 'battle_map') {
    return (
      <BattleAdminPanel
        token={token}
        isDeployingEnemy={isDeployingEnemy} setIsDeployingEnemy={setIsDeployingEnemy}
        isDeployingFriendly={isDeployingFriendly} setIsDeployingFriendly={setIsDeployingFriendly}
        tempBattleMapScale={tempBattleMapScale} setTempBattleMapScale={setTempBattleMapScale}
        activeBattleMapData={activeBattleMapData} locations={locations} refreshLocations={refreshLocations}
        handleSaveDefault={handleSaveDefault} handleLoadDefault={handleLoadDefault}
        setIsAdminPayOpen={setIsAdminPayOpen} secureModeEnabled={secureModeEnabled} onLogout={onLogout}
        globalSettings={globalSettings} fetchGlobalSettings={fetchGlobalSettings}
        onOpenNpcLibrary={onOpenNpcLibrary} activeUsers={activeUsers}
      />
    );
  }

  const [density, setDensity] = useState(8);
  const [overpassDensity, setOverpassDensity] = useState<OverpassDensity>('normal');
  const [allowedShapes, setAllowedShapes] = useState<string[]>(['box', 'cylinder', 'sphere']);
  const [activeUserEditing, setActiveUserEditing] = useState<any>(null);
  const [copyBuffer, setCopyBuffer] = useState<any>(null);

  const [fps, setFps] = useState(0);
  useEffect(() => {
    let lastTime = performance.now();
    let frames = 0;
    let animationId: number;

    const tick = () => {
      const now = performance.now();
      frames++;
      if (now >= lastTime + 1000) {
        setFps(Math.round((frames * 1000) / (now - lastTime)));
        frames = 0;
        lastTime = now;
      }
      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.on('editingStarted', (data: any) => setActiveUserEditing(data));
    socket.on('editingStopped', () => setActiveUserEditing(null));
    return () => { socket.off('editingStarted'); socket.off('editingStopped'); };
  }, [socketRef.current]);

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState<{ label: string; onConfirm: () => void } | null>(null);
  const [adminAlert, setAdminAlert] = useState<string | null>(null);
  const [adminTab, setAdminTab] = useState<'city' | 'export' | 'game' | 'players'>('city');
  const [showOfflinePlayers, setShowOfflinePlayers] = useState(false);
  const [customLibrary, setCustomLibrary] = useState<any[]>([]);
  const [customLibraryLoading, setCustomLibraryLoading] = useState(false);
  const [roadEraseMode, setRoadEraseModeLocal] = useState<'segment' | 'path'>('segment');
  const setRoadEraseMode = (m: 'segment' | 'path') => { setRoadEraseModeLocal(m); onRoadEraseModeChange?.(m); };
  const [roadPurgeConfirming, setRoadPurgeConfirming] = useState(false);
  const [overpassPurgeConfirming, setOverpassPurgeConfirming] = useState(false);
  // Map export toggles. Both default off: hidden structures stay out so a shared
  // export never leaks GM-only geometry, and tokens stay out so the result is a clean
  // city map rather than a snapshot of where everyone was standing. Per-export
  // preferences, so deliberately not persisted to global_settings.
  const [exportIncludeHidden, setExportIncludeHidden] = useState(false);
  const [exportIncludeTokens, setExportIncludeTokens] = useState(false);
  const [exportWidth, setExportWidth] = useState<number>(DEFAULT_PNG_EXPORT_WIDTH);
  // Grid defaults on — it reads as map paper under the city.
  const [exportIncludeGrid, setExportIncludeGrid] = useState(true);
  // Off by default — the themed background is what most exports want.
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportDuration, setExportDuration] = useState<number>(MAX_RECORD_SECONDS);

  // active_map_name changes when a map is loaded mid-session, but global settings are
  // only fetched on mount — refresh on entry so the filename is not stale.
  React.useEffect(() => {
    if (adminTab === 'export') fetchGlobalSettings?.();
  }, [adminTab, fetchGlobalSettings]);


  const getCenterGroundTarget = () => {
    let tx = 0, tz = 0;
    if (controlsRef.current) {
        const camera = controlsRef.current._camera || controlsRef.current.camera;
        if (camera) {
            const rc = new THREE.Raycaster();
            rc.setFromCamera(new THREE.Vector2(0, 0), camera);
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const target = new THREE.Vector3();
            rc.ray.intersectPlane(plane, target);
            tx = target.x; tz = target.z;
        } else if (controlsRef.current.getTarget) {
            const t = new THREE.Vector3();
            controlsRef.current.getTarget(t);
            tx = t.x; tz = t.z;
        }
    }
    return { tx, tz };
  };

  const startNew = () => {
    setEditId(null); setSelectedLocation(null);
    const { tx, tz } = getCenterGroundTarget();
    setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
    setEditData({ name: '', description: '', npcs: '', x: tx, y: 0, z: tz, width: 8, height: 16, depth: 8, baseWidth: 8, baseHeight: 16, baseDepth: 8, shape: 'box', color: '#00ff00', isFavorite: false, isDanger: false, owner: '', polyCount: 5 });
    setView('editor');
  };

  const startNewEnemy = () => {
    setEditId(null); setSelectedLocation(null);
    const { tx, tz } = getCenterGroundTarget();
    setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
    setEditData({
        name: '', description: '', npcs: '', x: tx, y: 0, z: tz,
        width: 1.875, height: 1.875, depth: 1.875,
        baseWidth: 1.875, baseHeight: 1.875, baseDepth: 1.875,
        shape: 'enemy_rhombus', color: 'var(--danger)', isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5,
        battle_map_id: activeBattleMapData?.locationId ?? null,
        floor_index: activeBattleMapData?.currentFloorIndex ?? null,
    });
    setView('editor');
  };

  const startNewFriendly = () => {
    setEditId(null); setSelectedLocation(null);
    const { tx, tz } = getCenterGroundTarget();
    setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
    setEditData({
        name: '', description: '', npcs: '', x: tx, y: 0, z: tz,
        width: 1.875, height: 1.875, depth: 1.875,
        baseWidth: 1.875, baseHeight: 1.875, baseDepth: 1.875,
        shape: 'friendly_rhombus', color: '#00ccff', isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5,
        battle_map_id: activeBattleMapData?.locationId ?? null,
        floor_index: activeBattleMapData?.currentFloorIndex ?? null,
    });
    setView('editor');
  };

  const startEdit = (loc: any) => {
    setEditId(loc.id);
    setEditData({ ...loc, description: loc.description ?? '', npcs: loc.npcs ?? '', owner: loc.owner ?? '', baseWidth: loc.width, baseHeight: loc.height, baseDepth: loc.depth, shape: loc.shape || 'box', polyCount: loc.polyCount || 5 });
    if (targetObject) targetObject.scale.set(1, 1, 1);
    setView('editor');
  };

  const generateBlock = () => {
    const newBuildings: any[] = []; const blockSize = 24; const rows = Math.ceil(Math.sqrt(density)); const cols = Math.ceil(density / rows);
    const plotW = (blockSize / cols); const plotD = (blockSize / rows);
    for (let i = 0; i < density; i++) {
      const r = Math.floor(i / cols); const c = i % cols;
      const x = (c * plotW) - (blockSize / 2) + (plotW / 2) + (Math.random() - 0.5) * (plotW * 0.3);
      const z = (r * plotD) - (blockSize / 2) + (plotD / 2) + (Math.random() - 0.5) * (plotD * 0.3);
      newBuildings.push({ name: '', description: '', npcs: '', x, y: 0, z, width: Math.max(1.5, plotW * 0.7), height: 2 + Math.random() * 15, depth: Math.max(1.5, plotD * 0.7), shape: 'box', color: '' });
    }
    setBlockBuildings(newBuildings);
  };

  const commitBlock = async () => {
    if (!targetObject) return;
    const finalBuildings = blockBuildings.map(b => ({ ...b, x: b.x + targetObject.position.x, z: b.z + targetObject.position.z, y: b.y + targetObject.position.y }));
    const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalBuildings) });
    if (res.ok) { setAdminAlert("BLOCK_PLACED"); refreshLocations(); setBlockBuildings([]); setView('list'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!targetObject) return;
    
    if (!editId) {
        if (editorGenParts && editorGenParts.length > 0) {
            const finalDataArray = editorGenParts.map(part => {
                const isRoot = !part.parent_name;
                const pos = new THREE.Vector3(part.x, part.y, part.z);
                pos.multiply(targetObject.scale);
                pos.applyEuler(new THREE.Euler(targetObject.rotation.x, targetObject.rotation.y, targetObject.rotation.z, 'YXZ'));
                  pos.add(targetObject.position);
                  
                  const targetQuat = targetObject.quaternion;
                  const partQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation_x || 0, part.rotation || 0, part.rotation_z || 0, 'YXZ'));
                  const finalQuat = targetQuat.clone().multiply(partQuat);
                  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'YXZ');

                  return {
                      ...editData,
                      name: isRoot ? editData.name : `${editData.name}_PART`,
                      description: isRoot ? editData.description : '',
                      npcs: isRoot ? editData.npcs : '',
                      x: pos.x,
                      y: pos.y,
                      z: pos.z,
                      width: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.width * targetObject.scale.x,
                      height: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.height * targetObject.scale.y,
                      depth: part.shape === 'sphere' ? Math.min(part.width * targetObject.scale.x, part.depth * targetObject.scale.z) : part.depth * targetObject.scale.z,
                      rotation: finalEuler.y,
                      rotation_x: finalEuler.x,
                      rotation_z: finalEuler.z,
                    shape: part.shape,
                    color: part.color,
                    parent_name: part.parent_name,
                    isFavorite: isRoot ? editData.isFavorite : false,
                    isDanger: isRoot ? editData.isDanger : false,
                };
            });
            const rootParts = finalDataArray.filter(p => !p.parent_name);
            const childParts = finalDataArray.filter(p => p.parent_name);
            
            const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rootParts) });
            if (res.ok) { 
                const rootData = await res.json();
                if (rootData.data && childParts.length > 0) {
                    const rootId = rootData.data[0].id;
                    childParts.forEach(c => c.parent_id = rootId);
                    await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(childParts) });
                }
                setAdminAlert("STRUCTURE_PLACED"); 
                targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); 
            }
            return;
        }

        let finalW = (editData.baseWidth || editData.width || 2) * targetObject.scale.x;
        let finalH = (editData.baseHeight || editData.height || 4) * targetObject.scale.y;
        let finalD = (editData.baseDepth || editData.depth || 2) * targetObject.scale.z;
        if (editData.shape === 'sphere') {
            const r = Math.min(finalW, finalD);
            finalW = r; finalH = r; finalD = r;
        }
        const finalData = { ...editData, x: targetObject.position.x, z: targetObject.position.z, y: targetObject.position.y, width: finalW, height: finalH, depth: finalD, rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z };
        const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalData) });
        if (res.ok) { setAdminAlert("STRUCTURE_PLACED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }
        return;
    }
    const children = locations.filter(l => l.parent_id === editId);
    const updates: any[] = [];
    const worldScale = new THREE.Vector3();
    const euler = new THREE.Euler().setFromQuaternion(targetObject.quaternion);

    targetObject.traverse((mesh: any) => {
        if (!mesh.isMesh || !mesh.userData || !mesh.userData.id) return;
        const partId = mesh.userData.id;
        const isRoot = partId === editId;
        const originalData = [editData, ...children].find(p => p.id === partId);
        if (!originalData) return;

        const worldPos = new THREE.Vector3(); mesh.getWorldPosition(worldPos);
          mesh.getWorldScale(worldScale);
          const meshWorldQuat = new THREE.Quaternion();
          mesh.getWorldQuaternion(meshWorldQuat);
          const meshEuler = new THREE.Euler().setFromQuaternion(meshWorldQuat, 'YXZ');
        
        let w = worldScale.x;
        let h = worldScale.y;
        let d = worldScale.z;
        
        if (originalData && originalData.shape === 'sphere') {
            const sphereR = Math.min(w, d);
            w = sphereR;
            h = sphereR;
            d = sphereR;
        }
        
        const mergedData = { ...originalData };
        if (!isRoot) {
            mergedData.name = editData.name;
            mergedData.description = editData.description;
            mergedData.npcs = editData.npcs;
            mergedData.color = editData.color;
            mergedData.district_name = editData.district_name;
            mergedData.district_color = editData.district_color;
            mergedData.isFavorite = editData.isFavorite;
            mergedData.isDanger = editData.isDanger;
        }

        updates.push({ ...mergedData, x: worldPos.x, y: worldPos.y - (h / 2), z: worldPos.z, width: w, height: h, depth: d, rotation: meshEuler.y, rotation_x: meshEuler.x, rotation_z: meshEuler.z });
    });
    if (updates.length === 0) {
        // Fallback for objects that might not have children with IDs (like simple boxes)
        let finalW = (editData.baseWidth || editData.width || 2) * targetObject.scale.x;
        let finalH = (editData.baseHeight || editData.height || 4) * targetObject.scale.y;
        let finalD = (editData.baseDepth || editData.depth || 2) * targetObject.scale.z;
        if (editData.shape === 'sphere') {
            const r = Math.min(finalW, finalD);
            finalW = r; finalH = r; finalD = r;
        }
        updates.push({ ...editData, x: targetObject.position.x, z: targetObject.position.z, y: targetObject.position.y, width: finalW, height: finalH, depth: finalD, rotation: targetObject.rotation.y, rotation_x: targetObject.rotation.x, rotation_z: targetObject.rotation.z });
    }
    const finalRoot = updates.find(u => u.id === editId) || updates[0];
    const res = await fetch(`/api/locations/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoot) });
    if (res.ok) {
        for (const childUpdate of updates.filter(u => u.id !== editId)) {
            await fetch(`/api/locations/${childUpdate.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(childUpdate) });
        }
        // Its own route: the PUT above neither accepts nor clears building_type, and the
        // shop gate lives on this one. Sent unconditionally rather than diffed - it is a
        // single idempotent write, and working out whether it changed costs more than
        // doing it.
        if (shopsAvailable(globalSettings['game_system'])) {
          await fetch(`/api/locations/${editId}/building-type`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ building_type: editData.building_type || '' }),
          });
        }
        setAdminAlert("CHANGES_SAVED"); targetObject.scale.set(1, 1, 1); refreshLocations(); setView('list');
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    
    let root = deleteTarget;
    if (deleteTarget.parent_id) {
        const foundRoot = locations.find((l: any) => l.id === deleteTarget.parent_id);
        if (foundRoot) root = foundRoot;
    }
    
    const idsToDelete = [root.id, ...locations.filter((l: any) => l.parent_id === root.id).map((l: any) => l.id)];
    const res = await fetch('/api/locations/batch-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: idsToDelete }) });
    if (res.ok) { 
        refreshLocations(); 
        setDeleteTarget(null); 
        // Force-deactivate Rhombus deployment state to prevent moving Admin character on next click
        setRhombusState((p: any) => ({ ...p, active: false }));
    }
  };

  const handleUndo = async () => {
    const res = await fetch('/api/undo', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const data = await res.json();
        refreshLocations();
        if (data.type === 'water_create') fetchWaterBodies();
    } else {
        const err = await res.json();
        setAdminAlert(err.error || "UNDO_FAILED");
    }
  };

  /**
   * Generate a city into the selected area.
   *
   * `purgeFirst` clears whatever was generated there before, which is what
   * regenerating means. Without it, generating again infills around what is
   * already standing — useful in its own right, but not a fresh city.
   */
  const runGeneration = async (purgeFirst: boolean) => {
              try {
                const drawing = cityGenDrawMode === 'draw';
                const tracedPoints = (genBoundaryTrail ?? []).map((p: any) => ({ x: p.x, z: p.z }));
                // Under three points cannot enclose an area; generateCity ignores such a
                // boundary, so refuse here rather than silently generating over the bbox.
                if (drawing && tracedPoints.length < 3) return setAdminAlert("TRACE AN AREA FIRST");
                if (!drawing && !roadSelectionBounds) return setAdminAlert("SELECT AREA FIRST");

                // A traced shape still needs a rectangle for the split to recurse on,
                // so its bounding box frames the work and the polygon confines it.
                const xs = tracedPoints.map((p: any) => p.x);
                const zs = tracedPoints.map((p: any) => p.z);
                const genBounds = drawing
                  ? { min: { x: Math.min(...xs), z: Math.min(...zs) }, max: { x: Math.max(...xs), z: Math.max(...zs) } }
                  : roadSelectionBounds;

                // Clear the previous generation before building, and use the world as
                // it is *after* that — placement tests against existing locations, so
                // stale ones would leave the new city avoiding buildings that are gone.
                let worldLocations = locations;
                let worldRoads = roads;
                let worldWater = waterBodies;
                if (purgeFirst) {
                  const doomed = countGeneratedInRegion(locations, genBounds, drawing ? tracedPoints : null);
                  if (doomed.removed > 0) {
                    const kept = doomed.kept > 0
                      ? ` ${doomed.kept} named structure${doomed.kept > 1 ? 's' : ''} will be kept.`
                      : '';
                    // Leads with the count: "regenerate?" invites a reflexive yes.
                    if (!confirm(`This removes ${doomed.removed} generated structures.${kept}`)) return;
                  }

                  const purgeRes = await fetch('/api/locations/purge-region', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(drawing ? { polygon: tracedPoints } : { bounds: genBounds }),
                  });
                  if (!purgeRes.ok) throw new Error(`Purge failed: ${purgeRes.status}`);

                  // Water is refetched for the same reason as locations and roads: the
                  // purge deleted the last river, and generating against the stale list
                  // means the new city avoids water that is no longer there — a dead
                  // band of empty ground tracing where the old river used to run.
                  const [freshLocs, freshRoads, freshWater] = await Promise.all([
                    fetch('/api/locations').then(r => r.json()).catch(() => locations),
                    fetch('/api/roads').then(r => r.json()).catch(() => roads),
                    fetch('/api/water').then(r => r.json()).catch(() => waterBodies),
                  ]);
                  if (Array.isArray(freshLocs)) worldLocations = freshLocs;
                  if (Array.isArray(freshRoads)) worldRoads = freshRoads;
                  if (Array.isArray(freshWater)) worldWater = freshWater;
                }

                // A typed seed is used as typed and never rewritten — normalising it
                // looked like the field being cleared and replaced. Only a blank field
                // gets filled in, so the seed just rolled can be written down.
                const typedSeed = (citySeed ?? '').trim();
                const seed = seedFrom(typedSeed);
                // Reported, never written back into the field. Filling the input meant
                // every later regenerate silently rebuilt the same city, which reads as
                // the purge having failed.
                setLastCitySeed?.(String(seed));

                const { blocks, roads: finalRoads, buildings: rawBuildings, overpasses: newOverpasses, waterBodies: newWater } = generateCity(
                  genBounds,
                  {
                    sectionType: citySectionType as SectionType,
                    excludeRoads: genExcludeRoads,
                    overpassDensity,
                    layout: cityLayout ?? 'BSP',
                    water: cityWater ?? 'NONE',
                    parkPonds: !!cityParkPonds,
                    roundabouts: cityRoundabouts ?? 'off',
                    boundary: drawing ? { points: tracedPoints } : undefined,
                  },
                  { locations: worldLocations, roads: worldRoads, waterBodies: worldWater },
                  seededRng(seed)
                );

                // Water first: it shapes where the roads went, so it should exist
                // before they are persisted. Marked generated so a later regenerate
                // clears it without touching anything the GM drew.
                for (const w of newWater) {
                  const wRes = await fetch('/api/water', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ points: w.points, generated: true }),
                  });
                  if (!wRes.ok) throw new Error(`Water creation failed: ${wRes.status}`);
                }
                if (newWater.length > 0) fetchWaterBodies?.();

                if (finalRoads.length > 0) {
                  const rRes = await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoads) });
                  if (!rRes.ok) throw new Error(`Road creation failed: ${rRes.status}`);
                }

                for (const o of newOverpasses) {
                  const oRes = await fetch('/api/overpasses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(o) });
                  if (!oRes.ok) throw new Error(`Overpass creation failed: ${oRes.status}`);
                }
                
                // Grouping logic for parent_id using SPATIAL GRID for O(N) speed
                const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rawBuildings.filter(b => !b.parent_name)) });
                if (!res.ok) throw new Error(`Building creation failed: ${res.status}`);
                
                const rootData = await res.json();
                if (rootData.data) {
                  const children: any[] = [];
                  // Reuse the generator's spatial hash to match each child to a
                  // nearby persisted root in O(1) instead of scanning all roots.
                  const rootGrid = new SpatialGrid();
                  rootData.data.forEach((r: any) => rootGrid.add(r));

                  rawBuildings.filter(b => b.parent_name === 'ROOT' || b.parent_name === 'CORP_ROOT').forEach(c => {
                    for (const nKey of rootGrid.neighborKeys(c.x, c.z)) {
                      const cell = rootGrid.cells[nKey];
                      if (!cell) continue;
                      const root = cell.find((r: any) => {
                        if (c.temp_block_id && r.temp_block_id) {
                          return c.temp_block_id === r.temp_block_id;
                        }
                        const dist = Math.sqrt((r.x - c.x)**2 + (r.z - c.z)**2);
                        return dist < 20;
                      });
                      if (root) {
                        children.push({ ...c, parent_id: (root as any).id });
                        break;
                      }
                    }
                  });

                  if (children.length > 0) {
                    const cRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(children) });
                    if (!cRes.ok) throw new Error(`Child building creation failed: ${cRes.status}`);
                  }
                }

                const bridgeNote = newOverpasses.length > 0 ? ` / ${newOverpasses.length} BRIDGE${newOverpasses.length > 1 ? 'S' : ''}` : '';
                setAdminAlert(`CITY GENERATED: ${blocks.length} SECTORS${bridgeNote}`);
                refreshLocations();
                if (newOverpasses.length > 0) refreshOverpasses?.();
                // Stay on the panel with the area still selected, so layout and
                // density can be adjusted and regenerated without re-selecting.
                // Generating again infills rather than overlapping: placement tests
                // against existing locations, and roads consolidate onto existing ones.
            } catch (err: any) {
              console.error(err);
              setAdminAlert(`SYSTEM_ERROR: ${err.message}. Area might be too large or complex.`);
            }
  };

  const handleToggleHidden = () => {
    if (!selectedLocation) return;
    const rootId = selectedLocation.parent_id ? selectedLocation.parent_id : selectedLocation.id;
    onToggleHidden(rootId);
  };

  const handleCopy = () => {
    if (!selectedLocation) return;
    
    let root = selectedLocation;
    // If the user selected a child part, resolve the root structure first
    if (selectedLocation.parent_id) {
        const foundRoot = locations.find((l: any) => String(l.id) === String(selectedLocation.parent_id));
        if (foundRoot) root = foundRoot;
    }
    
    const children = locations.filter((l: any) => String(l.parent_id) === String(root.id));
    setCopyBuffer({ root, children });
    setAdminAlert("STRUCTURE_COPIED");
  };

  const handlePaste = async () => {
    if (!copyBuffer) return;
    
    // Spawn at the center of the user's view
    const target = getCenterGroundTarget();
    const offsetX = target.tx - copyBuffer.root.x;
    const offsetZ = target.tz - copyBuffer.root.z;
    
    const newRoot = { ...copyBuffer.root, x: copyBuffer.root.x + offsetX, z: copyBuffer.root.z + offsetZ };
    delete newRoot.id; // explicitly remove id to avoid serialization anomalies

    const res = await fetch('/api/locations', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
        body: JSON.stringify(newRoot) 
    });
    
    if (res.ok) {
        const result = await res.json();
        const newRootId = result.data[0].id;
        
        if (copyBuffer.children.length > 0) {
            const newChildren = copyBuffer.children.map((c: any) => {
                const newChild = { ...c, parent_id: Number(newRootId), x: c.x + offsetX, z: c.z + offsetZ };
                delete newChild.id;
                return newChild;
            });
            await fetch('/api/locations', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
                body: JSON.stringify(newChildren) 
            });
        }
        setAdminAlert("STRUCTURE_PASTED");
        refreshLocations();
    }
  };

  const resolvedDeleteTarget = deleteTarget?.parent_id ? locations.find((l: any) => l.id === deleteTarget.parent_id) || deleteTarget : deleteTarget;

  return (
    <div className="panel admin-panel" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
      {adminAlert && createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="panel critical-alert">
            <h2 className="alert-text">!! SYSTEM_ALERT !!</h2>
            <p>{adminAlert}</p>
            <div className="button-group" style={{marginTop: '20px'}}>
              <button className="upload-btn danger-btn" onClick={() => setAdminAlert(null)}>ACKNOWLEDGE</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {purgeConfirm && (
        <div className="modal-overlay"><div className="panel critical-alert"><h2 className="alert-text">!! CONFIRM !!</h2><p>{purgeConfirm.label}</p><div className="button-group" style={{marginTop: '20px'}}><button className="upload-btn danger-btn" onClick={() => { purgeConfirm.onConfirm(); setPurgeConfirm(null); }}>CONFIRM</button><button className="utility-btn" onClick={() => setPurgeConfirm(null)}>CANCEL</button></div></div></div>
      )}
      {deleteTarget && resolvedDeleteTarget && (
        <div className="modal-overlay"><div className="panel critical-alert"><h2 className="alert-text">!! CONFIRM DELETE !!</h2><p>DELETE {locations.filter((l: any) => l.parent_id === resolvedDeleteTarget.id).length > 0 ? 'STRUCTURE GROUP' : 'STRUCTURE'}:</p><p className="highlight">[{isUserDefinedName(resolvedDeleteTarget.name) ? resolvedDeleteTarget.name : getStructLabel(resolvedDeleteTarget)}]</p><div className="button-group" style={{marginTop: '20px'}}><button className="upload-btn danger-btn" onClick={executeDelete}>DELETE</button><button className="utility-btn" onClick={() => setDeleteTarget(null)}>CANCEL</button></div></div></div>
      )}
      
      {view === 'list' && (
        <>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <h3>ADMIN_ACCESS // DATA_NET</h3>
              <span style={{
                fontSize: '0.6rem',
                color: 'var(--cyan)',
                border: '1px solid var(--cyan)',
                padding: '1px 5px',
                borderRadius: '3px',
                textShadow: '0 0 3px var(--cyan)',
                fontFamily: 'monospace',
                background: 'rgba(0, 255, 255, 0.05)'
              }}>
                FPS: {fps}
              </span>
            </div>
            <button className="utility-btn" onClick={handleUndo} title="UNDO LAST CHANGE" style={{fontSize: '0.65rem', padding: '2px 8px'}}>⟲ UNDO</button>
          </div>

          {/* Tab bar */}
          <div style={{display: 'flex', borderBottom: '1px solid var(--green)', marginTop: '8px', marginBottom: '12px'}}>
            {(['city', 'export', 'game', 'players'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setAdminTab(tab)}
                style={{
                  flex: 1,
                  padding: '5px 4px',
                  fontSize: '0.65rem',
                  fontFamily: 'monospace',
                  letterSpacing: '1px',
                  background: adminTab === tab ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'transparent',
                  color: adminTab === tab ? 'var(--green)' : 'color-mix(in srgb, var(--green) 50%, transparent)',
                  border: 'none',
                  borderBottom: adminTab === tab ? '2px solid var(--green)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>

          {/* ── CITY TAB ── */}
          {adminTab === 'city' && <>
          {!isBatchSelecting && (selectedLocation || copyBuffer) && (
            <div className="panel selection-panel" style={{marginBottom: '10px'}}>
              <button className="close-btn" onClick={() => setSelectedLocation(null)}>X</button>
              {selectedLocation && (
                <>
                  <h4>CURRENT_SELECTION:</h4>
                  <p className="highlight">{isUserDefinedName(selectedLocation.name) ? selectedLocation.name : getStructLabel(selectedLocation)}</p>
                  <div className="button-group">
                    <button className="upload-btn" onClick={() => startEdit(selectedLocation)}>EDIT</button>
                    <button className="upload-btn" onClick={handleCopy}>COPY</button>
                    <button className="upload-btn danger-btn" onClick={() => setDeleteTarget(selectedLocation)}>DEL</button>
                  </div>
                  <button
                    className="upload-btn"
                    style={{ width: '100%', marginTop: '6px', backgroundColor: selectedLocation.is_hidden ? '#444' : 'transparent', borderColor: '#888', color: '#aaa' }}
                    onClick={handleToggleHidden}
                  >
                    {selectedLocation.is_hidden ? 'REVEAL_STRUCTURE' : 'HIDE_STRUCTURE'}
                  </button>
                  {currentLocBattleMaps?.length > 0 && (
                    <button
                      className="upload-btn"
                      style={{ width: '100%', marginTop: '8px', backgroundColor: '#5500ff' }}
                      onClick={() => enterBattleMap(selectedLocation.id)}
                    >
                      ENTER_BATTLE_MAP ({currentLocBattleMaps.length})
                    </button>
                  )}
                </>
              )}
              {copyBuffer && (
                <div style={{marginTop: selectedLocation ? '10px' : '0'}}>
                  <button className="upload-btn" style={{width: '100%', borderColor: 'var(--cyan)', color: 'var(--cyan)'}} onClick={handlePaste}>
                    PASTE: {isUserDefinedName(copyBuffer.root.name) ? copyBuffer.root.name : getStructLabel(copyBuffer.root)}
                  </button>
                </div>
              )}
            </div>
          )}
          <button className="upload-btn" onClick={startNew}>+ ADD_NEW_STRUCTURE</button>
          <button className={`utility-btn ${isPlantingTrees ? 'active' : ''}`} onClick={() => setIsPlantingTrees(!isPlantingTrees)} style={{marginTop: '10px', width: '100%'}}>{isPlantingTrees ? 'PLANTING_TREES: ON' : 'PLANTING_TREES: OFF'}</button>
          {isPlantingTrees && (
              <div style={{marginTop: '10px', padding: '10px', border: '1px solid #00ff66', background: 'rgba(0, 255, 102, 0.1)'}}>
                  <label style={{fontSize: '0.7rem', color: '#00ff66'}}>TREES_PER_CLICK: {treeBatchSize}</label>
                  <input type="range" min="1" max="20" value={treeBatchSize} onChange={e => setTreeBatchSize(parseInt(e.target.value))} style={{width: '100%'}} />
              </div>
          )}
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { 
                setSelectedLocation(null); 
                const { tx, tz } = getCenterGroundTarget();
                setTargetObject({ position: new THREE.Vector3(tx, 0, tz), rotation: new THREE.Euler(), scale: new THREE.Vector3(1,1,1) });
                setView('generator'); generateBlock(); 
              }}>+ BLOCK_GEN</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadSelectionBounds(null); setView('city_gen'); }}>+ CITY_GEN</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setRoadTrail([]); setView('draw_roads'); }}>+ DRAW_ROADS</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setWaterTrail([]); setView('draw_water'); }}>+ DRAW_WATER</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setDistrictSelection([]); setEditingDistrict(null); setAssigningDistrict(null); setView('district'); }}>+ MNG_DISTRICT</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setJoinSelection([]); setView('join'); }}>+ CUSTOM_STRUCT</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn enemy-btn" style={{flex: 1}} onClick={startNewEnemy}>+ ADD_ENEMY</button>
              <button className="utility-btn friendly-btn" style={{flex: 1}} onClick={startNewFriendly}>+ ADD_FRIENDLY</button>
          </div>
          <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setView('signs')}>+ CUSTOM_SIGNS ({(signs || []).length})</button>
          <div style={{ marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px' }}>
              <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>
                  GLOBAL MAP SCALE (FT/UNIT): {tempCityMapScale !== null ? tempCityMapScale : (globalSettings?.map_scale_multiplier || 5)}
              </label>
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  <input type="range" min="0.1" max="50" step="0.1" 
                      value={tempCityMapScale !== null ? tempCityMapScale : (globalSettings?.map_scale_multiplier || 5)}
                      onChange={(e) => setTempCityMapScale(e.target.value)} style={{ flex: 1 }} />
                  <input type="number" step="0.1" 
                      value={tempCityMapScale !== null ? tempCityMapScale : (globalSettings?.map_scale_multiplier || 5)}
                      onChange={(e) => setTempCityMapScale(e.target.value)} style={{ width: '60px', backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '5px' }} />
                  <button className="utility-btn" onClick={() => {
                      if (tempCityMapScale === null) return;
                      fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ key: 'map_scale_multiplier', value: !isNaN(parseFloat(tempCityMapScale.toString())) ? parseFloat(tempCityMapScale.toString()) : 5 })
                      }).then(() => {
                          setTempCityMapScale(null);
                          fetchGlobalSettings();
                      });
                  }}>APPLY</button>
              </div>
          </div>

          <div style={{display: 'flex', gap: '16px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--green)'}}>
            <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
              <input type="checkbox" checked={renderSidewalks ?? true} onChange={e => setRenderSidewalks(e.target.checked)} />
              SIDEWALKS
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
              <input type="checkbox" checked={renderSignage ?? true} onChange={e => setRenderSignage(e.target.checked)} />
              SIGNAGE
            </label>
          </div>
          {renderSignage && (
            <div style={{marginTop: '6px'}}>
              <label style={{fontSize: '0.7rem', opacity: 0.8}}>SIGN_DENSITY: {(signageDensity ?? 1).toFixed(1)}</label>
              <input type="range" min="0.5" max="5" step="0.5" value={signageDensity ?? 1} onChange={e => setSignageDensity(parseFloat(e.target.value))} style={{width: '100%'}} />
            </div>
          )}

          <button className={`utility-btn ${isBatchSelecting ? 'active' : ''}`} style={{marginTop: '10px', width: '100%'}} onClick={() => { if (isBatchSelecting) setSelectedIds([]); setIsBatchSelecting(!isBatchSelecting); }}>{isBatchSelecting ? 'CANCEL_SELECTION' : 'BATCH_SELECT_DELETE'}</button>
          {isBatchSelecting && <button className="upload-btn danger-btn" style={{marginTop: '10px'}} onClick={batchDelete}>DELETE_SELECTED ({selectedIds.length})</button>}
          <div style={{marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px'}}>
            <button className="utility-btn danger-btn" style={{width: '100%'}} onClick={() => setView('purge_roads')}>PURGE_ROADS</button>
            <button className="utility-btn danger-btn" style={{marginTop: '5px', width: '100%'}} onClick={() => setPurgeConfirm({ label: 'DELETE ALL WATER?', onConfirm: async () => { const res = await fetch('/api/water', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); if (res.ok) { setAdminAlert("ALL WATER CLEARED"); if (fetchWaterBodies) fetchWaterBodies(); } } })}>PURGE_ALL_WATER</button>
          </div>
          {!secureModeEnabled && <button onClick={onLogout} className="logout-btn">EXIT_ADMIN_MODE</button>}
          </> /* end CITY tab */}

          {/* ── GAME TAB ── */}
          {adminTab === 'export' && (<>
          {/* Names CITY_DATA_BASE explicitly: "export" most plausibly reads as
              exporting map data, which is that panel's job, not this one's. */}
          <div style={{fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px', marginBottom: '12px', opacity: 0.85}}>
            <p>Renders the city as a top-down image or video for sharing and printing.</p>
            <p style={{marginTop: '6px', opacity: 0.75}}>This does not save or back up your map — use CITY_DATA_BASE for that.</p>
          </div>
          {onExportPng && (
            <div>
            <div style={{display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap'}}>
              <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
                <input type="checkbox" checked={exportIncludeGrid} onChange={e => setExportIncludeGrid(e.target.checked)} />
                INCLUDE_GRID
              </label>
              <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
                <input type="checkbox" checked={exportIncludeHidden} onChange={e => setExportIncludeHidden(e.target.checked)} />
                INCLUDE_HIDDEN
              </label>
              <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
                <input type="checkbox" checked={exportIncludeTokens} onChange={e => setExportIncludeTokens(e.target.checked)} />
                INCLUDE_TOKENS
              </label>
              <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}} title="PNG only — WebM has no dependable alpha channel">
                <input type="checkbox" checked={exportTransparent} onChange={e => setExportTransparent(e.target.checked)} />
                TRANSPARENT_BG
              </label>
            </div>
            <label htmlFor="export-png-width" style={{fontSize: '0.7rem', opacity: 0.8, display: 'block', marginBottom: '4px'}}>RESOLUTION <span style={{opacity: 0.6}}>(VIDEO CAPS AT 2K)</span></label>
            <select
              id="export-png-width"
              value={exportWidth}
              onChange={e => setExportWidth(parseInt(e.target.value))}
              style={{width: '100%', marginBottom: '10px', backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '4px', fontSize: '0.7rem'}}
            >
              {PNG_EXPORT_PRESETS.map(p => (
                <option key={p.width} value={p.width}>
                  {p.label} ({p.width} PX){p.width === DEFAULT_PNG_EXPORT_WIDTH ? ' — DEFAULT' : ''}
                </option>
              ))}
            </select>
            <label htmlFor="export-duration" style={{fontSize: '0.7rem', opacity: 0.8, display: 'block', marginBottom: '4px'}}>RECORD_LENGTH <span style={{opacity: 0.6}}>(VIDEO ONLY)</span></label>
            <select
              id="export-duration"
              value={exportDuration}
              onChange={e => setExportDuration(parseInt(e.target.value))}
              disabled={isRecording}
              style={{width: '100%', marginBottom: '10px', backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '4px', fontSize: '0.7rem'}}
            >
              {RECORD_DURATIONS.map(d => (
                <option key={d} value={d}>{d} SECONDS{d === MAX_RECORD_SECONDS ? ' — DEFAULT' : ''}</option>
              ))}
            </select>
            {isRecording && (
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '8px'}}>
                <span style={{color: '#ff4444'}}>● REC</span>
                <span>{recordSecondsLeft}s REMAINING</span>
              </div>
            )}
            <div style={{display: 'flex', gap: '10px'}}>
              <button className="utility-btn" style={{flex: 1}} disabled={isExporting || isRecording}
                onClick={() => onExportPng({ includeHidden: exportIncludeHidden, includeTokens: exportIncludeTokens, includeGrid: exportIncludeGrid, transparent: exportTransparent, width: exportWidth, mapName: globalSettings?.active_map_name })}>
                {isExporting ? 'EXPORTING…' : 'EXPORT_PNG'}
              </button>
              {isRecording ? (
                <button className="utility-btn enemy-btn" style={{flex: 1}} onClick={() => onStopRecording?.()}>STOP_RECORDING</button>
              ) : (
                <button className="utility-btn" style={{flex: 1}} disabled={isExporting}
                  onClick={() => onStartRecording?.({ includeHidden: exportIncludeHidden, includeTokens: exportIncludeTokens, includeGrid: exportIncludeGrid, durationSeconds: exportDuration, mapName: globalSettings?.active_map_name })}>
                  RECORD_MAP
                </button>
              )}
            </div>
            </div>
          )}

          </>)}

          {adminTab === 'game' && (
            <>
              <TTRPGSystemPanel token={token} onOpenNpcLibrary={onOpenNpcLibrary} activeUsers={activeUsers} />
              <div style={{ marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px' }}>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>CURRENCY_ICON</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(['credits', '$', '£', '€', '🪙'] as const).map(opt => (
                    <button
                      key={opt}
                      className={`utility-btn ${(globalSettings?.currency_icon || 'credits') === opt ? 'active' : ''}`}
                      style={{ padding: '4px 10px', fontSize: opt === 'credits' ? '0.6rem' : '1rem' }}
                      onClick={() => {
                        fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ key: 'currency_icon', value: opt }),
                        }).then(() => fetchGlobalSettings());
                      }}
                    >
                      {opt === 'credits' ? 'DEFAULT' : opt}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setIsAdminPayOpen(true)} className="utility-btn" style={{ width: '100%', marginTop: '10px' }}>PAY_PLAYERS</button>
              <BankSoundsPanel token={token} globalSettings={globalSettings} fetchGlobalSettings={fetchGlobalSettings} />
              <div style={{marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px'}}>
                <button className="utility-btn danger-btn" style={{width: '100%'}} onClick={() => setPurgeConfirm({ label: 'CLEAR ALL CHAT HISTORY?', onConfirm: async () => { await fetch('/api/chat/purge', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); } })}>PURGE_CHAT_HISTORY</button>
                <button className="utility-btn danger-btn" style={{marginTop: '5px', width: '100%'}} onClick={() => setPurgeConfirm({ label: 'CLEAR ALL DICE ROLL HISTORY?', onConfirm: () => { socketRef.current.emit('purgeDiceHistory', { token }); setAdminAlert("DICE ROLL HISTORY CLEARED"); } })}>PURGE_ROLL_HISTORY</button>
              </div>
            </>
          )}

          {/* ── PLAYERS TAB ── */}
          {adminTab === 'players' && (
            <>
              {pendingRequests.length > 0 && pendingRequests.map((req: any, i: number) => (
                <div key={i} className="panel" style={{marginBottom: '10px', borderColor: 'var(--green)'}}>
                  <h4>EDIT_REQUEST: {req.userName}</h4>
                  <p style={{fontSize: '0.7rem'}}>TARGET: {isUserDefinedName(req.locationName) ? req.locationName : `STRUCT_${req.locationId}`}</p>
                  <div className="button-group" style={{marginTop: '10px'}}>
                    <button className="upload-btn" onClick={() => {
                      socketRef.current.emit('approveEditing', { userId: req.userId, location: locations.find((l: any) => String(l.id) === String(req.locationId)) });
                      setPendingRequests((prev: any[]) => prev.filter(r => r.userId !== req.userId));
                    }}>APPROVE</button>
                    <button className="upload-btn danger-btn" onClick={() => {
                      socketRef.current.emit('denyEditing', { userId: req.userId });
                      setPendingRequests((prev: any[]) => prev.filter(r => r.userId !== req.userId));
                    }}>DENY</button>
                  </div>
                </div>
              ))}
              {activeUserEditing && (
                <div className="panel" style={{marginBottom: '10px', borderColor: 'var(--danger)'}}>
                  <h4>EDITING_NOW: {activeUserEditing.userName || activeUserEditing.userId}</h4>
                  <button className="upload-btn danger-btn" onClick={() => socketRef.current.emit('revokeEditing', { userId: activeUserEditing.userId })}>KICK_EDITOR</button>
                </div>
              )}
              {isPrimaryAdmin && (() => {
                const onlineUsers = (activeUsers || []).filter((u: any) => !u.isAdmin && !u.isNPC);
                const onlineNames: string[] = onlineUsers.map((u: any) => u.userName);
                const offlineNames: string[] = [...new Set<string>(
                  locations
                    .filter((l: any) => l.shape === 'rhombus' && l.owner && !l.owner.startsWith('enemy_') && !l.owner.startsWith('friendly_'))
                    .map((l: any) => l.owner)
                    .filter((name: string) => !onlineNames.includes(name))
                )];
                return (
                  <>
                    <div className="location-list" style={{marginBottom: '10px'}}>
                      <h4 style={{display: 'flex', alignItems: 'center', marginBottom: '6px'}}>
                        <span style={{width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green)', display: 'inline-block', marginRight: '8px', boxShadow: '0 0 4px var(--green)'}} />
                        ONLINE ({onlineNames.length})
                      </h4>
                      {onlineNames.length === 0 && <p style={{fontSize: '0.65rem', opacity: 0.5, paddingLeft: '16px'}}>No players online.</p>}
                      {onlineUsers.map((u: any) => (
                        <div key={u.userName} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 4px 4px 16px'}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden'}}>
                            <span style={{fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{u.userName}</span>
                            {u.isTemporaryAdmin && <span style={{fontSize: '0.55rem', color: 'var(--warning)', opacity: 0.8}}>TEMP_ADMIN</span>}
                          </div>
                          <button
                            className={`utility-btn ${u.isTemporaryAdmin ? 'danger-btn' : ''}`}
                            style={{fontSize: '0.55rem', padding: '2px 6px', flexShrink: 0}}
                            onClick={() => u.isTemporaryAdmin ? onRevokeAccess(u.userName) : onGrantAccess(u.userName)}
                          >
                            {u.isTemporaryAdmin ? 'REVOKE_ADMIN' : 'GRANT_ADMIN'}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="location-list">
                      <h4 style={{cursor: 'pointer', display: 'flex', alignItems: 'center', marginBottom: '6px'}} onClick={() => setShowOfflinePlayers(!showOfflinePlayers)}>
                        <span style={{width: '20px', display: 'inline-block'}}>{showOfflinePlayers ? '▼' : '▶'}</span>
                        <span style={{width: '8px', height: '8px', borderRadius: '50%', background: '#444', display: 'inline-block', marginRight: '8px'}} />
                        OFFLINE ({offlineNames.length})
                      </h4>
                      {showOfflinePlayers && offlineNames.map((name: string) => (
                        <div key={name} style={{padding: '4px 4px 4px 36px', fontSize: '0.7rem', opacity: 0.4}}>{name}</div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </>
      )}

      {view === 'draw_roads' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>DRAW_ROADS</h3><button onClick={() => { setView('list'); setRoadTrail([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
              <label style={{fontSize: '0.7rem'}}>LAYER</label>
              <div className="button-group" style={{marginTop: '5px'}}>
                  <button className={(roadLayerMode || 'road') === 'road' ? 'active' : ''} onClick={() => setRoadLayerMode?.('road')}>ROAD</button>
                  <button className={roadLayerMode === 'overpass' ? 'active' : ''} onClick={() => setRoadLayerMode?.('overpass')}>OVERPASS</button>
              </div>
              <label style={{fontSize: '0.7rem', marginTop: '10px', display: 'block'}}>DRAWING_MODE</label>
              <div className="button-group" style={{marginTop: '5px'}}>
                  <button className={roadDrawMode === 'free' ? 'active' : ''} onClick={() => { setRoadDrawMode('free'); }}>FREE_DRAW</button>
                  <button className={roadDrawMode === 'straight' ? 'active' : ''} onClick={() => { setRoadDrawMode('straight'); }}>STRAIGHT</button>
              </div>
              <button className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{marginTop: '10px', width: '100%'}}>{snapToGrid ? 'SNAP_TO_GRID: ON' : 'SNAP_TO_GRID: OFF'}</button>
              <div style={{marginTop: '10px'}}>
                <label style={{fontSize: '0.7rem'}}>ROAD_THICKNESS: {drawingRoadWidth.toFixed(1)}</label>
                <input type="range" min="0.5" max="10" step="0.1" value={drawingRoadWidth} onChange={(e) => setDrawingRoadWidth(parseFloat(e.target.value))} style={{width: '100%'}} />
              </div>
              {roadLayerMode === 'overpass' && (
                <>
                  <div style={{marginTop: '10px'}}>
                    <label style={{fontSize: '0.7rem'}}>HEIGHT: {(overpassHeight ?? 8).toFixed(1)}</label>
                    <input type="range" min="2" max="30" step="0.5" value={overpassHeight ?? 8} onChange={(e) => setOverpassHeight?.(parseFloat(e.target.value))} style={{width: '100%'}} />
                  </div>
                  <div style={{marginTop: '10px'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                      <label style={{fontSize: '0.7rem'}}>RAMP_LENGTH</label>
                      <label style={{fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer'}}>
                        <input type="checkbox" checked={overpassSplitRamps ?? false} onChange={(e) => setOverpassSplitRamps?.(e.target.checked)} />
                        SPLIT
                      </label>
                    </div>
                    {overpassSplitRamps ? (
                      <>
                        <label style={{fontSize: '0.65rem', opacity: 0.8}}>START: {(overpassRampLengthStart ?? 20).toFixed(0)}</label>
                        <input type="range" min="0" max="160" step="1" value={overpassRampLengthStart ?? 20} onChange={(e) => setOverpassRampLengthStart?.(parseFloat(e.target.value))} style={{width: '100%'}} />
                        <label style={{fontSize: '0.65rem', opacity: 0.8}}>END: {(overpassRampLengthEnd ?? 20).toFixed(0)}</label>
                        <input type="range" min="0" max="160" step="1" value={overpassRampLengthEnd ?? 20} onChange={(e) => setOverpassRampLengthEnd?.(parseFloat(e.target.value))} style={{width: '100%'}} />
                      </>
                    ) : (
                      <>
                        <label style={{fontSize: '0.65rem', opacity: 0.8}}>{(overpassRampLength ?? 20).toFixed(0)}</label>
                        <input type="range" min="0" max="160" step="1" value={overpassRampLength ?? 20} onChange={(e) => setOverpassRampLength?.(parseFloat(e.target.value))} style={{width: '100%'}} />
                      </>
                    )}
                  </div>
                </>
              )}
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>PATHS_DRAWN: {roadTrail.length}</p><p>TOTAL_NODES: {roadTrail.reduce((acc, curr) => acc + curr.length, 0)}</p><p style={{opacity: 0.7, marginTop: '5px'}}>HOLD LEFT-CLICK TO DRAW PATH</p><button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setRoadTrail([])}>CLEAR_ALL_DRAWINGS</button></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
                if (roadTrail.length === 0) return setAdminAlert("DRAW A PATH FIRST");
                const roadWidth = drawingRoadWidth;
                let allNewSegments: any[] = [];
                const overpassPaths: { x: number; z: number }[][] = [];

                for (const path of roadTrail) {
                    if (path.length < 2) continue;
                    let currentPath = path.map(p => p.clone());
                    
                    // --- STEP 1: SNAPPING ---
                    const snapDist = 5;
                    const snapToExisting = (pos: THREE.Vector3) => {
                      let bestDist = snapDist; let bestPos = pos;
                      roads.forEach(r => {
                        const p1 = new THREE.Vector3(r.x1, 0, r.z1); const p2 = new THREE.Vector3(r.x2, 0, r.z2);
                        const d1 = pos.distanceTo(p1); const d2 = pos.distanceTo(p2);
                        if (d1 < bestDist) { bestDist = d1; bestPos = p1; }
                        if (d2 < bestDist) { bestDist = d2; bestPos = p2; }
                      });
                      return bestPos;
                    };
                    currentPath[0] = snapToExisting(currentPath[0]);
                    currentPath[currentPath.length - 1] = snapToExisting(currentPath[currentPath.length - 1]);

                    // --- STEP 2: SMOOTHING ---
                    for (let iter = 0; iter < 3; iter++) {
                        for (let i = 1; i < currentPath.length - 1; i++) {
                            currentPath[i].lerp(currentPath[i-1].clone().lerp(currentPath[i+1], 0.5), 0.5);
                        }
                    }

                    if (roadLayerMode === 'overpass') {
                      overpassPaths.push(currentPath.map(p => ({ x: p.x, z: p.z })));
                      continue;
                    }

                    for (let i = 0; i < currentPath.length - 1; i++) {
                      allNewSegments.push({ x1: currentPath[i].x, z1: currentPath[i].z, x2: currentPath[i+1].x, z2: currentPath[i+1].z, width: roadWidth });
                    }
                }

                if (roadLayerMode === 'overpass') {
                  if (overpassPaths.length === 0) return setAdminAlert("NO VALID PATHS DRAWN");
                  for (const pts of overpassPaths) {
                    await fetch('/api/overpasses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({
                      points: pts, height: overpassHeight ?? 8, width: roadWidth,
                      ramp_length: overpassRampLength ?? 20,
                      ramp_length_start: overpassSplitRamps ? (overpassRampLengthStart ?? 20) : null,
                      ramp_length_end: overpassSplitRamps ? (overpassRampLengthEnd ?? 20) : null,
                      pillar_spacing: 12,
                    }) });
                  }
                  setAdminAlert(`OVERPASS GENERATED: ${overpassPaths.length} SPAN${overpassPaths.length > 1 ? 'S' : ''}`);
                  refreshOverpasses?.(); setView('list'); setRoadTrail([]);
                  return;
                }

                if (allNewSegments.length === 0) return setAdminAlert("NO VALID PATHS DRAWN");

                const finalSegments = consolidateRoads(allNewSegments, roads);
                await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalSegments) });
                setAdminAlert(`DRAWN NETWORK GENERATED: ${finalSegments.length} SEGMENTS`); refreshLocations(); setView('list'); setRoadTrail([]);
            }}>GENERATE_FROM_DRAWINGS</button>
        </>
      )}

      {view === 'signs' && (
        <SignEditor
          token={token}
          signs={signs || []}
          fetchSigns={fetchSigns}
          remoteFonts={remoteFonts || []}
          setRemoteFonts={setRemoteFonts}
          isPlacingSign={isPlacingSign}
          setIsPlacingSign={setIsPlacingSign}
          pendingSignPos={pendingSignPos}
          setPendingSignPos={setPendingSignPos}
          selectedSignId={selectedSignId}
          setSelectedSignId={setSelectedSignId}
          signTransformMode={signTransformMode}
          setSignTransformMode={setSignTransformMode}
          signTransformActive={signTransformActive}
          setSignTransformActive={setSignTransformActive}
          handleUpdateSign={handleUpdateSign}
          controlsRef={controlsRef}
          signMesh={signMesh}
          onClose={() => setView('list')}
        />
      )}

      {view === 'purge_roads' && (
        <>
          <header style={{marginBottom: '10px'}}>
            <h3>PURGE_ROADS</h3>
            <button onClick={() => { setView('list'); setRoadPurgeConfirming(false); }} className="close-btn" style={{position: 'static'}}>X</button>
          </header>
          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>TOOL</label>
            <div className="button-group" style={{marginTop: '5px'}}>
              <button className={roadEraseMode === 'segment' ? 'active' : ''} onClick={() => setRoadEraseMode('segment')}>ERASER</button>
              <button className={roadEraseMode === 'path' ? 'active' : ''} onClick={() => setRoadEraseMode('path')}>SELECTOR</button>
            </div>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px', opacity: 0.7}}>
            {roadEraseMode === 'segment'
              ? 'CLICK A SEGMENT ON THE MAP TO DELETE IT'
              : 'CLICK ANY SEGMENT TO DELETE THE FULL CONNECTED ROAD PATH'}
          </div>
          <div style={{marginTop: '10px', fontSize: '0.7rem', border: '1px dashed #ff3300', padding: '10px'}}>
            <p style={{opacity: 0.7}}>ROAD_SEGMENTS: {roads.length}</p>
            {roadPurgeConfirming ? (
              <>
                <p style={{marginTop: '8px', color: '#ff3300'}}>PURGE ALL {roads.length} SEGMENTS?</p>
                <div style={{display: 'flex', gap: '5px', marginTop: '8px'}}>
                  <button className="upload-btn danger-btn" style={{flex: 1}} onClick={async () => {
                    const res = await fetch('/api/roads', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                    if (res.ok) { setAdminAlert('ALL ROADS PURGED'); if (refreshRoads) refreshRoads(); setView('list'); }
                    setRoadPurgeConfirming(false);
                  }}>CONFIRM</button>
                  <button className="utility-btn" style={{flex: 1}} onClick={() => setRoadPurgeConfirming(false)}>CANCEL</button>
                </div>
              </>
            ) : (
              <button className="utility-btn danger-btn" style={{marginTop: '8px', width: '100%'}} onClick={() => setRoadPurgeConfirming(true)}>PURGE_ALL_ROADS</button>
            )}
          </div>
          <div style={{marginTop: '10px', fontSize: '0.7rem', border: '1px dashed #ff3300', padding: '10px'}}>
            <p style={{opacity: 0.7}}>OVERPASSES: {(overpasses || []).length}</p>
            <p style={{opacity: 0.6, marginTop: '4px'}}>CLICK AN OVERPASS TO DELETE IT</p>
            {overpassPurgeConfirming ? (
              <>
                <p style={{marginTop: '8px', color: '#ff3300'}}>PURGE ALL {(overpasses || []).length} OVERPASSES?</p>
                <div style={{display: 'flex', gap: '5px', marginTop: '8px'}}>
                  <button className="upload-btn danger-btn" style={{flex: 1}} onClick={async () => {
                    await Promise.all((overpasses || []).map((o: any) => fetch(`/api/overpasses/${o.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })));
                    setAdminAlert('ALL OVERPASSES PURGED'); refreshOverpasses?.(); setView('list');
                    setOverpassPurgeConfirming(false);
                  }}>CONFIRM</button>
                  <button className="utility-btn" style={{flex: 1}} onClick={() => setOverpassPurgeConfirming(false)}>CANCEL</button>
                </div>
              </>
            ) : (
              <button className="utility-btn danger-btn" style={{marginTop: '8px', width: '100%'}} onClick={() => setOverpassPurgeConfirming(true)}>PURGE_ALL_OVERPASSES</button>
            )}
          </div>
        </>
      )}

      {view === 'draw_water' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>DRAW_WATER</h3><button onClick={() => { setView('list'); setWaterTrail([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>WATER_POINTS: {waterTrail.length}</p><p style={{opacity: 0.7, marginTop: '5px'}}>HOLD LEFT-CLICK TO TRACE BOUNDARY</p><button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setWaterTrail([])}>CLEAR_DRAWING</button></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
                if (waterTrail.length < 3) return setAdminAlert("DRAW A POLYGON WITH AT LEAST 3 POINTS");
                const points = waterTrail.map((p: any) => ({ x: p.x, z: p.z }));
                await fetch('/api/water', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ points }) });
                setAdminAlert(`WATER BODY SAVED`); fetchWaterBodies(); setView('list'); setWaterTrail([]);
            }}>SAVE_WATER_BODY</button>
          {/* Same server-side undo as the main admin header. Distinct from
              CLEAR_DRAWING above, which only discards the untraced trail. */}
          <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={handleUndo} title="UNDO LAST SAVED CHANGE">⟲ UNDO</button>
        </>
      )}

      {view === 'district' && !editingDistrict && !assigningDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>MNG_DISTRICT</h3><button onClick={() => { setView('list'); setDistrictSelection([]); setEditingDistrict(null); setAssigningDistrict(null); }} className="close-btn" style={{position: 'static'}}>X</button></header>

          <p style={{fontSize: '0.65rem', opacity: 0.7, margin: '0 0 12px', lineHeight: 1.5}}>
            Create a district below, then use ASSIGN on it to pick its structures on the map.
            EDIT changes its colour and lists what is in it.
          </p>

          {districts.length === 0 && (
            <p style={{fontSize: '0.65rem', opacity: 0.5, fontStyle: 'italic'}}>NO DISTRICTS YET.</p>
          )}

          {districts.map(d => {
            const members = locations.filter((l: any) => l.district_name === d.name);
            return (
            <div key={d.id} className="list-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px'}}>
                <div style={{minWidth: 0}}>
                  <span style={{display: 'inline-block', width: '12px', height: '12px', backgroundColor: d.color, marginRight: '8px', border: '1px solid #000'}}></span>
                  <span>{d.name}</span>
                  <span style={{opacity: 0.5, marginLeft: '8px', fontSize: '0.6rem'}}>{members.length} STRUCTURES</span>
                </div>
                <div style={{display: 'flex', gap: '5px', flexShrink: 0}}>
                  <button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={() => {
                      // Starts empty. The selection is what you are ADDING, not the district
                      // as it stands - prefilling it made SAVE look like a full replace,
                      // which is exactly what it used to be.
                      setDistrictSelection([]);
                      setAssigningDistrict(d);
                  }}>ASSIGN</button>
                  <button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={() => {
                      setDistrictConfig({ name: d.name, color: d.color });
                      setEditingDistrict(d);
                  }}>EDIT</button>
                  <button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={async () => {
                      if (!confirm(`Delete ${d.name}? ${members.length} structure(s) will be left with no district.`)) return;
                      await fetch(`/api/districts/${encodeURIComponent(d.name)}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                      fetchDistricts();
                      refreshLocations();
                  }}>DEL</button>
                </div>
            </div>
          );})}

          <div className="editor-controls" style={{marginTop: '20px', borderTop: '1px solid #333', paddingTop: '10px'}}>
            <h4>CREATE NEW DISTRICT</h4>
            <label style={{fontSize: '0.7rem'}}>DISTRICT_NAME</label><input placeholder="Name" value={districtConfig.name} onChange={e => setDistrictConfig({...districtConfig, name: e.target.value})} style={{width: '100%', marginBottom: '10px'}} />
            <label style={{fontSize: '0.7rem'}}>DISTRICT_COLOR</label>
            <input type="color" value={districtConfig.color} onChange={e => setDistrictConfig({...districtConfig, color: e.target.value})} style={{width: '100%', marginTop: '5px', height: '30px', padding: '0', background: 'none', border: '1px solid var(--green)'}} />
            <button className="upload-btn" style={{marginTop: '10px'}} onClick={async () => {
                if (!districtConfig.name.trim()) return setAdminAlert("NAME REQUIRED");
                const res = await fetch('/api/districts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: districtConfig.name, color: districtConfig.color }) });
                if (res.ok) { fetchDistricts(); setDistrictConfig({name: '', color: '#00ff00'}); setAdminAlert("DISTRICT_CREATED"); }
                else setAdminAlert("NAME ALREADY USED");
            }}>CREATE</button>
          </div>
        </>
      )}

      {view === 'district' && assigningDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>ASSIGN: {assigningDistrict.name}</h3><button onClick={() => { setAssigningDistrict(null); setDistrictSelection([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>

          <p style={{fontSize: '0.65rem', opacity: 0.7, margin: '0 0 10px', lineHeight: 1.5}}>
            Click structures on the map to add them, or drag a box to take several at once.
            A structure already in another district moves to this one.
          </p>

          <div style={{marginTop: '10px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>
            <p style={{margin: 0}}>SELECTED: {districtSelection.length} STRUCTURES</p>
            {districtSelection.length > 0 && (() => {
              const moving = locations.filter((l: any) => districtSelection.includes(l.id)
                && l.district_name && l.district_name !== assigningDistrict.name);
              return moving.length > 0 ? (
                <p style={{margin: '6px 0 0', opacity: 0.7}}>{moving.length} will move out of another district.</p>
              ) : null;
            })()}
          </div>

          <div style={{display: 'flex', gap: '6px', marginTop: '15px'}}>
            <button className="upload-btn" style={{flex: 1}} disabled={districtSelection.length === 0} onClick={async () => {
                const res = await fetch('/api/locations/assign-district', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: districtSelection, district_name: assigningDistrict.name }) });
                if (res.ok) { setAdminAlert("STRUCTURES_ASSIGNED"); refreshLocations(); setAssigningDistrict(null); setDistrictSelection([]); }
                else setAdminAlert("ASSIGN_FAILED");
            }}>SAVE</button>
            <button className="upload-btn" style={{flex: 1}} disabled={districtSelection.length === 0}
              onClick={() => setDistrictSelection([])}>CLEAR</button>
          </div>
        </>
      )}

      {view === 'district' && editingDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>EDIT: {editingDistrict.name}</h3><button onClick={() => { setEditingDistrict(null); setDistrictSelection([]); setHoveredStructureId?.(null); }} className="close-btn" style={{position: 'static'}}>X</button></header>

          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>DISTRICT_NAME</label>
            <input value={districtConfig.name} onChange={e => setDistrictConfig({...districtConfig, name: e.target.value})} style={{width: '100%', marginBottom: '10px'}} />
            <label style={{fontSize: '0.7rem'}}>DISTRICT_COLOR</label>
            <input type="color" value={districtConfig.color} onChange={e => setDistrictConfig({...districtConfig, color: e.target.value})} style={{width: '100%', marginTop: '5px', height: '30px', padding: '0', background: 'none', border: '1px solid var(--green)'}} />
            {(() => {
              const nextName = (districtConfig.name || '').trim();
              const renaming = nextName !== editingDistrict.name;
              const clash = renaming && districts.some((d: any) => d.name === nextName);
              const dirty = renaming || districtConfig.color !== editingDistrict.color;
              return (
                <>
                  {clash && <p style={{fontSize: '0.62rem', color: 'var(--warning, #ffcc00)', margin: '8px 0 0'}}>ANOTHER DISTRICT ALREADY USES THAT NAME.</p>}
                  <button className="upload-btn" style={{marginTop: '10px'}} disabled={!dirty || !nextName || clash} onClick={async () => {
                      const res = await fetch(`/api/districts/${encodeURIComponent(editingDistrict.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: nextName, color: districtConfig.color }) });
                      if (res.ok) {
                        setAdminAlert(renaming ? "DISTRICT_RENAMED" : "COLOR_SAVED");
                        fetchDistricts(); refreshLocations();
                        setEditingDistrict({ ...editingDistrict, name: nextName, color: districtConfig.color });
                      } else setAdminAlert(res.status === 409 ? "NAME ALREADY USED" : "SAVE_FAILED");
                  }}>SAVE CHANGES</button>
                  {renaming && !clash && nextName && (
                    <p style={{fontSize: '0.62rem', opacity: 0.6, margin: '6px 0 0'}}>
                      Renaming moves all {locations.filter((l: any) => l.district_name === editingDistrict.name).length} structure(s) with it.
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          <div style={{marginTop: '20px', borderTop: '1px solid #333', paddingTop: '10px'}}>
            <h4 style={{marginBottom: '8px'}}>ASSIGNED STRUCTURES</h4>
            {(() => {
              const members = locations.filter((l: any) => l.district_name === editingDistrict.name);
              if (members.length === 0) {
                return <p style={{fontSize: '0.65rem', opacity: 0.5, fontStyle: 'italic'}}>NONE. USE ASSIGN TO ADD SOME.</p>;
              }
              return members.map((l: any) => (
                <div
                  key={l.id}
                  className="list-item"
                  style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px'}}
                  // Hovering the row lights the building up on the map, so you can see
                  // which one you are about to take out of the district.
                  onMouseEnter={() => setHoveredStructureId?.(l.id)}
                  onMouseLeave={() => setHoveredStructureId?.(null)}
                >
                  <button
                    type="button"
                    title="SHOW_ON_MAP"
                    onClick={() => { setSelectedLocation(l); setHoveredStructureId?.(null); }}
                    style={{background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0}}
                  >
                    {isUserDefinedName(l.name) ? l.name : getStructLabel(l)}
                  </button>
                  <button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem', flexShrink: 0}}
                    title="REMOVE_FROM_DISTRICT"
                    onClick={async () => {
                      const res = await fetch('/api/locations/unassign-district', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: [l.id] }) });
                      if (res.ok) { setHoveredStructureId?.(null); refreshLocations(); }
                      else setAdminAlert("REMOVE_FAILED");
                    }}>REMOVE</button>
                </div>
              ));
            })()}
          </div>
        </>
      )}

      {view === 'city_gen' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>CITY_GENERATOR</h3><button onClick={() => { setView('list'); setRoadSelectionBounds(null); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>SECTION_TYPE</label>
            <div className="button-group" style={{marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
              {['MIXED', 'CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL'].map(t => (
                <button 
                  key={t} 
                  className={citySectionType === t ? 'active' : ''} 
                  style={{ flex: '1 1 80px', minWidth: '80px' }}
                  onClick={() => setCitySectionType(t as any)}
                >
                  {t}
                </button>
              ))}
            </div>
            <button className={`utility-btn ${genExcludeRoads ? 'active' : ''}`} style={{marginTop: '10px', width: '100%'}} onClick={() => setGenExcludeRoads(!genExcludeRoads)}>{genExcludeRoads ? 'EXCLUDE_ROADS: ON' : 'EXCLUDE_ROADS: OFF'}</button>

            <label style={{fontSize: '0.7rem', marginTop: '10px', display: 'block'}}>OVERPASS_DENSITY</label>
            <div className="button-group" style={{marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
              {(['off', 'sparse', 'normal', 'heavy'] as OverpassDensity[]).map(d => (
                <button
                  key={d}
                  className={overpassDensity === d ? 'active' : ''}
                  style={{ flex: '1 1 60px', minWidth: '60px' }}
                  onClick={() => setOverpassDensity(d)}
                  disabled={genExcludeRoads}
                  title="How often a road crossing water is carried over by a bridge. Wide crossings are never bridged."
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label htmlFor="city-water" style={{fontSize: '0.7rem', opacity: 0.8, display: 'block', marginTop: '10px', marginBottom: '4px'}}>WATER</label>
          <select
            id="city-water"
            value={cityWater ?? 'NONE'}
            onChange={e => setCityWater?.(e.target.value)}
            style={{width: '100%', backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '4px', fontSize: '0.7rem'}}
          >
            {WATER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            className={`utility-btn ${cityParkPonds ? 'active' : ''}`}
            style={{marginTop: '8px', width: '100%'}}
            title="Give some parks a pond. Independent of WATER — a pond sits inside its own plot and does not reshape the street grid."
            onClick={() => setCityParkPonds?.(!cityParkPonds)}
          >{cityParkPonds ? 'PARK_PONDS: ON' : 'PARK_PONDS: OFF'}</button>
          <label style={{fontSize: '0.7rem', opacity: 0.8, display: 'block', marginTop: '10px', marginBottom: '4px'}}>ROUNDABOUTS</label>
          <div className="button-group" style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
            {(['off', 'sparse', 'normal'] as RoundaboutDensity[]).map(d => (
              <button
                key={d}
                className={(cityRoundabouts ?? 'off') === d ? 'active' : ''}
                style={{ flex: '1 1 60px', minWidth: '60px' }}
                onClick={() => setCityRoundabouts?.(d)}
                disabled={genExcludeRoads}
                title="Put roundabouts where major roads meet. Applies to whichever layout is chosen; the island gets a monument or trees."
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
          <label htmlFor="city-seed" style={{fontSize: '0.7rem', opacity: 0.8, display: 'block', marginTop: '10px', marginBottom: '4px'}}>SEED <span style={{opacity: 0.6}}>(BLANK = RANDOM)</span></label>
          <div style={{display: 'flex', gap: '6px'}}>
            <input
              id="city-seed"
              value={citySeed ?? ''}
              placeholder="RANDOM"
              onChange={e => setCitySeed?.(e.target.value)}
              style={{flex: 1, backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '4px', fontSize: '0.7rem', fontFamily: 'monospace'}}
            />
            <button className="utility-btn" title="CLEAR SEED" style={{padding: '2px 10px'}}
              onClick={() => setCitySeed?.('')}>🗑</button>
          </div>
          {lastCitySeed
            ? <p style={{fontSize: '0.65rem', opacity: 0.75, marginTop: '4px'}}>
                LAST: <button
                  onClick={() => setCitySeed?.(String(lastCitySeed))}
                  title="REUSE THIS SEED"
                  style={{background: 'none', border: 'none', color: 'var(--green)', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '0.65rem'}}
                >{lastCitySeed}</button>
              </p>
            : null}
          <p style={{fontSize: '0.65rem', opacity: 0.55, marginTop: '4px'}}>SAME SEED + SAME AREA + SAME OPTIONS = SAME CITY</p>
          <label htmlFor="city-layout" style={{fontSize: '0.7rem', opacity: 0.8, display: 'block', marginTop: '10px', marginBottom: '4px'}}>LAYOUT</label>
          <select
            id="city-layout"
            value={cityLayout ?? 'BSP'}
            onChange={e => setCityLayout?.(e.target.value)}
            style={{width: '100%', backgroundColor: '#222', color: 'var(--green)', border: '1px solid var(--green)', padding: '4px', fontSize: '0.7rem'}}
          >
            {LAYOUT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
            <button className={`utility-btn ${cityGenDrawMode !== 'draw' ? 'active' : ''}`} style={{flex: 1}}
              onClick={() => { setCityGenDrawMode?.('rect'); setGenBoundaryTrail?.([]); }}>DRAG_RECT</button>
            <button className={`utility-btn ${cityGenDrawMode === 'draw' ? 'active' : ''}`} style={{flex: 1}}
              onClick={() => { setCityGenDrawMode?.('draw'); setRoadSelectionBounds(null); }}>DRAW_AREA</button>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>{cityGenDrawMode === 'draw'
            ? (genBoundaryTrail?.length > 2
                ? <><p>BOUNDARY_TRACED: {genBoundaryTrail.length} POINTS</p><button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setGenBoundaryTrail?.([])}>CLEAR_BOUNDARY</button></>
                : <p style={{opacity: 0.7}}>HOLD LEFT-CLICK TO TRACE GENERATION AREA</p>)
            : (roadSelectionBounds ? <p>AREA_SELECTED: {Math.round(Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x))}x{Math.round(Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z))} units</p> : <p style={{opacity: 0.7}}>DRAG ON MAP TO SELECT GENERATION AREA</p>)}<p style={{opacity: 0.7, marginTop: '5px'}}>HIERARCHICAL BSP: ENABLED</p><p style={{opacity: 0.7}}>ZONING: {citySectionType}</p><p style={{opacity: 0.7}}>INFRASTRUCTURE: {genExcludeRoads ? 'BUILDINGS_ONLY' : 'ROADS_+_BUILDINGS'}</p></div>
          <div style={{display: 'flex', gap: '10px', marginTop: '15px'}}>
            <button className="upload-btn" style={{flex: 1, marginTop: 0}}
              onClick={() => runGeneration(false)}>GENERATE_CITY_GRID</button>
            <button className="upload-btn danger-btn" style={{flex: 1, marginTop: 0}}
              title="CLEAR THE PREVIOUS GENERATION HERE, THEN BUILD AFRESH"
              onClick={() => runGeneration(true)}>REGENERATE</button>
          </div>
          {/* Same server-side undo as the admin header. Generating leaves the panel
              open, so reverting a bad result belongs here rather than three clicks away. */}
          <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={handleUndo} title="UNDO LAST SAVED CHANGE">⟲ UNDO</button>
        </>
      )}

      {view === 'join' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>CUSTOM_STRUCTURE</h3><button onClick={() => { setView('list'); setJoinSelection([]); setSelectedClassification(''); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px', lineHeight: '1.7'}}>
            <p>SELECTION: {joinSelection.length} UNITS</p>
            <p style={{opacity: 0.7}}>Click buildings on the map to group them into a custom structure. The first building selected becomes the group root.</p>
          </div>
          <div style={{marginTop: '15px'}}>
            <label style={{fontSize: '0.7rem', display: 'block', marginBottom: '5px'}}>CLASSIFICATION <span style={{opacity: 0.5}}>(optional)</span></label>
            <div className="button-group" style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
              {['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'LANDMARK', 'MARKETS', 'CUSTOM'].map(t => (
                <button key={t} type="button" className={selectedClassification === t ? 'active' : ''} onClick={() => setSelectedClassification(selectedClassification === t ? '' : t)} style={{fontSize: '0.7rem', padding: '4px 8px'}}>{t}</button>
              ))}
            </div>
            {selectedClassification === 'CUSTOM' && (
              <p style={{fontSize: '0.65rem', opacity: 0.6, marginTop: '8px', lineHeight: '1.6'}}>This group will be saved as a prefab and appear under ADD_NEW_STRUCTURE when NEXT_STYLE cycles to CUSTOM.</p>
            )}
          </div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { if (joinSelection.length < 1) return setAdminAlert("SELECT AT LEAST 1 UNIT"); const res = await fetch('/api/locations/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: joinSelection, classification: selectedClassification || undefined }) }); if (res.ok) { setAdminAlert("STRUCTURES_CLASSIFIED/JOINED"); refreshLocations(); setView('list'); setJoinSelection([]); setSelectedClassification(''); } }}>SAVE_CUSTOM_STRUCTURE</button>
        </>
      )}

      {view === 'generator' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>BLOCK_GENERATOR</h3><button onClick={() => { setView('list'); setBlockBuildings([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <label style={{fontSize: '0.7rem'}}>DENSITY: {density}</label><input type="range" min="1" max="16" value={density} onChange={(e) => setDensity(parseInt(e.target.value))} style={{width: '100%'}} />
            <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={generateBlock}>REROLL_BLOCK</button>
            <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
              <button className="utility-btn" onClick={() => targetObject && (targetObject.position.y = 0)} style={{flex: 1}}>SNAP_TO_GROUND</button>
              <button className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>
            </div>
          </div>
          <p style={{fontSize: '0.65rem', color: '#888', margin: '10px 0'}}>DRAG THE PURPLE GIZMO TO POSITION THE BLOCK CENTER.</p>
          <button className="upload-btn" onClick={commitBlock}>COMMIT_BLOCK</button>
        </>
      )}

      {view === 'editor' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>{editData.shape === 'enemy_rhombus' ? (editId ? 'EDIT_ENEMY_DATA_POINT' : 'New_ENEMY_DATA_POINT') : (editData.shape === 'friendly_rhombus' ? (editId ? 'EDIT_FRIENDLY_NPC' : 'NEW_FRIENDLY_NPC') : (editId ? 'EDIT_DATA_POINT' : 'NEW_DATA_POINT'))}</h3><button onClick={() => setView('list')} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
            <div className="button-group">
                <button className={transformMode === 'translate' ? 'active' : ''} onClick={() => setTransformMode('translate')}>MOVE</button>
                {editData.shape !== 'enemy_rhombus' && editData.shape !== 'friendly_rhombus' && <button className={transformMode === 'scale' ? 'active' : ''} onClick={() => setTransformMode('scale')}>STRETCH</button>}
                <button className={transformMode === 'rotate' ? 'active' : ''} onClick={() => setTransformMode('rotate')}>ROTATE</button>
            </div>
            <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                <button type="button" className="utility-btn" onClick={() => { if (targetObject) targetObject.position.y = 0; }} style={{flex: 1, fontSize: '0.7rem'}}>SNAP_TO_GROUND</button>
                <button type="button" className={`utility-btn ${isCopyingSize ? 'active priority-danger-btn' : ''}`} onClick={() => setIsCopyingSize(!isCopyingSize)} style={{flex: 1, fontSize: '0.7rem'}}>{isCopyingSize ? 'SELECT_ON_MAP...' : 'COPY_SIZE'}</button>
              </div>
              <div style={{display: 'flex', gap: '5px', marginTop: '5px'}}>
                <button type="button" className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{flex: 1, fontSize: '0.7rem'}}>{snapToGrid ? 'GRID_SNAP: ON' : 'GRID_SNAP: OFF'}</button>
                <button type="button" className={`utility-btn ${snapRotation ? 'active' : ''}`} onClick={() => setSnapRotation(!snapRotation)} style={{flex: 1, fontSize: '0.7rem'}}>{snapRotation ? 'ROT_SNAP: ON' : 'ROT_SNAP: OFF'}</button>
              </div>
          </div>
          <form onSubmit={handleSubmit}>
            {editData.district_name && <div style={{ fontSize: '0.7rem', color: editData.district_color || 'var(--green)', marginBottom: '10px', padding: '5px', border: '1px dashed currentColor', opacity: 0.9, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}><span>ASSIGNED_DISTRICT: {editData.district_name}</span><button type="button" onClick={() => setEditData({...editData, district_name: null, district_color: null})} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px', fontSize: '0.9rem', lineHeight: 1 }} title="REMOVE_FROM_DISTRICT">🗑</button></div>}
            <input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} />
            <textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} />
            
            {editData.shape !== 'enemy_rhombus' && editData.shape !== 'friendly_rhombus' && (
                <>
                    <textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} />
                    
                    <div style={{marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '5px'}}>
                        <label style={{fontSize: '0.7rem'}}>BASE SHAPE</label>
                        <select 
                            value={editData.shape} 
                            onChange={e => setEditData({...editData, shape: e.target.value})} 
                            style={{width: '100%', padding: '5px', background: 'color-mix(in srgb, var(--black) 60%, transparent)', border: '1px solid var(--green)', color: 'var(--green)', outline: 'none'}}
                        >
                            <option value="box">Box</option>
                            <option value="cylinder">Cylinder</option>
                            <option value="sphere">Sphere</option>
                            <option value="pyramid">Pyramid</option>
                        </select>
                        {editorGenParts.length === 0 && (editData.shape === 'sphere' || editData.shape === 'cylinder' || editData.shape === 'pyramid') && (
                            <div style={{marginTop: '5px'}}>
                                <label style={{fontSize: '0.7rem'}}>POLYGON DETAIL: {editData.polyCount || 5}</label>
                                <input 
                                    type="range" min="3" max="32" 
                                    value={editData.polyCount || 5} 
                                    onChange={(e) => setEditData({...editData, polyCount: parseInt(e.target.value)})} 
                                    style={{width: '100%'}} 
                                />
                            </div>
                        )}
                    </div>

                    {/* NEW PREMADE STRUCTURES SECTION */}
                    <div style={{marginTop: '10px', padding: '10px', border: '1px solid #333', background: 'rgba(0,0,0,0.5)'}}>
                      <label style={{fontSize: '0.7rem'}}>PREMADE STRUCTURES</label>
                      <div className="button-group" style={{marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
                        {['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'LANDMARK', 'MARKETS'].map(t => (
                          <button key={t} type="button" className={editorGenType === t ? 'active' : ''} onClick={() => {
                            setEditorGenType(t);
                            setEditorStyleIndex(0);
                            const raw: any[] = [];
                            const bWidth = (editData.baseWidth || editData.width || 2) * (targetObject ? targetObject.scale.x : 1);
                            const bDepth = (editData.baseDepth || editData.depth || 2) * (targetObject ? targetObject.scale.z : 1);
                            let zoneVal = 0.5;
                            if (t === 'CORPO') zoneVal = 0.9;
                            else if (t === 'URBAN') zoneVal = 0.5;
                            else if (t === 'SLUMS') zoneVal = 0.1;
                            else if (t === 'INDUSTRIAL') zoneVal = -0.1;
                            else if (t === 'LANDMARK') zoneVal = 1.5;
                            else if (t === 'MARKETS') zoneVal = 2.0;
                            const localIsBlocked = (x: number, z: number, w: number, d: number, buffer = 1.5) => {
                                return raw.some(l => {
                                    const xOverlap = Math.abs(l.x - x) < (l.width + w) / 2 + buffer;
                                    const zOverlap = Math.abs(l.z - z) < (l.depth + d) / 2 + buffer;
                                    return xOverlap && zOverlap;
                                });
                            };
                            const bHeight = (editData.baseHeight || editData.height || 4) * (targetObject ? targetObject.scale.y : 1);
                            generateThemedBuildingsForPlot(0, 0, bWidth, bDepth, zoneVal, localIsBlocked, () => '', {}, raw, locations, undefined, bHeight, 0);
                            setEditorStyleIndex(1);
                            setEditorGenParts(raw);
                            if (targetObject) {
                                setEditData({...editData, baseWidth: bWidth, baseDepth: bDepth, baseHeight: bHeight});
                                targetObject.scale.set(1, 1, 1);
                            }
                          }}>
                            {t}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={editorGenType === 'CUSTOM' ? 'active' : ''}
                          onClick={async () => {
                            setEditorGenType('CUSTOM');
                            setEditorStyleIndex(0);
                            setEditorGenParts([]);
                            setCustomLibraryLoading(true);
                            const res = await fetch('/api/locations/custom-library', { headers: { Authorization: `Bearer ${token}` } });
                            if (res.ok) {
                              const lib = await res.json();
                              setCustomLibrary(lib);
                              if (lib.length > 0) {
                                const entry = lib[0];
                                const rootPart = { x: 0, y: 0, z: 0, width: entry.width, height: entry.height, depth: entry.depth, shape: entry.shape || 'box', color: entry.color || '#00ff00', rotation: entry.rotation || 0, rotation_x: entry.rotation_x || 0, rotation_z: entry.rotation_z || 0, polyCount: entry.polyCount || 5 };
                                const childParts = (entry.parts || []).map((c: any) => ({ x: c.x - entry.x, y: c.y - entry.y, z: c.z - entry.z, width: c.width, height: c.height, depth: c.depth, shape: c.shape || 'box', color: c.color || '#00ff00', rotation: c.rotation || 0, rotation_x: c.rotation_x || 0, rotation_z: c.rotation_z || 0, polyCount: c.polyCount || 5, parent_name: 'ROOT' }));
                                setEditorGenParts([rootPart, ...childParts]);
                                setEditorStyleIndex(1);
                              }
                            }
                            setCustomLibraryLoading(false);
                          }}
                        >CUSTOM</button>
                      </div>
                      {editorGenType && (() => {
                        if (editorGenType === 'CUSTOM') {
                          const maxStyle = customLibrary.length;
                          if (maxStyle === 0) return (
                            <div style={{ marginTop: '8px', fontSize: '0.65rem', opacity: 0.6 }}>
                              {customLibraryLoading ? 'LOADING...' : 'No custom structures yet. Use CUSTOM_STRUCT → CUSTOM classification to add one.'}
                            </div>
                          );
                          const currentStyle = editorStyleIndex % maxStyle;
                          const displayNum = currentStyle === 0 ? maxStyle : currentStyle;
                          return (
                            <button type="button" className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => {
                              const entry = customLibrary[currentStyle];
                              if (!entry) return;
                              const rootPart = { x: 0, y: 0, z: 0, width: entry.width, height: entry.height, depth: entry.depth, shape: entry.shape || 'box', color: entry.color || '#00ff00', rotation: entry.rotation || 0, rotation_x: entry.rotation_x || 0, rotation_z: entry.rotation_z || 0, polyCount: entry.polyCount || 5 };
                              const childParts = (entry.parts || []).map((c: any) => ({ x: c.x - entry.x, y: c.y - entry.y, z: c.z - entry.z, width: c.width, height: c.height, depth: c.depth, shape: c.shape || 'box', color: c.color || '#00ff00', rotation: c.rotation || 0, rotation_x: c.rotation_x || 0, rotation_z: c.rotation_z || 0, polyCount: c.polyCount || 5, parent_name: 'ROOT' }));
                              setEditorGenParts([rootPart, ...childParts]);
                              setEditorStyleIndex(editorStyleIndex + 1);
                            }}>NEXT_STYLE [{displayNum}/{maxStyle}]</button>
                          );
                        }
                        const baseMaxStyle = editorGenType === 'CORPO' ? 11 : editorGenType === 'URBAN' ? 10 : editorGenType === 'INDUSTRIAL' ? 10 : editorGenType === 'SLUMS' ? 1 : editorGenType === 'LANDMARK' ? 13 : editorGenType === 'MARKETS' ? 5 : 0;
                        if (baseMaxStyle === 0) return null;
                        const currentStyle = editorStyleIndex % baseMaxStyle;
                        return (
                          <button type="button" className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => {
                              const raw: any[] = [];
                              const bWidth = (editData.baseWidth || editData.width || 2) * (targetObject ? targetObject.scale.x : 1);
                              const bDepth = (editData.baseDepth || editData.depth || 2) * (targetObject ? targetObject.scale.z : 1);
                              let zoneVal = 0.5;
                              if (editorGenType === 'CORPO') zoneVal = 0.9;
                              else if (editorGenType === 'URBAN') zoneVal = 0.5;
                              else if (editorGenType === 'SLUMS') zoneVal = 0.1;
                              else if (editorGenType === 'INDUSTRIAL') zoneVal = -0.1;
                              else if (editorGenType === 'LANDMARK') zoneVal = 1.5;
                              else if (editorGenType === 'MARKETS') zoneVal = 2.0;
                              const bHeight = (editData.baseHeight || editData.height || 4) * (targetObject ? targetObject.scale.y : 1);
                              generateThemedBuildingsForPlot(0, 0, bWidth, bDepth, zoneVal, () => false, () => '', {}, raw, locations, undefined, bHeight, currentStyle);
                              setEditorStyleIndex(editorStyleIndex + 1);
                              setEditorGenParts(raw);
                          }}>NEXT_STYLE [{currentStyle === 0 ? baseMaxStyle : currentStyle}/{baseMaxStyle}]</button>
                        );
                      })()}
                    </div>

                    <div style={{display: 'flex', gap: '10px', marginTop: '10px', marginBottom: '10px'}}>
                        <button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></button>
                        <button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button>
                    </div>

                    {editData.shape !== 'enemy_rhombus' && editData.shape !== 'friendly_rhombus' && editData.shape !== 'rhombus' && editData.shape !== 'none' && (
                      <div style={{display: 'flex', gap: '16px', marginTop: '8px', marginBottom: '10px'}}>
                        <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
                          <input type="checkbox" checked={editData.has_signage ?? true} onChange={e => setEditData({...editData, has_signage: e.target.checked})} />
                          SIGNAGE
                        </label>
                      </div>
                    )}

                    {/* What the building is for, which is what puts a SHOP button in the
                        info window. Cities Without Number only for now, and the server
                        refuses it under anything else — this just keeps a control off
                        screens where using it would only ever return a refusal. */}
                    {editData.shape !== 'enemy_rhombus' && editData.shape !== 'friendly_rhombus' && editData.shape !== 'rhombus' && editData.shape !== 'none' && shopsAvailable(globalSettings['game_system']) && (
                      <div style={{marginTop: '8px', marginBottom: '10px'}}>
                        <label>BUILDING TYPE</label>
                        <select
                          aria-label="Building type"
                          value={editData.building_type || ''}
                          onChange={e => setEditData({...editData, building_type: e.target.value})}
                          style={{width: '100%'}}
                        >
                          <option value="">— NONE —</option>
                          {BUILDING_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}{t.shop ? ' (shop)' : ''}</option>
                          ))}
                        </select>
                      </div>
                    )}
                </>
            )}
            
            {editId && editData.shape === 'friendly_rhombus' && (() => {
              // Handing a friendly NPC to the players running it. Admins keep control
              // whatever is set here - this shares the token, it does not give it away.
              const grant = parseGrant(editData.controllers);
              const players = (activeUsers || [])
                .filter((u: any) => !u.isAdmin && !u.isNPC)
                .map((u: any) => u.userName);
              // Anyone already granted stays listed even if they are offline, or removing
              // them would mean waiting for them to log back in.
              const names: string[] = [...new Set([...players, ...grant.users])].sort();
              const push = (next: { all: boolean; users: string[] }) => {
                setEditData({ ...editData, controllers: JSON.stringify(next) });
                socketRef.current?.emit('setTokenControl', { id: editId, all: next.all, users: next.users });
              };
              return (
                <div style={{ marginTop: '15px', borderTop: '1px solid #333', paddingTop: '10px' }}>
                  <h4 style={{ marginBottom: '4px' }}>PLAYER_CONTROL</h4>
                  <p style={{ fontSize: '0.62rem', opacity: 0.7, margin: '0 0 8px', lineHeight: 1.5 }}>
                    Who else can move this NPC. You keep control either way.
                  </p>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem', marginBottom: '8px' }}>
                    <input
                      type="checkbox"
                      checked={grant.all}
                      onChange={(e) => push({ all: e.target.checked, users: grant.users })}
                    />
                    ALL PLAYERS
                  </label>

                  {names.length === 0 ? (
                    <p style={{ fontSize: '0.62rem', opacity: 0.5, fontStyle: 'italic' }}>NO PLAYERS ONLINE TO NAME.</p>
                  ) : names.map((name) => (
                    <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.7rem', opacity: grant.all ? 0.45 : 1 }}>
                      <input
                        type="checkbox"
                        checked={grant.all || grant.users.includes(name)}
                        disabled={grant.all}
                        onChange={(e) => push({
                          all: grant.all,
                          users: e.target.checked
                            ? [...grant.users, name]
                            : grant.users.filter((u) => u !== name),
                        })}
                      />
                      {name}
                    </label>
                  ))}

                  <p style={{ fontSize: '0.62rem', opacity: 0.6, marginTop: '8px' }}>
                    NOW: {describeGrant({ ...editData, shape: 'friendly_rhombus' })}
                  </p>
                </div>
              );
            })()}

            <button type="submit" className="upload-btn">
                {editData.shape === 'enemy_rhombus' ? (editId ? 'UPDATE_ENEMY_DATA' : 'UPLOAD_NEW_ENEMY') : (editData.shape === 'friendly_rhombus' ? (editId ? 'UPDATE_FRIENDLY_NPC' : 'UPLOAD_NEW_FRIENDLY') : (editId ? 'UPDATE_DATA_POINT' : 'UPLOAD_NEW'))}
            </button>
            {isAdmin && isPrimaryAdmin && editId && editData.shape !== 'enemy_rhombus' && editData.shape !== 'friendly_rhombus' && (
                <button type="button" className="upload-btn" style={{backgroundColor: '#5500ff', marginTop: '10px'}} onClick={() => setShowBattleMapManager(true)}>BATTLE MAPS</button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

const BANK_SOUND_KEYS: BankSoundKey[] = ['cashregister', 'debtpaid', 'highroller', 'firstpay', 'overdraft'];
const BANK_SOUND_LABELS: Record<BankSoundKey, string> = {
  cashregister: 'Cash Register',
  debtpaid: 'Debt Paid Off',
  highroller: 'High Roller 🐋',
  firstpay: 'First Payday 🎊',
  overdraft: 'Overdraft 😢',
};
const BANK_SOUND_TESTERS: Record<BankSoundKey, (vol: number) => void> = {
  cashregister: playCashRegister,
  debtpaid: playProudFanfare,
  highroller: playHighRollerSound,
  firstpay: playCalibration,
  overdraft: playWompWomp,
};

// Per-system house rules: staged locally, written to global_settings on
// APPLY (not on every click). Self-contained - give it the rule definitions
// and it handles load / stage / apply / revert / status.
interface HouseRuleDef {
  settingKey: string;
  label: string;
  title: string;
  /** Rules that are ON when the key is absent (e.g. cwn_trauma). */
  defaultOn?: boolean;
}

function HouseRulesPanel({ token, defs }: { token: string; defs: HouseRuleDef[] }) {
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then((rows) => {
      if (!Array.isArray(rows)) return;
      const loaded: Record<string, boolean> = {};
      defs.forEach((d) => {
        const value = rows.find((r: any) => r.key === d.settingKey)?.value;
        loaded[d.settingKey] = d.defaultOn ? value !== '0' : value === '1';
      });
      setRules(loaded);
      setSaved(loaded);
    }).catch(() => {});
  }, [defs.map(d => d.settingKey).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = defs.some(d => rules[d.settingKey] !== saved[d.settingKey]);
  const apply = async () => {
    try {
      for (const d of defs) {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ key: d.settingKey, value: rules[d.settingKey] ? '1' : '0' }),
        });
      }
      setSaved({ ...rules });
      setMsg('HOUSE RULES APPLIED');
    } catch {
      setMsg('APPLY FAILED');
    }
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div style={{ border: '1px solid var(--dark-green)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0, color: 'var(--green)', fontSize: '0.65rem', letterSpacing: '1px', opacity: 0.8 }}
      >
        <span>HOUSE RULES</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <>
        {defs.map((d) => (
          <label
            key={d.settingKey}
            title={d.title}
            style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={!!rules[d.settingKey]}
              onChange={(e) => setRules(r => ({ ...r, [d.settingKey]: e.target.checked }))}
              style={{ flexShrink: 0 }}
            />
            <span style={{ textAlign: 'left' }}>{d.label}</span>
          </label>
        ))}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            className="utility-btn"
            style={{ fontSize: '0.65rem', padding: '3px 12px', opacity: dirty ? 1 : 0.4 }}
            disabled={!dirty}
            onClick={apply}
          >
            APPLY
          </button>
          {dirty && (
            <button
              className="utility-btn"
              style={{ fontSize: '0.65rem', padding: '3px 12px' }}
              onClick={() => setRules({ ...saved })}
            >
              REVERT
            </button>
          )}
          {msg && (
            <span style={{ fontSize: '0.6rem', color: 'var(--green)', opacity: 0.8, letterSpacing: '1px' }}>{msg}</span>
          )}
          {dirty && !msg && (
            <span style={{ fontSize: '0.6rem', color: 'var(--warning)', opacity: 0.8, letterSpacing: '1px' }}>UNSAVED CHANGES</span>
          )}
        </div>
      </>}
    </div>
  );
}

const GLOBAL_HOUSE_RULES: HouseRuleDef[] = [
  {
    settingKey: 'initiative_follows_building',
    label: 'INITIATIVE FOLLOWS BUILDING (ALL FLOORS SHARE ONE TRACKER)',
    title: 'When enabled, all floors of the same building share a single initiative tracker. Players moving between floors stay in the same combat order. Each building and the city map still have their own separate initiatives.',
  },
];

const CPR_HOUSE_RULES: HouseRuleDef[] = [
  {
    settingKey: 'cpr_exploding_initiative',
    label: 'EXPLODING INITIATIVE DIE (HOUSE RULE)',
    title: 'House rule: rolling a 10 on the initiative d10 adds 10 to the score and triggers another d10 roll, which is also added. Keeps exploding on consecutive 10s. Off by default (RAW: single d10, no explosion).',
  },
  {
    settingKey: 'melee_dv_take10',
    label: 'MELEE_DV TAKE-10 (10 + DEX + EVASION INSTEAD OF 6 +)',
    title: 'Melee DV stamped at sheet generation/attach: default is 6 + DEX + Evasion (average of the opposed Evasion roll); take-10 uses 10 + DEX + Evasion for a harder melee defense. Existing tokens are not changed.',
  },
  {
    settingKey: 'luck_negates_fumble',
    label: 'LUCK BONUS ALSO NEGATES NAT-1',
    title: 'House rule: any LUCK spent as a roll bonus also negates a natural-1 critical fumble. Off = RAW: only the dedicated 1-LUCK fumble shield negates. Players always have the shield option either way.',
  },
];

const CWN_HOUSE_RULES: HouseRuleDef[] = [
  {
    settingKey: 'cwn_individual_initiative',
    label: 'INDIVIDUAL INITIATIVE',
    title: 'House rule: each combatant rolls their own 1d8 + DEX mod and acts in individual order. RAW: the whole party rolls once using the best DEX mod, acting as one side against the NPC side.',
  },
  {
    settingKey: 'cwn_trauma',
    label: 'GRITTY COMBAT (TRAUMA DIE + MAJOR INJURIES)',
    title: 'Gritty Combat: on a hit, roll the weapon\'s trauma die — if it meets the target\'s Trauma Target the damage is multiplied. Also enables the Major Injury flow when a traumatic hit drops a PC to 0 HP. On by default. Off = plain hit/damage + shock only.',
    defaultOn: true,
  },
  {
    settingKey: 'cwn_deluxe',
    label: 'DELUXE EDITION (SPELLCASTING + SUMMONING)',
    title: 'CWN Deluxe Edition: enables Spellcasting and Summoning on character sheets, including Mage Effort, Summoner Effort, and one-click casting. Off by default.',
  },
];

const SR6_HOUSE_RULES: HouseRuleDef[] = [
  {
    settingKey: 'sr6_awakened',
    label: 'AWAKENED (MAGIC)',
    title: 'Unlocks the AWAKENED tab on character sheets: spells, powers, tradition, and the Magic attribute. Off by default.',
  },
  {
    settingKey: 'sr6_emerged',
    label: 'EMERGED (RESONANCE)',
    title: 'Unlocks the EMERGED tab on character sheets: complex forms, sprites, and the Resonance attribute. Off by default.',
  },
];

function TTRPGSystemPanel({ token, onOpenNpcLibrary, activeUsers }: { token: string; onOpenNpcLibrary?: () => void; activeUsers?: any[] }) {
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<string>('generic');
  const [systems, setSystems] = useState<{ id: string; name: string }[]>([]);
  const [luckResetMsg, setLuckResetMsg] = useState<string | null>(null);
  const [edgeGrantTarget, setEdgeGrantTarget] = useState<string>('');

  const refresh = () => {
    fetch('/api/sheets/system').then(r => r.json()).then(d => {
      if (d.system) setSystem(d.system);
      if (d.systems) setSystems(d.systems);
    }).catch(() => {});
  };

  useEffect(() => { if (open) refresh(); }, [open]);

  const selectSystem = (id: string) => {
    fetch('/api/sheets/system', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ system: id }),
    }).then(r => { if (r.ok) setSystem(id); });
  };

  return (
    <div style={{ marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px' }}>
      <button className="utility-btn" style={{ width: '100%' }} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} TTRPG_SYSTEM
      </button>
      {open && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.7rem' }}>GAME SYSTEM</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {systems.map(s => (
              <button
                key={s.id}
                className={`utility-btn ${system === s.id ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: '0.65rem' }}
                onClick={() => selectSystem(s.id)}
              >
                {s.name.toUpperCase()}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '0.6rem', opacity: 0.6, margin: 0 }}>
            Player sheets for the current system are kept and restored if you switch back.
          </p>
          <HouseRulesPanel token={token} defs={[
            ...GLOBAL_HOUSE_RULES,
            ...(system === 'cities_without_number' ? CWN_HOUSE_RULES : []),
            ...(system === 'cyberpunk_red' ? CPR_HOUSE_RULES : []),
            ...(system === 'shadowrun_6e' ? SR6_HOUSE_RULES : []),
          ]} />
          {system === 'shadowrun_6e' && (() => {
            const onlinePlayers = (activeUsers || []).filter((u: any) => !u.isAdmin && !u.isNPC).map((u: any) => u.userName);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--green)', paddingTop: '6px', marginTop: '2px' }}>
                <label style={{ fontSize: '0.65rem', opacity: 0.7, letterSpacing: '1px' }}>EDGE MANAGEMENT</label>
                <button
                  className="utility-btn"
                  style={{ fontSize: '0.65rem' }}
                  title="Restore all SR6 players' Edge to their Edge Max"
                  onClick={() => {
                    fetch('/api/sheets/reset-edge', {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                    }).then(r => r.json()).then(d => {
                      setLuckResetMsg(d.reason ?? `EDGE REPLENISHED — ${d.reset} SHEET${d.reset !== 1 ? 'S' : ''}`);
                      setTimeout(() => setLuckResetMsg(null), 3000);
                    }).catch(() => setLuckResetMsg('REPLENISH FAILED'));
                  }}
                >
                  REPLENISH ALL EDGE
                </button>
                {onlinePlayers.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <select
                      value={edgeGrantTarget}
                      onChange={e => setEdgeGrantTarget(e.target.value)}
                      style={{ flex: 1, fontSize: '0.65rem', background: 'var(--bg)', color: 'var(--green)', border: '1px solid var(--green)', padding: '3px 4px' }}
                    >
                      <option value="">— PLAYER —</option>
                      {onlinePlayers.map((name: string) => (
                        <option key={name} value={name}>{name.toUpperCase()}</option>
                      ))}
                    </select>
                    <button
                      className="utility-btn"
                      style={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}
                      disabled={!edgeGrantTarget}
                      title="Give 1 Edge to the selected player (capped at their Edge Max)"
                      onClick={() => {
                        if (!edgeGrantTarget) return;
                        fetch('/api/sheets/grant-edge', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ username: edgeGrantTarget }),
                        }).then(r => r.json()).then(d => {
                          if (d.granted) {
                            setLuckResetMsg(`${edgeGrantTarget.toUpperCase()} → EDGE ${d.edge}/${d.edge_max}`);
                          } else {
                            setLuckResetMsg(d.reason ?? 'GRANT FAILED');
                          }
                          setTimeout(() => setLuckResetMsg(null), 3000);
                        }).catch(() => setLuckResetMsg('GRANT FAILED'));
                      }}
                    >
                      GIVE 1 EDGE
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ display: 'flex', gap: '6px' }}>
            {onOpenNpcLibrary && (
              <button
                className="utility-btn"
                style={{ fontSize: '0.65rem', flex: 1 }}
                onClick={onOpenNpcLibrary}
              >
                NPC_LIBRARY
              </button>
            )}
            {system === 'cyberpunk_red' && (
              <button
                className="utility-btn"
                style={{ fontSize: '0.65rem', flex: 1 }}
                title="Reset all player LUCK to their maximum value"
                onClick={() => {
                  fetch('/api/sheets/reset-luck', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  }).then(r => r.json()).then(d => {
                    setLuckResetMsg(d.reason ?? `LUCK RESET — ${d.reset} SHEET${d.reset !== 1 ? 'S' : ''}`);
                    setTimeout(() => setLuckResetMsg(null), 3000);
                  }).catch(() => setLuckResetMsg('RESET FAILED'));
                }}
              >
                RESET_ALL_LUCK
              </button>
            )}
            {system === 'cities_without_number' && (
              <button
                className="utility-btn"
                style={{ fontSize: '0.65rem', flex: 1 }}
                title="Long rest: every CWN sheet (players and NPCs) recovers 1 System Strain"
                onClick={() => {
                  fetch('/api/sheets/cwn-rest', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  }).then(r => r.json()).then(d => {
                    setLuckResetMsg(d.reason ?? `LONG REST — ${d.rested} SHEET${d.rested !== 1 ? 'S' : ''} RECOVERED 1 STRAIN`);
                    setTimeout(() => setLuckResetMsg(null), 3000);
                  }).catch(() => setLuckResetMsg('REST FAILED'));
                }}
              >
                LONG_REST (STRAIN −1)
              </button>
            )}
          </div>
          {luckResetMsg && (
            <div style={{ fontSize: '0.6rem', color: 'var(--green)', opacity: 0.8, letterSpacing: '1px' }}>
              {luckResetMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BankSoundsPanel({ token, globalSettings, fetchGlobalSettings }: { token: string; globalSettings: any; fetchGlobalSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [volumes, setVolumes] = useState<Record<BankSoundKey, number>>({
    cashregister: 1, debtpaid: 1, highroller: 1, firstpay: 1, overdraft: 1,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!globalSettings) return;
    setVolumes({
      cashregister: parseFloat(globalSettings.bank_vol_cashregister ?? '1'),
      debtpaid: parseFloat(globalSettings.bank_vol_debtpaid ?? '1'),
      highroller: parseFloat(globalSettings.bank_vol_highroller ?? '1'),
      firstpay: parseFloat(globalSettings.bank_vol_firstpay ?? '1'),
      overdraft: parseFloat(globalSettings.bank_vol_overdraft ?? '1'),
    });
  }, [globalSettings]);

  const saveVolumes = async () => {
    setSaving(true);
    await Promise.all(BANK_SOUND_KEYS.map(key =>
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: `bank_vol_${key}`, value: volumes[key] }),
      })
    ));
    setSaving(false);
    fetchGlobalSettings();
  };

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        className="utility-btn"
        style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
        onClick={() => setOpen(o => !o)}
      >
        <span>BANK SOUNDS</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {BANK_SOUND_KEYS.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="utility-btn"
                style={{ minWidth: '36px', padding: '4px 8px' }}
                onClick={() => BANK_SOUND_TESTERS[key](volumes[key])}
              >▶</button>
              <span style={{ minWidth: '130px', fontSize: '0.75rem' }}>{BANK_SOUND_LABELS[key]}</span>
              <input
                type="range" min="0" max="2" step="0.05"
                value={volumes[key]}
                onChange={e => setVolumes(v => ({ ...v, [key]: parseFloat(e.target.value) }))}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: '32px', fontSize: '0.75rem', textAlign: 'right' }}>
                {Math.round(volumes[key] * 100)}%
              </span>
            </div>
          ))}
          <button className="utility-btn" onClick={saveVolumes} disabled={saving} style={{ marginTop: '4px' }}>
            {saving ? 'SAVING...' : 'SAVE VOLUMES'}
          </button>
        </div>
      )}
    </div>
  );
}


