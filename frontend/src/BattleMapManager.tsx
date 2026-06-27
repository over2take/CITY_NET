import React, { useState, useEffect } from 'react';

export const BattleMapManager = ({ locationId, onClose, token }: { locationId: number, onClose: () => void, token: string }) => {
  const [maps, setMaps] = useState<any[]>([]);
  const [designationType, setDesignationType] = useState('Level');
  const [levelNumber, setLevelNumber] = useState(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMaps();
  }, [locationId]);

  const fetchMaps = async () => {
    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps`);
      if (res.ok) {
        const data = await res.json();
        setMaps(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return setError('Select an image file');
    
    let designation = designationType;
    if (designationType === 'Level') designation = `Level ${levelNumber}`;

    // Check for override
    if (maps.some(m => m.designation === designation)) {
      if (!window.confirm(`A map for ${designation} already exists. Replace it?`)) return;
    }

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('image', selectedFile);
    formData.append('designation', designation);

    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        setSelectedFile(null);
        fetchMaps();
      } else {
        const data = await res.json();
        setError(data.error || 'Upload failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleDelete = async (mapId: number) => {
    if (!window.confirm('Delete this map?')) return;
    try {
      const res = await fetch(`/api/locations/${locationId}/battle_maps/${mapId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchMaps();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="panel" style={{
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      backgroundColor: '#111', padding: '20px', border: '1px solid #00ff00', zIndex: 10000, color: '#00ff00', pointerEvents: 'auto'
    }}>
      <h3>BATTLE MAPS MANAGEMENT</h3>
      <button style={{ position: 'absolute', top: '10px', right: '10px' }} onClick={onClose}>X</button>
      
      <div style={{ marginBottom: '20px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <h4>UPLOAD NEW MAP</h4>
        <input type="file" accept="image/*" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} style={{ display: 'block', marginBottom: '10px' }} />
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center' }}>
          {['Lobby', 'Level', 'Penthouse'].map(opt => (
            <button 
              key={opt}
              type="button"
              className="utility-btn"
              onClick={() => setDesignationType(opt)}
              style={{ 
                margin: 0,
                backgroundColor: designationType === opt ? '#00ff00' : '#111', 
                color: designationType === opt ? '#000' : '#00ff00',
                border: designationType === opt ? '1px solid #00ff00' : '1px solid #333'
              }}
            >
              {opt.toUpperCase()}
            </button>
          ))}
          {designationType === 'Level' && (
            <input type="number" min="1" value={levelNumber} onChange={(e) => setLevelNumber(parseInt(e.target.value) || 1)} style={{ width: '50px', backgroundColor: '#000', border: '1px solid #00ff00', color: '#00ff00', padding: '4px', height: '100%' }} />
          )}
        </div>

        <button className="upload-btn" onClick={handleUpload} disabled={loading}>{loading ? 'UPLOADING...' : 'UPLOAD MAP'}</button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>

      <div>
        <h4>EXISTING MAPS</h4>
        {maps.length === 0 ? <p>No maps uploaded yet.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {maps.map(m => (
              <li key={m.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', padding: '5px', backgroundColor: '#222' }}>
                <span>[{m.designation}]</span>
                <button className="upload-btn danger-btn" onClick={() => handleDelete(m.id)}>DELETE</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
