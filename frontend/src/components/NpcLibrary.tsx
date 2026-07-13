import React, { useEffect, useState, useCallback } from 'react';
import { DraggableWindow } from './DraggableWindow';

interface NpcRow {
  id: number;
  npc_label: string;
  folder: string | null;
  portrait_url: string | null;
  updated_at: string;
}

interface NpcLibraryProps {
  token: string;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  /** If provided, show an "Attach to token" affordance for this location_id */
  attachLocationId?: number | null;
}

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px',
  borderBottom: '1px solid #0a2a0a', cursor: 'pointer', userSelect: 'none',
};
const label9: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 9, letterSpacing: 0.5,
};
const btn: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 8, letterSpacing: 1, background: 'none',
  border: '1px solid #333', color: '#666', cursor: 'pointer', padding: '2px 6px',
  borderRadius: 2,
};
const btnGreen: React.CSSProperties = { ...btn, border: '1px solid var(--green)', color: 'var(--green)' };
const btnRed: React.CSSProperties = { ...btn, border: '1px solid #ff3333', color: '#ff3333' };

function NpcRow({
  npc,
  token,
  onDeleted,
  attachLocationId,
  onLinked,
}: {
  npc: NpcRow;
  token: string;
  onDeleted: (id: number) => void;
  attachLocationId?: number | null;
  onLinked?: (npcId: number, locationId: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    await fetch(`/api/sheets/npcs/${npc.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    onDeleted(npc.id);
  };

  const handleLink = async () => {
    if (!attachLocationId) return;
    await fetch(`/api/sheets/npcs/${npc.id}/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location_id: attachLocationId }),
    });
    onLinked?.(npc.id, attachLocationId);
  };

  return (
    <div style={{ ...row, background: confirming ? 'rgba(80,0,0,0.15)' : undefined }}>
      {npc.portrait_url ? (
        <img src={npc.portrait_url} alt={npc.npc_label} style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 2, border: '1px solid #1a3a1a', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 24, height: 24, background: '#001a00', border: '1px solid #1a3a1a', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)', fontSize: 10, flexShrink: 0 }}>
          {(npc.npc_label[0] ?? '?').toUpperCase()}
        </div>
      )}
      <span style={{ ...label9, color: 'var(--green)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {npc.npc_label.toUpperCase()}
      </span>
      {attachLocationId && (
        <button style={btnGreen} onClick={handleLink} title="Attach this NPC sheet to the selected token">
          ATTACH
        </button>
      )}
      <button
        style={confirming ? btnRed : btn}
        onClick={handleDelete}
        onBlur={() => setConfirming(false)}
        title="Delete NPC sheet"
      >
        {confirming ? 'CONFIRM?' : 'DEL'}
      </button>
    </div>
  );
}

function FolderGroup({
  folderName,
  npcs,
  token,
  onDeleted,
  attachLocationId,
  onLinked,
}: {
  folderName: string;
  npcs: NpcRow[];
  token: string;
  onDeleted: (id: number) => void;
  attachLocationId?: number | null;
  onLinked?: (npcId: number, locationId: number) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...label9, width: '100%', textAlign: 'left', background: '#001200', border: 'none', color: '#aaffaa', cursor: 'pointer', padding: '3px 6px', letterSpacing: 1, opacity: 0.8 }}
      >
        {open ? '▼' : '▶'} {folderName.toUpperCase()}
      </button>
      {open && npcs.map(n => (
        <NpcRow key={n.id} npc={n} token={token} onDeleted={onDeleted} attachLocationId={attachLocationId} onLinked={onLinked} />
      ))}
    </div>
  );
}

export function NpcLibrary({ token, pos, setPos, onClose, attachLocationId }: NpcLibraryProps) {
  const [npcs, setNpcs] = useState<NpcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [creating, setCreating] = useState(false);
  const [linkedNpcId, setLinkedNpcId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/sheets/npcs', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setNpcs(await res.json());
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    const res = await fetch('/api/sheets/npcs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ npc_label: newLabel.trim(), folder: newFolder.trim() || null }),
    });
    if (res.ok) {
      setNewLabel('');
      setNewFolder('');
      await load();
    }
    setCreating(false);
  };

  const handleDeleted = (id: number) => setNpcs(prev => prev.filter(n => n.id !== id));

  const handleLinked = (npcId: number) => setLinkedNpcId(npcId);

  // Group by folder
  const grouped: Record<string, NpcRow[]> = {};
  const ungrouped: NpcRow[] = [];
  npcs.forEach(n => {
    if (n.folder) {
      (grouped[n.folder] = grouped[n.folder] || []).push(n);
    } else {
      ungrouped.push(n);
    }
  });

  return (
    <DraggableWindow
      title="NPC_LIBRARY"
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: 300 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflow: 'hidden' }}>
        {attachLocationId && linkedNpcId === null && (
          <div style={{ ...label9, color: '#aaffaa', border: '1px solid #1a4a1a', padding: '4px 8px', borderRadius: 2 }}>
            SELECT AN NPC TO ATTACH TO THIS TOKEN
          </div>
        )}
        {attachLocationId && linkedNpcId !== null && (
          <div style={{ ...label9, color: 'var(--green)', border: '1px solid var(--green)', padding: '4px 8px', borderRadius: 2 }}>
            NPC LINKED — TOKEN NOW USES THIS SHEET
          </div>
        )}

        {/* NPC list */}
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: '40vh' }}>
          {loading ? (
            <div style={{ ...label9, opacity: 0.5, padding: '10px 6px' }}>LOADING…</div>
          ) : npcs.length === 0 ? (
            <div style={{ ...label9, opacity: 0.5, padding: '10px 6px' }}>NO NPC SHEETS — CREATE ONE BELOW</div>
          ) : (
            <>
              {ungrouped.map(n => (
                <NpcRow key={n.id} npc={n} token={token} onDeleted={handleDeleted} attachLocationId={attachLocationId} onLinked={(_npcId, _locId) => handleLinked(_npcId)} />
              ))}
              {Object.entries(grouped).map(([folder, rows]) => (
                <FolderGroup key={folder} folderName={folder} npcs={rows} token={token} onDeleted={handleDeleted} attachLocationId={attachLocationId} onLinked={(_npcId, _locId) => handleLinked(_npcId)} />
              ))}
            </>
          )}
        </div>

        {/* Create form */}
        <form onSubmit={handleCreate} style={{ borderTop: '1px solid #0a2a0a', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ ...label9, color: '#aaffaa', letterSpacing: 1, marginBottom: 2 }}>NEW NPC</div>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Gang Member)"
            style={{ fontFamily: 'monospace', fontSize: 9, background: '#001a00', border: '1px solid #1a3a1a', color: 'var(--green)', padding: '3px 6px', borderRadius: 2 }}
          />
          <input
            value={newFolder}
            onChange={e => setNewFolder(e.target.value)}
            placeholder="Folder (optional)"
            style={{ fontFamily: 'monospace', fontSize: 9, background: '#001a00', border: '1px solid #1a3a1a', color: 'var(--green)', padding: '3px 6px', borderRadius: 2 }}
          />
          <button type="submit" disabled={creating || !newLabel.trim()} style={btnGreen}>
            {creating ? 'CREATING…' : 'CREATE NPC'}
          </button>
        </form>
      </div>
    </DraggableWindow>
  );
}
