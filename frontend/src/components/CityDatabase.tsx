import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SavedMap } from '../types';

interface ConfirmDialogState {
  title: string;
  message: string;
  onConfirm: () => void;
  confirmText?: string;
  isAlert?: boolean;
}

interface CityDatabaseProps {
  token: string;
  emitUpdate: () => void;
}

export function CityDataBaseMenu({ token, emitUpdate }: CityDatabaseProps) {
  const [maps, setMaps] = useState<SavedMap[]>([]);
  const [mapName, setMapName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const showAlert = (message: string) => {
    setConfirmDialog({ title: '!! SYSTEM_ALERT !!', message, onConfirm: () => setConfirmDialog(null), confirmText: 'ACKNOWLEDGE', isAlert: true });
  };

  const fetchMaps = async () => {
    try {
      const res = await fetch('/api/maps');
      if (res.ok) setMaps(await res.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchMaps(); }, []);

  const handleSave = async () => {
    if (!token) return showAlert('ADMIN_ACCESS_REQUIRED');
    if (!mapName.trim()) return showAlert('MAP_NAME_REQUIRED');

    const executeSave = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/maps/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name: mapName.trim() }),
        });
        if (res.ok) { fetchMaps(); window.dispatchEvent(new CustomEvent('clearUnsavedChanges')); }
        else showAlert('SAVE_FAILED');
      } catch (e) { console.error(e); }
      setIsLoading(false);
    };

    const existing = maps.find(m => m.name === mapName.trim());
    if (existing) {
      setConfirmDialog({ title: '!! CRITICAL_WARNING !!', message: `OVERWRITE_MAP: '${mapName.trim()}'?`, confirmText: 'OVERWRITE_DATA', onConfirm: () => { setConfirmDialog(null); executeSave(); } });
    } else {
      executeSave();
    }
  };

  const handleNewMap = async () => {
    if (!token) return showAlert('ADMIN_ACCESS_REQUIRED');

    const executeClear = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/maps/clear', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) { setMapName(''); window.dispatchEvent(new CustomEvent('clearUnsavedChanges')); }
      } catch (e) { console.error(e); }
      setIsLoading(false);
    };

    const confirmClear = () => {
      setConfirmDialog({ title: '!! CRITICAL_WARNING !!', message: 'CLEAR_ACTIVE_MAP?', confirmText: 'PURGE_MAP', onConfirm: () => { setConfirmDialog(null); executeClear(); } });
    };

    if ((window as any).hasUnsavedChanges) {
      setConfirmDialog({ title: '!! CRITICAL_WARNING !!', message: 'UNSAVED_CHANGES_DETECTED. PROCEED_WITH_NEW_MAP?', confirmText: 'PROCEED', onConfirm: () => { setConfirmDialog(null); confirmClear(); } });
    } else {
      confirmClear();
    }
  };

  const handleLoad = async (name: string) => {
    if (!token) return showAlert('ADMIN_ACCESS_REQUIRED');

    const executeLoad = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/maps/load/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) { setMapName(name); window.dispatchEvent(new CustomEvent('clearUnsavedChanges')); }
        else showAlert('LOAD_FAILED');
      } catch (e) { console.error(e); }
      setIsLoading(false);
    };

    if ((window as any).hasUnsavedChanges) {
      setConfirmDialog({ title: '!! CRITICAL_WARNING !!', message: 'UNSAVED_CHANGES_DETECTED. PROCEED_WITH_LOAD?', confirmText: 'OVERWRITE_CURRENT', onConfirm: () => { setConfirmDialog(null); executeLoad(); } });
    } else {
      executeLoad();
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!token) return showAlert('ADMIN_ACCESS_REQUIRED');
    setConfirmDialog({
      title: '!! CRITICAL_WARNING !!',
      message: `CONFIRM_DELETE_MAP: '${name}'?`,
      confirmText: 'PURGE_DATA',
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsLoading(true);
        try {
          const res = await fetch(`/api/maps/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
          if (res.ok) fetchMaps();
        } catch (e) { console.error(e); }
        setIsLoading(false);
      },
    });
  };

  return (
    <div className="panel city-database-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>CITY_DATA_BASE</h3>
      </header>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <input placeholder="MAP_DESIGNATION" value={mapName} onChange={e => setMapName(e.target.value)} style={{ flex: 1, minWidth: '150px' }} />
        <button className="upload-btn" onClick={handleSave} disabled={isLoading}>SAVE</button>
        <button className="upload-btn danger-btn" onClick={handleNewMap} disabled={isLoading}>NEW_MAP</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <h4 className="category-header">ARCHIVED_MAPS</h4>
        {maps.length === 0 ? (
          <p style={{ fontSize: '0.7rem', opacity: 0.5 }}>NO_ARCHIVED_DATA</p>
        ) : (
          maps.map(m => (
            <div key={m.id} className="list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <span onClick={() => setMapName(m.name)} style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1 }} title="Populate Map Designation">
                {m.name}
              </span>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button className="utility-btn" onClick={() => handleLoad(m.name)} disabled={isLoading} style={{ fontSize: '0.6rem', padding: '2px 8px' }}>LOAD</button>
                <button className="utility-btn danger-btn" onClick={() => handleDelete(m.id, m.name)} disabled={isLoading} style={{ fontSize: '0.6rem', padding: '2px 8px' }}>DELETE</button>
              </div>
            </div>
          ))
        )}
      </div>

      {confirmDialog && createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="panel critical-alert">
            <h2 className="alert-text">{confirmDialog.title}</h2>
            <p>{confirmDialog.message}</p>
            <div className="button-group" style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button className="upload-btn danger-btn" onClick={confirmDialog.onConfirm}>{confirmDialog.confirmText || 'PROCEED'}</button>
              {!confirmDialog.isAlert && (
                <button className="utility-btn" onClick={() => setConfirmDialog(null)}>ABORT_OPERATION</button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
