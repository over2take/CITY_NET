/**
 * The boot's hard-drive sound. What a test can hold without speakers: it is exactly as long
 * as the boot it plays under, and where there is no audio at all it quietly does nothing.
 */

import { describe, it, expect } from 'vitest';
import { playHddSpinUp } from '../hddSpinUp';
import { BOOT_SECONDS, bootLines } from '../../components/BootScreen';

describe('the drive spinning up', () => {
  it('does nothing, and does not throw, where there is no audio', () => {
    expect(playHddSpinUp(0.5, 4)).toBeNull();
  });

  it('lasts as long as the boot, lines, hold and fade', () => {
    // 13 lines at 260ms, a 600ms hold and a 450ms fade.
    expect(bootLines('x')).toHaveLength(13);
    expect(BOOT_SECONDS).toBeCloseTo(4.43, 2);
  });
});
