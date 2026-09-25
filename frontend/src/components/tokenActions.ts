// Which buttons a token's window offers, to whom.
//
// Pure, and apart from the handlers, so the rules can be read in one place and tested for
// every kind of viewer. They are the old token window's conditions carried over one for one:
// changing the window's look was not a reason to change who can purge a token or open a
// sheet, and a test holds each of them.

export type TokenActionKey =
  | 'attack' | 'melee' | 'ranged'
  | 'check-health' | 'update-health'
  | 'player-sheet' | 'npc-sheet' | 'generate-sheet' | 'edit'
  | 'vehicles' | 'bank' | 'enemy-vehicles' | 'battle'
  | 'ping' | 'broadcast' | 'purge';

export interface TokenViewer {
  /** Signed in as the GM (main or granted). */
  isAdmin: boolean;
  /** This viewer owns this token. */
  isOwner: boolean;
  /** Past the login screen at all. */
  isLoggedIn: boolean;
  /** A player's token, as opposed to an enemy or friendly NPC. */
  isPlayerToken: boolean;
  /** The token has an owner recorded. */
  hasOwner: boolean;
  /** The token is linked to an NPC sheet, and that sheet is for the running system. */
  sheetHere: boolean;
  /** The token is linked to an NPC sheet at all. */
  linked: boolean;
  /** An attack is being set up by this viewer, against any target. */
  attackPending: boolean;
  /** The system resolves attacks from the sheet's weapons, so one ATTACK button. */
  sheetCombat: boolean;
  /** The viewer may delete this token: the GM, or a player their own token. */
  canManage: boolean;
  /** Someone has a vehicle to be seated in. */
  hasRoster: boolean;
  /** The running system has vehicles at all. */
  systemHasVehicles: boolean;
  /** This location has battle maps. */
  hasBattleMaps: boolean;
}

export function tokenActionKeys(v: TokenViewer): TokenActionKey[] {
  const isNpc = !v.isPlayerToken;
  const keys: TokenActionKey[] = [];

  // Attacking: anyone signed in, at anything but their own token, when not already mid-attack.
  if (v.isLoggedIn && !v.isOwner && !v.attackPending) {
    keys.push(...(v.sheetCombat ? ['attack' as const] : ['melee' as const, 'ranged' as const]));
  }
  // Another player's health is looked at; your own, or anyone's for the GM, is changed.
  if (!v.isAdmin && !v.isOwner) keys.push('check-health');
  if (v.isAdmin || (v.isPlayerToken && v.isOwner)) keys.push('update-health');
  // A player's sheet: its owner, or the GM.
  if (v.isPlayerToken && v.hasOwner && (v.isOwner || v.isAdmin)) keys.push('player-sheet');
  // An NPC's sheet, and what the GM does before it has one.
  if (v.isAdmin && isNpc && v.sheetHere) keys.push('npc-sheet');
  if (v.isAdmin && isNpc && !v.sheetHere) keys.push('generate-sheet');
  if (v.isAdmin && isNpc && !v.linked) keys.push('edit');
  if (v.hasRoster) keys.push('vehicles');
  if (v.isAdmin && v.isPlayerToken) keys.push('bank');
  // The enemy roster never reaches a player's client at all.
  if (v.isAdmin && v.systemHasVehicles) keys.push('enemy-vehicles');
  if (v.hasBattleMaps) keys.push('battle');
  keys.push('ping');
  if (v.isAdmin) keys.push('broadcast');
  if (v.canManage) keys.push('purge');
  return keys;
}

// ── What each button does ───────────────────────────────────────────────────

/** A window to the side of the info panel: right of it, or left when there is no room. */
export const besidePanel = (panel: { x: number; y: number }, viewportWidth: number) => ({
  x: panel.x + 320 + 300 > viewportWidth ? Math.max(0, panel.x - 320) : panel.x + 320,
  y: panel.y,
});

/**
 * Everything the buttons reach for, handed in rather than imported, so a test can press every
 * button and see exactly what it sent, fetched or opened.
 */
export interface TokenActionContext {
  location: any;
  /** The admin or editor token, for the calls that need one. */
  authToken: string;
  emit: (event: string, payload: unknown) => void;
  fetch: (url: string, init?: RequestInit) => Promise<{ ok: boolean }>;
  /** Where the info window is, so health windows open beside it. */
  panelPos: { x: number; y: number };
  viewportWidth: number;
  /** Every location the client holds, to tell a synthetic player token from a real one. */
  knownLocations: any[];
  refreshLocations: () => unknown;
  /** The linked NPC sheet, when there is one. */
  sheetLink: { sheet_id: number; npc_label: string } | null;
  /** The tier GENERATE_SHEET asks for, already resolved; undefined where the system has none. */
  tier: string | undefined;
  isOwner: boolean;
  open: {
    reviewHealth: (owner: string, pos: { x: number; y: number }, locationId: number) => void;
    hitPoints: (pos: { x: number; y: number }) => void;
    ownSheet: () => void;
    playerSheet: (owner: string) => void;
    npcSheet: (sheet: { id: number; npc_label: string; token_shape: string; locationId: number }) => void;
    editLocation: (location: any) => void;
    vehicles: () => void;
    bank: (owner: string) => void;
    enemyVehicles: () => void;
    battleMap: (locationId: number) => void;
  };
  ping: () => void;
  broadcast: () => void;
  /** The token is gone: close its window. */
  clearSelection: () => void;
}

