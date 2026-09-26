import { useCallback, useEffect, useRef } from 'react';

// The ambient hum (Loop_seamless_fixed.mp3), as one sound for the whole session.
//
// It eases in once: its first start - as the login window appears after the boot, or on the
// first click where the browser held sound back until then - waits a moment and then rises
// from silence on a curve. After that it is only ever adjusted in place. Moving the volume
// slider changes its volume, and muting pauses it and unmuting resumes it at its level - it
// is never rebuilt, which used to restart it and run the slow start-up again on every move.

export interface AmbientHumOptions {
  src: string;
  /** Loudness at full, before the master volume. */
  level: number;
  enabled: boolean;
  masterVolume: number;
  /** How long its first start waits, then how long it takes to rise to full. */
  delayMs: number;
  fadeMs: number;
}

export function useAmbientHum({ src, level, enabled, masterVolume, delayMs, fadeMs }: AmbientHumOptions) {
  const el = useRef<HTMLAudioElement | null>(null);
  const started = useRef(false);
  const waiting = useRef(false);
  const fading = useRef<ReturnType<typeof setInterval> | null>(null);
  const opts = useRef({ level, enabled, masterVolume, delayMs, fadeMs });
  opts.current = { level, enabled, masterVolume, delayMs, fadeMs };
  const full = () => opts.current.level * opts.current.masterVolume;

  /** The timing of the start last asked for, so a click retrying it keeps that timing. */
  const timing = useRef<{ delayMs: number; fadeMs: number } | null>(null);

  /**
   * The first start eases in; it does nothing once the hum has started or is about to. A
   * start can ask for its own timing - a refresh straight to the login page wants it quick -
   * and otherwise uses the hook's.
   */
  const startHum = useCallback((when?: { delayMs: number; fadeMs: number }) => {
    if (when) timing.current = when;
    const { delayMs: wait, fadeMs: rise } = timing.current ?? opts.current;
    const a = el.current;
    if (!a || !opts.current.enabled || started.current || waiting.current) return;
    waiting.current = true;
    setTimeout(() => {
      waiting.current = false;
      const b = el.current;
      if (!b || !opts.current.enabled || started.current) return;
      started.current = true;
      b.volume = 0;
      b.play().then(() => {
        const t0 = Date.now();
        fading.current = setInterval(() => {
          const k = Math.min(1, (Date.now() - t0) / Math.max(1, rise));
          // Cubed: ears hear loudness on a curve, and a straight ramp sounds as if it arrives
          // at once. Read `full()` each step so the slider still counts mid-fade.
          b.volume = full() * k * k * k;
          if (k >= 1 && fading.current) { clearInterval(fading.current); fading.current = null; }
        }, 50);
      }).catch(() => { started.current = false; b.volume = full(); });
    }, wait);
  }, []);

  // One element for the session, and the first click as a way in where sound was held back.
  useEffect(() => {
    const a = new Audio(src);
    a.loop = true;
    a.volume = full();
    el.current = a;
    // Retries a start the browser refused, with that start's own timing.
    const onFirstClick = () => startHum();
    document.addEventListener('click', onFirstClick, { once: true });
    return () => {
      document.removeEventListener('click', onFirstClick);
      if (fading.current) { clearInterval(fading.current); fading.current = null; }
      a.pause();
      if (el.current === a) el.current = null;
      started.current = false;
    };
  }, [src, startHum]); // eslint-disable-line react-hooks/exhaustive-deps

  // The slider: the new level straight away, unless the first start is still easing in.
  useEffect(() => {
    const a = el.current;
    if (a && !fading.current) a.volume = full();
  }, [masterVolume, level]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute and unmute: pause, and resume at its level - no second start-up.
  useEffect(() => {
    const a = el.current;
    if (!a) return;
    if (!enabled) {
      if (fading.current) { clearInterval(fading.current); fading.current = null; }
      a.pause();
      return;
    }
    if (started.current && a.paused) {
      a.volume = full();
      a.play().catch(() => {});
    }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { startHum };
}
