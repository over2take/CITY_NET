/**
 * What is selectable while the signs editor is open.
 *
 * Signs and structures share the scene, and a sign hangs flat against whatever is behind
 * it, so aiming at a sign and hitting the building underneath was easy — and it swapped
 * the admin panel out from under you mid-edit.
 *
 * Both 3D paths for a structure — the instanced meshes and the individually rendered
 * interactive ones — go through one handler, so the guard belongs there rather than at
 * each call site. That is what these cover.
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * The guard, lifted out of App's handler so it can be exercised without mounting the whole
 * scene. Kept deliberately literal: if the real handler grows a second early return, this
 * copy is wrong and the drift is the thing to catch.
 */
const clickReaches = (view: string, measureMode: boolean) => {
  if (measureMode) return false;
  if (view === 'signs') return false;
  return true;
};

describe('selecting a structure while editing signs', () => {
  it('ignores structure clicks while the signs editor is open', () => {
    expect(clickReaches('signs', false)).toBe(false);
  });

  it('still selects structures in every other view', () => {
    for (const view of ['list', 'editor', 'district', 'draw_roads', 'battle_map']) {
      expect(clickReaches(view, false)).toBe(true);
    }
  });

  it('leaves the measure-mode guard alone', () => {
    // The guard it sits beside, so a change to one does not quietly undo the other.
    expect(clickReaches('list', true)).toBe(false);
  });
});

describe('the guard matches the handler it stands for', () => {
  it('App guards structure clicks on the signs view', async () => {
    // Reading the source rather than mounting App, which needs a WebGL canvas. This fails
    // if the guard is removed or renamed, which is the drift worth catching.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/App.tsx', 'utf8');
    const handler = src.slice(src.indexOf('const handleBuildingClick'));
    const body = handler.slice(0, handler.indexOf('if (isCopyingSize)'));

    expect(body).toContain("if (view === 'signs') return;");
    expect(body).toContain('if (measureMode) return;');
  });

  it('both structure click paths go through that one handler', async () => {
    // Instanced buildings and interactive ones. If a third path appears that calls
    // setSelectedLocation directly from the scene, the guard would not cover it.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/App.tsx', 'utf8');
    const routed = (src.match(/handleBuildingClick/g) || []).length;
    expect(routed).toBeGreaterThanOrEqual(3);   // the definition plus both call sites
  });
});
