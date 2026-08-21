/**
 * Which battle maps are loops.
 *
 * This decides which loader the scene reaches for, so getting it wrong is not a cosmetic
 * problem: a video sent down the image path renders as nothing, and a still sent down the
 * video path renders as nothing rather more slowly.
 */

import { describe, it, expect } from 'vitest';
import { isVideoMap, VIDEO_EXT, MAP_ACCEPT } from '../battleMapMedia';

describe('isVideoMap', () => {
  it('recognises the loop formats', () => {
    for (const ext of VIDEO_EXT) {
      expect(isVideoMap(`/uploads/battle_maps/abc123${ext}`), ext).toBe(true);
    }
  });

  it('leaves still images on the texture path', () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg']) {
      expect(isVideoMap(`/uploads/battle_maps/abc123${ext}`), ext).toBe(false);
    }
  });

  it('does not care about case', () => {
    // Uploads are stored lowercased today, but the check should not depend on that being
    // true for ever or for maps that arrived another way.
    expect(isVideoMap('/uploads/battle_maps/MAP.WEBM')).toBe(true);
    expect(isVideoMap('/uploads/battle_maps/MAP.PNG')).toBe(false);
  });

  it('ignores a query string or fragment', () => {
    expect(isVideoMap('/uploads/battle_maps/a.webm?v=2')).toBe(true);
    expect(isVideoMap('/uploads/battle_maps/a.png?v=2')).toBe(false);
    // The trap this exists for: the last dot is in the query, not the filename.
    expect(isVideoMap('/uploads/battle_maps/a.png?cache=1.webm')).toBe(false);
  });

  it('treats a name with no extension as a still', () => {
    // Falls through to the path every existing map already takes.
    expect(isVideoMap('/uploads/battle_maps/abc123')).toBe(false);
    expect(isVideoMap('')).toBe(false);
  });

  it('offers the loop formats in the file picker alongside images', () => {
    expect(MAP_ACCEPT).toContain('image/*');
    expect(MAP_ACCEPT).toContain('video/webm');
    expect(MAP_ACCEPT).toContain('video/mp4');
  });
});
