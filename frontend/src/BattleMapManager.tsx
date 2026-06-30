import React, { useState, useEffect } from 'react';

interface ConfirmModal { message: string; onConfirm: () => void; }

export const BattleMapManager = ({ locationId, onClose, token, onMapsChanged }: { locationId: number; onClose: () => void; token: string; onMapsChanged?: () => void }) => {
  const [maps, setMaps] = useState<any[]>([]);
  const [tab, setTab] = useState<'upload' | 'existing'>('upload');
  const [allImages, setAllImages] = useState<{ filename: string; url: string }[]>([]);
  const [designationType, setDesignationType] = useState('Level');
  const [levelNumber, setLevelNumber] = useState(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedExistingUrl, setSelectedExistingUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null);

  useEffect(() => { fetchMaps(); }, [locationId]);

  useEffect(() => {
    if (tab === 'existing' && allImages.length === 0) fetchAllImages();
  }, [tab]);

  const fetchMaps = async () => {
    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps`);
      if (res.ok) setMaps(await res.json());
    } catch (err) { console.error(err); }
  };

  const fetchAllImages = async () => {
    try {
      const res = await fetch('/api/battle_maps/images', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setAllImages(await res.json());
    } catch (err) { console.error(err); }
  };

  const getDesignation = () => designationType === 'Level' ? `Level ${levelNumber}` : designationType;

  const checkOverride = (designation: string, proceed: () => void) => {
    if (maps.some(m => m.designation === designation)) {
      setConfirmModal({ message: `A map for ${designation} already exists. Replace it?`, onConfirm: proceed });
    } else {
      proceed();
    }
  };

  const doUpload = async () => {
    if (!selectedFile) return setError('Select an image file');
    setLoading(true); setError('');
    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('designation', getDesignation());
    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) { setSelectedFile(null); fetchMaps(); onMapsChanged?.(); }
      else { const d = await res.json(); setError(d.error || 'Upload failed'); }
    } catch (err: any) { setError(err.message); }
    setLoading(false);
  };

  const handleUpload = () => checkOverride(getDesignation(), doUpload);

  const doUseExisting = async (designation: string) => {
    if (!selectedExistingUrl) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps/use-existing`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ designation, imageUrl: selectedExistingUrl }),
      });
      if (res.ok) { setSelectedExistingUrl(null); fetchMaps(); onMapsChanged?.(); setTab('upload'); }
      else { const d = await res.json(); setError(d.error || 'Failed'); }
    } catch (err: any) { setError(err.message); }
    setLoading(false);
  };

  const handleUseExisting = () => {
    if (!selectedExistingUrl) return setError('Select an image first');
    checkOverride(getDesignation(), () => doUseExisting(getDesignation()));
  };

  const doDelete = async (mapId: number) => {
    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps/${mapId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { fetchMaps(); onMapsChanged?.(); }
    } catch (err) { console.error(err); }
  };

  const handleDelete = (mapId: number, designation: string) =>
    setConfirmModal({ message: `Delete map for ${designation}?`, onConfirm: () => doDelete(mapId) });

  const tabBtn = (id: 'upload' | 'existing', label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        flex: 1, padding: '6px', background: tab === id ? '#00ff00' : '#111',
        color: tab === id ? '#000' : '#00ff00', border: '1px solid #00ff00',
        fontFamily: 'monospace', cursor: 'pointer', fontWeight: 'bold',
      }}
    >{label}</button>
  );

  const designationControls = (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
      {['Lobby', 'Level', 'Penthouse'].map(opt => (
        <button key={opt} type="button" className="utility-btn" onClick={() => setDesignationType(opt)} style={{
          margin: 0,
          backgroundColor: designationType === opt ? '#00ff00' : '#111',
          color: designationType === opt ? '#000' : '#00ff00',
          border: `1px solid ${designationType === opt ? '#00ff00' : '#333'}`,
        }}>{opt.toUpperCase()}</button>
      ))}
      {designationType === 'Level' && (
        <input type="number" min="1" value={levelNumber} onChange={(e) => setLevelNumber(parseInt(e.target.value) || 1)}
          style={{ width: '50px', backgroundColor: '#000', border: '1px solid #00ff00', color: '#00ff00', padding: '4px' }} />
      )}
    </div>
  );

  return (
    <>
      {confirmModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 20000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: '#111', border: '1px solid #ff0000', padding: '24px', color: '#00ff00', fontFamily: 'monospace', maxWidth: '360px', width: '90%' }}>
            <p style={{ marginTop: 0 }}>{confirmModal.message}</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="utility-btn" onClick={() => setConfirmModal(null)}>CANCEL</button>
              <button className="upload-btn danger-btn" onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}>CONFIRM</button>
            </div>
          </div>
        </div>
      )}

      <div className="panel" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        backgroundColor: '#111', padding: '20px', border: '1px solid #00ff00',
        zIndex: 10000, color: '#00ff00', pointerEvents: 'auto', width: '480px', maxWidth: '95vw',
      }}>
        <h3 style={{ margin: '0 0 12px' }}>BATTLE MAPS MANAGEMENT</h3>
        <button style={{ position: 'absolute', top: '10px', right: '10px' }} onClick={onClose}>X</button>

        <div style={{ display: 'flex', marginBottom: '16px' }}>
          {tabBtn('upload', 'UPLOAD NEW')}
          {tabBtn('existing', 'SELECT EXISTING')}
        </div>

        {tab === 'upload' && (
          <div style={{ marginBottom: '16px', borderBottom: '1px solid #333', paddingBottom: '16px' }}>
            <input type="file" accept="image/*" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              style={{ display: 'block', marginBottom: '10px', color: '#00ff00' }} />
            {designationControls}
            <button className="upload-btn" onClick={handleUpload} disabled={loading}>
              {loading ? 'UPLOADING...' : 'UPLOAD MAP'}
            </button>
          </div>
        )}

        {tab === 'existing' && (
          <div style={{ marginBottom: '16px', borderBottom: '1px solid #333', paddingBottom: '16px' }}>
            {allImages.length === 0 ? (
              <p style={{ color: '#666' }}>No images on server yet.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', maxHeight: '260px', overflowY: 'auto', marginBottom: '12px' }}>
                {allImages.map(img => (
                  <div key={img.filename} onClick={() => setSelectedExistingUrl(img.url)} style={{
                    cursor: 'pointer', border: `2px solid ${selectedExistingUrl === img.url ? '#00ff00' : '#333'}`,
                    padding: '2px', background: selectedExistingUrl === img.url ? '#001a00' : '#000',
                  }}>
                    <img src={img.url} alt={img.filename} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                    <div style={{ fontSize: '9px', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px' }}>
                      {img.filename.slice(0, 16)}…
                    </div>
                  </div>
                ))}
              </div>
            )}
            {designationControls}
            <button className="upload-btn" onClick={handleUseExisting} disabled={loading || !selectedExistingUrl}>
              {loading ? 'SAVING...' : 'USE THIS IMAGE'}
            </button>
          </div>
        )}

        {error && <p style={{ color: 'red', margin: '8px 0' }}>{error}</p>}

        <div>
          <h4 style={{ margin: '0 0 8px' }}>CURRENT MAPS FOR THIS LOCATION</h4>
          {maps.length === 0 ? <p style={{ color: '#666' }}>No maps uploaded yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {maps.map(m => (
                <li key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', padding: '5px', backgroundColor: '#222' }}>
                  <span>[{m.designation}]</span>
                  <button className="upload-btn danger-btn" onClick={() => handleDelete(m.id, m.designation)}>DELETE</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};
