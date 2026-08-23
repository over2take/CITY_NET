import { useEffect, useState } from 'react';
import * as THREE from 'three';

// A looping battle map, as a texture the scene can put on a plane.
//
// Kept apart from the scene because the video element is the awkward part and it is all
// browser policy rather than rendering: autoplay is refused unless the video is muted,
// a paused element stops feeding the texture, and a decoder left running on a tab nobody
// is looking at is a laptop fan spinning through a session that ended an hour ago.
//
// Verified in a real browser against a real VP9 file, since jsdom has neither a media
// stack nor WebGL and the tests here can only cover the element's configuration: the file
// decodes, muted autoplay starts without a gesture, `THREE.VideoTexture` uploads frames,
// successive rendered frames differ, and it wraps from the end back to the start without
// firing `ended` or pausing — a loop, not a clip that stops. Worth recording one thing that looked like a
// fault and was not — a tab the compositor has stopped painting fires neither
// `requestAnimationFrame` nor `requestVideoFrameCallback`, so the texture never marks
// itself stale and the plane renders black while the video's `currentTime` keeps
// advancing. That is the same mechanism this hook leans on to pause on hidden tabs, and
// it means a map that looks frozen in a background window is behaving correctly.

export interface VideoMapTexture {
  texture: THREE.VideoTexture | null;
  /** width / height, known only once the browser has read the file's metadata. */
  aspect: number;
  /** True when the browser refused to start playback and is waiting for a gesture. */
  awaitingGesture: boolean;
}

/**
 * Load `url` as a looping, muted video and hand back a texture for it.
 *
 * Muted is not a preference — every browser refuses to autoplay a video with sound, and a
 * battle map that needs a click before it moves is a battle map that looks broken. There
 * is no audio on a map loop worth the trade.
 */
export function useVideoMapTexture(url: string): VideoMapTexture {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  const [aspect, setAspect] = useState(1);
  const [awaitingGesture, setAwaitingGesture] = useState(false);

  useEffect(() => {
    if (!url) return undefined;

    const video = document.createElement('video');
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    // Without this, iOS Safari takes the video full-screen instead of leaving it in the
    // page, which for a texture means it is not on the map at all.
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    // The plane cannot be sized until the file says how big it is.
    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
    };
    video.addEventListener('loadedmetadata', onMeta);

    /** jsdom has no media stack, and a browser may reject the promise. Neither is fatal. */
    const attemptPlay = () => {
      try {
        const started = video.play?.();
        if (started && typeof started.then === 'function') {
          started.then(() => setAwaitingGesture(false)).catch(() => setAwaitingGesture(true));
        }
      } catch {
        setAwaitingGesture(true);
      }
    };

    // A muted loop is normally allowed to start on its own. When a browser refuses anyway
    // — a strict setting, an extension — the next click anywhere is enough, and waiting
    // for one is better than a still frame nobody can explain.
    const onGesture = () => attemptPlay();
    window.addEventListener('pointerdown', onGesture);

    // Nothing to draw while the tab is hidden, and decoding for nobody costs real battery
    // on a laptop left open between sessions.
    const onVisibility = () => {
      if (document.hidden) video.pause();
      else attemptPlay();
    };
    document.addEventListener('visibilitychange', onVisibility);

    attemptPlay();
    setTexture(tex);

    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      window.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
      // Releasing the source as well as pausing: a paused element still holds the decoded
      // buffers, and a GM stepping through floors would otherwise accumulate one per map.
      video.removeAttribute('src');
      try { video.load(); } catch { /* jsdom */ }
      tex.dispose();
      setTexture(null);
    };
  }, [url]);

  return { texture, aspect, awaitingGesture };
}
