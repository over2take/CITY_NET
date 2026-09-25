/**
 * What each button in a token's window does when pressed.
 *
 * tokenActions.test.ts checks who gets which button; this presses every one of them against
 * fakes and checks exactly what it sent, fetched or opened - the attack it starts, the row
 * it deletes, the window it opens and where.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildTokenActions, besidePanel, type TokenActionContext, type TokenViewer } from '../tokenActions';

const everyone: TokenViewer = {
  isAdmin: true, isOwner: false, isLoggedIn: true, isPlayerToken: true, hasOwner: true,
  sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: true,
  hasRoster: true, systemHasVehicles: true, hasBattleMaps: true,
};

const context = (over: Partial<TokenActionContext> = {}): TokenActionContext => ({
  location: { id: 42, name: 'GHOST', shape: 'rhombus', owner: 'ghost', width: 1, height: 1, depth: 1 },
  authToken: 'tok',
  emit: vi.fn(),
  fetch: vi.fn(async () => ({ ok: true })),
  panelPos: { x: 100, y: 50 },
  viewportWidth: 1600,
  knownLocations: [],
  refreshLocations: vi.fn(),
  sheetLink: { sheet_id: 7, npc_label: 'Ganger' },
  tier: 'mook',
  isOwner: false,
  open: {
    reviewHealth: vi.fn(), hitPoints: vi.fn(), ownSheet: vi.fn(), playerSheet: vi.fn(), npcSheet: vi.fn(),
    editLocation: vi.fn(), vehicles: vi.fn(), bank: vi.fn(), enemyVehicles: vi.fn(), battleMap: vi.fn(),
  },
  ping: vi.fn(),
  broadcast: vi.fn(),
  clearSelection: vi.fn(),
  ...over,
});

/** Press the button with this key, from the list built for this viewer. */
const press = async (key: string, c: TokenActionContext, viewer: Partial<TokenViewer> = {}) => {
  const action = buildTokenActions({ ...everyone, ...viewer }, c).find((a) => a.key === key);
  if (!action) throw new Error(`no ${key} button for this viewer`);
  await action.onClick();
  return action;
};

const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('attacks', () => {
  it('ATTACK starts an attack on this token and lets the sheet pick the weapon', async () => {
    const c = context();
    await press('attack', c, { sheetCombat: true });
    expect(c.emit).toHaveBeenCalledWith('initiateAttack', { targetId: 42, attackType: 'melee' });
  });

  it('MELEE and RANGED start that kind of attack', async () => {
    const c = context();
    await press('melee', c);
    await press('ranged', c);
    expect(c.emit).toHaveBeenNthCalledWith(1, 'initiateAttack', { targetId: 42, attackType: 'melee' });
    expect(c.emit).toHaveBeenNthCalledWith(2, 'initiateAttack', { targetId: 42, attackType: 'ranged' });
  });
});

describe('health', () => {
  it("CHECK_HEALTH opens the owner's health beside the window", async () => {
    const c = context();
    await press('check-health', c, { isAdmin: false });
    expect(c.open.reviewHealth).toHaveBeenCalledWith('ghost', { x: 420, y: 50 }, 42);
  });

  it('opens health on the left when there is no room on the right', () => {
    expect(besidePanel({ x: 1200, y: 10 }, 1600)).toEqual({ x: 880, y: 10 });
    expect(besidePanel({ x: 100, y: 10 }, 300)).toEqual({ x: 0, y: 10 });
  });

  it('UPDATE_HEALTH opens the health window and makes nothing for a real token', async () => {
    const c = context();
    await press('update-health', c);
    expect(c.open.hitPoints).toHaveBeenCalledWith({ x: 420, y: 50 });
    expect(c.fetch).not.toHaveBeenCalled();
  });

  it('UPDATE_HEALTH makes the row first for a player who never placed a token', async () => {
    const order: string[] = [];
    const c = context({
      location: { id: -1, shape: 'rhombus', owner: 'ghost' },
      fetch: vi.fn(async () => { order.push('create'); return { ok: true }; }),
      refreshLocations: vi.fn(async () => { order.push('refresh'); }),
    });
    mockOf(c.open.hitPoints).mockImplementation(() => { order.push('open'); });
    await press('update-health', c);
    const [url, init] = mockOf(c.fetch).mock.calls[0];
    expect(url).toBe('/api/locations');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({ shape: 'rhombus', owner: 'ghost', hp_max: 100 });
    // The window opens onto a row that exists.
    expect(order).toEqual(['create', 'refresh', 'open']);
  });

  it('UPDATE_HEALTH makes no second row when the player already has one', async () => {
    const c = context({ location: { id: -1, shape: 'rhombus', owner: 'ghost' }, knownLocations: [{ shape: 'rhombus', owner: 'ghost' }] });
    await press('update-health', c);
    expect(c.fetch).not.toHaveBeenCalled();
    expect(c.open.hitPoints).toHaveBeenCalled();
  });
});

