import { describe, it, expect } from 'vitest';
import { rollerOf, rollFlashes, rollOpensTray, diceRailClick } from '../rollNotify';

/**
 * When a roll flashes DICE_TRAY.EXE's buttons (6c4g): someone else's, while the tray is shut,
 * with its bell on. And what the rail's DICE_ROLLER does when clicked while it flashes.
 */

const quiet = { me: 'kes', trayOpen: false, bell: true };

describe('a roll flashing the tray', () => {
  it('is whose roll it is by login account, or the name it came under when there is none', () => {
    expect(rollerOf({ userName: 'KES THE BLADE', account: 'kes' })).toBe('kes');
    expect(rollerOf({ userName: 'rook' })).toBe('rook');
  });

  it('flashes for someone else\'s roll while the tray is shut and its bell is on', () => {
    expect(rollFlashes({ userName: 'rook' }, quiet)).toBe(true);
    expect(rollFlashes({ userName: 'ROOK', account: 'rook' }, quiet)).toBe(true);
  });

  it('never for your own, even under another name: your rolls open the tray themselves', () => {
    expect(rollFlashes({ userName: 'kes' }, quiet)).toBe(false);
    expect(rollFlashes({ userName: 'KES THE BLADE', account: 'kes' }, quiet)).toBe(false);
  });

  it('never with the tray open, where the roll is seen, nor with its bell off', () => {
    expect(rollFlashes({ userName: 'rook' }, { ...quiet, trayOpen: true })).toBe(false);
    expect(rollFlashes({ userName: 'rook' }, { ...quiet, bell: false })).toBe(false);
  });

  it('goes by the account, not the name: a character named as you is still someone else', () => {
    expect(rollFlashes({ userName: 'kes', account: 'rook' }, quiet)).toBe(true);
  });
});

describe('a click on the rail\'s DICE_ROLLER', () => {
  it('opens and shuts its menu as ever while it doesn\'t flash', () => {
    expect(diceRailClick('none', false)).toEqual({ menu: 'dice_menu', openTray: false });
    expect(diceRailClick('dice_menu', false)).toEqual({ menu: 'none', openTray: false });
    expect(diceRailClick('bank_menu', false)).toEqual({ menu: 'dice_menu', openTray: false });
  });

  it('while it flashes, opens the menu and the tray with it, never shutting the menu', () => {
    for (const menu of ['none', 'dice_menu', 'bank_menu']) expect(diceRailClick(menu, true), menu).toEqual({ menu: 'dice_menu', openTray: true });
  });
});

describe('a quiet line (a rest that rolled no dice)', () => {
  it('neither flashes the tray nor opens it, whoever it is for', () => {
    expect(rollFlashes({ userName: 'rook', quiet: true }, quiet)).toBe(false);
    expect(rollOpensTray({ userName: 'KES', account: 'kes', quiet: true }, 'kes')).toBe(false);
  });

  it('a roll of your own opens the tray; someone else\'s doesn\'t', () => {
    expect(rollOpensTray({ userName: 'KES', account: 'kes' }, 'kes')).toBe(true);
    expect(rollOpensTray({ userName: 'rook' }, 'kes')).toBe(false);
  });
});
