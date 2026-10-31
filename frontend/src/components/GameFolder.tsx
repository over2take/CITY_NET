import React, { useState } from 'react';

// A folder of the admin GAME tab (the user, 2026-10-30: "making bank and rest collapsible might save
// on space"): a full-width button, ▾ open or ▸ shut, like TTRPG_SYSTEM's, over what it holds. Open
// at first, so nothing is hidden from a GM who has never shut it; shut or opened, it stays that way
// in this browser.

/** Where a folder remembers whether it is open, by its id: citynet:gameFolder:<id>. */
const folderKey = (id: string) => `citynet:gameFolder:${id}`;

const remembered = (id: string): boolean => {
  try { return window.localStorage.getItem(folderKey(id)) !== 'shut'; } catch { return true; }
};

export function GameFolder({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => remembered(id));
  const flip = () => {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(folderKey(id), next ? 'open' : 'shut'); } catch { /* a private window: open or shut for now only */ }
  };
  return (
    <div style={{ marginTop: '10px', borderTop: '1px solid var(--green)', paddingTop: '10px' }}>
      {/* Solid, where the buttons inside are dashed: a folder, not something to do (the user, 2026-10-30). */}
      <button type="button" className="utility-btn" style={{ width: '100%', borderStyle: 'solid' }} aria-expanded={open} onClick={flip}>
        {open ? '▾' : '▸'} {name}
      </button>
      {open && <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>{children}</div>}
    </div>
  );
}
