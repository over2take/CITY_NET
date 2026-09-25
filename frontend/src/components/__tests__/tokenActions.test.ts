/**
 * Who gets which button and folder in a token's window.
 *
 * The old window's conditions, carried over one for one. Every viewer is checked against
 * the full list it should see - not just that a button appears - so a button leaking to
 * someone who never had it fails here by name. Health was two buttons and is a folder now;
 * the split carried over with it: who had UPDATE_HEALTH edits, who had CHECK_HEALTH watches.
 */

import { describe, it, expect } from 'vitest';
import { tokenActionKeys, tokenView, type TokenViewer } from '../tokenActions';

const base: TokenViewer = {
  isAdmin: false, isPrimaryAdmin: false, isOwner: false, isLoggedIn: true, isPlayerToken: true, hasOwner: true,
  sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: false,
  hasRoster: false, systemHasVehicles: false, hasBattleMaps: false,
};
const keys = (over: Partial<TokenViewer>) => tokenActionKeys({ ...base, ...over });

describe('a player looking at a token', () => {
  it('can attack another player and ping', () => {
    expect(keys({})).toEqual(['melee', 'ranged', 'ping']);
  });

  it('gets one ATTACK where the sheet picks the weapon', () => {
    expect(keys({ sheetCombat: true })).toEqual(['attack', 'ping']);
  });

  it('cannot attack while already setting one up', () => {
    expect(keys({ attackPending: true })).toEqual(['ping']);
  });

  it('manages their own token: sheet, delete - and never attacks it', () => {
    expect(keys({ isOwner: true, canManage: true })).toEqual(['player-sheet', 'ping', 'purge']);
  });

  it('sees an NPC like another player, with none of the GM\'s sheet controls', () => {
    expect(keys({ isPlayerToken: false, hasOwner: false })).toEqual(['melee', 'ranged', 'ping']);
  });

  it('gets VEHICLES when there is somewhere to sit, and nothing about enemy cars', () => {
    expect(keys({ hasRoster: true, systemHasVehicles: true })).toEqual(['melee', 'ranged', 'vehicles', 'ping']);
  });

  it('cannot attack before signing in', () => {
    expect(keys({ isLoggedIn: false })).toEqual(['ping']);
  });
});

describe('the GM looking at a token', () => {
  const gm = { isAdmin: true, canManage: true };

  it('on a player: their sheet, their bank, the camera and delete', () => {
    expect(keys(gm)).toEqual(['melee', 'ranged', 'player-sheet', 'bank', 'ping', 'broadcast', 'purge']);
  });

  it('on an NPC with no sheet: generate one, or edit the token by hand', () => {
    expect(keys({ ...gm, isPlayerToken: false, hasOwner: false }))
      .toEqual(['melee', 'ranged', 'generate-sheet', 'edit', 'ping', 'broadcast', 'purge']);
  });

  it('on an NPC with a sheet for this system: open it, and no hand edit', () => {
    expect(keys({ ...gm, isPlayerToken: false, hasOwner: false, sheetHere: true, linked: true }))
      .toEqual(['melee', 'ranged', 'npc-sheet', 'ping', 'broadcast', 'purge']);
  });

  it('on an NPC whose sheet is for another system: generate, but no hand edit', () => {
    expect(keys({ ...gm, isPlayerToken: false, hasOwner: false, sheetHere: false, linked: true }))
      .toEqual(['melee', 'ranged', 'generate-sheet', 'ping', 'broadcast', 'purge']);
  });

  it('gets ENEMY VEHICLES where the system has vehicles, and battle maps where there are some', () => {
    expect(keys({ ...gm, systemHasVehicles: true, hasBattleMaps: true }))
      .toEqual(['melee', 'ranged', 'player-sheet', 'bank', 'enemy-vehicles', 'battle', 'ping', 'broadcast', 'purge']);
  });
});

describe('which folders a viewer gets', () => {
  const view = (over: Partial<TokenViewer>) => tokenView({ ...base, ...over });
  const npc = { isPlayerToken: false, hasOwner: false };

  it("a player on someone else's token watches their health, and nothing else", () => {
    expect(view({})).toEqual({ health: 'watch', gmSections: false, quickActions: false, gmNotes: false });
    expect(view(npc)).toEqual({ health: 'watch', gmSections: false, quickActions: false, gmNotes: false });
  });

  it('a player on their own token changes their health and gets QUICK ACTIONS', () => {
    expect(view({ isOwner: true })).toEqual({ health: 'edit', gmSections: false, quickActions: true, gmNotes: false });
  });

  it('owning an NPC token is not owning a character: no rolls, and health only watched', () => {
    expect(view({ ...npc, isOwner: true })).toEqual({ health: 'watch', gmSections: false, quickActions: false, gmNotes: false });
  });

  it('the main admin on an NPC edits health, defense and initiative, and keeps notes', () => {
    expect(view({ ...npc, isAdmin: true, isPrimaryAdmin: true })).toEqual({ health: 'edit', gmSections: true, quickActions: false, gmNotes: true });
  });

  it('the GM on a player token edits health, but keeps no notes on players', () => {
    expect(view({ isAdmin: true, isPrimaryAdmin: true })).toEqual({ health: 'edit', gmSections: true, quickActions: false, gmNotes: false });
  });

  it('a granted editor never reads the GM notes', () => {
    expect(view({ ...npc, isAdmin: true, isPrimaryAdmin: false }).gmNotes).toBe(false);
  });
});
