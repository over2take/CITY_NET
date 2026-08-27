/**
 * Which sign the move/rotate gizmo attaches to.
 *
 * Every sign used to report its mesh on every selection change — the mesh when selected,
 * null when not — and they all write to one slot on the parent. React runs sibling effects
 * in list order, so the last sign in the list wrote last. Selecting the newest worked;
 * selecting any earlier one did not, because every sign after it wrote null over the top.
 *
 * Rendered with plain React Testing Library. The bug is in React's effect ordering, not in
 * anything three.js does, and the r3f elements render as inert unknown tags here — enough
 * to run the effects that are the whole subject.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { Signs } from '../Signs';

/**
 * jsdom has no 2D canvas, and a sign paints its text onto one to build its texture. That
 * throws before any effect runs, so the context is stubbed permissively — the subject here
 * is which sign reports its mesh, not what the sign looks like.
 */
beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : () => undefined),
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
});

const sign = (id: number, text: string) => ({
  id, text, x: id, y: 2, z: 0,
  rotation_x: 0, rotation_y: 0, rotation_z: 0,
  font_size: 1, font_family: 'monospace',
  image_url: null, use_tv_filter: 0, lines: null, filter_intensity: 1,
});

// Three signs, so "first", "middle" and "newest" are all distinguishable. The bug only
// showed on the ones that are not last.
const SIGNS = [sign(1, 'first'), sign(2, 'middle'), sign(3, 'newest')];

/** Render the layer with one sign selected and report what the parent was handed. */
function meshFor(selectedId: number | null) {
  const onMeshRef = vi.fn();
  const view = render(
    <Signs signs={SIGNS} selectedId={selectedId} onSelect={vi.fn()} onMeshRef={onMeshRef} />,
  );
  return { onMeshRef, view, last: onMeshRef.mock.calls.at(-1)?.[0] ?? null };
}

afterEach(() => vi.restoreAllMocks());

describe('the gizmo follows the selected sign', () => {
  it('attaches to the newest sign', () => {
    // This one always worked, because it is last in the list.
    const { last } = meshFor(3);
    expect(last).not.toBeNull();
  });

  it('attaches to the first sign', () => {
    // The reported bug. Before the fix the two signs after it wrote null afterwards, so
    // the parent ended up holding nothing and no gizmo appeared.
    const { last } = meshFor(1);
    expect(last).not.toBeNull();
  });

  it('attaches to a sign in the middle', () => {
    const { last } = meshFor(2);
    expect(last).not.toBeNull();
  });

  it('hands over nothing when no sign is selected', () => {
    const { last } = meshFor(null);
    expect(last).toBeNull();
  });

  it('only the selected sign reports at all', () => {
    // Three signs, one selection, one call. Previously all three wrote on every change,
    // which is what let the losers overwrite the winner.
    const { onMeshRef } = meshFor(1);
    expect(onMeshRef).toHaveBeenCalledTimes(1);
  });

  it('hands over the newly selected sign when the selection moves', () => {
    // The ordering case: the outgoing sign's cleanup must not erase the incoming one.
    const onMeshRef = vi.fn();
    const { rerender } = render(
      <Signs signs={SIGNS} selectedId={3} onSelect={vi.fn()} onMeshRef={onMeshRef} />,
    );
    onMeshRef.mockClear();

    rerender(<Signs signs={SIGNS} selectedId={1} onSelect={vi.fn()} onMeshRef={onMeshRef} />);
    expect(onMeshRef.mock.calls.at(-1)?.[0]).not.toBeNull();
  });

  it('clears the gizmo when the selection is dropped', () => {
    const onMeshRef = vi.fn();
    const { rerender } = render(
      <Signs signs={SIGNS} selectedId={1} onSelect={vi.fn()} onMeshRef={onMeshRef} />,
    );
    rerender(<Signs signs={SIGNS} selectedId={null} onSelect={vi.fn()} onMeshRef={onMeshRef} />);
    expect(onMeshRef.mock.calls.at(-1)?.[0]).toBeNull();
  });
});
