import { useCallback, useEffect, useRef, useState } from 'react';
import { rollFlashes, type ArrivingRoll } from '../utils/rollNotify';

// DICE_TRAY.EXE's flash (6c4g): set by someone else's roll while the tray is shut with its bell on
// (utils/rollNotify.ts). Opening the tray stops the flashing at once, and the tray opens on the
// roll history; closing it again forgets those rolls, so the next flash is for new ones.

/** For `me`: whether the tray's buttons flash, whether it opens on the history, and `arrived` for each roll. */
export function useRollFlash(me: string, trayOpen: boolean, bell: boolean) {
  const [unseen, setUnseen] = useState(false);
  const [wasOpen, setWasOpen] = useState(trayOpen);
  if (wasOpen !== trayOpen) {
    setWasOpen(trayOpen);
    if (!trayOpen) setUnseen(false);
  }
  // Read when a roll arrives, inside socket handlers set up once.
  const now = useRef({ me, trayOpen, bell });
  useEffect(() => { now.current = { me, trayOpen, bell }; }, [me, trayOpen, bell]);

  const arrived = useCallback((roll: ArrivingRoll) => {
    if (rollFlashes(roll, now.current)) setUnseen(true);
  }, []);

  return { flashing: unseen && !trayOpen, openOnHistory: unseen, arrived };
}
