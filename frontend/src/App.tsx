import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Location, District, Road, WaterBody, BattleMap, SavedMap,
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
import { HitPointsMenu } from './components/HitPoints';
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
import { Building, InstancedBuildings, generateThemedBuildingsForPlot } from './components/Buildings';
import { DistrictInteractions, WaterBody, WaterBodies, Roads, GhostTraffic } from './components/MapElements';



function AdminPanel({
  socketRef, token, onLogout, refreshLocations, refreshRoads, locations, roads, editData, setEditData, editId, setEditId,
  transformMode, setTransformMode, targetObject, blockBuildings, setBlockBuildings, selectedLocation,
  setSelectedLocation, setTargetObject, isChatOpen, setIsChatOpen, controlsRef, view, setView, pendingRequests, setPendingRequests,
  isBatchSelecting, setIsBatchSelecting, selectedIds, setSelectedIds, toggleSelection, batchDelete,
  districtSelection, setDistrictSelection, districtConfig, setDistrictConfig,
  districts, fetchDistricts, editingDistrict, setEditingDistrict,
  joinSelection, setJoinSelection, selectedClassification, setSelectedClassification, roadSelectionBounds, setRoadSelectionBounds,
  roadTrail, setRoadTrail, waterTrail, setWaterTrail, fetchWaterBodies, roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid, snapRotation, setSnapRotation,
  drawingRoadWidth, setDrawingRoadWidth, isGeneratingMap, setIsGeneratingMap, citySectionType, setCitySectionType,
  genExcludeRoads, setGenExcludeRoads, setRhombusState, setActiveSidebarMenu,
  editorGenParts, setEditorGenParts, editorGenType, setEditorGenType, editorStyleIndex, setEditorStyleIndex,
  isCopyingSize, setIsCopyingSize, isAdmin, isPrimaryAdmin, setShowBattleMapManager,
  isPlantingTrees, setIsPlantingTrees, treeBatchSize, setTreeBatchSize, userName,
    isDeployingEnemy, setIsDeployingEnemy, isDeployingFriendly, setIsDeployingFriendly, handleSaveDefault, handleLoadDefault,
    tempCityMapScale, setTempCityMapScale, globalSettings, fetchGlobalSettings, tempBattleMapScale, setTempBattleMapScale, activeBattleMapData, setIsAdminPayOpen
  }: any) {
  if (view === 'battle_map') {
    let resolvedBattleMapScale: number | string = 5;
    if (tempBattleMapScale !== null) {
        resolvedBattleMapScale = tempBattleMapScale;
    } else if (activeBattleMapData) {
        const loc = locations.find((l:any) => l.id === activeBattleMapData.locationId);
        if (loc) {
            let scaleData = loc.map_scale_multiplier;
            if (typeof scaleData === 'string' && scaleData.startsWith('[')) {
                try {
                    const arr = JSON.parse(scaleData);
                    const idx = activeBattleMapData?.currentFloorIndex || 0;
                    if (arr[idx] !== undefined && arr[idx] !== null) resolvedBattleMapScale = arr[idx];
                    else resolvedBattleMapScale = arr[0] || 5;
                } catch(e) {}
            } else {
                resolvedBattleMapScale = parseFloat(scaleData) || 5;
            }
        }
    }

    return (
      <div className="panel admin-panel" style={{ width: '300px', maxHeight: '90vh', overflowY: 'auto', pointerEvents: 'auto' }}>
        <h3 style={{ textShadow: '0 0 10px #00ff00', margin: '0 0 10px 0' }}>BATTLE ADMIN</h3>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button className="upload-btn" onClick={() => { setIsDeployingEnemy(!isDeployingEnemy); setIsDeployingFriendly(false); }} style={{ flex: 1, backgroundColor: isDeployingEnemy ? '#ff0000' : '' }}>{isDeployingEnemy ? 'CANCEL_DEPLOY' : 'ADD_ENEMY'}</button>
          <button className="upload-btn" onClick={() => { setIsDeployingFriendly(!isDeployingFriendly); setIsDeployingEnemy(false); }} style={{ flex: 1, backgroundColor: isDeployingFriendly ? '#00ccff' : '' }}>{isDeployingFriendly ? 'CANCEL_DEPLOY' : 'ADD_FRIENDLY'}</button>
        </div>
        <div style={{ marginBottom: '10px', borderTop: '1px solid #00ff00', paddingTop: '10px' }}>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>
                    MAP SCALE (FT/UNIT): {resolvedBattleMapScale}
                </label>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <input type="range" min="0.1" max="50" step="0.1" 
                    value={resolvedBattleMapScale}
                    onChange={(e) => setTempBattleMapScale(e.target.value)} style={{ flex: 1 }} />
                <input type="number" step="0.1" 
                    value={resolvedBattleMapScale}
                    onChange={(e) => setTempBattleMapScale(e.target.value)} style={{ width: '60px', backgroundColor: '#222', color: '#00ff00', border: '1px solid #00ff00', padding: '5px' }} />
                <button className="utility-btn" onClick={() => {
                    if (tempBattleMapScale === null) return;
                    const loc = locations.find((l:any) => l.id === activeBattleMapData.locationId);
                    if (loc) {
                        let currentArr: any[] = [];
                        if (typeof loc.map_scale_multiplier === 'string' && loc.map_scale_multiplier.startsWith('[')) {
                            try { currentArr = JSON.parse(loc.map_scale_multiplier); } catch(e) {}
                        } else {
                            currentArr = [parseFloat(loc.map_scale_multiplier) || 5];
                        }
                        const idx = activeBattleMapData?.currentFloorIndex || 0;
                        const parsedScale = parseFloat(tempBattleMapScale.toString());
                        currentArr[idx] = !isNaN(parsedScale) ? parsedScale : 5;
                        
                        fetch(`/api/locations/${loc.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ ...loc, map_scale_multiplier: JSON.stringify(currentArr) })
                        }).then(() => {
                            setTempBattleMapScale(null);
                            refreshLocations();
                        });
                    }
                }}>APPLY</button>
            </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px', borderTop: '1px solid #00ff00', paddingTop: '10px', borderBottom: '1px solid #00ff00', paddingBottom: '10px' }}>
           <button style={{ padding: '10px', backgroundColor: '#5500ff', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }} onClick={handleSaveDefault}>SAVE_DEFAULT</button>
           <button style={{ padding: '10px', backgroundColor: '#aa00ff', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }} onClick={handleLoadDefault}>LOAD_DEFAULT</button>
        </div>
        <button className="utility-btn" onClick={() => setIsAdminPayOpen(true)} style={{ width: '100%', marginBottom: '10px' }}>PAY_PLAYERS</button>
        <button className="utility-btn danger-btn" onClick={() => {
            onLogout();
        }} style={{ width: '100%' }}>EXIT_ADMIN_MODE</button>
      </div>
    );
  }

  const [density, setDensity] = useState(8);
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
    socketRef.current.on('editingStarted', (data: any) => setActiveUserEditing(data));
    socketRef.current.on('editingStopped', () => setActiveUserEditing(null));
    return () => { socketRef.current.off('editingStarted'); socketRef.current.off('editingStopped'); };
  }, []);

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [adminAlert, setAdminAlert] = useState<string | null>(null);
  const [showDefined, setShowDefined] = useState(false);
  const [showUndefined, setShowUndefined] = useState(false);
  const defined = locations.filter((l: any) => !l.parent_id && isUserDefinedName(l.name));
  const undefinedLocs = locations.filter((l: any) => !l.parent_id && !isUserDefinedName(l.name));

  const consolidateRoads = (newSegments: any[], existingRoads: any[], snapDist = 6) => {
    const points: THREE.Vector3[] = [];
    newSegments.forEach(s => { points.push(new THREE.Vector3(s.x1, 0, s.z1), new THREE.Vector3(s.x2, 0, s.z2)); });
    
    // Snap to existing nodes OR project onto existing segments
    points.forEach(p => {
        let bestDist = snapDist;
        let snapTarget: THREE.Vector3 | null = null;

        for (const r of existingRoads) {
            const p1 = new THREE.Vector3(r.x1, 0, r.z1); 
            const p2 = new THREE.Vector3(r.x2, 0, r.z2);
            
            // Check endpoints
            const d1 = p.distanceTo(p1);
            const d2 = p.distanceTo(p2);
            if (d1 < bestDist) { bestDist = d1; snapTarget = p1; }
            if (d2 < bestDist) { bestDist = d2; snapTarget = p2; }

            // Project onto segment if not near endpoints
            const line = new THREE.Line3(p1, p2);
            const closest = new THREE.Vector3();
            line.closestPointToPoint(p, true, closest);
            const dLine = p.distanceTo(closest);
            if (dLine < bestDist) { bestDist = dLine; snapTarget = closest; }
        }
        if (snapTarget) p.copy(snapTarget);
    });

    // Snap new points to each other
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (points[i].distanceTo(points[j]) < snapDist) points[j].copy(points[i]);
        }
    }

    return newSegments.map((s, i) => ({ 
        ...s, 
        x1: points[i*2].x, z1: points[i*2].z, 
        x2: points[i*2+1].x, z2: points[i*2+1].z 
    })).filter(s => new THREE.Vector3(s.x1, 0, s.z1).distanceTo(new THREE.Vector3(s.x2, 0, s.z2)) > 0.5);
  };

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
        shape: 'enemy_rhombus', color: '#ff0000', isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5
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
        shape: 'friendly_rhombus', color: '#00ccff', isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5
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
    if (res.ok) { setAdminAlert("BLOCK_COMMITTED"); refreshLocations(); setBlockBuildings([]); setView('list'); }
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
                setAdminAlert("LOCATION_UPLOADED"); 
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
        if (res.ok) { setAdminAlert("LOCATION_UPLOADED"); targetObject.scale.set(1, 1, 1); targetObject.rotation.set(0, 0, 0); refreshLocations(); setView('list'); setEditorGenParts([]); setEditorGenType(''); }
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
        setAdminAlert("DATA_UPDATED"); targetObject.scale.set(1, 1, 1); refreshLocations(); setView('list');
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
        // Option to show what was undone
        console.log("Undone:", data.type);
        refreshLocations();
    } else {
        const err = await res.json();
        setAdminAlert(err.error || "UNDO_FAILED");
    }
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
    setAdminAlert("DATA_LINK_COPIED");
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
        setAdminAlert("DATA_LINK_PASTED");
        refreshLocations();
    }
  };

  const resolvedDeleteTarget = deleteTarget?.parent_id ? locations.find((l: any) => l.id === deleteTarget.parent_id) || deleteTarget : deleteTarget;

  return (
    <div className="panel admin-panel">
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
      {deleteTarget && resolvedDeleteTarget && (
        <div className="modal-overlay"><div className="panel critical-alert"><h2 className="alert-text">!! CRITICAL_WARNING !!</h2><p>CONFIRM DESTRUCTION OF {locations.filter((l: any) => l.parent_id === resolvedDeleteTarget.id).length > 0 ? 'STRUCTURE GROUP' : 'DATA POINT'}:</p><p className="highlight">[{isUserDefinedName(resolvedDeleteTarget.name) ? resolvedDeleteTarget.name : getStructLabel(resolvedDeleteTarget)}]</p><div className="button-group" style={{marginTop: '20px'}}><button className="upload-btn danger-btn" onClick={executeDelete}>PURGE_DATA</button><button className="utility-btn" onClick={() => setDeleteTarget(null)}>ABORT_OPERATION</button></div></div></div>
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
          <button className="upload-btn" onClick={startNew}>+ ADD_NEW_DATA_POINT</button>
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
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setDistrictSelection([]); setEditingDistrict(null); setView('district'); }}>+ MNG_DISTRICT</button>
              <button className="utility-btn" style={{flex: 1}} onClick={() => { setSelectedLocation(null); setJoinSelection([]); setView('join'); }}>+ JOIN_STRUCTS</button>
          </div>
          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className="utility-btn" style={{flex: 1, borderColor: '#ff0000', color: '#ff0000'}} onClick={startNewEnemy}>+ ADD_ENEMY</button>
              <button className="utility-btn" style={{flex: 1, borderColor: '#00ccff', color: '#00ccff'}} onClick={startNewFriendly}>+ ADD_FRIENDLY</button>
          </div>
          <div style={{ marginTop: '10px', borderTop: '1px solid #00ff00', paddingTop: '10px' }}>
              <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '5px' }}>
                  GLOBAL MAP SCALE (FT/UNIT): {tempCityMapScale !== null ? tempCityMapScale : (globalSettings?.map_scale_multiplier || 5)}
              </label>
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  <input type="range" min="0.1" max="50" step="0.1" 
                      value={tempCityMapScale !== null ? tempCityMapScale : (globalSettings?.map_scale_multiplier || 5)}
                      onChange={(e) => setTempCityMapScale(e.target.value)} style={{ flex: 1 }} />
                  <input type="number" step="0.1" 
                      value={tempCityMapScale !== null ? tempCityMapScale : (globalSettings?.map_scale_multiplier || 5)}
                      onChange={(e) => setTempCityMapScale(e.target.value)} style={{ width: '60px', backgroundColor: '#222', color: '#00ff00', border: '1px solid #00ff00', padding: '5px' }} />
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
          <button className="utility-btn danger-btn" style={{marginTop: '10px', width: '100%'}} onClick={async () => {
            if (confirm("PURGE ALL ROAD DATA?")) {
              const res = await fetch('/api/roads', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
              if (res.ok) {
                setAdminAlert("ALL ROADS PURGED FROM DATABASE");
                if (refreshRoads) refreshRoads();
              }
            }
          }}>PURGE_ALL_ROADS</button>
          <button className="utility-btn danger-btn" style={{marginTop: '10px', width: '100%'}} onClick={async () => {
            if (confirm("PURGE ALL WATER DATA?")) {
              const res = await fetch('/api/water', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
              if (res.ok) {
                setAdminAlert("ALL WATER PURGED FROM DATABASE");
                if (fetchWaterBodies) fetchWaterBodies();
              }
            }
          }}>PURGE_ALL_WATER</button>
          <button className="utility-btn danger-btn" style={{marginTop: '5px', width: '100%'}} onClick={async () => { if (confirm("PURGE ALL CHAT HISTORY?")) { await fetch('/api/chat/purge', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); } }}>PURGE_CHAT_HISTORY</button>
          <button className="utility-btn danger-btn" style={{marginTop: '5px', width: '100%'}} onClick={() => { if (confirm("PURGE ALL DICE ROLL HISTORY?")) { socketRef.current.emit('purgeDiceHistory', { token }); setAdminAlert("DICE ROLL HISTORY PURGED"); } }}>PURGE_ROLL_HISTORY</button>
          <button className={`utility-btn ${isBatchSelecting ? 'active' : ''}`} style={{marginTop: '10px', width: '100%'}} onClick={() => { if (isBatchSelecting) setSelectedIds([]); setIsBatchSelecting(!isBatchSelecting); }}>{isBatchSelecting ? 'CANCEL_BATCH_DELETE' : 'BATCH_DELETE_MODE'}</button>
          {isBatchSelecting && <button className="upload-btn danger-btn" style={{marginTop: '10px'}} onClick={batchDelete}>PURGE_SELECTED ({selectedIds.length})</button>}
          {!isBatchSelecting && (selectedLocation || copyBuffer) && (
            <div className="panel selection-panel" style={{marginTop: '15px', marginBottom: '15px'}}>
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
          {pendingRequests.length > 0 && pendingRequests.map((req: any, i: number) => (
            <div key={i} className="panel" style={{marginTop: '15px', borderColor: 'var(--green)'}}>
              <h4>ACCESS_REQUEST: {req.userName}</h4>
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
          {activeUserEditing && <div className="panel" style={{marginTop: '15px', borderColor: '#ff0000'}}><h4>ACTIVE_EDIT: {activeUserEditing.userId}</h4><button className="upload-btn danger-btn" onClick={() => socketRef.current.emit('revokeEditing', { userId: activeUserEditing.userId })}>REVOKE_ACCESS</button></div>}
          <div className="location-list" style={{maxHeight: '250px', marginTop: '15px'}}>
            <h4 style={{cursor: 'pointer', display: 'flex', alignItems: 'center'}} onClick={() => setShowDefined(!showDefined)}><span style={{width: '20px', display: 'inline-block'}}>{showDefined ? '▼' : '▶'}</span> DEFINED_STRUCTURES ({defined.length})</h4>
            {showDefined && defined.map(loc => (
              <div key={loc.id} className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => setSelectedLocation(loc)} style={{cursor: 'pointer', paddingLeft: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}><div style={{display: 'flex', alignItems: 'center', gap: '10px', flex: 1, overflow: 'hidden'}}><input type="checkbox" checked={selectedIds.includes(loc.id)} onChange={() => toggleSelection(loc.id)} onClick={(e) => e.stopPropagation()} /><span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{loc.name}</span></div>{!isBatchSelecting && <div style={{display: 'flex', gap: '5px'}}><button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); startEdit(loc); }}>EDIT</button><button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); setDeleteTarget(loc); }}>DEL</button></div>}</div>
            ))}
            <h4 style={{cursor: 'pointer', marginTop: '10px', display: 'flex', alignItems: 'center'}} onClick={() => setShowUndefined(!showUndefined)}><span style={{width: '20px', display: 'inline-block'}}>{showUndefined ? '▼' : '▶'}</span> UNDEFINED_STRUCTURES ({undefinedLocs.length})</h4>
            {showUndefined && undefinedLocs.map((loc: any) => (
              <div key={loc.id} className={`list-item ${selectedLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => setSelectedLocation(loc)} style={{cursor: 'pointer', paddingLeft: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}><div style={{display: 'flex', alignItems: 'center', gap: '10px', flex: 1, overflow: 'hidden'}}><input type="checkbox" checked={selectedIds.includes(loc.id)} onChange={() => toggleSelection(loc.id)} onClick={(e) => e.stopPropagation()} /><span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{getStructLabel(loc)}</span></div>{!isBatchSelecting && <div style={{display: 'flex', gap: '5px'}}><button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); startEdit(loc); }}>EDIT</button><button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem', width: 'auto'}} onClick={(e) => { e.stopPropagation(); setDeleteTarget(loc); }}>DEL</button></div>}</div>
            ))}
          </div>
          <button onClick={() => setIsAdminPayOpen(true)} className="upload-btn" style={{ width: '100%', marginBottom: '10px', backgroundColor: '#00ff66', color: '#000' }}>PAY_PLAYERS</button>
          <button onClick={onLogout} className="logout-btn">EXIT_ADMIN_MODE</button>
        </>
      )}

      {view === 'draw_roads' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>DRAW_ROADS</h3><button onClick={() => { setView('list'); setRoadTrail([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div className="editor-controls">
              <label style={{fontSize: '0.7rem'}}>DRAWING_MODE</label>
              <div className="button-group" style={{marginTop: '5px'}}>
                  <button className={roadDrawMode === 'free' ? 'active' : ''} onClick={() => { setRoadDrawMode('free'); }}>FREE_DRAW</button>
                  <button className={roadDrawMode === 'straight' ? 'active' : ''} onClick={() => { setRoadDrawMode('straight'); }}>STRAIGHT</button>
              </div>
              <button className={`utility-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} style={{marginTop: '10px', width: '100%'}}>{snapToGrid ? 'SNAP_TO_GRID: ON' : 'SNAP_TO_GRID: OFF'}</button>
              <div style={{marginTop: '10px'}}>
                <label style={{fontSize: '0.7rem'}}>ROAD_THICKNESS: {drawingRoadWidth.toFixed(1)}</label>
                <input type="range" min="0.5" max="10" step="0.1" value={drawingRoadWidth} onChange={(e) => setDrawingRoadWidth(parseFloat(e.target.value))} style={{width: '100%'}} />
              </div>
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>PATHS_DRAWN: {roadTrail.length}</p><p>TOTAL_NODES: {roadTrail.reduce((acc, curr) => acc + curr.length, 0)}</p><p style={{opacity: 0.7, marginTop: '5px'}}>HOLD LEFT-CLICK TO DRAW PATH</p><button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setRoadTrail([])}>CLEAR_ALL_DRAWINGS</button></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
                if (roadTrail.length === 0) return setAdminAlert("DRAW A PATH FIRST");
                const roadWidth = drawingRoadWidth;
                let allNewSegments: any[] = [];

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

                    for (let i = 0; i < currentPath.length - 1; i++) {
                      allNewSegments.push({ x1: currentPath[i].x, z1: currentPath[i].z, x2: currentPath[i+1].x, z2: currentPath[i+1].z, width: roadWidth });
                    }
                }

                if (allNewSegments.length === 0) return setAdminAlert("NO VALID PATHS DRAWN");
                
                const finalSegments = consolidateRoads(allNewSegments, roads);
                await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalSegments) });
                setAdminAlert(`DRAWN NETWORK GENERATED: ${finalSegments.length} SEGMENTS`); refreshLocations(); setView('list'); setRoadTrail([]);
            }}>GENERATE_FROM_DRAWINGS</button>
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
        </>
      )}

      {view === 'district' && !editingDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>MNG_DISTRICT</h3><button onClick={() => { setView('list'); setDistrictSelection([]); setEditingDistrict(null); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          
          {districts.map(d => (
            <div key={d.id} className="list-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <div>
                  <span style={{display: 'inline-block', width: '12px', height: '12px', backgroundColor: d.color, marginRight: '8px', border: '1px solid #000'}}></span>
                  <span>{d.name}</span>
                </div>
                <div style={{display: 'flex', gap: '5px'}}>
                  <button className="upload-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={() => { 
                      setEditingDistrict(d); 
                      // Pre-fill selection with current buildings in district
                      setDistrictSelection(locations.filter((l: any) => l.district_name === d.name).map((l: any) => l.id)); 
                  }}>EDIT</button>
                  <button className="upload-btn danger-btn" style={{padding: '2px 5px', fontSize: '0.6rem'}} onClick={async () => {
                      if (!confirm('Delete District?')) return;
                      await fetch(`/api/districts/${d.name}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                      fetchDistricts();
                      refreshLocations();
                  }}>DEL</button>
                </div>
            </div>
          ))}

          <div className="editor-controls" style={{marginTop: '20px', borderTop: '1px solid #333', paddingTop: '10px'}}>
            <h4>CREATE NEW DISTRICT</h4>
            <label style={{fontSize: '0.7rem'}}>DISTRICT_NAME</label><input placeholder="Name" value={districtConfig.name} onChange={e => setDistrictConfig({...districtConfig, name: e.target.value})} style={{width: '100%', marginBottom: '10px'}} />
            <label style={{fontSize: '0.7rem'}}>DISTRICT_COLOR</label>
            <input type="color" value={districtConfig.color} onChange={e => setDistrictConfig({...districtConfig, color: e.target.value})} style={{width: '100%', marginTop: '5px', height: '30px', padding: '0', background: 'none', border: '1px solid var(--green)'}} />
            <button className="upload-btn" style={{marginTop: '10px'}} onClick={async () => { 
                if (!districtConfig.name.trim()) return setAdminAlert("NAME REQUIRED"); 
                const res = await fetch('/api/districts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: districtConfig.name, color: districtConfig.color }) }); 
                if (res.ok) { fetchDistricts(); setDistrictConfig({name: '', color: '#00ff00'}); } 
            }}>CREATE</button>
          </div>
        </>
      )}

      {view === 'district' && editingDistrict && (
        <>
          <header style={{marginBottom: '10px'}}><h3>EDITING: {editingDistrict.name}</h3><button onClick={() => { setEditingDistrict(null); setDistrictSelection([]); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>SELECTION: {districtSelection.length} UNITS</p><p style={{opacity: 0.7}}>DRAG TO SELECT MULTIPLE UNITS</p><p style={{opacity: 0.7}}>CLICK TO TOGGLE INDIVIDUALS</p></div>
          
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { 
              const res = await fetch('/api/locations/batch-district', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: districtSelection, district_name: editingDistrict.name, district_color: editingDistrict.color }) }); 
              if (res.ok) { setAdminAlert("DISTRICT_SAVED"); refreshLocations(); setEditingDistrict(null); setDistrictSelection([]); } 
          }}>SAVE DISTRICT</button>
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
          </div>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}>{roadSelectionBounds ? <p>AREA_SELECTED: {Math.round(Math.abs(roadSelectionBounds.max.x - roadSelectionBounds.min.x))}x{Math.round(Math.abs(roadSelectionBounds.max.z - roadSelectionBounds.min.z))} units</p> : <p style={{opacity: 0.7}}>DRAG ON MAP TO SELECT GENERATION AREA</p>}<p style={{opacity: 0.7, marginTop: '5px'}}>HIERARCHICAL BSP: ENABLED</p><p style={{opacity: 0.7}}>ZONING: {citySectionType}</p><p style={{opacity: 0.7}}>INFRASTRUCTURE: {genExcludeRoads ? 'BUILDINGS_ONLY' : 'ROADS_+_BUILDINGS'}</p></div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => {
              try {
                if (!roadSelectionBounds) return setAdminAlert("SELECT AREA FIRST");
                const minX = Math.min(roadSelectionBounds.min.x, roadSelectionBounds.max.x); const maxX = Math.max(roadSelectionBounds.min.x, roadSelectionBounds.max.x);
                const minZ = Math.min(roadSelectionBounds.min.z, roadSelectionBounds.max.z); const maxZ = Math.max(roadSelectionBounds.min.z, roadSelectionBounds.max.z);
                const cityW = maxX - minX; const cityD = maxZ - minZ;
                const centerX = (minX + maxX) / 2;
                const centerZ = (minZ + maxZ) / 2;
                const maxRadius = Math.max(1, Math.max(cityW, cityD) / 2);
                const slumAngle = Math.random() * Math.PI * 2;
                // Industrial clusters in its own sector, offset from slums by ~120-180 degrees
                const industrialAngle = slumAngle + Math.PI * (0.65 + Math.random() * 0.35);

                const blocks: {x: number, z: number, w: number, d: number}[] = [];
                const cityRoads: any[] = [];
                const mainRoadW = 6; const sideRoadW = 3;

                // Dynamic max depth: scale recursion with area size so larger selections produce more blocks, not bigger blocks
                const minBlockSize = 35;
                const maxDimension = Math.max(cityW, cityD);
                const maxSplitDepth = Math.max(4, Math.ceil(Math.log2(maxDimension / minBlockSize)) + 2);

                const split = (x: number, z: number, w: number, d: number, iter: number) => {
                  if (iter > maxSplitDepth || (w < minBlockSize && d < minBlockSize)) { blocks.push({x, z, w, d}); return; }
                  const splitV = w > d ? true : (w === d ? Math.random() > 0.5 : false);
                  const roadW = iter < 2 ? mainRoadW : sideRoadW;
                  const jitter = (Math.random() - 0.5) * (iter < 2 ? 10 : 5);
                  if (splitV) {
                    const ratio = 0.35 + Math.random() * 0.3; const lw = w * ratio; const rw = w - lw;
                    const rx = x - w/2 + lw + jitter; 
                    const midZ = z + (Math.random() - 0.5) * d * 0.25;
                    if (!genExcludeRoads) {
                      const offset = (Math.random() - 0.5) * 4.5;
                      cityRoads.push({ x1: rx, z1: z - d/2, x2: rx + offset, z2: midZ, width: roadW });
                      cityRoads.push({ x1: rx + offset, z1: midZ, x2: rx, z2: z + d/2, width: roadW });
                    }
                    split(x - w/2 + (lw + jitter)/2, z, lw + jitter, d, iter + 1); split(x + w/2 - (rw - jitter)/2, z, rw - jitter, d, iter + 1);
                  } else {
                    const ratio = 0.35 + Math.random() * 0.3; const td = d * ratio; const bd = d - td;
                    const rz = z - d/2 + td + jitter;
                    const midX = x + (Math.random() - 0.5) * w * 0.25;
                    if (!genExcludeRoads) {
                      const offset = (Math.random() - 0.5) * 4.5;
                      cityRoads.push({ x1: x - w/2, z1: rz, x2: midX + offset, z2: rz, width: roadW });
                      cityRoads.push({ x1: midX + offset, z1: rz, x2: x + w/2, z2: rz, width: roadW });
                    }
                    split(x, z - d/2 + (td + jitter)/2, w, td + jitter, iter + 1); split(x, z + d/2 - (bd - jitter)/2, w, bd - jitter, iter + 1);
                  }
                };

                split((minX + maxX)/2, (minZ + maxZ)/2, cityW, cityD, 0);
                const finalRoads = genExcludeRoads ? [] : consolidateRoads(cityRoads, roads, 3.0);
                
                const rawBuildings: any[] = [];
                // SPATIAL GRID FOR COLLISION SPEED
                const spatialGrid: any = {};
                const gridCell = 20;
                const getGridKey = (x: number, z: number) => `${Math.floor(x/gridCell)},${Math.floor(z/gridCell)}`;
                
                // Pre-populate grid with existing buildings
                locations.forEach(l => {
                    const key = getGridKey(l.x, l.z);
                    if (!spatialGrid[key]) spatialGrid[key] = [];
                    spatialGrid[key].push(l);
                });

                // Combine existing roads and new sector roads for collision checks
                const allRoadsToCheck = [...roads, ...cityRoads];

                const isBlocked = (x: number, z: number, w: number, d: number, buffer = 2) => {
                    // 1. Check building-to-building collision
                    const key = getGridKey(x, z);
                    const neighbors = [key];
                    for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(x/gridCell)+dx},${Math.floor(z/gridCell)+dz}`); }}
                    
                    for(const nKey of neighbors) {
                        if(!spatialGrid[nKey]) continue;
                        const blocked = spatialGrid[nKey].some((l: any) => {
                            // AABB intersection check with custom safety buffer
                            const xOverlap = Math.abs(l.x - x) < (l.width + w) / 2 + buffer;
                            const zOverlap = Math.abs(l.z - z) < (l.depth + d) / 2 + buffer;
                            return xOverlap && zOverlap;
                        });
                        if (blocked) return true;
                    }

                    // 2. Check building-to-road collision to prevent spawning on roads
                    if (!genExcludeRoads) {
                        for (const r of allRoadsToCheck) {
                            const p1 = new THREE.Vector3(r.x1, 0, r.z1);
                            const p2 = new THREE.Vector3(r.x2, 0, r.z2);
                            const line = new THREE.Line3(p1, p2);
                            const closest = new THREE.Vector3();
                            line.closestPointToPoint(new THREE.Vector3(x, 0, z), true, closest);
                            
                            const rx = closest.x;
                            const rz = closest.z;
                            // Add safety padding from road margins
                            const halfW = w / 2 + r.width / 2 + 1.2;
                            const halfD = d / 2 + r.width / 2 + 1.2;
                            
                            if (Math.abs(rx - x) < halfW && Math.abs(rz - z) < halfD) {
                                return true;
                            }
                        }
                    }
                    
                    return false;
                };

                blocks.forEach((b, bIdx) => {
                  const plotId = `gen_${bIdx}`;
                  const startIndex = rawBuildings.length;
                  const pad = 10; let bw = b.w - pad; let bd = b.d - pad;
                  if (bw < 8 || bd < 8) return;
                  
                  let distToCenter = Math.sqrt((b.x - centerX)**2 + (b.z - centerZ)**2);
                  let normDist = Math.min(1.0, distToCenter / maxRadius);

                  // 1. NEGATIVE SPACE (Parks / Plazas with Holographic Plants)
                  // Bias park probability to be higher near the center (max 20%), sliding to 0 at the slum boundary (0.8)
                  const parkProb = normDist > 0.8 ? 0.0 : 0.20 * (1.0 - normDist / 0.8);
                  if (Math.random() < parkProb) {
                     // Generate a Park with simple low-poly holographic trees
                     const numPlants = 6 + Math.floor(Math.random() * 7); // 6 to 12 trees
                     for (let pIdx = 0; pIdx < numPlants; pIdx++) {
                          const px = b.x + (Math.random() - 0.5) * bw * 0.8;
                          const pz = b.z + (Math.random() - 0.5) * bd * 0.8;
                          
                          if (!isBlocked(px, pz, 0.4, 0.4, 0.5)) {
                              const trunkH = 2.0 + Math.random() * 2.5;
                              const trunkW = 0.4;
                              const color = '#00ff66'; // Glowing Green
                              const trunk = { name: '', description: '', x: px, y: 0, z: pz, width: trunkW, depth: trunkW, height: trunkH, color, shape: 'cylinder' };
                              rawBuildings.push(trunk);
                              
                              const canopyW = 1.5 + Math.random() * 1.0;
                              const canopyH = 2.0 + Math.random() * 1.5;
                              const canopyShape = Math.random() > 0.5 ? 'pyramid' : 'box';
                              rawBuildings.push({ name: 'HOLOTREE_CANOPY', x: px, y: trunkH, z: pz, width: canopyW, depth: canopyW, height: canopyH, color, shape: canopyShape, parent_name: 'ROOT' });
                          }
                     }
                      for (let i = startIndex; i < rawBuildings.length; i++) {
                        rawBuildings[i].temp_block_id = plotId;
                        if (!rawBuildings[i].name) rawBuildings[i].name = 'PARK';
                      }
                      return; 
                  }

                  let blockAngle = Math.atan2(b.z - centerZ, b.x - centerX);
                  let angleDiff = Math.abs(blockAngle - slumAngle);
                  if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

                  let zoneTypeVal = Math.random();

                  if (citySectionType === 'MIXED') {
                    // Concentric ring city layout:
                    //   Core (0-0.3):   Corporate downtown
                    //   Inner (0.3-0.55): Corporate → Urban transition
                    //   Middle (0.55-0.75): Urban, slums creeping in from slum sector
                    //   Outer (0.75-1.0): Slums + Industrial on the edges

                    // Angular proximity to the industrial sector
                    let indAngleDiff = Math.abs(blockAngle - industrialAngle);
                    if (indAngleDiff > Math.PI) indAngleDiff = Math.PI * 2 - indAngleDiff;
                    const isInIndustrialSector = indAngleDiff < Math.PI / 3; // ~120° wedge
                    const isInSlumSector = angleDiff < Math.PI * 5 / 12;     // ~150° wedge

                    if (normDist < 0.30) {
                      // CORE: Corporate downtown — tall towers, clean
                      zoneTypeVal = Math.random() < 0.88 ? 0.9 : 0.5;
                    } else if (normDist < 0.55) {
                      // INNER RING: Corporate fading into Urban
                      // Linear transition: corpo chance drops from ~80% to ~20% across this band
                      const t = (normDist - 0.30) / 0.25;
                      const corpoChance = 0.80 - t * 0.60;
                      zoneTypeVal = Math.random() < corpoChance ? 0.9 : 0.5;
                    } else if (normDist < 0.75) {
                      // MIDDLE RING: Primarily Urban, slums starting to bleed in from the slum sector
                      const t = (normDist - 0.55) / 0.20;
                      if (isInSlumSector && Math.random() < t * 0.45) {
                        zoneTypeVal = 0.1; // slums growing outward
                      } else if (isInIndustrialSector && Math.random() < t * 0.30) {
                        zoneTypeVal = -0.1; // early industrial on the fringe
                      } else {
                        zoneTypeVal = 0.5; // urban
                      }
                    } else {
                      // OUTER EDGE: Slums and Industrial dominate, clustered in their sectors
                      if (isInIndustrialSector && Math.random() < 0.70) {
                        zoneTypeVal = -0.1; // industrial zone
                      } else if (isInSlumSector && Math.random() < 0.65) {
                        zoneTypeVal = 0.1; // slum district
                      } else if (Math.random() < 0.35) {
                        // Spillover: some slums/industrial scatter outside their main sectors
                        zoneTypeVal = Math.random() < 0.5 ? 0.1 : -0.1;
                      } else {
                        zoneTypeVal = 0.5; // remaining urban pockets on the outskirts
                      }
                    }
                  } else if (citySectionType === 'CORPO') zoneTypeVal = 0.9;
                  else if (citySectionType === 'URBAN') zoneTypeVal = 0.5;
                  else if (citySectionType === 'SLUMS') zoneTypeVal = 0.1;
                  else if (citySectionType === 'INDUSTRIAL') zoneTypeVal = -0.1;

                  // Determine zone prefix for structure naming
                  const zonePrefix = zoneTypeVal < 0 ? 'INDUSTRIAL' : zoneTypeVal <= 0.25 ? 'SLUMS' : zoneTypeVal > 0.7 ? 'CORPO' : 'URBAN';
                  
                  // Clamp aspect ratio to 1.3 for non-slums zones to eliminate long flat buildings
                  const isSlum = zoneTypeVal <= 0.25 && zoneTypeVal >= 0;
                  if (!isSlum) {
                    const maxRatio = 1.3;
                    if (bw > bd * maxRatio) bw = bd * maxRatio;
                    else if (bd > bw * maxRatio) bd = bw * maxRatio;
                  }

                  // 2. LANDMARKS / HERO BUILDINGS
                  // Occasionally create a unique, large building that acts as a visual anchor (with footprint check)
                  const isLandmark = Math.random() < 0.20 && zoneTypeVal > 0.3 && (zoneTypeVal > 0.8 || (bw > 30 && bd > 30)) && !isBlocked(b.x, b.z, bw * 0.7, bd * 0.7, 2.0);

                  if (isLandmark) {
                    const landmarkStyle = Math.floor(Math.random() * 4);
                    const color = ''; // Neutral color, default wireframe style
                    
                    if (landmarkStyle === 0) {
                      // Style 0: Cyber-Citadel (Stepped buttresses + tall central spire)
                      const centralSpireH = 150 + Math.random() * 70;
                      const centralSpireW = bw * 0.45;
                      const centralSpireD = bd * 0.45;
                      const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: centralSpireW, depth: centralSpireD, height: centralSpireH, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Tiered corner buttresses
                      const bW = bw * 0.15;
                      const bD = bd * 0.15;
                      const offsets = [
                        { dx: -bw * 0.35, dz: -bd * 0.35 },
                        { dx: bw * 0.35, dz: -bd * 0.35 },
                        { dx: -bw * 0.35, dz: bd * 0.35 },
                        { dx: bw * 0.35, dz: bd * 0.35 }
                      ];
                      offsets.forEach(offset => {
                        const bx = b.x + offset.dx;
                        const bz = b.z + offset.dz;
                        // Tier 1 (Lower)
                        rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bW, depth: bD, height: centralSpireH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT' });
                        // Tier 2 (Middle, slightly narrower)
                        rawBuildings.push({ name: '', x: bx - Math.sign(offset.dx)*bW*0.2, y: centralSpireH * 0.4, z: bz - Math.sign(offset.dz)*bD*0.2, width: bW * 0.7, depth: bD * 0.7, height: centralSpireH * 0.35, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      });

                      // Large top ring / horizontal slab near the top
                      rawBuildings.push({ name: '', x: b.x, y: centralSpireH * 0.8, z: b.z, width: centralSpireW * 1.3, depth: centralSpireD * 1.3, height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      // Top antenna
                      rawBuildings.push({ name: '', x: b.x, y: centralSpireH, z: b.z, width: 0.3, depth: 0.3, height: centralSpireH * 0.18, color, shape: 'box', parent_name: 'CORP_ROOT' });

                    } else if (landmarkStyle === 1) {
                      // Style 1: Hyper-Pyramid Complex (Grand tiered pyramid monument)
                      const base1W = bw * 0.75;
                      const base1D = bd * 0.75;
                      const base1H = 8.0;
                      const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: base1W, depth: base1D, height: base1H, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Stepped Tier 2 Base
                      const base2W = base1W * 0.75;
                      const base2D = base1D * 0.75;
                      const base2H = 12.0;
                      rawBuildings.push({ name: '', x: b.x, y: base1H, z: b.z, width: base2W, depth: base2D, height: base2H, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Crown Pyramid
                      const pyramidW = base2W * 0.75;
                      const pyramidD = base2D * 0.75;
                      const pyramidH = 120 + Math.random() * 50;
                      rawBuildings.push({ name: '', x: b.x, y: base1H + base2H, z: b.z, width: pyramidW, depth: pyramidD, height: pyramidH, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });

                      // Satellite Obelisks (smaller pyramids at corners)
                      const satOffsets = [
                        { dx: -bw * 0.42, dz: -bd * 0.42 },
                        { dx: bw * 0.42, dz: -bd * 0.42 },
                        { dx: -bw * 0.42, dz: bd * 0.42 },
                        { dx: bw * 0.42, dz: bd * 0.42 }
                      ];
                      satOffsets.forEach(offset => {
                        const bx = b.x + offset.dx;
                        const bz = b.z + offset.dz;
                        rawBuildings.push({ name: '', x: bx, y: 0, z: bz, width: bw * 0.08, depth: bd * 0.08, height: 4.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                        rawBuildings.push({ name: '', x: bx, y: 4.0, z: bz, width: bw * 0.08, depth: bd * 0.08, height: 25.0, color, shape: 'pyramid', parent_name: 'CORP_ROOT' });
                      });

                    } else if (landmarkStyle === 2) {
                      // Style 2: Megastructure Arch / Arcology (Twin massive pillars + top joining arch + suspended atrium)
                      const pillarW = bw * 0.22;
                      const pillarD = bd * 0.65;
                      const pillarH = 140 + Math.random() * 50;
                      const offsetDist = bw * 0.33;

                      const root = { name: '', description: '', x: b.x - offsetDist, y: 0, z: b.z, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x - offsetDist, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Right Pillar
                      const rightPillar = { name: '', x: b.x + offsetDist, y: 0, z: b.z, width: pillarW, depth: pillarD, height: pillarH, color, shape: 'box', parent_name: 'CORP_ROOT' };
                      rawBuildings.push(rightPillar);
                      const key2 = getGridKey(b.x + offsetDist, b.z); if(!spatialGrid[key2]) spatialGrid[key2] = []; spatialGrid[key2].push(rightPillar);

                      // Top Connecting Arch/Sky-bridge
                      const archH = 12.0;
                      const archW = offsetDist * 2 + pillarW;
                      rawBuildings.push({ name: '', x: b.x, y: pillarH - archH, z: b.z, width: archW, depth: pillarD * 0.9, height: archH, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Center Suspended Atrium (hanging block in the middle)
                      const atriumW = offsetDist * 1.3;
                      const atriumD = pillarD * 0.7;
                      const atriumH = pillarH * 0.45;
                      rawBuildings.push({ name: '', x: b.x, y: pillarH * 0.35, z: b.z, width: atriumW, depth: atriumD, height: atriumH, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Twin spires on top of the arch
                      rawBuildings.push({ name: '', x: b.x - offsetDist, y: pillarH, z: b.z, width: 0.5, depth: 0.5, height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      rawBuildings.push({ name: '', x: b.x + offsetDist, y: pillarH, z: b.z, width: 0.5, depth: 0.5, height: 15.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

                    } else {
                      // Style 3: Communications Array (Stepped tower + wide horizontal array discs + needles)
                      const towerH = 130 + Math.random() * 60;
                      const root = { name: '', description: '', x: b.x, y: 0, z: b.z, width: bw * 0.4, depth: bd * 0.4, height: towerH * 0.3, color, shape: 'box' };
                      rawBuildings.push(root);
                      const key = getGridKey(b.x, b.z); if(!spatialGrid[key]) spatialGrid[key] = []; spatialGrid[key].push(root);

                      // Mid and Upper Sections
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.3, z: b.z, width: bw * 0.3, depth: bd * 0.3, height: towerH * 0.4, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.7, z: b.z, width: bw * 0.2, depth: bd * 0.2, height: towerH * 0.3, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Horizontal Array Discs (wide flat boxes at different heights)
                      const disc1W = bw * 0.65;
                      const disc1D = bd * 0.65;
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.45, z: b.z, width: disc1W, depth: disc1D, height: 2.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      const disc2W = bw * 0.5;
                      const disc2D = bd * 0.5;
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.75, z: b.z, width: disc2W, depth: disc2D, height: 1.5, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      const disc3W = bw * 0.32;
                      const disc3D = bd * 0.32;
                      rawBuildings.push({ name: '', x: b.x, y: towerH * 0.92, z: b.z, width: disc3W, depth: disc3D, height: 1.0, color, shape: 'box', parent_name: 'CORP_ROOT' });

                      // Central array needle
                      rawBuildings.push({ name: '', x: b.x, y: towerH, z: b.z, width: 0.2, depth: 0.2, height: towerH * 0.2, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      // Side needles
                      rawBuildings.push({ name: '', x: b.x - bw * 0.1, y: towerH * 0.92, z: b.z - bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color, shape: 'box', parent_name: 'CORP_ROOT' });
                      rawBuildings.push({ name: '', x: b.x + bw * 0.1, y: towerH * 0.92, z: b.z + bd * 0.1, width: 0.1, depth: 0.1, height: towerH * 0.12, color, shape: 'box', parent_name: 'CORP_ROOT' });
                    }
                    for (let i = startIndex; i < rawBuildings.length; i++) {
                      rawBuildings[i].temp_block_id = plotId;
                      if (!rawBuildings[i].name) rawBuildings[i].name = zonePrefix;
                    }
                    return; // Done with this block
                  }

                  generateThemedBuildingsForPlot(b.x, b.z, bw, bd, zoneTypeVal, isBlocked, getGridKey, spatialGrid, rawBuildings, locations, plotId);
                  for (let i = startIndex; i < rawBuildings.length; i++) {
                    rawBuildings[i].temp_block_id = plotId;
                    if (!rawBuildings[i].name) rawBuildings[i].name = zonePrefix;
                  }
                });

                if (finalRoads.length > 0) {
                  const rRes = await fetch('/api/roads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(finalRoads) });
                  if (!rRes.ok) throw new Error(`Road creation failed: ${rRes.status}`);
                }
                
                // Grouping logic for parent_id using SPATIAL GRID for O(N) speed
                const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(rawBuildings.filter(b => !b.parent_name)) });
                if (!res.ok) throw new Error(`Building creation failed: ${res.status}`);
                
                const rootData = await res.json();
                if (rootData.data) {
                  const children: any[] = [];
                  const rootGrid: any = {};
                  rootData.data.forEach((r: any) => {
                    const key = getGridKey(r.x, r.z);
                    if (!rootGrid[key]) rootGrid[key] = [];
                    rootGrid[key].push(r);
                  });

                  rawBuildings.filter(b => b.parent_name === 'ROOT' || b.parent_name === 'CORP_ROOT').forEach(c => {
                    const key = getGridKey(c.x, c.z);
                    const neighbors = [key];
                    for(let dx=-1; dx<=1; dx++) { for(let dz=-1; dz<=1; dz++) { if(dx===0 && dz===0) continue; neighbors.push(`${Math.floor(c.x/gridCell)+dx},${Math.floor(c.z/gridCell)+dz}`); }}
                    
                    let matched = false;
                    for(const nKey of neighbors) {
                      if(!rootGrid[nKey]) continue;
                      const root = rootGrid[nKey].find((r: any) => {
                        if (c.temp_block_id && r.temp_block_id) {
                          return c.temp_block_id === r.temp_block_id;
                        }
                        const dist = Math.sqrt((r.x - c.x)**2 + (r.z - c.z)**2);
                        return (c.parent_name === 'ROOT' && dist < 20) || (c.parent_name === 'CORP_ROOT' && dist < 20);
                      });
                      if (root) {
                        children.push({ ...c, parent_id: root.id });
                        matched = true; break;
                      }
                    }
                  });

                  if (children.length > 0) {
                    const cRes = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(children) });
                    if (!cRes.ok) throw new Error(`Child building creation failed: ${cRes.status}`);
                  }
                }

                setAdminAlert(`CITY GENERATED: ${blocks.length} SECTORS`); refreshLocations(); setView('list'); setRoadSelectionBounds(null);
            } catch (err: any) {
              console.error(err);
              setAdminAlert(`SYSTEM_ERROR: ${err.message}. Area might be too large or complex.`);
            }
            }}>GENERATE_CITY_GRID</button>
        </>
      )}

      {view === 'join' && (
        <>
          <header style={{marginBottom: '10px'}}><h3>JOIN_STRUCTURES</h3><button onClick={() => { setView('list'); setJoinSelection([]); setSelectedClassification(''); }} className="close-btn" style={{position: 'static'}}>X</button></header>
          <div style={{marginTop: '15px', fontSize: '0.7rem', border: '1px dashed var(--green)', padding: '10px'}}><p>SELECTION: {joinSelection.length} UNITS</p><p style={{opacity: 0.7}}>CLICK BUILDINGS ON MAP TO ADD TO GROUP</p><p style={{opacity: 0.7}}>FIRST SELECTION BECOMES GROUP ROOT</p></div>
          <div style={{marginTop: '15px'}}>
            <label style={{fontSize: '0.7rem', display: 'block', marginBottom: '5px'}}>OPTIONAL_CLASSIFICATION</label>
            <div className="button-group" style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
              {['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'LANDMARK', 'MARKETS', 'CUSTOM'].map(t => (
                <button key={t} type="button" className={selectedClassification === t ? 'active' : ''} onClick={() => setSelectedClassification(selectedClassification === t ? '' : t)} style={{fontSize: '0.7rem', padding: '4px 8px'}}>{t}</button>
              ))}
            </div>
          </div>
          <button className="upload-btn" style={{marginTop: '15px'}} onClick={async () => { if (joinSelection.length < 1) return setAdminAlert("SELECT AT LEAST 1 UNIT"); const res = await fetch('/api/locations/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ ids: joinSelection, classification: selectedClassification || undefined }) }); if (res.ok) { setAdminAlert("STRUCTURES_CLASSIFIED/JOINED"); refreshLocations(); setView('list'); setJoinSelection([]); setSelectedClassification(''); } }}>JOIN_SELECTED</button>
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
                            style={{width: '100%', padding: '5px', background: 'rgba(0,40,0,0.6)', border: '1px solid var(--green)', color: 'var(--green)', outline: 'none'}}
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
                        {['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'LANDMARK', 'MARKETS', 'CUSTOM'].map(t => (
                          <button key={t} type="button" className={editorGenType === t ? 'active' : ''} onClick={() => {
                            setEditorGenType(t);
                            setEditorStyleIndex(0); // Reset cycle when switching type
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
                            else if (t === 'CUSTOM') zoneVal = 3.0;
                            
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
                      </div>
                      {editorGenType && (() => {
                        const baseMaxStyle = editorGenType === 'CORPO' ? 11 : editorGenType === 'URBAN' ? 10 : editorGenType === 'INDUSTRIAL' ? 10 : editorGenType === 'SLUMS' ? 1 : editorGenType === 'LANDMARK' ? 13 : editorGenType === 'MARKETS' ? 5 : 0;
                        const customPoolSize = locations.filter((b: any) => b.classification === editorGenType && !b.parent_id).length;
                        const maxStyle = baseMaxStyle + customPoolSize;
                        if (maxStyle === 0) return null;
                        const currentStyle = editorStyleIndex % maxStyle;
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
                              else if (editorGenType === 'CUSTOM') zoneVal = 3.0;
                              const bHeight = (editData.baseHeight || editData.height || 4) * (targetObject ? targetObject.scale.y : 1);
                              generateThemedBuildingsForPlot(0, 0, bWidth, bDepth, zoneVal, () => false, () => '', {}, raw, locations, undefined, bHeight, currentStyle);
                              setEditorStyleIndex(editorStyleIndex + 1);
                              setEditorGenParts(raw);
                          }}>NEXT_STYLE [{currentStyle === 0 ? maxStyle : currentStyle}/{maxStyle}]</button>
                        );
                      })()}
                    </div>

                    <div style={{display: 'flex', gap: '10px', marginTop: '10px', marginBottom: '10px'}}>
                        <button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}>★</button>
                        <button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button>
                    </div>
                </>
            )}
            
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


const GlobalCameraCapture = () => {
  const { camera } = useThree();
  useEffect(() => {
    (window as any).globalCamera = camera;
  }, [camera]);
  return null;
};

function CursorPivotControls() {
  const { camera, controls, raycaster, pointer, scene } = useThree();

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      // Rotate on left or right click
      if ((e.button === 0 || e.button === 2) && controls && (controls as any).setOrbitPoint) {
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = -(e.clientY / window.innerHeight) * 2 + 1;
        const mouse = new THREE.Vector2(x, y);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);
        if (intersects.length > 0) {
          const point = intersects[0].point;
          (controls as any).setOrbitPoint(point.x, point.y, point.z);
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [camera, pointer, raycaster, scene, controls]);

  return null;
}

function CameraController({ target, onComplete }: { target: { pos: [number, number, number], size: number } | null, onComplete: () => void }) {
    const { camera, controls, size } = useThree();
    const startTime = useRef<number | null>(null);
    const initialPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const initialTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const destPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const destTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentPos = useRef<THREE.Vector3>(new THREE.Vector3());
    const currentTarget = useRef<THREE.Vector3>(new THREE.Vector3());
    const moveDir = useRef<THREE.Vector3>(new THREE.Vector3());
    const panAxis = useRef<THREE.Vector3>(new THREE.Vector3());
    const upVec = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
    const distanceRef = useRef<number>(0);
    const isSetup = useRef<boolean>(false);

    useFrame((state) => {
        if (!target || !controls || !(camera as any).fov) return;
        
        if (!isSetup.current) {
            isSetup.current = true;
            startTime.current = state.clock.elapsedTime;
            
            // 1. Store initial state
            initialPos.current.copy(camera.position);
            if (typeof (controls as any).getTarget === 'function') {
                (controls as any).getTarget(initialTarget.current);
            } else if ((controls as any).target) {
                initialTarget.current.copy((controls as any).target);
            }

            // 2. Compute exact mathematical framing distance
            const [tx, ty, tz] = target.pos;
            destTarget.current.set(tx, ty, tz);
            
            // Radius of the object's bounding sphere
            const radius = Math.max(15, target.size * 1.5);
            
            // Calculate distance needed to fit radius in FOV
            const fov = (camera as any).fov * (Math.PI / 180);
            const aspect = size.width / size.height;
            let fitDistance = radius / Math.sin(fov / 2);
            
            // If window is tall and narrow, increase distance to prevent cropping sides
            if (aspect < 1) {
                fitDistance = fitDistance / aspect;
            }

            // 3. Force 45-degree up and 45-degree right angle (Isometric)
            // x: right, y: up, z: toward viewer
            const isoDir = new THREE.Vector3(0.5, 0.7071, 0.5).normalize();
            
            // Dest position is exactly the target center + offset direction * fitDistance
            destPos.current.copy(destTarget.current).add(isoDir.multiplyScalar(fitDistance));

            distanceRef.current = initialPos.current.distanceTo(destPos.current);
        }

        if (startTime.current === null) return;

        const duration = 2.0; 
        const elapsed = state.clock.elapsedTime - startTime.current;
        const progress = Math.min(1, elapsed / duration);
        
        // Smooth easing
        const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // 1. Linear interpolation for basic path
        currentPos.current.lerpVectors(initialPos.current, destPos.current, t);
        
        // 2. Add an "Arc" (Swoop up in the middle)
        const arcHeight = distanceRef.current * 0.25;
        const swoop = Math.sin(t * Math.PI) * arcHeight;
        currentPos.current.y += swoop;

        // 3. Add a "Pan" (Horizontal curve)
        moveDir.current.subVectors(destPos.current, initialPos.current).normalize();
        if (moveDir.current.lengthSq() > 0.001) {
            panAxis.current.copy(upVec.current).cross(moveDir.current).normalize();
            const panAmount = Math.sin(t * Math.PI) * (distanceRef.current * 0.4);
            currentPos.current.add(panAxis.current.multiplyScalar(panAmount));
        }

        // Apply to camera and controls
        currentTarget.current.lerpVectors(initialTarget.current, destTarget.current, t);
        
        if (typeof (controls as any).setLookAt === 'function') {
            (controls as any).setLookAt(
                currentPos.current.x, currentPos.current.y, currentPos.current.z, 
                currentTarget.current.x, currentTarget.current.y, currentTarget.current.z, 
                false
            );
        } else {
            camera.position.copy(currentPos.current);
            camera.lookAt(currentTarget.current);
            if ((controls as any).target) (controls as any).target.copy(currentTarget.current);
        }
        
        // Force sync controls to prevent internal tweening conflicts
        (controls as any).update(0);

        if (progress >= 1) {
            isSetup.current = false;
            startTime.current = null;
            onComplete();
        }
    });

    return null;
  }

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

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
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
  const [bankData, setBankData] = useState<{ balance: number, debt: number }>({ balance: 0, debt: 0 });
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
        setRhombusState(prev => ({
            ...prev,
            // DO NOT set active: true here. That should only happen when the user clicks 'DEPLOY'
            color: existing.color || prev.color,
            name: existing.name || '',
            description: existing.description || '',
            hp_max: existing.hp_max || 0
        }));
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

  useEffect(() => {
    if (selectedLocation && selectedLocation.shape !== 'rhombus' && selectedLocation.shape !== 'enemy_rhombus') {
      fetch(`/api/locations/${selectedLocation.id}/battle_maps`)
        .then(res => res.json())
        .then(data => setCurrentLocBattleMaps(Array.isArray(data) ? data : []))
        .catch(() => setCurrentLocBattleMaps([]));
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
      } else {
      setSelectedLocation(prev => prev?.id === loc.id ? null : loc);
    }
  };

  const [isLoggedIn, setIsLoggedIn] = useState(false);

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
    userName, token, isLoggedIn,
    notificationsEnabled, isChatOpen,
    onFetchAll: fetchAll,
    onFetchLocations: fetchLocations,
    onFetchRoads: fetchRoads,
    onFetchDistricts: fetchDistricts,
    onFetchWaterBodies: fetchWaterBodies,
    onBankUpdate: (balance, debt) => setBankData({ balance, debt }),
    onNotification: setNotification,
    onHasUnreadChat: setHasUnreadChat,
    onTokenUpdate: setToken,
    onIsAdminUpdate: setIsAdmin,
  });

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
    localStorage.setItem('audioEnabled', JSON.stringify(audioEnabled));
    const loopSound = new Audio('/Loop_seamless_fixed.mp3');
    loopSound.loop = true; loopSound.volume = 0.01;
    const playAudio = async () => { if (audioEnabled) { try { await loopSound.play(); } catch (e) {} } };
    if (!audioEnabled) loopSound.pause();
    document.addEventListener('click', playAudio, { once: true });
    return () => { document.removeEventListener('click', playAudio); loopSound.pause(); };
  }, [audioEnabled]);

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

  useEffect(() => { if (isEditModalOpen && activeEditLocation) setEditData({ ...activeEditLocation, description: activeEditLocation.description ?? '', npcs: activeEditLocation.npcs ?? '', owner: activeEditLocation.owner ?? '', baseWidth: activeEditLocation.width, baseHeight: activeEditLocation.height, baseDepth: activeEditLocation.depth, polyCount: activeEditLocation.polyCount || 5 }); }, [isEditModalOpen, activeEditLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) });
    const data = await res.json();
    if (data.token) { setToken(data.token); setIsAdmin(true); setShowAdminPanel(true); } else { setNotification("LOGIN_FAILED"); }
  };

  const startBootSequence = () => { if (!tempUserName.trim()) return; localStorage.setItem('userName', tempUserName); setUserName(tempUserName); setIsLoggedIn(true); if (socketRef.current) socketRef.current.emit('identify', tempUserName); if (audioEnabled) { const startupSound = new Audio('/StartUp.mp3'); startupSound.volume = 0.20; startupSound.play().catch(() => {}); } };

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

  const handleLogout = () => {
    // 1. Immediately close all UI elements for a clean fade-out
    setIsChatOpen(false);
    setIsDiceTrayOpen(false);
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
        if (socket) socket.disconnect();
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
      {!isLoggedIn && (
        <div className="modal-overlay">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div className="panel login-panel" style={{textAlign: 'center', minWidth: '350px', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                <button className={`admin-toggle ${!audioEnabled ? 'muted' : ''}`} onClick={() => setAudioEnabled(!audioEnabled)} style={{padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  {audioEnabled ? (
                    <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                      <path fill="currentColor" fillRule="evenodd" d="m403.966 426.944l-33.285-26.63c74.193-81.075 74.193-205.015-.001-286.09l33.285-26.628c86.612 96.712 86.61 242.635.001 339.348M319.58 155.105l-33.324 26.659c39.795 42.568 39.794 108.444.001 151.012l33.324 26.658c52.205-58.22 52.205-146.109-.001-204.329m-85.163-69.772l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                      <path fill="currentColor" fillRule="evenodd" d="m403.375 257.27l59.584 59.584l-30.167 30.166l-59.583-59.583l-59.584 59.583l-30.166-30.166l59.583-59.584l-59.583-59.583l30.166-30.166l59.584 59.583l59.583-59.583l30.167 30.166zM234.417 85.333l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                    </svg>
                  )}
                </button>
              </div>
              <h1 style={{fontSize: '3rem', margin: '0', textShadow: 'var(--glow)'}}>CITY_NET</h1>
              <div style={{ fontSize: '0.65rem', opacity: 0.5, letterSpacing: '4px', marginTop: '35px', marginBottom: '15px' }}>NAV_OS_v1.0.4</div>
              <div><input value={tempUserName} onChange={e => setTempUserName(e.target.value)} placeholder="OPERATOR_ID" style={{fontSize: '1.2rem', textAlign: 'center'}} /><button className="upload-btn" onClick={startBootSequence} style={{fontSize: '1.2rem', padding: '10px'}}>LOGIN</button></div>
            </div>
            <StatusLogDisplay />
          </div>
        </div>
      )}
      {isLoggedIn && (
        <>
          <div className="ui-overlay">
      {showBattleMapManager && (selectedLocation || activeEditLocation || editId) && (
        <BattleMapManager locationId={selectedLocation ? selectedLocation.id : (activeEditLocation ? activeEditLocation.id : editId)} token={token} onClose={() => setShowBattleMapManager(false)} />
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
              <div className="modal-overlay"><div className="panel"><h2>EDIT_DATA_POINT</h2><form onSubmit={async (e) => { e.preventDefault(); const res = await fetch(`/api/locations/${activeEditLocation.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(editData) }); if (res.ok) { setNotification("DATA_POINT_UPDATED"); cleanupEditModal(); } }} style={{display: 'flex', flexDirection: 'column', gap: '10px'}}><label>NAME</label><input placeholder="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} style={{width: '100%'}} /><div style={{display: 'flex', gap: '10px', width: '100%'}}><div style={{flex: 1}}><label>DESCRIPTION</label><textarea placeholder="Description" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} style={{width: '100%', height: '100px'}} /></div><div style={{flex: 1}}><label>RESIDENTS</label><textarea placeholder="NPCs" value={editData.npcs} onChange={e => setEditData({...editData, npcs: e.target.value})} style={{width: '100%', height: '100px'}} /></div></div><div style={{display: 'flex', gap: '10px', marginTop: '10px'}}><button type="button" className={`utility-btn star-btn ${editData.isFavorite ? 'active' : ''}`} onClick={() => setEditData({...editData, isFavorite: !editData.isFavorite, isDanger: false})}>☆</button><button type="button" className={`utility-btn priority-danger-btn ${editData.isDanger ? 'active' : ''}`} onClick={() => setEditData({...editData, isDanger: !editData.isDanger, isFavorite: false})}>!</button></div>{isAdmin && isPrimaryAdmin && editData.shape !== 'enemy_rhombus' && <button type="button" className="upload-btn" style={{backgroundColor: '#5500ff'}} onClick={() => setShowBattleMapManager(true)}>BATTLE MAPS</button>}<button type="submit" className="upload-btn">SAVE</button><button type="button" className="utility-btn" onClick={() => { cleanupEditModal(); }}>CLOSE</button></form></div></div>
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
                <div style={{display: 'flex', gap: '10px'}}>{token && <button className={`admin-toggle ${pendingRequests.length > 0 && !showAdminPanel ? 'unread-flash' : ''}`} onClick={() => setShowAdminPanel(!showAdminPanel)}>{showAdminPanel ? 'HIDE_DASHBOARD' : 'SHOW_DASHBOARD'}</button>}<button className="admin-toggle" onClick={() => !token && setIsAdmin(!isAdmin)}>{token ? 'ADMIN_MODE' : (isAdmin ? 'CANCEL' : 'ADMIN_LOGIN')}</button></div>
              </div>
            </header>
            {isAdmin && !token && <div className="panel admin-login"><form onSubmit={handleLogin}><input placeholder="USERNAME" onChange={e => setLoginForm({...loginForm, username: e.target.value})} /><input type="password" placeholder="PASSWORD" onChange={e => setLoginForm({...loginForm, password: e.target.value})} /><button type="submit">ACCESS_SYSTEM</button></form></div>}
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
            {isBankOpen && (
              <BankWindow 
                  pos={bankPos} 
                  setPos={setBankPos} 
                  onClose={() => setIsBankOpen(false)} 
                  bankData={bankData} 
                  socket={socketRef.current} 
                  userName={userName} 
                  isBankOpen={isBankOpen}
              />
            )}
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
                  socket={socketRef.current}
                  token={token}
                  isChatOpen={isChatOpen}
              />
            {isHitPointsOpen && (
              <HitPointsMenu 
                targetRhombus={locations.find((l: any) => l.id === ((selectedLocation?.shape === 'rhombus' || (token !== '' && (selectedLocation?.shape === 'enemy_rhombus' || selectedLocation?.shape === 'friendly_rhombus'))) ? selectedLocation.id : locations.find((ul: any) => ul.shape === 'rhombus' && ul.owner === userName)?.id))} 
                token={token} 
                refreshLocations={fetchLocations}
                pos={hitPointsPos}
                setPos={setHitPointsPos}
                onClose={() => setIsHitPointsOpen(false)}
              />
            )}
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
                      <button className="upload-btn" style={{marginTop: '10px'}} onClick={() => { setIsEditModalOpen(true); setActiveEditLocation(selectedLocation); setEditData({ ...selectedLocation, name: selectedLocation.name || '', description: selectedLocation.description || '', npcs: selectedLocation.npcs || '' }); }}>EDIT_DATA_POINT</button>
                    )}
                    {isRhombus && (isAdmin || (isPlayerRhombus && selectedLocation.owner === userName)) && (
                        <button className="upload-btn" style={{marginTop: '10px', backgroundColor: 'var(--green)', color: '#000'}} onClick={() => {
                            let newX = infoPanelPos.x + 320;
                            if (newX + 300 > window.innerWidth) newX = Math.max(0, infoPanelPos.x - 320);
                            setHitPointsPos({ x: newX, y: infoPanelPos.y });
                            setIsHitPointsOpen(true);
                        }}>UPDATE_HEALTH</button>
                    )}
                    {isAdmin && isPrimaryAdmin && !isRhombus && (
      <></>
  )}
  {currentLocBattleMaps.length > 0 && (
      <button className="upload-btn" style={{backgroundColor: '#ff00ff', color: 'white'}} onClick={() => enterBattleMap(selectedLocation.id)}>ENTER BATTLE MAP</button>
  )}
  {!token && !isRhombus && <button className="upload-btn" onClick={() => { if (isSomeoneEditing) { setNotification("ANOTHER_USER_ACCESSING_DATA_POINTS"); } else { socketRef.current.emit('requestEditing', { userId: userName, userName, locationId: selectedLocation.id, locationName: selectedLocation.name }); setNotification("REQUEST_SENT_TO_ADMIN"); } }}>REQUEST_EDITING_RIGHTS</button>}
                  </DraggableWindow>
                );
              }
              return null;
            })()}
            <div className="bottom-bar"><p>{token ? 'EDITOR_ACTIVE // USE GIZMO TO MANIPULATE DATA_POINT' : <StatusBarText />}</p></div>
          </div>
          <Canvas shadows frameloop="always" onPointerDown={() => { if (!rhombusState.active) setActiveSidebarMenu('none'); }}>
            <CursorPingListener socket={socketRef.current} view={view} activeBattleMapData={activeBattleMapData} pingColor={rhombusState.color || '#00ccff'} />
            <MeasurementTool measureMode={measureMode} socket={socketRef.current} view={view} activeBattleMapData={activeBattleMapData} mapScaleMultiplier={view === 'battle_map' ? (() => {
                const loc = locations.find((l:any) => l.id === activeBattleMapData?.locationId);
                if (!loc) return 5;
                let scaleData = loc.map_scale_multiplier;
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
                          hp_max: existing ? (existing.hp_max ?? 100) : (rhombusState.hp_max || 100),
                          hp_current: existing ? (existing.hp_current ?? existing.hp_max ?? 100) : (rhombusState.hp_max || 100),
                          hp_temp: existing ? (existing.hp_temp ?? 0) : 0,
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
            <CameraControls ref={controlsRef} makeDefault enabled={!isDragging && !measureMode} dollyToCursor={true} />
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
                <PingEffect key={ping.id} position={[ping.x, ping.y !== undefined ? ping.y : 0.5, ping.z]} color={ping.color} size={ping.size} />
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





