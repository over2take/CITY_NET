// Streamer mode: ?streamer=true loads a read-only spectator client for OBS capture.
// Evaluated once at module load — the mode cannot change without a reload.
export const IS_SPECTATOR = new URLSearchParams(window.location.search).has('streamer');
