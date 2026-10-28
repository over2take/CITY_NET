import { useAccountSetting } from './useAccountSetting';

// The dice tray's bell (6c4g): ON, someone else's roll made while the tray is shut flashes its
// buttons (utils/rollNotify.ts); OFF, it doesn't. Kept on the signed-in person's account and in the
// browser (useAccountSetting), apart from chat's bell. Starts ON.

export type TrayNotify = 'on' | 'off';

const CHOICES = ['on', 'off'] as const;

/** The tray's bell and a way to change it, saved to the account of whoever `authToken` signs in. */
export function useTrayNotify(authToken?: string | null) {
  return useAccountSetting<TrayNotify>('trayNotify', CHOICES, 'on', 'citynet_tray_notify', authToken);
}
