// How hurt a token is, as a band: the heart monitor's color AND its rhythm come from it.
//
// Other players never see a number for someone else's health (HealthReviewPanel), so the
// monitor has to say it: green and steady over half, yellow and twice as fast at half or
// less, red, fast and uneven at a quarter or less, a red flatline when down. Color and
// rhythm use the same thresholds, so they always agree. Every system's monitor draws from
// this, the built-in ones included.

export type HealthBand = 'steady' | 'fast' | 'critical' | 'down';

/** The band for a current and max. No max reads as badly hurt, as the color always has. */
export const bandOf = (current: number, max: number): HealthBand => {
  if (current <= 0) return 'down';
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  return pct > 0.5 ? 'steady' : pct > 0.25 ? 'fast' : 'critical';
};

/**
 * Harm levels have no pool: the band is the worst level taken, in thirds of the levels.
 * With three levels, lesser is steady, moderate fast, severe critical; out is the flatline.
 */
export const harmBand = (worst: number, levels: number, out: boolean): HealthBand => {
  if (out) return 'down';
  if (worst < 0 || levels <= 0) return 'steady';
  const pct = (worst + 1) / levels;
  return pct <= 1 / 3 ? 'steady' : pct <= 2 / 3 ? 'fast' : 'critical';
};

export const BAND_COLOR: Record<HealthBand, string> = {
  steady: 'var(--green)',
  fast: 'var(--warning)',
  critical: 'var(--danger)',
  down: 'var(--danger)',
};

/** Words for a screen reader: what the picture shows, still without a number. */
export const BAND_WORDS: Record<HealthBand, string> = {
  steady: 'steady heartbeat',
  fast: 'fast heartbeat',
  critical: 'weak, uneven heartbeat',
  down: 'flatline',
};

/**
 * The beats in one 280-wide stretch of the trace, as [where it starts, how strong]. The
 * trace is two stretches scrolled by half its width, so what one holds repeats seamlessly.
 * Over half: the one even beat the monitor has always drawn. Half or less: twice as many.
 * A quarter or less: fast, uneven, and some barely there. Seconds is one full scroll.
 */
export const RHYTHM: Record<Exclude<HealthBand, 'down'>, { seconds: number; beats: [number, number][] }> = {
  steady: { seconds: 2.4, beats: [[27, 1]] },
  fast: { seconds: 2.4, beats: [[20, 1], [160, 1]] },
  // A beat is 60 wide: each starts after the last has ended, and the last ends by 280.
  critical: { seconds: 2, beats: [[10, 0.8], [78, 0.45], [150, 0.75], [214, 0.3]] },
};

/** One beat's shape, from where it starts: a small bump, the spike, a trailing wave. Baseline 25. */
const BEAT: [number, number][] = [[0, 25], [7, 20], [15, 25], [22, 25], [29, 5], [33, 45], [37, 5], [41, 25], [53, 30], [60, 25]];

const fmt = (n: number) => String(Number(n.toFixed(1)));

/** The polyline for one stretch starting at `offset`, with `beats` in it. */
export const beatPoints = (offset: number, beats: [number, number][]): string =>
  [[offset, 25], ...beats.flatMap(([x, strength]) => BEAT.map(([bx, by]) => [offset + x + bx, 25 + (by - 25) * strength])), [offset + 280, 25]]
    .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
    .join(' ');
