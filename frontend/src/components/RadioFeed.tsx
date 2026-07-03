import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DraggableWindow } from './DraggableWindow';

export interface MusicItem {
  id: number;
  parent_id: number | null;
  type: 'folder' | 'file';
  name: string;
  path?: string;
  sort_order: number;
}

interface RadioFeedProps {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  token: string;
  socket: any;
  onTrackSelect: (item: MusicItem) => void;
  selectedTrackId: number | null;
}

const ACCEPT = '.mp3,.mp4,.wav,.ogg,.flac,.m4a,audio/*';

export function RadioFeed({
  pos, setPos, onClose, token, socket, onTrackSelect, selectedTrackId,
}: RadioFeedProps) {
  const [items, setItems] = useState<MusicItem[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MusicItem | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchLibrary = useCallback(() => {
    fetch('/api/music/library')
      .then((r) => r.json())
      .then((data: MusicItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchLibrary();
    socket.on('musicLibraryUpdated', handler);
    return () => socket.off('musicLibraryUpdated', handler);
  }, [socket, fetchLibrary]);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  const handleSelect = (item: MusicItem) => {
    setSelectedId((prev) => (prev === item.id ? null : item.id));
  };

  const handleDoubleClick = (item: MusicItem) => {
    if (item.type !== 'file') return;
    setSelectedId(item.id);
    onTrackSelect(item);
  };

  const toggleExpand = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const parent_id = selectedItem?.type === 'folder' ? selectedItem.id : null;
    fetch('/api/music/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, parent_id }),
    }).then(() => {
      setNewFolderName('');
      setShowFolderInput(false);
    });
  };

  const handleDeleteConfirmed = () => {
    if (!confirmDelete) return;
    const url = confirmDelete.type === 'folder'
      ? `/api/music/folder/${confirmDelete.id}`
      : `/api/music/file/${confirmDelete.id}`;
    fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).then(() => {
      setConfirmDelete(null);
      if (selectedId === confirmDelete.id) setSelectedId(null);
    });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const parent_id = selectedItem?.type === 'folder' ? selectedItem.id : null;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', file.name);
    if (parent_id !== null) fd.append('parent_id', String(parent_id));
    fetch('/api/music/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
  };

  const uploadTarget = selectedItem?.type === 'folder' ? selectedItem.name : 'ROOT';

  const renderTree = (parentId: number | null, depth = 0) => {
    const children = items
      .filter((i) => i.parent_id === parentId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
      });

    return children.map((item) => {
      const isSelected = item.id === selectedId;
      const isExpanded = expanded.has(item.id);
      const isPlaying = item.id === selectedTrackId;

      return (
        <div key={item.id}>
          <div
            onClick={() => handleSelect(item)}
            onDoubleClick={() => handleDoubleClick(item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 4px',
              paddingLeft: `${8 + depth * 14}px`,
              cursor: 'pointer',
              background: isSelected ? 'var(--dark-green)' : 'transparent',
              color: isPlaying ? 'var(--green)' : 'var(--text)',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              userSelect: 'none',
            }}
          >
            {item.type === 'folder' ? (
              <span
                onClick={(e) => toggleExpand(item.id, e)}
                style={{ opacity: 0.7, minWidth: '10px' }}
              >
                {isExpanded ? '▾' : '›'}
              </span>
            ) : (
              <span style={{ minWidth: '10px', opacity: 0.4 }}>♪</span>
            )}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
              {isPlaying && <span style={{ marginLeft: '4px', opacity: 0.7 }}>▶</span>}
            </span>
          </div>
          {item.type === 'folder' && isExpanded && renderTree(item.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <DraggableWindow
      title="RADIO_FEED"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '280px', zIndex: 1200 }}
      contentStyle={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      {/* Library tree */}
      <div
        style={{
          minHeight: '200px',
          maxHeight: '440px',
          overflowY: 'auto',
          border: '1px solid var(--dark-green)',
          background: 'var(--black)',
        }}
      >
        {items.length === 0 ? (
          <div style={{ padding: '12px', opacity: 0.4, fontFamily: 'monospace', fontSize: '0.75rem', textAlign: 'center' }}>
            NO_TRACKS
          </div>
        ) : (
          renderTree(null)
        )}
      </div>

      {/* Folder name input */}
      {showFolderInput && (
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddFolder(); if (e.key === 'Escape') setShowFolderInput(false); }}
            placeholder="FOLDER_NAME"
            style={{
              flex: 1, background: 'var(--black)', color: 'var(--green)',
              border: '1px solid var(--dark-green)', padding: '3px 6px',
              fontFamily: 'monospace', fontSize: '0.75rem',
            }}
          />
          <button
            onClick={handleAddFolder}
            style={{ background: 'var(--dark-green)', color: 'var(--green)', border: 'none', padding: '3px 8px', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer' }}
          >
            OK
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <button
          onClick={() => { setShowFolderInput((v) => !v); setNewFolderName(''); }}
          style={toolbarBtn}
          title="Add folder"
        >
          + FOLDER
        </button>
        <button
          onClick={() => selectedItem && setConfirmDelete(selectedItem)}
          disabled={!selectedItem}
          style={{ ...toolbarBtn, opacity: selectedItem ? 1 : 0.35 }}
          title="Delete selected"
        >
          DELETE
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={toolbarBtn}
          title={`Upload to: ${uploadTarget}`}
        >
          UPLOAD
        </button>
        <input ref={fileInputRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={handleUpload} />
      </div>

      {/* Upload target hint */}
      <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', opacity: 0.5 }}>
        UPLOAD_TARGET: {uploadTarget}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.7)',
          }}
        >
          <div
            style={{
              background: 'var(--black)', border: '1px solid var(--dark-green)',
              padding: '20px', fontFamily: 'monospace', color: 'var(--text)',
              minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '12px',
            }}
          >
            <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>
              DELETE <span style={{ color: 'var(--green)' }}>{confirmDelete.name}</span>
              {confirmDelete.type === 'folder' && (
                <><br /><span style={{ opacity: 0.6, fontSize: '0.7rem' }}>All contents will be removed.</span></>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={toolbarBtn}>CANCEL</button>
              <button
                onClick={handleDeleteConfirmed}
                style={{ ...toolbarBtn, color: '#ff4444', borderColor: '#ff4444' }}
              >
                CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}
    </DraggableWindow>
  );
}

const toolbarBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--green)',
  border: '1px solid var(--dark-green)',
  padding: '3px 8px',
  fontFamily: 'monospace',
  fontSize: '0.7rem',
  cursor: 'pointer',
  letterSpacing: '0.5px',
};
