/**
 * Which loader a battle map goes to.
 *
 * The scene was one component calling `useLoader` unconditionally; it is now two, chosen
 * by extension, because `useLoader` suspends and there is no Suspense boundary above this
 * — so the video path must not take it. That decision is the whole change, and it had no
 * coverage at all: the app smoke test mocks this component away entirely.
 *
 * Both failure modes are silent. A loop sent to `TextureLoader` renders as nothing, and a
 * still sent to the video path renders as nothing while also holding a video element.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const useLoader = vi.fn(() => ({ image: { width: 400, height: 200 } }));

vi.mock('@react-three/fiber', () => ({ useLoader: (...args: any[]) => useLoader(...args) }));
vi.mock('@react-three/drei', () => ({
  OrthographicCamera: () => null,
  MapControls: React.forwardRef(() => null),
}));
vi.mock('../streamerMode', () => ({ IS_SPECTATOR: false }));

import { BattleMapScene } from '../BattleMapScene';

let videosMade: any[];
let realCreate: typeof document.createElement;

beforeEach(() => {
  useLoader.mockClear();
  videosMade = [];
  realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) => {
    const el: any = realCreate(tag as any, ...(rest as []));
    if (tag === 'video') {
      el.play = vi.fn(() => Promise.resolve());
      el.pause = vi.fn();
      el.load = vi.fn();
      videosMade.push(el);
    }
    return el;
  }) as any);
});

afterEach(() => vi.restoreAllMocks());

describe('BattleMapScene', () => {
  it('loads a still map as a texture, as it always has', () => {
    render(<BattleMapScene mapUrl="/uploads/battle_maps/abc.png" />);
    expect(useLoader).toHaveBeenCalled();
    expect(useLoader.mock.calls[0][1]).toBe('/uploads/battle_maps/abc.png');
    expect(videosMade).toHaveLength(0);
  });

  it('plays an animated map instead of loading it as a texture', () => {
    render(<BattleMapScene mapUrl="/uploads/battle_maps/abc.webm" />);
    // The important half: `useLoader` suspends, and nothing above this catches that.
    expect(useLoader).not.toHaveBeenCalled();
    expect(videosMade).toHaveLength(1);
    expect(videosMade[0].loop).toBe(true);
    expect(videosMade[0].muted).toBe(true);
  });

  it('sends an unknown extension down the path every existing map takes', () => {
    // A map from before any of this, or one that arrived another way, must not become a
    // video element on the strength of not being recognised.
    render(<BattleMapScene mapUrl="/uploads/battle_maps/abc" />);
    expect(useLoader).toHaveBeenCalled();
    expect(videosMade).toHaveLength(0);
  });
});
