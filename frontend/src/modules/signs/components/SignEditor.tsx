import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SignData, SignLine } from '../index';
import { BUILTIN_FONTS, type RemoteFont } from '../../../utils/fontLoader';

// The custom-signs editor: the list, the form, and the placement controls.
//
// Lifted out of AdminPanel, where it had been a 400-line component sharing a 2500-line
// file with everything else the GM can do. Nothing about it changed in the move — the
// props are the same, so App still owns the state and the API calls still go to the same
// routes, which is what keeps signs already placed exactly where they were.

const BLANK_SIGN = { text: '', x: 0, y: 3, z: 0, rotation_x: 0, rotation_y: 0, rotation_z: 0, font_size: 1.0, font_family: 'monospace', image_url: '', use_tv_filter: false, filter_intensity: 1.0, lines: null };

/** Pitch that lays a sign flat, face up, with its text running north — a map label. */
const LAY_FLAT_PITCH = -Math.PI / 2;
const BLANK_LINE = { text: '', font_size: 1.0 };

const SIGN_PRESETS = [
  { label: 'NOODLES', url: '/signs/noodle-bar.svg' },
  { label: 'CLINIC', url: '/signs/cyber-clinic.svg' },
  { label: 'MOTEL', url: '/signs/motel.svg' },
  { label: 'BAR', url: '/signs/bar-open.svg' },
  { label: 'PAWN', url: '/signs/pawn-shop.svg' },
  { label: 'NET CAFE', url: '/signs/net-cafe.svg' },
  { label: 'KEEP OUT', url: '/signs/danger-zone.svg' },
];

const INPUT_STYLE: React.CSSProperties = { width: '100%', marginTop: '2px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.75rem' };

