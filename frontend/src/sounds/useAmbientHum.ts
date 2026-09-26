import { useCallback, useEffect, useRef } from 'react';

// The ambient hum (Loop_seamless_fixed.mp3), as one sound for the whole session.
//
// It eases in once: its first start - as the login window appears after the boot (slowly), or on
// a refresh straight to the login (quickly) - rises from silence on a curve. After that it is only
// ever adjusted in place: the volume slider changes its volume, and muting pauses it and
// unmuting resumes it at its level. It is never rebuilt, which used to restart it and run the
// start-up again on every slider move.
//
// Browsers hold sound back until the page has been clicked or typed in (Firefox on every load,
// private windows included), and a held-back start does not always fail - Chrome can leave it
// waiting. So nothing here trusts the request to play: only the element's own 'playing' event
// counts. Until that fires, every key or mouse press asks again from inside that press, which is
// what a browser allows, and the fade only begins once the hum can actually be heard.

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

type Timing = { delayMs: number; fadeMs: number };

export function useAmbientHum({ src, level, enabled, masterVolume, delayMs, fadeMs }: AmbientHumOptions) {
  const el = useRef<HTMLAudioElement | null>(null);
  /** Asked to start, and its wait is over: from here it should be playing. */
  const wanted = useRef(false);
  const waiting = useRef(false);
  /** Actually heard: the element said 'playing'. */
  const playing = useRef(false);
  /** The first start's fade has begun; every later start is at full. */
  const faded = useRef(false);
  const fading = useRef<ReturnType<typeof setInterval> | null>(null);
  const timing = useRef<Timing | null>(null);
  const opts = useRef({ level, enabled, masterVolume, delayMs, fadeMs });
  opts.current = { level, enabled, masterVolume, delayMs, fadeMs };
  const full = () => opts.current.level * opts.current.masterVolume;

  /** Ask the element to play. Called from a timer, or from inside a key or mouse press. */
  const tryPlay = () => {
    const a = el.current;
    if (!a || !opts.current.enabled || playing.current) return;
    if (!faded.current) a.volume = 0;
    a.play().catch(() => { /* held back until the page is touched - a press asks again */ });
  };

  /**
   * The first start: waits, then asks to play. It does nothing once it has been asked. A start
   * can bring its own timing - a refresh wants it quick - and otherwise uses the hook's.
   */
  const startHum = useCallback((when?: Timing) => {
    if (when) timing.current = when;
    if (!el.current || !opts.current.enabled || wanted.current || waiting.current) return;
    waiting.current = true;
    setTimeout(() => {
      waiting.current = false;
      wanted.current = true;
      tryPlay();
    }, (timing.current ?? opts.current).delayMs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = new Audio(src);
    a.loop = true;
    a.volume = full();
    el.current = a;

    // Heard at last: the first time, fade up from silence on a curve - cubed, because ears hear
    // loudness on a curve and a straight ramp sounds as if it arrives at once. `full()` is read
    // each step, so the slider still counts mid-fade.
    const onPlaying = () => {
      playing.current = true;
      if (faded.current) { if (!fading.current) a.volume = full(); return; }
      faded.current = true;
      const rise = Math.max(1, (timing.current ?? opts.current).fadeMs);
      const t0 = Date.now();
      fading.current = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / rise);
        a.volume = full() * k * k * k;
        if (k >= 1 && fading.current) { clearInterval(fading.current); fading.current = null; }
      }, 50);
    };
    const onPause = () => { playing.current = false; };
    a.addEventListener('playing', onPlaying);
    a.addEventListener('pause', onPause);

    // A key or a press: the moment a browser lets sound through. Asks again if it should be
    // playing and is not, or starts it if nothing has yet. Keys as well as the mouse, since
    // someone who tabs into the login, types and presses Enter never clicks at all.
    const onInteract = () => {
      if (!opts.current.enabled || playing.current) return;
      if (wanted.current) tryPlay();
      else if (!waiting.current) startHum();
    };
    window.addEventListener('pointerdown', onInteract);
    window.addEventListener('keydown', onInteract);

    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
      a.removeEventListener('playing', onPlaying);
      a.removeEventListener('pause', onPause);
      if (fading.current) { clearInterval(fading.current); fading.current = null; }
      a.pause();
      if (el.current === a) el.current = null;
      wanted.current = false;
      playing.current = false;
      faded.current = false;
    };
  }, [src, startHum]); // eslint-disable-line react-hooks/exhaustive-deps

  // The slider: the new level straight away, unless the first start is still fading in.
  useEffect(() => {
    const a = el.current;
    if (a && !fading.current && faded.current) a.volume = full();
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
    if (wanted.current) {
      if (faded.current) a.volume = full();
      tryPlay();
    }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { startHum };
}