const LABEL: Record<TokenActionKey, string> = {
  attack: '⚔ ATTACK', melee: '⚔ MELEE', ranged: '🏹 RANGED',
  'check-health': 'CHECK_HEALTH', 'update-health': 'UPDATE_HEALTH',
  'player-sheet': 'OPEN_SHEET', 'npc-sheet': 'OPEN_SHEET', 'generate-sheet': 'GENERATE_SHEET', edit: 'EDIT_DATA_POINT',
  vehicles: 'VEHICLES', bank: 'VIEW_BANK', 'enemy-vehicles': 'ENEMY VEHICLES', battle: 'ENTER BATTLE MAP',
  ping: 'BROADCAST PING', broadcast: 'BROADCAST_THIS', purge: 'PURGE_DATA_POINT',
};

export interface BuiltTokenAction {
  key: TokenActionKey;
  label: string;
  onClick: () => void | Promise<void>;
  title?: string;
  tone?: 'primary' | 'normal' | 'accent' | 'danger';
}

/** The buttons this viewer gets, each wired to what it does. */
export function buildTokenActions(viewer: TokenViewer, c: TokenActionContext): BuiltTokenAction[] {
  const loc = c.location;
  const attack = (attackType: 'melee' | 'ranged') => c.emit('initiateAttack', { targetId: loc.id, attackType });

  const does: Record<TokenActionKey, Omit<BuiltTokenAction, 'key' | 'label'>> = {
    attack: { tone: 'primary', onClick: () => attack('melee') },
    melee: { tone: 'primary', onClick: () => attack('melee') },
    ranged: { tone: 'primary', onClick: () => attack('ranged') },
    'check-health': { onClick: () => c.open.reviewHealth(loc.owner, besidePanel(c.panelPos, c.viewportWidth), loc.id) },
    'update-health': {
      onClick: async () => {
        const pos = besidePanel(c.panelPos, c.viewportWidth);
        // A player who has never placed their token is shown one that does not exist yet
        // (id -1). Health needs a real row, so one is made on the spot - before the window
        // opens, so it finds the row.
        if (loc.id === -1 && loc.owner && !c.knownLocations.some((l) => l.shape === 'rhombus' && l.owner === loc.owner)) {
          await c.fetch('/api/locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.authToken}` },
            body: JSON.stringify({ name: loc.owner, description: '', shape: 'rhombus', owner: loc.owner, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 100, hp_max: 100, hp_temp: 0, battle_map_id: -1, floor_index: -1 }),
          });
          await c.refreshLocations();
        }
        c.open.hitPoints(pos);
      },
    },
    'player-sheet': { onClick: () => (c.isOwner ? c.open.ownSheet() : c.open.playerSheet(loc.owner)) },
    'npc-sheet': {
      onClick: () => {
        if (c.sheetLink) c.open.npcSheet({ id: c.sheetLink.sheet_id, npc_label: c.sheetLink.npc_label, token_shape: loc.shape, locationId: loc.id });
      },
    },
    'generate-sheet': { onClick: () => c.emit('generateNpcSheet', { location_id: loc.id, tier: c.tier }) },
    edit: { onClick: () => c.open.editLocation(loc) },
    vehicles: { onClick: () => c.open.vehicles() },
    bank: { onClick: () => c.open.bank(loc.owner) },
    'enemy-vehicles': { title: 'Enemy vehicles, kept on NPC sheets between sessions', onClick: () => c.open.enemyVehicles() },
    battle: { tone: 'accent', onClick: () => c.open.battleMap(loc.id) },
    ping: { title: 'Show everyone where this is', onClick: () => c.ping() },
    broadcast: { title: 'Point the stream camera at this object', onClick: () => c.broadcast() },
    purge: {
      tone: 'danger',
      onClick: async () => {
        const res = await c.fetch(`/api/locations/${loc.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${c.authToken}` } });
        if (res.ok) { c.clearSelection(); c.refreshLocations(); }
      },
    },
  };

  return tokenActionKeys(viewer).map((key) => ({ key, label: LABEL[key], ...does[key] }));
}
