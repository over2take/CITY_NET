/**
 * The building window's buttons: who gets each, and what each does when pressed.
 * The old window's conditions, carried over one for one.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildingActionKeys, buildBuildingActions, type BuildingViewer, type BuildingActionContext } from '../buildingActions';

const base: BuildingViewer = { shopHere: false, hasBattleMaps: false, isAdmin: false, systemHasVehicles: false };

describe('who gets which button', () => {
  it('a player: ping, and asking for editing rights', () => {
    expect(buildingActionKeys(base)).toEqual(['ping', 'request-edit']);
  });

  it('a player at a shop with a battle map', () => {
    expect(buildingActionKeys({ ...base, shopHere: true, hasBattleMaps: true })).toEqual(['shop', 'battle', 'ping', 'request-edit']);
  });

  it('a player never sees enemy vehicles, even where the system has them', () => {
    expect(buildingActionKeys({ ...base, systemHasVehicles: true })).toEqual(['ping', 'request-edit']);
  });

  it('the GM: the camera and enemy vehicles, and no request for rights they already have', () => {
    expect(buildingActionKeys({ ...base, isAdmin: true, systemHasVehicles: true, shopHere: true }))
      .toEqual(['shop', 'ping', 'broadcast', 'enemy-vehicles']);
  });
});

const context = (over: Partial<BuildingActionContext> = {}): BuildingActionContext => ({
  location: { id: 7, name: "VIC'S ARMS" },
  userName: 'ghost',
  emit: vi.fn(),
  someoneEditing: false,
  notify: vi.fn(),
  open: { shop: vi.fn(), battleMap: vi.fn(), enemyVehicles: vi.fn() },
  ping: vi.fn(),
  broadcast: vi.fn(),
  ...over,
});

const everything: BuildingViewer = { shopHere: true, hasBattleMaps: true, isAdmin: true, systemHasVehicles: true };
const press = (key: string, c: BuildingActionContext, viewer: BuildingViewer = everything) => {
  const a = buildBuildingActions(viewer, c).find((x) => x.key === key);
  if (!a) throw new Error(`no ${key} button`);
  a.onClick();
  return a;
};

describe('pressing each button', () => {
  it("SHOP opens this building's shop", () => {
    const c = context();
    press('shop', c);
    expect(c.open.shop).toHaveBeenCalledWith(c.location);
  });

  it("ENTER BATTLE MAP enters this building's battle map", () => {
    const c = context();
    press('battle', c);
    expect(c.open.battleMap).toHaveBeenCalledWith(7);
  });

  it('BROADCAST PING, BROADCAST_THIS and ENEMY VEHICLES do what they say', () => {
    const c = context();
    press('ping', c);
    press('broadcast', c);
    press('enemy-vehicles', c);
    expect(c.ping).toHaveBeenCalled();
    expect(c.broadcast).toHaveBeenCalled();
    expect(c.open.enemyVehicles).toHaveBeenCalled();
  });

  it('REQUEST_EDITING_RIGHTS asks the GM for this building, and says so', () => {
    const c = context();
    press('request-edit', c, base);
    expect(c.emit).toHaveBeenCalledWith('requestEditing', { userId: 'ghost', userName: 'ghost', locationId: 7, locationName: "VIC'S ARMS" });
    expect(c.notify).toHaveBeenCalledWith('REQUEST_SENT_TO_ADMIN');
  });

  it('REQUEST_EDITING_RIGHTS asks nothing while someone else is editing', () => {
    const c = context({ someoneEditing: true });
    press('request-edit', c, base);
    expect(c.emit).not.toHaveBeenCalled();
    expect(c.notify).toHaveBeenCalledWith('ANOTHER_USER_ACCESSING_DATA_POINTS');
  });

  it('marks SHOP as the main button', () => {
    expect(press('shop', context()).tone).toBe('primary');
  });
});
