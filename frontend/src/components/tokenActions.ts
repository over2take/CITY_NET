// Which buttons and folders a token's window offers, to whom.
//
// Pure, and apart from the handlers, so the rules can be read in one place and tested for
// every kind of viewer. The buttons are the old token window's conditions carried over one
// for one: changing the window's look was not a reason to change who can purge a token or
// open a sheet, and a test holds each of them. Health moved from two buttons into a folder,
// with the same split: the old UPDATE_HEALTH viewers change it, CHECK_HEALTH viewers watch it.

export type TokenActionKey =
  | 'attack' | 'melee' | 'ranged'
  | 'player-sheet' | 'npc-sheet' | 'generate-sheet' | 'edit'
  | 'vehicles' | 'bank' | 'enemy-vehicles' | 'battle'
  | 'ping' | 'broadcast' | 'purge';

export interface TokenViewer {
  /** Signed in as the GM (main or granted). */
  isAdmin: boolean;
  /** The main admin, not a granted editor. */
  isPrimaryAdmin: boolean;
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

// ── Which folders ───────────────────────────────────────────────────────────

export interface TokenView {
  /**
   * Change health - the numbers, HEAL, DAMAGE, injuries - or only watch it: the heart
   * monitor and the injury map, never a number, for someone else's token.
   */
  health: 'edit' | 'watch';
  /** The GM's defense edit and manual initiative entry, under HEALTH. */
  gmSections: boolean;
  /** Your own token: your defense, and rolls straight off your sheet. */
  quickActions: boolean;
  /** Notes only the main admin reads, on NPC tokens. */
  gmNotes: boolean;
}

export function tokenView(v: TokenViewer): TokenView {
  const ownPlayerToken = v.isPlayerToken && v.isOwner;
  return {
    health: v.isAdmin || ownPlayerToken ? 'edit' : 'watch',
    gmSections: v.isAdmin,
    quickActions: ownPlayerToken,
    // What the GM knows about a player is not this, and a granted editor never reads it.
    gmNotes: v.isAdmin && v.isPrimaryAdmin && !v.isPlayerToken,
  };
}

// ── What each button does ───────────────────────────────────────────────────

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
  refreshLocations: () => unknown;
  /** The linked NPC sheet, when there is one. */
  sheetLink: { sheet_id: number; npc_label: string } | null;
  /** The tier GENERATE_SHEET asks for, already resolved; undefined where the system has none. */
  tier: string | undefined;
  isOwner: boolean;
  open: {
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
  'player-sheet': 'OPEN_SHEET', 'npc-sheet': 'OPEN_SHEET', 'generate-sheet': 'GENERATE_SHEET', edit: 'EDIT_DATA_POINT',
  vehicles: 'VEHICLES', bank: 'VIEW_BANK', 'enemy-vehicles': 'ENEMY VEHICLES', battle: 'ENTER BATTLE MAP',
  ping: 'BROADCAST PING', broadcast: 'BROADCAST_THIS', purge: 'REMOVE_TOKEN',
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

  // Worded like the sidebar's own remove buttons: your token is yours to take off the map.
  const label = (key: TokenActionKey) =>
    key === 'purge' && viewer.isPlayerToken && viewer.isOwner ? 'REMOVE_MY_TOKEN' : LABEL[key];
  return tokenActionKeys(viewer).map((key) => ({ key, label: label(key), ...does[key] }));
}

/**
 * A player who has never placed their token is shown one that does not exist yet (id -1).
 * Health needs a real row, so the HEALTH folder offers to make one; this is what it makes.
 */
export async function createPlayerTokenRow(
  c: Pick<TokenActionContext, 'fetch' | 'authToken' | 'refreshLocations'>,
  owner: string,
) {
  await c.fetch('/api/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.authToken}` },
    body: JSON.stringify({ name: owner, description: '', shape: 'rhombus', owner, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 100, hp_max: 100, hp_temp: 0, battle_map_id: -1, floor_index: -1 }),
  });
  await c.refreshLocations();
}

const TOKEN_SHAPES = ['rhombus', 'enemy_rhombus', 'friendly_rhombus'];

export const isTokenShape = (shape: unknown) => TOKEN_SHAPES.includes(shape as string);

/**
 * Whose health the sidebar's HIT_POINTS button opens, in the token window's HEALTH folder.
 *
 * A player's own token - or, before they have placed one, the stand-in quick access shows,
 * where HEALTH offers to make the record. The GM's is the selected token, and with none
 * selected there is nothing to open.
 */
export function hitPointsTarget(c: {
  isGm: boolean;
  selected: any;
  locations: any[];
  userName: string | null;
}): { token: any } | { notice: string } | null {
  if (c.isGm) {
    return c.selected && isTokenShape(c.selected.shape) ? { token: c.selected } : { notice: 'SELECT_A_TOKEN_FIRST' };
  }
  if (!c.userName) return null;
  const own = c.locations.find((l) => l.shape === 'rhombus' && l.owner === c.userName);
  return {
    token: own ?? {
      id: -1, shape: 'rhombus', owner: c.userName, name: c.userName,
      description: 'OPERATOR_ONLINE — beacon not yet deployed',
      x: 0, y: 0, z: 0, width: 0, height: 0, depth: 0,
    },
  };
}
