// Whether a battle map is a still image or a loop.
//
// Mirrored from the backend's allowlist in `routes/battle_maps.js`, the same way seat ids
// are — this decides what the scene *draws*, never what the server accepts. A map that
// somehow arrives in a format not listed here falls through to the image path and shows
// nothing, which is the same outcome as before any of this existed.

/**
 * Formats drawn as video rather than as a texture.
 *
 * Deliberately short. These are the ones a browser will decode from a `<video>` without
 * a codec argument or a container surprise, and an animated map that plays for the GM but
 * not for half the table is worse than one nobody can use.
 */
export const VIDEO_EXT = ['.webm', '.mp4', '.m4v'];

const extensionOf = (url: string): string => {
  // Query strings and fragments are not part of the name on disk. Uploads are hashed and
  // carry neither today, but a URL that picked one up should still be recognised.
  const clean = String(url || '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot).toLowerCase();
};

/** True when this map should be played rather than loaded as a still texture. */
export const isVideoMap = (url: string): boolean => VIDEO_EXT.includes(extensionOf(url));

/** What the file picker offers. Images plus the loops the scene can actually play. */
export const MAP_ACCEPT = `image/*,${VIDEO_EXT.map((e) => `video/${e.slice(1)}`).join(',')}`;
