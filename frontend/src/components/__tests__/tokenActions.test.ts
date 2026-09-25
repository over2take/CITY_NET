/**
 * Who gets which button in a token's window.
 *
 * The old window's conditions, carried over one for one. Every viewer is checked against
 * the full list it should see - not just that a button appears - so a button leaking to
 * someone who never had it fails here by name.
 */

import { describe, it, expect } from 'vitest';
import { tokenActionKeys, type TokenViewer } from '../tokenActions';

const base: TokenViewer = {
  isAdmin: false, isOwner: false, isLoggedIn: true, isPlayerToken: true, hasOwner: true,
  sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: false,
  hasRoster: false, systemHasVehicles: false, hasBattleMaps: false,
};
const keys = (over: Partial<TokenViewer>) => tokenActionKeys({ ...base, ...over });

describe('a player looking at a token', () => {
  it('can attack another player, look at their health, and ping', () => {
    expect(keys({})).toEqual(['melee', 'ranged', 'check-health', 'ping']);
  });

  it('gets one ATTACK where the sheet picks the weapon', () => {
    expect(keys({ sheetCombat: true })).toEqual(['attack', 'check-health', 'ping']);
  });

  it('cannot attack while already setting one up', () => {
    expect(keys({ attackPending: true })).toEqual(['check-health', 'ping']);
  });

  it('manages their own token: health, sheet, delete - and never attacks it', () => {
    expect(keys({ isOwner: true, canManage: true })).toEqual(['update-health', 'player-sheet', 'ping', 'purge']);
  });

  it('sees an NPC like another player, with none of the GM\'s sheet controls', () => {
    expect(keys({ isPlayerToken: false, hasOwner: false })).toEqual(['melee', 'ranged', 'check-health', 'ping']);
  });

  it('gets VEHICLES when there is somewhere to sit, and nothing about enemy cars', () => {
    expect(keys({ hasRoster: true, systemHasVehicles: true })).toEqual(['melee', 'ranged', 'check-health', 'vehicles', 'ping']);
  });

  it('cannot attack before signing in', () => {
    expect(keys({ isLoggedIn: false })).toEqual(['check-health', 'ping']);
  });
});

describe('the GM looking at a token', () => {
  const gm = { isAdmin: true, canManage: true };

  it('on a player: health, their sheet, their bank, the camera and delete', () => {
    expect(keys(gm)).toEqual(['melee', 'ranged', 'update-health', 'player-sheet', 'bank', 'ping', 'broadcast', 'purge']);
  });

  it('on an NPC with no sheet: generate one, or edit the token by hand', () => {
    expect(keys({ ...gm, isPlayerToken: false, hasOwner: false }))
      .toEqual(['melee', 'ranged', 'update-health', 'generate-sheet', 'edit', 'ping', 'broadcast', 'purge']);
  });

  it('on an NPC with a sheet for this system: open it, and no hand edit', () => {
    expect(keys({ ...gm, isPlayerToken: false, hasOwner: false, sheetHere: true, linked: true }))
      .toEqual(['melee', 'ranged', 'update-health', 'npc-sheet', 'ping', 'broadcast', 'purge']);
  });

  it('on an NPC whose sheet is for another system: generate, but no hand edit', () => {
    expect(keys({ ...gm, isPlayerToken: false, hasOwner: false, sheetHere: false, linked: true }))
      .toEqual(['melee', 'ranged', 'update-health', 'generate-sheet', 'ping', 'broadcast', 'purge']);
  });

  it('gets ENEMY VEHICLES where the system has vehicles, and battle maps where there are some', () => {
    expect(keys({ ...gm, systemHasVehicles: true, hasBattleMaps: true }))
      .toEqual(['melee', 'ranged', 'update-health', 'player-sheet', 'bank', 'enemy-vehicles', 'battle', 'ping', 'broadcast', 'purge']);
  });
});
