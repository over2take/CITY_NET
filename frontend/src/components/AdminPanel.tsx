import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { isUserDefinedName, getStructLabel } from '../utils/locationHelpers';
import { consolidateRoads } from '../utils/roadHelpers';
import { generateThemedBuildingsForPlot } from './Buildings';
import type { BankSoundKey } from './BankWindows';
import { playCashRegister, playWompWomp, playCalibration, playProudFanfare, playHighRollerSound } from './BankWindows';
import type { SignData, SignLine } from './Signs';
import { BUILTIN_FONTS, type RemoteFont } from '../utils/fontLoader';

// ─── Custom Signs view ───────────────────────────────────────────────────────

const BLANK_SIGN = { text: '', x: 0, y: 3, z: 0, rotation_y: 0, font_size: 1.0, font_family: 'monospace', image_url: '', use_tv_filter: false, lines: null };
const BLANK_LINE = { text: '', font_size: 1.0 };

const INPUT_STYLE: React.CSSProperties = { width: '100%', marginTop: '2px', background: '#010a01', color: '#00ff00', border: '1px solid #00ff00', padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.75rem' };

function SignsView({ token, signs, fetchSigns, isPlacingSign, setIsPlacingSign, pendingSignPos, setPendingSignPos, selectedSignId, setSelectedSignId, remoteFonts, setRemoteFonts, signTransformMode, setSignTransformMode, controlsRef, signMesh, onClose }: {
  token: string;
  signs: SignData[];
  fetchSigns: () => void;
  isPlacingSign: boolean;
  setIsPlacingSign: (v: boolean) => void;
  pendingSignPos: { x: number; z: number } | null;
  setPendingSignPos: (v: { x: number; z: number } | null) => void;
  selectedSignId: number | null;
  setSelectedSignId: (id: number | null) => void;
  remoteFonts: RemoteFont[];
  setRemoteFonts: (f: RemoteFont[]) => void;
  signTransformMode: 'translate' | 'rotate';
  setSignTransformMode: (m: 'translate' | 'rotate') => void;
  controlsRef: React.MutableRefObject<any>;
  signMesh: THREE.Mesh | null;
  onClose: () => void;
}) {
  const [form, setForm] = React.useState<any>(BLANK_SIGN);
  const [isNew, setIsNew] = React.useState(true);
  const [isMultiLine, setIsMultiLine] = React.useState(false);
  const [formLines, setFormLines] = React.useState<{text: string; font_size: number}[]>([{...BLANK_LINE}]);
  const [uploadErr, setUploadErr] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

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

  React.useEffect(() => {
    if (selectedSignId == null) return;
    const s = signs.find(s => s.id === selectedSignId);
    if (!s) return;
    setForm({ ...s, image_url: s.image_url ?? '', use_tv_filter: !!s.use_tv_filter, font_family: s.font_family ?? 'monospace' });
    setIsNew(false);
    if (s.lines) {
      try {
        const parsed = JSON.parse(s.lines);
        if (Array.isArray(parsed) && parsed.length) { setFormLines(parsed); setIsMultiLine(true); return; }
      } catch { /* fall through */ }
    }
    setIsMultiLine(false);
    setFormLines([{ text: s.text, font_size: s.font_size }]);
  }, [selectedSignId, signs]);

  React.useEffect(() => {
    if (!pendingSignPos) return;
    setForm((f: any) => ({ ...f, x: parseFloat(pendingSignPos.x.toFixed(2)), z: parseFloat(pendingSignPos.z.toFixed(2)) }));
    setPendingSignPos(null);
  }, [pendingSignPos, setPendingSignPos]);

  const startNew = () => {
    setForm(BLANK_SIGN); setIsNew(true); setSelectedSignId(null);
    setIsMultiLine(false); setFormLines([{...BLANK_LINE}]);
  };

  const toggleMultiLine = (on: boolean) => {
    if (on) {
      // seed with current single-line values
      setFormLines([{ text: form.text || '', font_size: parseFloat(form.font_size) || 1 }]);
    } else {
      // pull first line back into the form
      const first = formLines[0] ?? BLANK_LINE;
      setForm((f: any) => ({ ...f, text: first.text, font_size: first.font_size }));
    }
    setIsMultiLine(on);
  };

  const updateLine = (i: number, key: string, val: any) =>
    setFormLines(ls => ls.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  const addLine    = () => setFormLines(ls => [...ls, { ...BLANK_LINE }]);
  const removeLine = (i: number) => setFormLines(ls => ls.filter((_, idx) => idx !== i));

  const buildBody = () => {
    const primaryText = isMultiLine ? (formLines[0]?.text || '') : form.text;
    const primarySize = isMultiLine ? (formLines[0]?.font_size || 1) : (parseFloat(form.font_size) || 1);
    return {
      text: primaryText,
      x: parseFloat(form.x) || 0,
      y: parseFloat(form.y) || 0,
      z: parseFloat(form.z) || 0,
      rotation_y: parseFloat(form.rotation_y) || 0,
      font_size: primarySize,
      font_family: form.font_family || 'monospace',
      image_url: form.image_url || null,
      use_tv_filter: form.use_tv_filter ? 1 : 0,
      lines: isMultiLine ? formLines.filter((l: SignLine) => l.text.trim()) : null,
    };
  };

  const hasContent = () => {
    const hasText = isMultiLine ? formLines.some((l: SignLine) => l.text.trim()) : form.text.trim();
    return !!(hasText || form.image_url?.trim());
  };

  // Place a new sign at the center of the current camera view, then select it so the gizmo appears
  const placeSign = async () => {
    if (!hasContent()) return;
    const { tx, tz } = getCenterGroundTarget();
    const body = { ...buildBody(), x: tx, z: tz, rotation_y: 0 };
    const res = await fetch('/api/signs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const created = await res.json();
    setSelectedSignId(created.id);
    setIsNew(false);
    setForm((f: any) => ({ ...f, x: parseFloat(tx.toFixed(2)), z: parseFloat(tz.toFixed(2)) }));
    fetchSigns();
  };

  const save = async () => {
    if (!hasContent()) return;
    const body = buildBody();
    await fetch(`/api/signs/${selectedSignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    fetchSigns();
  };

  const remove = async (id: number) => {
    await fetch(`/api/signs/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    fetchSigns();
    if (selectedSignId === id) startNew();
  };

  const uploadFont = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(''); setUploading(true);
    const fd = new FormData();
    fd.append('font', file);
    try {
      const res = await fetch('/api/fonts', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { setUploadErr(`Server error (${res.status}) — restart the backend`); return; }
      if (!res.ok) { setUploadErr(data.error || `Upload failed (${res.status})`); return; }
      const updated = await fetch('/api/fonts').then(r => r.json());
      setRemoteFonts(updated);
      setForm((f: any) => ({ ...f, font_family: data.name }));
    } catch { setUploadErr('Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const deleteFont = async (file: string) => {
    await fetch(`/api/fonts/${encodeURIComponent(file)}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    const updated = await fetch('/api/fonts').then(r => r.json());
    setRemoteFonts(updated);
    if (remoteFonts.find(f => f.file === file)?.name === form.font_family) {
      setForm((f: any) => ({ ...f, font_family: 'monospace' }));
    }
  };

  const field = (label: string, key: string, type = 'text', step?: string) => (
    <div style={{marginBottom: '6px'}}>
      <label style={{fontSize: '0.7rem', opacity: 0.8}}>{label}</label>
      <input type={type} step={step} value={form[key]} onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))} style={INPUT_STYLE} />
    </div>
  );

  const allFontOptions = [
    ...BUILTIN_FONTS,
    ...remoteFonts.map(rf => ({ label: rf.name, value: rf.name })),
  ];

  return (
    <>
      <header style={{marginBottom: '10px'}}>
        <h3>CUSTOM_SIGNS</h3>
        <button onClick={onClose} className="close-btn" style={{position: 'static'}}>X</button>
      </header>

      {/* Sign list */}
      <div style={{maxHeight: '120px', overflowY: 'auto', marginBottom: '10px', border: '1px solid #00ff0044', padding: '4px'}}>
        {signs.length === 0 && <div style={{fontSize: '0.7rem', opacity: 0.5}}>NO SIGNS PLACED</div>}
        {signs.map(s => (
          <div key={s.id} style={{display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', borderBottom: '1px solid #00ff0022', background: selectedSignId === s.id ? '#00ff0011' : 'transparent'}}>
            <div style={{flex: 1, fontSize: '0.7rem', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} onClick={() => { setSelectedSignId(s.id); setIsNew(false); }}>
              {s.text}
            </div>
            <button style={{fontSize: '0.6rem', padding: '1px 5px', background: 'transparent', color: '#ff4444', border: '1px solid #ff4444', cursor: 'pointer'}} onClick={() => remove(s.id)}>DEL</button>
          </div>
        ))}
      </div>

      {/* Form */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px'}}>
        <span style={{fontSize:'0.7rem', fontWeight:'bold', color:'#00ff00'}}>{isNew ? 'NEW SIGN' : `EDIT #${selectedSignId}`}</span>
        <label style={{display:'flex', alignItems:'center', gap:'4px', fontSize:'0.7rem', cursor:'pointer'}}>
          <input type="checkbox" checked={isMultiLine} onChange={e => toggleMultiLine(e.target.checked)} />
          MULTI-LINE
        </label>
      </div>

      {isMultiLine ? (
        <div style={{marginBottom:'6px', border:'1px solid #00ff0033', padding:'6px'}}>
          {formLines.map((line, i) => (
            <div key={i} style={{marginBottom:'8px', paddingBottom:'8px', borderBottom: i < formLines.length - 1 ? '1px dashed #00ff0033' : 'none'}}>
              <div style={{display:'flex', alignItems:'center', gap:'4px', marginBottom:'3px'}}>
                <span style={{fontSize:'0.65rem', opacity:0.6}}>LINE {i + 1}</span>
                {formLines.length > 1 && (
                  <button style={{marginLeft:'auto', fontSize:'0.6rem', padding:'0 4px', background:'transparent', color:'#ff4444', border:'1px solid #ff4444', cursor:'pointer'}} onClick={() => removeLine(i)}>✕</button>
                )}
              </div>
              <input
                type="text"
                value={line.text}
                onChange={e => updateLine(i, 'text', e.target.value)}
                placeholder="Line text..."
                style={{...INPUT_STYLE, marginBottom:'4px'}}
              />
              <div style={{display:'flex', alignItems:'center', gap:'6px'}}>
                <label style={{fontSize:'0.65rem', opacity:0.7, whiteSpace:'nowrap'}}>SIZE: {line.font_size.toFixed(1)}</label>
                <input type="range" min="0.5" max="4" step="0.5" value={line.font_size} onChange={e => updateLine(i, 'font_size', parseFloat(e.target.value))} style={{flex:1}} />
              </div>
            </div>
          ))}
          <button className="utility-btn" style={{width:'100%', fontSize:'0.7rem'}} onClick={addLine}>+ ADD LINE</button>
        </div>
      ) : (
        field('TEXT', 'text')
      )}
      <div style={{display: 'flex', gap: '8px'}}>
        <div style={{flex: 1}}>{field('X', 'x', 'number', '0.1')}</div>
        <div style={{flex: 1}}>{field('Y', 'y', 'number', '0.1')}</div>
        <div style={{flex: 1}}>{field('Z', 'z', 'number', '0.1')}</div>
      </div>

      {selectedSignId != null && (
        <div style={{display:'flex', gap:'6px', marginBottom:'6px'}}>
          <button
            className={`utility-btn${signTransformMode === 'translate' ? ' active' : ''}`}
            style={{flex:1, fontSize:'0.7rem'}}
            onClick={() => setSignTransformMode('translate')}
          >MOVE</button>
          <button
            className={`utility-btn${signTransformMode === 'rotate' ? ' active' : ''}`}
            style={{flex:1, fontSize:'0.7rem'}}
            onClick={() => setSignTransformMode('rotate')}
          >ROTATE</button>
        </div>
      )}

      {/* Font selector */}
      <div style={{marginBottom: '6px'}}>
        <label style={{fontSize: '0.7rem', opacity: 0.8}}>FONT</label>
        <select
          value={form.font_family || 'monospace'}
          onChange={e => setForm((f: any) => ({ ...f, font_family: e.target.value }))}
          style={{...INPUT_STYLE, width: '100%'}}
        >
          {allFontOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Font uploader */}
      <div style={{marginBottom: '8px', padding: '6px', border: '1px dashed #00ff0055'}}>
        <div style={{fontSize: '0.65rem', opacity: 0.7, marginBottom: '4px'}}>UPLOAD FONT (.ttf .otf .woff .woff2)</div>
        <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={uploadFont} style={{display: 'none'}} />
        <button className="utility-btn" style={{width: '100%', fontSize: '0.7rem'}} onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? 'UPLOADING...' : 'CHOOSE FILE'}
        </button>
        {uploadErr && <div style={{fontSize: '0.65rem', color: '#ff4444', marginTop: '3px'}}>{uploadErr}</div>}
        {remoteFonts.length > 0 && (
          <div style={{marginTop: '6px'}}>
            {remoteFonts.map(rf => (
              <div key={rf.file} style={{display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem', padding: '2px 0'}}>
                <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{rf.name}</span>
                <button style={{padding: '1px 4px', background: 'transparent', color: '#ff4444', border: '1px solid #ff4444', cursor: 'pointer', fontSize: '0.6rem'}} onClick={() => deleteFont(rf.file)}>DEL</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{display: 'flex', gap: '8px', marginBottom: '6px'}}>
        <div style={{flex: 1}}>
          <label style={{fontSize: '0.7rem', opacity: 0.8}}>ROTATION_Y: {parseFloat(form.rotation_y || 0).toFixed(2)}</label>
          <input type="range" min="0" max={Math.PI * 2} step="0.05" value={form.rotation_y || 0} onChange={e => {
            const val = parseFloat(e.target.value);
            setForm((f: any) => ({...f, rotation_y: val}));
            if (signMesh) signMesh.rotation.y = val;
          }} style={{width: '100%'}} />
        </div>
        {!isMultiLine && <div style={{flex: 1}}>
          <label style={{fontSize: '0.7rem', opacity: 0.8}}>FONT_SIZE: {parseFloat(form.font_size || 1).toFixed(1)}</label>
          <input type="range" min="0.5" max="4" step="0.5" value={form.font_size || 1} onChange={e => setForm((f: any) => ({...f, font_size: parseFloat(e.target.value)}))} style={{width: '100%'}} />
        </div>}
      </div>
      {field('IMAGE_URL (optional)', 'image_url')}
      <label style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', marginBottom: '10px', cursor: 'pointer'}}>
        <input type="checkbox" checked={!!form.use_tv_filter} onChange={e => setForm((f: any) => ({...f, use_tv_filter: e.target.checked}))} />
        TV_FILTER (Fable)
      </label>

      <div style={{display: 'flex', gap: '8px'}}>
        <button className="utility-btn" style={{flex: 1}} onClick={isNew ? placeSign : save} disabled={!hasContent()}>
          {isNew ? 'PLACE SIGN' : 'SAVE CHANGES'}
        </button>
        {!isNew && <button className="utility-btn" style={{flex: 1}} onClick={startNew}>NEW</button>}
      </div>
    </>
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
  joinSelection, setJoinSelection, selectedClassification, setSelectedClassification, roadSelectionBounds, setRoadSelectionBounds,
  roadTrail, setRoadTrail, waterTrail, setWaterTrail, fetchWaterBodies, roadDrawMode, setRoadDrawMode, snapToGrid, setSnapToGrid, snapRotation, setSnapRotation,
  drawingRoadWidth, setDrawingRoadWidth, isGeneratingMap, setIsGeneratingMap, citySectionType, setCitySectionType,
  roadLayerMode, setRoadLayerMode, overpassHeight, setOverpassHeight, overpassRampLength, setOverpassRampLength,
  overpassSplitRamps, setOverpassSplitRamps, overpassRampLengthStart, setOverpassRampLengthStart, overpassRampLengthEnd, setOverpassRampLengthEnd,
  refreshOverpasses, overpasses,
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
    signs, fetchSigns, remoteFonts, setRemoteFonts, isPlacingSign, setIsPlacingSign, pendingSignPos, setPendingSignPos, selectedSignId, setSelectedSignId, signTransformMode, setSignTransformMode, signMesh,
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
        {!secureModeEnabled && <button className="utility-btn danger-btn" onClick={() => { onLogout(); }} style={{ width: '100%' }}>EXIT_ADMIN_MODE</button>}
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
    const socket = socketRef.current;
    if (!socket) return;
    socket.on('editingStarted', (data: any) => setActiveUserEditing(data));
    socket.on('editingStopped', () => setActiveUserEditing(null));
    return () => { socket.off('editingStarted'); socket.off('editingStopped'); };
  }, [socketRef.current]);

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [adminAlert, setAdminAlert] = useState<string | null>(null);
  const [showDefined, setShowDefined] = useState(false);
  const [showUndefined, setShowUndefined] = useState(false);
  const [customLibrary, setCustomLibrary] = useState<any[]>([]);
  const [customLibraryLoading, setCustomLibraryLoading] = useState(false);
  const [roadEraseMode, setRoadEraseModeLocal] = useState<'segment' | 'path'>('segment');
  const setRoadEraseMode = (m: 'segment' | 'path') => { setRoadEraseModeLocal(m); onRoadEraseModeChange?.(m); };
  const [roadPurgeConfirming, setRoadPurgeConfirming] = useState(false);
  const [overpassPurgeConfirming, setOverpassPurgeConfirming] = useState(false);
  const defined = locations.filter((l: any) => !l.parent_id && isUserDefinedName(l.name));
  const undefinedLocs = locations.filter((l: any) => !l.parent_id && !isUserDefinedName(l.name));


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
        refreshLocations();
        if (data.type === 'water_create') fetchWaterBodies();
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

          <div style={{ marginTop: '10px', borderTop: '1px solid #00ff00', paddingTop: '10px' }}>
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

          {/* BANK SOUNDS TEST PANEL */}
          <BankSoundsPanel token={token} globalSettings={globalSettings} fetchGlobalSettings={fetchGlobalSettings} />

          <div style={{display: 'flex', gap: '16px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #00ff00'}}>
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

          <button className="utility-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setView('signs')}>CUSTOM_SIGNS ({(signs || []).length})</button>

          <button className="utility-btn danger-btn" style={{marginTop: '10px', width: '100%'}} onClick={() => setView('purge_roads')}>PURGE_ROADS</button>
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
          {!secureModeEnabled && <button onClick={onLogout} className="logout-btn">EXIT_ADMIN_MODE</button>}
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
        <SignsView
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
                              {customLibraryLoading ? 'LOADING...' : 'No custom structures yet. Use JOIN_STRUCTS → CUSTOM to add.'}
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
                          <input type="checkbox" checked={editData.has_sidewalk ?? true} onChange={e => setEditData({...editData, has_sidewalk: e.target.checked})} />
                          SIDEWALK
                        </label>
                        <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.7rem'}}>
                          <input type="checkbox" checked={editData.has_signage ?? true} onChange={e => setEditData({...editData, has_signage: e.target.checked})} />
                          SIGNAGE
                        </label>
                      </div>
                    )}
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
    <div style={{ marginTop: '10px', borderTop: '1px solid #00ff00', paddingTop: '10px' }}>
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


