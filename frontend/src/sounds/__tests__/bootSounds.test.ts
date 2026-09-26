/**
 * The boot's beep and drive clicks. Without speakers what can be held is that there being no
 * audio at all is harmless.
 */

import { describe, it, expect } from 'vitest';
import { createBootSounds } from '../bootSounds';

describe('the boot sounds', () => {
  it('are simply absent, not an error, where there is no audio', () => {
    expect(createBootSounds(0.5)).toBeNull();
  });
});