export function SignEditor({ token, signs, fetchSigns, isPlacingSign, setIsPlacingSign, pendingSignPos, setPendingSignPos, selectedSignId, setSelectedSignId, remoteFonts, setRemoteFonts, signTransformMode, setSignTransformMode, signTransformActive, setSignTransformActive, handleUpdateSign, controlsRef, signMesh, onClose }: {
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
  signTransformActive: boolean;
  setSignTransformActive: (v: boolean) => void;
  handleUpdateSign: () => void;
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
    // rotation_x/rotation_z coalesce because signs created before they existed come
    // back as null, and a null would leave the slider uncontrolled.
    setForm({ ...s, image_url: s.image_url ?? '', use_tv_filter: !!s.use_tv_filter, font_family: s.font_family ?? 'monospace', filter_intensity: s.filter_intensity ?? 1.0, rotation_x: s.rotation_x ?? 0, rotation_z: s.rotation_z ?? 0 });
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
      rotation_x: parseFloat(form.rotation_x) || 0,
      rotation_y: parseFloat(form.rotation_y) || 0,
      rotation_z: parseFloat(form.rotation_z) || 0,
      font_size: primarySize,
      font_family: form.font_family || 'monospace',
      image_url: form.image_url || null,
      use_tv_filter: form.use_tv_filter ? 1 : 0,
      filter_intensity: parseFloat(form.filter_intensity) >= 0 ? parseFloat(form.filter_intensity) : 1.0,
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
    // Placement resets yaw so a new sign faces the camera, but keeps any pitch/roll
    // already dialled in — placing a label flat should not stand it back up.
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
    if (signMesh) {
      signMesh.geometry.computeBoundingBox();
      const bb = signMesh.geometry.boundingBox;
      const halfH = bb ? (bb.max.y - bb.min.y) / 2 : 0;
      body.x = signMesh.position.x;
      body.y = signMesh.position.y - halfH;
      body.z = signMesh.position.z;
      body.rotation_x = signMesh.rotation.x;
      body.rotation_y = signMesh.rotation.y;
      body.rotation_z = signMesh.rotation.z;
    }
    await fetch(`/api/signs/${selectedSignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    fetchSigns();
    setSignTransformActive(false);
    setSelectedSignId(null);
    startNew();
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
      <div style={{maxHeight: '120px', overflowY: 'auto', marginBottom: '10px', border: '1px solid color-mix(in srgb, var(--green) 27%, transparent)', padding: '4px'}}>
        {signs.length === 0 && <div style={{fontSize: '0.7rem', opacity: 0.5}}>NO SIGNS PLACED</div>}
        {signs.map(s => (
          <div key={s.id} style={{display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', borderBottom: '1px solid color-mix(in srgb, var(--green) 13%, transparent)', background: selectedSignId === s.id ? 'color-mix(in srgb, var(--green) 7%, transparent)' : 'transparent'}}>
            <div style={{flex: 1, fontSize: '0.7rem', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} onClick={() => { setSelectedSignId(s.id); setIsNew(false); }}>
              {s.text}
            </div>
            <button className="danger-btn" style={{fontSize: '0.6rem', padding: '1px 5px'}} onClick={() => remove(s.id)}>DEL</button>
          </div>
        ))}
      </div>

      {/* Form */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px'}}>
        <span style={{fontSize:'0.7rem', fontWeight:'bold', color:'var(--green)'}}>{isNew ? 'NEW SIGN' : `EDIT #${selectedSignId}`}</span>
        <label style={{display:'flex', alignItems:'center', gap:'4px', fontSize:'0.7rem', cursor:'pointer'}}>
          <input type="checkbox" checked={isMultiLine} onChange={e => toggleMultiLine(e.target.checked)} />
          MULTI-LINE
        </label>
      </div>

      {isMultiLine ? (
        <div style={{marginBottom:'6px', border:'1px solid color-mix(in srgb, var(--green) 20%, transparent)', padding:'6px'}}>
          {formLines.map((line, i) => (
            <div key={i} style={{marginBottom:'8px', paddingBottom:'8px', borderBottom: i < formLines.length - 1 ? '1px dashed color-mix(in srgb, var(--green) 20%, transparent)' : 'none'}}>
              <div style={{display:'flex', alignItems:'center', gap:'4px', marginBottom:'3px'}}>
                <span style={{fontSize:'0.65rem', opacity:0.6}}>LINE {i + 1}</span>
                {formLines.length > 1 && (
                  <button className="danger-btn" style={{marginLeft:'auto', fontSize:'0.6rem', padding:'0 4px'}} onClick={() => removeLine(i)}>✕</button>
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
      {selectedSignId != null && (
        <>
          <div style={{display:'flex', gap:'6px', marginBottom:'6px'}}>
            <button
              className={`utility-btn${signTransformActive && signTransformMode === 'translate' ? ' active' : ''}`}
              style={{flex:1, fontSize:'0.7rem'}}
              onClick={() => { setSignTransformMode('translate'); setSignTransformActive(true); }}
            >MOVE</button>
            <button
              className={`utility-btn${signTransformActive && signTransformMode === 'rotate' ? ' active' : ''}`}
              style={{flex:1, fontSize:'0.7rem'}}
              onClick={() => { setSignTransformMode('rotate'); setSignTransformActive(true); }}
            >ROTATE</button>
          </div>
          {signTransformActive && (
            <button
              className="utility-btn"
              style={{width:'100%', fontSize:'0.7rem', marginBottom:'6px', color:'var(--green)', borderColor:'var(--green)'}}
              onClick={handleUpdateSign}
            >UPDATE SIGN POSITION</button>
          )}
        </>
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
      <div style={{marginBottom: '8px', padding: '6px', border: '1px dashed color-mix(in srgb, var(--green) 33%, transparent)'}}>
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
                <button className="danger-btn" style={{padding: '1px 4px', fontSize: '0.6rem'}} onClick={() => deleteFont(rf.file)}>DEL</button>
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

      <div style={{display: 'flex', gap: '8px', marginBottom: '6px'}}>
        <div style={{flex: 1}}>
          <label style={{fontSize: '0.7rem', opacity: 0.8}}>ROTATION_X: {parseFloat(form.rotation_x || 0).toFixed(2)}</label>
          <input type="range" min={-Math.PI} max={Math.PI} step="0.05" value={form.rotation_x || 0} onChange={e => {
            const val = parseFloat(e.target.value);
            setForm((f: any) => ({...f, rotation_x: val}));
            if (signMesh) signMesh.rotation.x = val;
          }} style={{width: '100%'}} />
        </div>
        <div style={{flex: 1}}>
          <label style={{fontSize: '0.7rem', opacity: 0.8}}>ROTATION_Z: {parseFloat(form.rotation_z || 0).toFixed(2)}</label>
          <input type="range" min={-Math.PI} max={Math.PI} step="0.05" value={form.rotation_z || 0} onChange={e => {
            const val = parseFloat(e.target.value);
            setForm((f: any) => ({...f, rotation_z: val}));
            if (signMesh) signMesh.rotation.z = val;
          }} style={{width: '100%'}} />
        </div>
      </div>

      <div style={{display: 'flex', gap: '8px', marginBottom: '6px'}}>
        <button className="utility-btn" style={{flex: 1, fontSize: '0.65rem'}} onClick={() => {
          setForm((f: any) => ({...f, rotation_x: LAY_FLAT_PITCH, rotation_z: 0}));
          if (signMesh) { signMesh.rotation.x = LAY_FLAT_PITCH; signMesh.rotation.z = 0; }
        }}>LAY_FLAT</button>
        <button className="utility-btn" style={{flex: 1, fontSize: '0.65rem'}} onClick={() => {
          setForm((f: any) => ({...f, rotation_x: 0, rotation_z: 0}));
          if (signMesh) { signMesh.rotation.x = 0; signMesh.rotation.z = 0; }
        }}>STAND_UP</button>
      </div>
      {field('IMAGE_URL (optional)', 'image_url')}
      <div style={{marginBottom: '8px'}}>
        <label style={{fontSize: '0.65rem', opacity: 0.7}}>PRESET SIGNS</label>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px'}}>
          {SIGN_PRESETS.map(p => (
            <button
              key={p.url}
              className="utility-btn"
              style={{fontSize: '0.6rem', padding: '2px 6px', opacity: form.image_url === p.url ? 1 : 0.65, borderStyle: form.image_url === p.url ? 'solid' : 'dashed'}}
              onClick={() => setForm((f: any) => ({...f, image_url: f.image_url === p.url ? '' : p.url}))}
            >{p.label}</button>
          ))}
        </div>
      </div>
      <label style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', marginBottom: form.use_tv_filter ? '4px' : '10px', cursor: 'pointer'}}>
        <input type="checkbox" checked={!!form.use_tv_filter} onChange={e => setForm((f: any) => ({...f, use_tv_filter: e.target.checked}))} />
        TV_FILTER
      </label>
      {form.use_tv_filter && (
        <div style={{marginBottom: '10px'}}>
          <label style={{fontSize: '0.7rem', opacity: 0.8}}>FILTER_INTENSITY: {(parseFloat(form.filter_intensity) >= 0 ? parseFloat(form.filter_intensity) : 1).toFixed(1)}</label>
          <input type="range" min="0.1" max="2" step="0.1" value={parseFloat(form.filter_intensity) >= 0 ? form.filter_intensity : 1} onChange={e => setForm((f: any) => ({...f, filter_intensity: parseFloat(e.target.value)}))} style={{width: '100%'}} />
        </div>
      )}

      <div style={{display: 'flex', gap: '8px'}}>
        <button className="utility-btn" style={{flex: 1}} onClick={isNew ? placeSign : save} disabled={!hasContent()}>
          {isNew ? 'PLACE SIGN' : 'SAVE CHANGES'}
        </button>
        {!isNew && <button className="utility-btn" style={{flex: 1}} onClick={startNew}>NEW</button>}
      </div>
    </>
  );
}
