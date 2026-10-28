// When a roll flashes DICE_TRAY.EXE's buttons (6c4g): the DICE_ROLLER button on the rail and the
// DICE_TRAY.exe button in its menu, until the tray is opened. Like chat's: someone else's roll,
// made while the tray is shut, with the tray's bell on. Your own rolls open the tray themselves.
// Only rolls the server sends you can flash, so a roll kept from you never gives itself away.

/** A roll as it arrives: whose it is, by login account, and the name it was rolled under. */
export interface ArrivingRoll {
  userName: string;
  account?: string;
}

/** Whose roll it is: the login account, or the name it came under when the server sent none. */
export const rollerOf = (roll: ArrivingRoll) => roll.account ?? roll.userName;

/** Whether `roll` flashes the tray's buttons for `me`. */
export const rollFlashes = (roll: ArrivingRoll, { me, trayOpen, bell }: { me: string; trayOpen: boolean; bell: boolean }) =>
  bell && !trayOpen && rollerOf(roll) !== me;

/**
 * What a click on the rail's DICE_ROLLER does: opens or shuts its menu, as ever; but while it
 * flashes, the menu doesn't show the rolls it flashes for, so the click opens the menu (never
 * shutting it) and the tray with it.
 */
export const diceRailClick = (activeMenu: string, flashing: boolean) =>
  flashing
    ? { menu: 'dice_menu', openTray: true }
    : { menu: activeMenu === 'dice_menu' ? 'none' : 'dice_menu', openTray: false };