describe('sheets', () => {
  it("OPEN_SHEET opens your own sheet on your token, and the player's for the GM", async () => {
    const own = context({ isOwner: true });
    await press('player-sheet', own, { isOwner: true });
    expect(own.open.ownSheet).toHaveBeenCalled();
    expect(own.open.playerSheet).not.toHaveBeenCalled();

    const gm = context();
    await press('player-sheet', gm);
    expect(gm.open.playerSheet).toHaveBeenCalledWith('ghost');
  });

  it("OPEN_SHEET on an NPC opens its linked sheet", async () => {
    const c = context({ location: { id: 9, shape: 'enemy_rhombus', owner: null } });
    await press('npc-sheet', c, { isPlayerToken: false, sheetHere: true, linked: true });
    expect(c.open.npcSheet).toHaveBeenCalledWith({ id: 7, npc_label: 'Ganger', token_shape: 'enemy_rhombus', locationId: 9 });
  });

  it('GENERATE_SHEET asks the server for a sheet at the chosen tier', async () => {
    const c = context({ location: { id: 9, shape: 'enemy_rhombus', owner: null } });
    await press('generate-sheet', c, { isPlayerToken: false });
    expect(c.emit).toHaveBeenCalledWith('generateNpcSheet', { location_id: 9, tier: 'mook' });
  });

  it('EDIT_DATA_POINT opens the edit window on this token', async () => {
    const c = context({ location: { id: 9, shape: 'enemy_rhombus', owner: null } });
    await press('edit', c, { isPlayerToken: false });
    expect(c.open.editLocation).toHaveBeenCalledWith(c.location);
  });
});

describe('the rest', () => {
  it('VEHICLES, VIEW_BANK, ENEMY VEHICLES and ENTER BATTLE MAP open their windows', async () => {
    const c = context();
    await press('vehicles', c);
    await press('bank', c);
    await press('enemy-vehicles', c);
    await press('battle', c);
    expect(c.open.vehicles).toHaveBeenCalled();
    expect(c.open.bank).toHaveBeenCalledWith('ghost');
    expect(c.open.enemyVehicles).toHaveBeenCalled();
    expect(c.open.battleMap).toHaveBeenCalledWith(42);
  });

  it('BROADCAST PING and BROADCAST_THIS do what they say', async () => {
    const c = context();
    await press('ping', c);
    await press('broadcast', c);
    expect(c.ping).toHaveBeenCalled();
    expect(c.broadcast).toHaveBeenCalled();
  });

  it('PURGE_DATA_POINT deletes the token and closes its window', async () => {
    const c = context();
    await press('purge', c);
    expect(c.fetch).toHaveBeenCalledWith('/api/locations/42', { method: 'DELETE', headers: { Authorization: 'Bearer tok' } });
    expect(c.clearSelection).toHaveBeenCalled();
    expect(c.refreshLocations).toHaveBeenCalled();
  });

  it('PURGE_DATA_POINT leaves the window open when the server refuses', async () => {
    const c = context({ fetch: vi.fn(async () => ({ ok: false })) });
    await press('purge', c);
    expect(c.clearSelection).not.toHaveBeenCalled();
  });

  it('labels every button, and marks the dangerous one', () => {
    const all = buildTokenActions(everyone, context());
    for (const a of all) expect(a.label, a.key).toBeTruthy();
    expect(all.find((a) => a.key === 'purge')?.tone).toBe('danger');
  });
});
