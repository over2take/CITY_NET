import { useAccountSetting } from './useAccountSetting';

// The dice tray's ROLL or LANDED (6c4b3b): every throw played, or the dice shown as they came to
// rest. Kept on the signed-in person's account and in the browser (useAccountSetting). Starts on ROLL.

export type TrayMotion = 'roll' | 'landed';

const MOTIONS = ['roll', 'landed'] as const;

/** The tray's motion and a way to change it, saved to the account of whoever `authToken` signs in. */
export function useTrayMotion(authToken?: string | null) {
  return useAccountSetting<TrayMotion>('trayMotion', MOTIONS, 'roll', 'citynet_tray_motion', authToken);
}
