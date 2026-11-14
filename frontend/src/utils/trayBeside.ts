// Where DICE_TRAY.EXE opens when a roll opens it over NEW_CHARACTER.EXE (7c3c): beside the window, or as
// far that way as the screen allows, so what the player has to do next isn't under it. Any click on the
// window brings it to the front, so on a small screen the part left showing is enough. Left where it is
// when it doesn't cover the window, so a tray the player has moved stays moved.

/** DICE_TRAY.EXE's width (components/DiceTray.tsx). */
export const TRAY_WIDTH = 480;
const GAP = 8;

interface Point { x: number; y: number }

export const trayBeside = (tray: Point, window_: Point & { width: number }, screenWidth: number): Point => {
  const covers = tray.x < window_.x + window_.width && tray.x + TRAY_WIDTH > window_.x;
  if (!covers) return tray;
  return { x: Math.max(0, Math.min(window_.x + window_.width + GAP, screenWidth - TRAY_WIDTH - GAP)), y: tray.y };
};
